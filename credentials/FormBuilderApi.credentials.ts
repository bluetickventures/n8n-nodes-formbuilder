import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow'

export class FormBuilderApi implements ICredentialType {
  name = 'formBuilderApi'
  displayName = 'FormBuilder API'
  documentationUrl = 'https://formbuilder.com/developers'
  icon = 'file:../nodes/FormBuilder/formbuilder.svg' as const
  properties: INodeProperties[] = [
    {
      displayName: 'API Token',
      name: 'apiToken',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      description:
        'Create a token in FormBuilder Settings → Developer. Use forms:read for connection tests, responses:read for responses/files, hooks:manage for triggers and forms:write for draft creation.',
    },
  ]
  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: { Authorization: '=Bearer {{$credentials.apiToken}}' },
    },
  }
  test: ICredentialTestRequest = {
    request: {
      baseURL: 'https://api.formbuilder.com/api/v1',
      url: '/me',
      method: 'GET',
      disableFollowRedirect: true,
    },
  }
}
