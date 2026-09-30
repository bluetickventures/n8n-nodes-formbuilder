import type { IDataObject, IHookFunctions } from 'n8n-workflow'
import { NodeOperationError, randomString } from 'n8n-workflow'
import { apiRequest, id, list, record, statusCode } from './GenericFunctions'
export function hookKey(mode: string): string {
  return mode === 'manual' ? 'testHook' : 'productionHook'
}
function matches(hook: IDataObject, saved: IDataObject) {
  return (
    hook.target_url === saved.target_url &&
    hook.form_id === saved.formId &&
    hook.event === 'response.created'
  )
}
function target(this: IHookFunctions, secret: string): string {
  const base = this.getNodeWebhookUrl('default')
  if (!base || !base.startsWith('https://'))
    throw new NodeOperationError(
      this.getNode(),
      'Use a publicly reachable HTTPS n8n webhook URL'
    )
  const url = new URL(base)
  url.searchParams.set('formbuilder_secret', secret)
  return url.toString()
}
export async function checkHook(this: IHookFunctions): Promise<boolean> {
  const data = this.getWorkflowStaticData('node'),
    slot = hookKey(this.getMode()),
    formId = id(this.getNodeParameter('formId'))
  let saved = record(data[slot]) ? (data[slot] as IDataObject) : undefined
  const hooks = await list.call(this, '/hooks', 100, true)
  if (
    saved &&
    typeof saved.secret === 'string' &&
    (saved.formId !== formId ||
      saved.target_url !== target.call(this, saved.secret))
  ) {
    for (const hook of hooks.filter(hook => matches(hook, saved!)))
      await apiRequest.call(this, 'DELETE', `/hooks/${id(hook.id)}`)
    delete data[slot]
    saved = undefined
  }
  if (!saved || typeof saved.secret !== 'string') {
    const secret = randomString(48)
    saved = {
      secret,
      formId,
      target_url: target.call(this, secret),
      uncertain: false,
    }
    data[slot] = saved
  }
  const existing = hooks.filter(hook => matches(hook, saved!))
  if (!existing.length) {
    delete saved.id
    return false
  }
  // Reconcile duplicates of this exact secret callback only. Never touch another
  // node, manual/production mode, form, or token's subscriptions.
  for (const extra of existing.slice(1))
    await apiRequest.call(this, 'DELETE', `/hooks/${id(extra.id)}`)
  saved.id = id(existing[0].id)
  saved.uncertain = false
  return true
}
export async function createHook(this: IHookFunctions): Promise<boolean> {
  if (await checkHook.call(this)) return true
  const saved = this.getWorkflowStaticData('node')[
    hookKey(this.getMode())
  ] as IDataObject
  if (saved.uncertain)
    throw new NodeOperationError(
      this.getNode(),
      'Subscription creation is uncertain',
      {
        description:
          'Activation only reconciles an existing subscription. Revoke the old FormBuilder token and recreate this trigger if no subscription appears.',
      }
    )
  // Keep the callback capability before POST, so a lost response can be recovered
  // using the current-token hook catalog. Never blindly repeat an ambiguous POST.
  saved.uncertain = true
  try {
    const created = await apiRequest.call(this, 'POST', '/hooks', {
      target_url: saved.target_url,
      form_id: saved.formId,
      event: 'response.created',
    })
    if (
      typeof created.id !== 'string' ||
      created.form_id !== saved.formId ||
      created.event !== 'response.created'
    )
      throw new NodeOperationError(
        this.getNode(),
        'The subscription result is uncertain'
      )
    saved.id = id(created.id)
    saved.uncertain = false
    return true
  } catch (error) {
    const status = statusCode(error)
    if (status >= 400 && status < 500) saved.uncertain = false
    throw new NodeOperationError(
      this.getNode(),
      'FormBuilder subscription could not be confirmed',
      {
        description:
          'Check the connection. Reactivation checks for the existing callback before attempting another subscription.',
      }
    )
  }
}
export async function deleteHook(this: IHookFunctions): Promise<boolean> {
  const data = this.getWorkflowStaticData('node'),
    slot = hookKey(this.getMode()),
    saved = data[slot]
  if (!record(saved)) return true
  const hooks = await list.call(this, '/hooks', 100, true)
  for (const hook of hooks.filter(hook => matches(hook, saved)))
    await apiRequest.call(this, 'DELETE', `/hooks/${id(hook.id)}`)
  delete data[slot]
  return true
}
