import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow'
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow'
import { properties } from './Descriptions'
import {
  apiRequest,
  getFields,
  getFiles,
  getForms,
  getResponse,
  id,
  list,
  record,
  selectedResponse,
} from './GenericFunctions'

export class FormBuilder implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'FormBuilder',
    name: 'formBuilder',
    icon: { light: 'file:formbuilder.svg', dark: 'file:formbuilder.dark.svg' },
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description:
      'Create forms, read responses and download private response files',
    defaults: { name: 'FormBuilder' },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    usableAsTool: true,
    credentials: [{ name: 'formBuilderApi', required: true }],
    properties,
  }
  methods = { loadOptions: { getForms, getFields, getFiles } }
  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const output: INodeExecutionData[] = []
    for (
      let itemIndex = 0;
      itemIndex < this.getInputData().length;
      itemIndex++
    ) {
      try {
        const resource = this.getNodeParameter('resource', itemIndex) as string,
          operation = this.getNodeParameter('operation', itemIndex) as string
        let result: IDataObject[] = []
        if (resource === 'form' && operation === 'create') {
          const title = String(this.getNodeParameter('title', itemIndex)).trim()
          const fields = this.getNodeParameter('fields', itemIndex, {}) as {
            field?: IDataObject[]
          }
          if (
            !title ||
            title.length > 200 ||
            !Array.isArray(fields.field) ||
            !fields.field.length ||
            fields.field.length > 100
          )
            throw new NodeOperationError(
              this.getNode(),
              'Enter a title and between 1 and 100 fields'
            )
          const payload = {
            title,
            description: String(
              this.getNodeParameter('description', itemIndex, '')
            ),
            publish: false,
            fields: fields.field.map(field => ({
              label: String(field.label || ''),
              type: String(field.type || 'text'),
              required: field.required === true,
            })),
          }
          if (
            payload.fields.some(
              field =>
                !field.label.trim() ||
                !['email', 'file', 'number', 'text', 'textarea'].includes(
                  field.type
                )
            )
          )
            throw new NodeOperationError(
              this.getNode(),
              'Review the field labels and types'
            )
          const created = await apiRequest.call(this, 'POST', '/forms', payload)
          if (typeof created.id !== 'string' || created.status !== 'draft')
            throw new NodeOperationError(
              this.getNode(),
              'The form may have been created. Check FormBuilder before retrying.'
            )
          result = [created]
        } else {
          const formId =
            resource === 'form' && operation === 'getMany'
              ? ''
              : id(this.getNodeParameter('formId', itemIndex))
          const responsePath = formId ? `/forms/${formId}/responses` : ''
          if (resource === 'response' && operation === 'get') {
            result = [
              await getResponse.call(
                this,
                formId,
                id(this.getNodeParameter('responseId', itemIndex)),
                this.getNodeParameter(
                  'selectedFields',
                  itemIndex,
                  []
                ) as string[]
              ),
            ]
          } else if (resource === 'form' && operation === 'getFields') {
            const response = await apiRequest.call(
              this,
              'GET',
              `/forms/${formId}/fields`
            )
            if (!Array.isArray(response.data))
              throw new NodeOperationError(
                this.getNode(),
                'Invalid form field schema'
              )
            result = response.data as IDataObject[]
          } else if (operation === 'getMany') {
            const returnAll = this.getNodeParameter(
              'returnAll',
              itemIndex,
              false
            ) as boolean
            const limit = returnAll
              ? 100
              : Number(this.getNodeParameter('limit', itemIndex, 50))
            if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
              throw new NodeOperationError(
                this.getNode(),
                'Choose a limit from 1 to 1000'
              )
            const path =
              resource === 'form'
                ? '/forms'
                : resource === 'response'
                  ? responsePath
                  : `${responsePath}/${id(this.getNodeParameter('responseId', itemIndex))}/files`
            result = await list.call(this, path, limit, returnAll)
            if (resource === 'response')
              result = result.map(row => ({
                form_id: formId,
                response_id: row.id,
                ...selectedResponse(
                  row,
                  this.getNodeParameter(
                    'selectedFields',
                    itemIndex,
                    []
                  ) as string[]
                ),
              }))
          } else if (resource === 'file' && operation === 'download') {
            const responseId = id(
                this.getNodeParameter('responseId', itemIndex)
              ),
              fileId = id(this.getNodeParameter('fileId', itemIndex))
            const property = String(
              this.getNodeParameter('binaryPropertyName', itemIndex, 'data')
            )
            if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(property))
              throw new NodeOperationError(
                this.getNode(),
                'Choose a simple output binary field name'
              )
            const response = await apiRequest.call(
              this,
              'GET',
              `${responsePath}/${responseId}/files/${fileId}/download`,
              undefined,
              undefined,
              true
            )
            const headers = record(response.headers) ? response.headers : {}
            const disposition = String(headers['content-disposition'] || '')
            const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
            let filename = encoded
              ? decodeURIComponent(encoded)
              : disposition.match(/filename="([^"]+)"/i)?.[1] || fileId
            filename =
              [...filename]
                .map(character =>
                  character === '/' ||
                  character === '\\' ||
                  character.charCodeAt(0) < 32 ||
                  character.charCodeAt(0) === 127
                    ? '_'
                    : character
                )
                .join('')
                .slice(0, 200) || fileId
            const binary = await this.helpers.prepareBinaryData(
              response.body as Parameters<
                typeof this.helpers.prepareBinaryData
              >[0],
              filename,
              'application/octet-stream'
            )
            output.push({
              json: {
                form_id: formId,
                response_id: responseId,
                file_id: fileId,
                file_name: filename,
              },
              binary: { [property]: binary },
              pairedItem: { item: itemIndex },
            })
            continue
          } else
            throw new NodeOperationError(
              this.getNode(),
              'Unsupported FormBuilder operation'
            )
        }
        output.push(
          ...result.map(json => ({ json, pairedItem: { item: itemIndex } }))
        )
      } catch (error) {
        const safe =
          error instanceof NodeOperationError
            ? error
            : new NodeOperationError(
                this.getNode(),
                'FormBuilder could not complete this operation',
                { itemIndex }
              )
        if (this.continueOnFail())
          output.push({
            json: { error: safe.message },
            pairedItem: { item: itemIndex },
          })
        else throw safe
      }
    }
    return [output]
  }
}
