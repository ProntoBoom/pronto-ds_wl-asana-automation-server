import { getWebhooks } from '../config/asana.js'
import { WebhookRepository } from '../schemas/db-local/webhooks.js'

export async function syncWebhooksFromAsana () {
  try {
    const { data: asanaWebhooks } = await getWebhooks()
    const recovered = []

    for (const webhook of asanaWebhooks) {
      // Target URL format: <host>/api/webhook/<path-segment>/<resource-gid>
      const urlPath = new URL(webhook.target).pathname
      const pathSegment = urlPath.split('/')[3]
      const path = `/${pathSegment}`

      const existing = WebhookRepository.findByGidAndPath(webhook.resource.gid, path)
      if (!existing) {
        const uuid = WebhookRepository.create({ path, resourceId: webhook.resource.gid })
        WebhookRepository.update(uuid, {
          webhookId: webhook.gid,
          resourceType: webhook.resource.resource_type
        })
        recovered.push(webhook.resource.gid)
      }
    }

    if (recovered.length > 0) {
      // Recovered records have NO handshake secret — Asana only sends the
      // secret once, at webhook creation. Incoming events for these will
      // fail verification until the project is deleted and re-registered.
      console.warn(
        `Recovered ${recovered.length} webhook(s) from Asana WITHOUT handshake secrets — ` +
        `signature verification will fail for these until they are re-registered: ${recovered.join(', ')}`
      )
    }
  } catch (error) {
    console.error('Failed to sync webhooks from Asana on startup:', error.message)
  }
}
