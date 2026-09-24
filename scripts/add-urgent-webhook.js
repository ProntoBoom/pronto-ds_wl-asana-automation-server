// One-off script: registers ONLY the urgent-keyword webhook for a project
// that predates the urgent-keyword feature (already has FRT registered).
//
// Deliberately does NOT go through the UI's "Register" flow — that flow
// re-creates the FRT webhook too, which would either fail (Asana rejects a
// duplicate webhook for the same resource+target) or, worse, succeed and
// leave two FRT webhooks firing on every comment. This only touches
// /urgent-request.
//
// Run from the app root, once per project that needs it:
//   node scripts/add-urgent-webhook.js <projectGid>
//
// On production (Kinsta), run this from the Web process terminal. No
// redeploy/restart needed afterward — this calls the live Asana API and
// writes the webhook record immediately; the running process doesn't need
// to reload anything to start receiving events for the new webhook.

import { WebhookRepository } from '../src/schemas/db-local/webhooks.js'
import { createURWebhook, asanaConfig } from '../src/config/asana.js'

const gid = process.argv[2]

if (!gid) {
  console.error('Usage: node scripts/add-urgent-webhook.js <projectGid>')
  process.exit(1)
}

asanaConfig()

const existing = WebhookRepository.findByGidAndPath(gid, '/urgent-request')
if (existing) {
  console.log(`Project ${gid} already has an urgent-request webhook registered (id: ${existing._id}). Nothing to do.`)
  process.exit(0)
}

let webhookUUID
try {
  webhookUUID = WebhookRepository.create({ path: '/urgent-request', resourceId: gid })

  const response = await createURWebhook(gid)
  const { gid: webhookId, resource: { resource_type: resourceType, name: resourceName } } = response.data

  WebhookRepository.update(webhookUUID, { webhookId, resourceType })

  console.log(`Urgent Keyword webhook registered for project "${resourceName ?? gid}" (${gid})`)
} catch (error) {
  if (webhookUUID) WebhookRepository.delete({ _id: webhookUUID })
  console.error(`Failed to register urgent-keyword webhook for project ${gid}:`, error.message)
  process.exit(1)
}
