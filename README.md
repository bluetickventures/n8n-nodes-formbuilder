# n8n-nodes-formbuilder

Native FormBuilder nodes for n8n: create draft forms, choose forms and fields, read responses directly, list private attachments, download original files into n8n binary data, and start workflows from new responses.

Requires a [FormBuilder](https://formbuilder.com) account. Install it in self-hosted n8n from **Settings → Community Nodes** using the package name `n8n-nodes-formbuilder`.

## Build and local checks

Use Node.js 24 for the current development SDK. The package was scaffolded using the official `@n8n/node-cli` 0.47.2 programmatic template. Tools and the `n8n-workflow` 2.16.0 development SDK are locked in `package-lock.json`. The distributed nodes have no external runtime dependencies other than the n8n host's `n8n-workflow` peer.

```sh
npm ci
npm run build
npm run lint
npm pack
```

`npm pack` creates the package tarball locally. Follow [n8n's local development workflow](https://docs.n8n.io/connect/create-nodes/build-your-node/using-the-n8n-node-tool) to load the built node into an authorized self-hosted development instance. `npm run dev` is available but was not used to create an account or register with a hosted service. Installing in n8n Cloud requires marketplace verification.

## Credentials

Create a personal API token in FormBuilder's Developer settings and enter it in the **FormBuilder API** credential. The credential is stored by n8n's credential system; the node does not put it in workflow parameters or execution output.

| Capability                                 | Required token scopes               |
| ------------------------------------------ | ----------------------------------- |
| Connection test, forms and field selection | `forms:read`                        |
| Responses and original file downloads      | `responses:read`                    |
| Response trigger subscription and cleanup  | `hooks:manage` and `responses:read` |
| Create draft form                          | `forms:write`                       |

Use all four scopes for the supplied recipes. API requests always use `https://api.formbuilder.com/api/v1`, pass authentication through `httpRequestWithAuthentication`, and do not follow redirects. No user-controlled API base URL is accepted. HTTP failures are sanitized before appearing in execution data.

## Nodes and operations

**FormBuilder Trigger**

- Event: Response Created.
- Choose a real form from the dynamic picker or use an ID expression.
- Choose answer field IDs to return, or leave the selection empty for all answers.
- Test submissions are excluded unless **Include Test Responses** is enabled.
- Activation subscribes automatically; deactivation removes this node's subscription. Test and production callbacks use separate saved records.

**FormBuilder**

| Resource | Operations                   |
| -------- | ---------------------------- |
| Form     | Get Many, Get Fields, Create |
| Response | Get, Get Many                |
| File     | Get Many, Download           |

Form creation always creates a draft. It does not publish. Text, textarea, email, number and file fields are available in the native collection editor. Existing forms can contain other types; response values keep their original nested shape.

Get Response uses the direct response-ID endpoint, with no paginated search workaround. File Download takes form, response and file IDs and streams authenticated original bytes through `prepareBinaryData`. The output uses the chosen binary property (default `data`), a safe filename and `application/octet-stream`. It never follows the file URL from a submitted answer or turns private files into public links.

Get Many supports a limit or automatic pagination, with a 10,000-item safety ceiling. Lists that change while paging are not a transactional snapshot. The node retains stable item links for downstream expressions.

## Quote and artwork examples

Import either inactive JSON workflow from `examples/` and select your own credential before running it:

- `create-quote-draft.workflow.json`: manual trigger → draft artwork quote form with email, project details, quantity and original file upload.
- `artwork-quote.workflow.json`: new response → native Remove Duplicates using `form_id:response_id` → attachment list → authenticated original-file download into the `artwork` binary field.

Choose the real form in the response trigger. The intake workflow has no configured email, storage, CRM, billing or other external action. Connect an authorized destination after checking the binary output. A response without attachments produces no download items.

The duplicate filter uses n8n's node-scoped 10,000-key history. It records IDs before downstream operations; after a download failure, retry the failed execution rather than clearing history or resubmitting blindly. This is not an exactly-once delivery guarantee.

## Subscription and data safeguards

The API hook catalog only returns the current token's subscriptions. The trigger verifies its exact callback, form and event using that catalog and cleans duplicate subscriptions of that exact callback. A random 48-character capability is added to each callback; keep webhook URLs and workflow static data private. The API does not sign notification bodies.

The node uses only the notification's IDs after checking the capability and expected form. It then fetches the current authorized response from FormBuilder. Answers, file URLs and labels supplied in a forged notification are not trusted. Current token revocation, ownership, response locks and payment eligibility are enforced by the API on every response or file request.

The callback identity is saved before subscription creation. An ambiguous POST result is only reconciled through the hook catalog; it is not blindly repeated. If no matching subscription appears, revoke the previous FormBuilder token and recreate the trigger after reviewing the failed activation. This prevents an unknown orphan subscription from continuing to deliver under that token. A process crash before n8n persists its workflow static data remains an engine-level limitation.

Deactivate before changing credentials so cleanup runs with the token that created the subscription. Another token cannot list that token's hooks, even for the same owner. Revoking the old token stops its hooks; data already stored in n8n executions remains governed by n8n's retention settings.

Native trigger delivery can be retried and duplicated. In-flight notifications and API requests can complete during deactivation. Use stable response/file IDs for downstream idempotency. The package does not decrypt encrypted FormBuilder answers or bypass plan, payment, ownership or file-access restrictions.

## Releases

Releases are published to npm from this repository's GitHub Actions workflow (`.github/workflows/release.yml`) with an npm provenance statement.

## Support

Email support@formbuilder.com or open an issue in this repository. Privacy policy: https://formbuilder.com/privacy
