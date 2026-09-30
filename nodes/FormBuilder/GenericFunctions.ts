import type {
  IDataObject,
  IExecuteFunctions,
  IHookFunctions,
  ILoadOptionsFunctions,
  IWebhookFunctions,
  IHttpRequestMethods,
  INodePropertyOptions,
  IHttpRequestOptions,
} from 'n8n-workflow'
import { NodeOperationError } from 'n8n-workflow'

type Context =
  | IExecuteFunctions
  | IHookFunctions
  | ILoadOptionsFunctions
  | IWebhookFunctions
export const API_BASE = 'https://api.formbuilder.com/api/v1'
export function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(value))
    throw new Error('Enter a valid FormBuilder ID')
  return value
}
export function record(value: unknown): value is IDataObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
export function statusCode(error: unknown): number {
  const e = error as {
    statusCode?: unknown
    status?: unknown
    httpCode?: unknown
    response?: { status?: unknown }
  }
  return Number(
    e?.statusCode || e?.status || e?.httpCode || e?.response?.status || 0
  )
}
export async function apiRequest(
  this: Context,
  method: IHttpRequestMethods,
  path: string,
  body?: IDataObject,
  qs?: IDataObject,
  binary = false
): Promise<IDataObject> {
  if (
    !/^\/(?:me|forms|hooks)(?:[/?]|$)/.test(path) ||
    path.includes('..') ||
    [...path].some(
      character => character.charCodeAt(0) <= 32 || character === '\\'
    )
  )
    throw new NodeOperationError(this.getNode(), 'Invalid FormBuilder API path')
  const options: IHttpRequestOptions = {
    method,
    url: API_BASE + path,
    disableFollowRedirect: true,
    sendCredentialsOnCrossOriginRedirect: false,
    timeout: 30000,
    returnFullResponse: true,
    ...(body ? { body } : {}),
    ...(qs ? { qs } : {}),
    ...(binary ? { encoding: 'stream' } : { json: true }),
  }
  try {
    const response = await this.helpers.httpRequestWithAuthentication.call(
      this,
      'formBuilderApi',
      options
    )
    if (!response || response.statusCode < 200 || response.statusCode >= 300)
      throw new Error('Unexpected API status')
    if (binary) return response
    if (!record(response.body)) throw new Error('Invalid API response')
    return response.body
  } catch (error) {
    const status = statusCode(error)
    const description =
      status === 401
        ? 'The token is invalid, expired or revoked. Reconnect the credential.'
        : status === 403
          ? 'The token lacks permission or the response is not currently eligible.'
          : status === 404
            ? 'The item does not exist or belongs to another owner.'
            : status === 429
              ? 'FormBuilder is limiting requests. Retry later.'
              : status === 402
                ? 'The FormBuilder plan limit was reached.'
                : 'Check the connection and retry. No redirect is followed.'
    // Do not attach an HTTP client error containing credentials, response answers
    // or a webhook capability URL to persisted n8n execution data.
    const safe = new NodeOperationError(
      this.getNode(),
      `FormBuilder request failed${status ? ` (${status})` : ''}`,
      { description }
    )
    Object.assign(safe, { httpCode: String(status) })
    throw safe
  }
}
export async function list(
  this: Context,
  path: string,
  limit: number,
  returnAll: boolean
): Promise<IDataObject[]> {
  const results: IDataObject[] = []
  const seen = new Set<string>()
  for (let page = 1; page <= 100; page++) {
    const response = await apiRequest.call(this, 'GET', path, undefined, {
      page,
      limit: Math.min(100, returnAll ? 100 : limit - results.length),
    })
    if (
      !Array.isArray(response.data) ||
      !record(response.pagination) ||
      !Number.isFinite(response.pagination.total) ||
      response.pagination.page !== page
    )
      throw new NodeOperationError(
        this.getNode(),
        'Invalid FormBuilder pagination'
      )
    for (const row of response.data) {
      if (!record(row) || typeof row.id !== 'string')
        throw new NodeOperationError(
          this.getNode(),
          'Invalid FormBuilder list item'
        )
      if (!seen.has(row.id)) {
        seen.add(row.id)
        results.push(row)
      }
    }
    if (!returnAll && results.length >= limit) return results.slice(0, limit)
    if (
      page * Number(response.pagination.limit) >=
      Number(response.pagination.total)
    )
      return results
    if (!response.data.length)
      throw new NodeOperationError(
        this.getNode(),
        'FormBuilder pagination ended before its reported total'
      )
  }
  throw new NodeOperationError(
    this.getNode(),
    'More than 10,000 items were returned. Use a smaller scope or a limited query.'
  )
}
export async function getForms(
  this: ILoadOptionsFunctions
): Promise<INodePropertyOptions[]> {
  const forms = await list.call(this, '/forms', 100, true)
  return forms.map(form => ({
    name: String(form.title || form.id),
    value: String(form.id),
  }))
}
export async function getFields(
  this: ILoadOptionsFunctions
): Promise<INodePropertyOptions[]> {
  const formId = id(this.getCurrentNodeParameter('formId'))
  const response = await apiRequest.call(this, 'GET', `/forms/${formId}/fields`)
  if (!Array.isArray(response.data))
    throw new NodeOperationError(
      this.getNode(),
      'Invalid FormBuilder field schema'
    )
  return response.data.map(field => {
    if (!record(field))
      throw new NodeOperationError(this.getNode(), 'Invalid FormBuilder field')
    return {
      name: String(field.label || field.id),
      value: id(field.id),
      description: String(field.type || ''),
    }
  })
}
export async function getFiles(
  this: ILoadOptionsFunctions
): Promise<INodePropertyOptions[]> {
  const formId = id(this.getCurrentNodeParameter('formId')),
    responseId = id(this.getCurrentNodeParameter('responseId'))
  const files = await list.call(
    this,
    `/forms/${formId}/responses/${responseId}/files`,
    100,
    true
  )
  return files.map(file => ({
    name: String(file.file_name || file.id),
    value: id(file.id),
  }))
}
export function selectedResponse(
  response: IDataObject,
  selected: string[]
): IDataObject {
  if (!selected.length) return response
  const answers = record(response.data) ? response.data : {}
  return {
    ...response,
    data: Object.fromEntries(
      selected
        .filter(key => Object.prototype.hasOwnProperty.call(answers, key))
        .map(key => [key, answers[key]])
    ),
  }
}
export async function getResponse(
  this: Context,
  formId: string,
  responseId: string,
  selected: string[] = []
): Promise<IDataObject> {
  const response = await apiRequest.call(
    this,
    'GET',
    `/forms/${id(formId)}/responses/${id(responseId)}`
  )
  if (
    !record(response.form) ||
    response.form.id !== formId ||
    !record(response.data) ||
    response.data.id !== responseId ||
    response.data.locked === true
  )
    throw new NodeOperationError(
      this.getNode(),
      'The requested response is unavailable'
    )
  return {
    form_id: formId,
    form_title: response.form.title,
    response_id: responseId,
    ...selectedResponse(response.data, selected),
  }
}
