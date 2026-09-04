import { WebhookRepository } from '../../schemas/db-local/webhooks.js'
import { KeywordsRepository } from '../../schemas/db-local/keywords.js'
import { verifySignature } from '../../util/crypto.js'
import { handleFirstResponseTime, verifyStoryFRT } from './webhook.service.js'
import { getWebhooks, createFRTWebhook, createTICWebhook, createURWebhook, deleteWebhook, getTask, getStory, updateTask } from '../../config/asana.js'
import { buildFinalResponse, checkIfUrgentPrioritySet } from './utils.js'
import { containsUrgentKeyword } from '../../util/urgentKeyword.js'
import { describeAsanaError, formatAsanaError } from '../../util/asanaError.js'
import { logEvent } from '../../util/eventLog.js'

// A project's own Asana Rules (e.g. "when task added to board, set Priority
// to Normal") react to the same events we do, and there's no guaranteed
// ordering between an external webhook delivery and Asana's internal rule
// engine — observed in practice taking up to ~60-90s to land. Rather than
// relying on winning that race, re-check once after a delay and re-apply if
// something else reset it. Deliberately a single, bounded recheck (not a
// recurring enforcement loop) so a person manually retriaging the task later
// isn't fought.
const URGENT_PRIORITY_RECHECK_DELAY_MS = Number(process.env.URGENT_PRIORITY_RECHECK_DELAY_MS) || 90_000

function scheduleUrgentPriorityRecheck (taskId, gid) {
  setTimeout(async () => {
    try {
      const taskData = (await getTask(taskId)).data
      if (checkIfUrgentPrioritySet(taskData)) return

      await updateTask(
        taskId,
        process.env.PRIORITY_CUSTOM_FIELD_GID,
        process.env.URGENT_ENUM_PRIORITY_GID
      )

      console.log(`Priority was reset after urgent-keyword match — re-applied Urgent on task ${taskId}`)
      logEvent({
        event: 'urgent.reapplied',
        projectGid: gid,
        taskGid: taskId,
        message: `Priority was reset (likely by another Asana rule) — re-applied Urgent after ${URGENT_PRIORITY_RECHECK_DELAY_MS / 1000}s`
      })
    } catch (error) {
      console.error(`Error re-checking urgent priority on task ${taskId}:`, formatAsanaError(error))
      logEvent({
        level: 'error',
        event: 'urgent.recheck_failed',
        projectGid: gid,
        taskGid: taskId,
        message: 'Unhandled error while re-checking urgent priority',
        detail: describeAsanaError(error)
      })
    }
  }, URGENT_PRIORITY_RECHECK_DELAY_MS)
}

export async function getWebhooksHandler (req, res) {
  try {
    const dbData = WebhookRepository.findAll()

    const { data: asanaData } = await getWebhooks()

    const webhooks = buildFinalResponse(asanaData, dbData)

    res.status(200).json({ webhooks })
  } catch (error) {
    console.error('Error getting webhooks:', formatAsanaError(error))
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
    console.error('Error creating webhook:', formatAsanaError(error))
    res.sendStatus(500)
  } finally {
    response = ''
    webhookUUID = ''
  }
}

/**
 * Resolve the stored record for an incoming delivery and answer Asana directly
 * when it cannot be trusted. Returns the handshake secret, or null once a
 * response has already been sent.
 *
 * Every path here used to throw and leave the request hanging until Asana timed
 * out; enough timed-out deliveries and Asana deactivates the webhook.
 */
function resolveWebhookSecret (req, res, gid, path, typeLabel) {
  const webhook = WebhookRepository.findByGidAndPath(gid, path)

  if (!webhook) {
    console.warn(`No ${typeLabel} webhook record for resource ${gid} — cannot verify event. Sent 404`)
    logEvent({
      level: 'warn',
      event: 'webhook.rejected',
      projectGid: gid,
      message: `${typeLabel} event rejected: no local webhook record for this project`,
      detail: { reason: 'no-record', status: 404 }
    })
    res.sendStatus(404)
    return null
  }

  // Handshake: Asana sends the secret exactly once, when the webhook is created.
  if (req.headers['x-hook-secret']) {
    const secret = req.headers['x-hook-secret']

    WebhookRepository.update(webhook._id, { secret })

    console.log('This is a new webhook')
    logEvent({
      event: 'webhook.handshake',
      projectGid: gid,
      message: `${typeLabel} webhook handshake completed`
    })

    res.setHeader('X-Hook-Secret', secret)
    res.sendStatus(200)
    return null
  }

  const secret = WebhookRepository.findById(webhook._id)?.secret

  if (!secret) {
    console.warn(`${typeLabel} webhook record for resource ${gid} has no secret (recovered without a handshake) — cannot verify. Sent 401`)
    logEvent({
      level: 'warn',
      event: 'webhook.rejected',
      projectGid: gid,
      message: `${typeLabel} event rejected: no handshake secret stored — re-register this project`,
      detail: { reason: 'no-secret', status: 401 }
    })
    res.sendStatus(401)
    return null
  }

  return secret
}

export async function webhookFRTHandler (req, res) {
  const { gid } = req.params

  try {
    const { body } = req
    const xHookSignature = req.headers['x-hook-signature']

    const secretFRT = resolveWebhookSecret(req, res, gid, '/first-response-time', 'FRT')
    if (!secretFRT) return

    console.log('New event received:', JSON.stringify(body, null, 2))

    const { events } = body
    const storyParentId = events[0]?.parent?.gid || null

    // Verify the signature of the webhook when an event is sent

    if (!verifySignature(xHookSignature, body, secretFRT)) {
      console.log('Authorization error. Sent 401')
      logEvent({
        level: 'warn',
        event: 'webhook.rejected',
        projectGid: gid,
        message: 'FRT event rejected: signature did not match',
        detail: { reason: 'bad-signature', status: 401 }
      })
      res.sendStatus(401)
      return
    }
    res.sendStatus(200)

    logEvent({
      event: 'webhook.received',
      projectGid: gid,
      taskGid: storyParentId,
      message: `FRT event received (${events?.length ?? 0} event(s))`
    })

    if (!storyParentId) return

    // Verify info.

    const { createdAt = null } = await verifyStoryFRT(storyParentId, gid)

    if (!createdAt) return

    await handleFirstResponseTime(storyParentId, createdAt, gid)
  } catch (error) {
    console.error('Error in webhookHandler:', formatAsanaError(error))
    logEvent({
      level: 'error',
      event: 'webhook.failed',
      projectGid: gid,
      message: 'Unhandled error while processing an FRT event',
      detail: describeAsanaError(error)
    })
    // Always answer Asana — an unanswered request counts as a failed delivery,
    // and enough of those get the webhook deactivated.
    if (!res.headersSent) res.sendStatus(500)
  }
}

export async function webhookURHandler (req, res) {
  const { gid } = req.params

  try {
    const { body } = req
    const xHookSignature = req.headers['x-hook-signature']

    const secretUR = resolveWebhookSecret(req, res, gid, '/urgent-request', 'Urgent Keyword')
    if (!secretUR) return

    console.log('New event(s) received:', JSON.stringify(body, null, 2))

    const { events } = body

    // Verify the signature of the webhook when an event is sent

    if (!verifySignature(xHookSignature, body, secretUR)) {
      console.log('Authorization error. Sent 401')
      logEvent({
        level: 'warn',
        event: 'webhook.rejected',
        projectGid: gid,
        message: 'Urgent Keyword event rejected: signature did not match',
        detail: { reason: 'bad-signature', status: 401 }
      })
      res.sendStatus(401)
      return
    }
    res.sendStatus(200)

    if (events.length === 0) return

    logEvent({
      event: 'webhook.received',
      projectGid: gid,
      message: `Urgent Keyword event received (${events.length} event(s))`
    })

    let textToAnalyze = ''
    let taskId = null

    for (const event of events) {
      if (event.action === 'changed') {
        // When a story change
        if (
          event.resource.resource_type === 'story' &&
          event.change.field === 'text'
        ) {
          const data = (await getStory(event.resource.gid)).data

          const {
            text,
            target: { gid: taskGid }
          } = data
          taskId = taskGid
          textToAnalyze += text

          const taskData = (await getTask(taskId)).data

          // Check if the task already has the urgent priority
          if (checkIfUrgentPrioritySet(taskData)) return
        }

        // When an existing task's title or description is edited
        if (
          event.resource.resource_type === 'task' &&
          (event.change.field === 'name' || event.change.field === 'notes')
        ) {
          taskId = event.resource.gid
          const data = (await getTask(taskId)).data

          // Check if the task already has the urgent priority
          if (checkIfUrgentPrioritySet(data)) return

          const { name, notes } = data
          textToAnalyze += name + ' ' + notes
        }
      }

      if (event.action === 'added') {
        // When a new task is added
        if (
          event.resource.resource_type === 'task' &&
          event.parent.resource_type === 'project'
        ) {
          taskId = event.resource.gid
          const data = (await getTask(event.resource.gid)).data

          // Check if the task already has the urgent priority
          if (checkIfUrgentPrioritySet(data)) return

          const { name, notes } = data
          textToAnalyze += name + ' ' + notes
        }
        // When a new comment is added
        if (
          event.resource.resource_subtype === 'comment_added' &&
          event.user !== null
        ) {
          taskId = event.parent.gid

          const taskData = (await getTask(taskId)).data

          // Check if the task already has the urgent priority
          if (checkIfUrgentPrioritySet(taskData)) return

          const data = (await getStory(event.resource.gid)).data

          const { text } = data
          textToAnalyze += text
        }
      }
    }

    if (!textToAnalyze) return

    const urgentKeywords = KeywordsRepository.findAll().map(i => i.keyword)

    const isUrgentWordDetected = containsUrgentKeyword(urgentKeywords, textToAnalyze)

    if (!isUrgentWordDetected) return

    await updateTask(
      taskId,
      process.env.PRIORITY_CUSTOM_FIELD_GID,
      process.env.URGENT_ENUM_PRIORITY_GID
    )

    console.log(`New keyword detected on task ${taskId}`)
    logEvent({
      event: 'urgent.matched',
      projectGid: gid,
      taskGid: taskId,
      message: 'Urgent keyword detected — priority set to Urgent'
    })

    scheduleUrgentPriorityRecheck(taskId, gid)
  } catch (error) {
    console.error('Error in webhookHandler:', formatAsanaError(error))
    logEvent({
      level: 'error',
      event: 'urgent.failed',
      projectGid: gid,
      message: 'Unhandled error while processing an Urgent Keyword event',
      detail: describeAsanaError(error)
    })
    if (!res.headersSent) res.sendStatus(500)
  }
}

export function keywordsHandler (req, res) {
  try {
    const keywords = KeywordsRepository.findAll().map(i => i.keyword)

    res.status(200).json({ keywords })
  } catch (error) {
    console.error('Error getting the keywords: ', error.message)
    res.sendStatus(500)
  }
}

export async function deleteWebhookHandler (req, res) {
  try {
    const { id } = req.params

    await deleteWebhook(id)

    WebhookRepository.delete({ webhookId: id })

    res.status(200).json({ message: 'Webhook deleted' })
  } catch (error) {
    console.error('Error in webhookHandler:', formatAsanaError(error))
    res.sendStatus(500)
  }
}
