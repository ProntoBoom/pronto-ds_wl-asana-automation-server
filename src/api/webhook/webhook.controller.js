import { WebhookRepository } from '../../schemas/db-local/webhooks.js'
import { verifySignature } from '../../util/crypto.js'
import { handleFirstResponseTime, verifyStoryFRT } from './webhook.service.js'
import { getWebhooks, createFRTWebhook, createTICWebhook, createURWebhook, deleteWebhook } from '../../config/asana.js'
import { buildFinalResponse } from './utils.js'

export async function getWebhooksHandler (req, res) {
  try {
    const dbData = WebhookRepository.findAll()

    const { data: asanaData } = await getWebhooks()

    const webhooks = buildFinalResponse(asanaData, dbData)

    res.status(200).json({ webhooks })
  } catch (error) {
    console.error('Error getting webhooks:', error)
    res.sendStatus(500)
  }
}

export async function createWebhookHandler (req, res) {
  const { path, gid: resourceId } = req.body

  let response
  let webhookUUID

  try {
    switch (path) {
      case '/first-response-time':
        webhookUUID = WebhookRepository.create({ path, resourceId })
        response = await createFRTWebhook(resourceId)
        break
      case '/total-interaction-count':
        webhookUUID = WebhookRepository.create({ path, resourceId })
        response = await createTICWebhook(resourceId)
        break
      case '/urgent-request':
        webhookUUID = WebhookRepository.create({ path, resourceId })
        response = await createURWebhook(resourceId)
        break
      default:
        res.status(400).json({ message: 'Invalid path' })
        return
    }

    const { gid: webhookId, resource: { resource_type: resourceType } } = response.data

    if (!webhookId || !resourceType) {
      WebhookRepository.delete({ _id: webhookUUID })
      res.status(500).json({ message: 'Invalid response' })
      return
    }

    WebhookRepository.update(webhookUUID, { webhookId, resourceType })

    res.status(201).json({ message: 'Webhook created' })
  } catch (error) {
    WebhookRepository.delete({ _id: webhookUUID })
    console.error('Error creating webhook:', error)
    res.sendStatus(500)
  } finally {
    response = ''
    webhookUUID = ''
  }
}

export async function webhookFRTHandler (req, res) {
  try {
    const { body } = req
    const { gid } = req.params
    const xHookSignature = req.headers['x-hook-signature']
    const webhook = WebhookRepository.findByGidAndPath(
      gid,
      '/first-response-time'
    )

    if (!webhook) {
      console.warn(`No webhook record for resource ${gid} — cannot verify event. Sent 404`)
      res.sendStatus(404)
      return
    }

    // Handle webhook secret handshake when creating a webhook
    if (req.headers['x-hook-secret']) {
      const secret = req.headers['x-hook-secret']

      WebhookRepository.update(webhook._id, { secret })

      console.log('This is a new webhook')

      res.setHeader('X-Hook-Secret', secret)
      res.sendStatus(200)
      return
    }

    console.log('New event received:', JSON.stringify(body, null, 2))

    const { events } = body
    const storyParentId = events[0]?.parent?.gid || null
    const secretFRT = WebhookRepository.findById(webhook._id)?.secret

    if (!secretFRT) {
      console.warn(`Webhook record for resource ${gid} has no secret (recovered without handshake?) — cannot verify. Sent 401`)
      res.sendStatus(401)
      return
    }

    // Verify the signature of the webhook when an event is sent

    if (!verifySignature(xHookSignature, body, secretFRT)) {
      console.log('Authorization error. Sent 401')
      res.sendStatus(401)
      return
    }
    res.sendStatus(200)

    if (!storyParentId) return

    // Verify info.

    const { createdAt = null } = await verifyStoryFRT(storyParentId, events)

    if (!createdAt) return

    await handleFirstResponseTime(storyParentId, createdAt)
  } catch (error) {
    console.error('Error in webhookHandler:', error)
    // Always answer Asana — an unanswered request counts as a failed
    // delivery and enough of those get the webhook deactivated
    if (!res.headersSent) res.sendStatus(500)
  }
}

export async function deleteWebhookHandler (req, res) {
  try {
    const { id } = req.params

    await deleteWebhook(id)

    WebhookRepository.delete({ webhookId: id })

    res.status(200).json({ message: 'Webhook deleted' })
  } catch (error) {
    console.error('Error in webhookHandler:', error)
    res.sendStatus(500)
  }
}
