import type {
  IDataObject,
  IHookFunctions,
  INodeType,
  INodeTypeDescription,
  IWebhookFunctions,
  IWebhookResponseData,
} from 'n8n-workflow'
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow'
import { formProperty, selectedFields } from './Descriptions'
import {
  getFields,
  getForms,
  getResponse,
  id,
  record,
  statusCode,
} from './GenericFunctions'

import { checkHook, createHook, deleteHook, hookKey } from './TriggerFunctions'
export class FormBuilderTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'FormBuilder Trigger',
    name: 'formBuilderTrigger',
    icon: { light: 'file:formbuilder.svg', dark: 'file:formbuilder.dark.svg' },
    subtitle: '={{$parameter["event"]}}',
    group: ['trigger'],
    version: 1,
    description: 'Start a workflow when a FormBuilder response is created',
    defaults: { name: 'FormBuilder Trigger' },
    inputs: [],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: 'formBuilderApi', required: true }],
    webhooks: [
      {
        name: 'default',
        httpMethod: 'POST',
        responseMode: 'onReceived',
        path: 'webhook',
      },
    ],
    properties: [
      {
        displayName: 'Event',
        name: 'event',
        type: 'options',
        options: [{ name: 'Response Created', value: 'response.created' }],
        default: 'response.created',
      },
      formProperty,
      selectedFields,
      {
        displayName: 'Include Test Responses',
        name: 'includeTest',
        type: 'boolean',
        default: false,
        description:
          'Whether to trigger for responses marked as test submissions',
      },
    ],
  }
  methods = { loadOptions: { getForms, getFields } }
  webhookMethods = {
    default: {
      async checkExists(this: IHookFunctions): Promise<boolean> {
        return checkHook.call(this)
      },
      async create(this: IHookFunctions): Promise<boolean> {
        return createHook.call(this)
      },
      async delete(this: IHookFunctions): Promise<boolean> {
        return deleteHook.call(this)
      },
    },
  }
  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const saved = this.getWorkflowStaticData('node')[hookKey(this.getMode())]
    const query = this.getQueryData() as IDataObject
    const body = this.getBodyData()
    const formId = id(this.getNodeParameter('formId'))
    if (
      !record(saved) ||
      saved.formId !== formId ||
      typeof saved.secret !== 'string' ||
      query.formbuilder_secret !== saved.secret ||
      body.event !== 'response.created' ||
      body.form_id !== formId ||
      typeof body.response_id !== 'string'
    )
      return { workflowData: [] }
    try {
      // Notification bodies are unsigned. Only their IDs are hints: fetch current
      // authorized data directly, so revoked tokens and locked answers fail closed.
      const response = await getResponse.call(
        this,
        formId,
        id(body.response_id),
        this.getNodeParameter('selectedFields', []) as string[]
      )
      if (
        response.is_test === true &&
        !this.getNodeParameter('includeTest', false)
      )
        return { workflowData: [] }
      return {
        workflowData: [
          this.helpers.returnJsonArray([
            { event: 'response.created', ...response },
          ]),
        ],
      }
    } catch (error) {
      if ([403, 404].includes(statusCode(error))) return { workflowData: [] }
      throw new NodeOperationError(
        this.getNode(),
        'Unable to verify the current FormBuilder response',
        {
          description:
            'Check the token and API availability, then retry the notification.',
        }
      )
    }
  }
}
