import { getWebhooks, deleteWebhook, createFRTWebhook, getProjectsInWorkspace, getUserByEmail, getTeamsForUser, getProjectsForTeam, getTeamlessProjectsForUser, getProjectById } from '../../config/asana.js'
import { WebhookRepository } from '../../schemas/db-local/webhooks.js'
import { buildFinalResponse } from '../webhook/utils.js'

export function getMeUI (req, res) {
  res.json(req.user)
}

export async function getWebhooksUI (req, res) {
  try {
    const dbData = WebhookRepository.findAll()
    const { data: asanaData } = await getWebhooks()
    res.json({ webhooks: buildFinalResponse(asanaData, dbData) })
  } catch (error) {
    console.error('Error getting webhooks:', error)
    res.sendStatus(500)
  }
}

export async function getProjectsUI (req, res) {
  try {
    const registered = new Set(WebhookRepository.findAll().map(w => w.resourceId))

    const asanaUser = await getUserByEmail(req.user.email)
    if (!asanaUser) {
      console.warn(`No Asana user found for email: ${req.user.email}`)
      const { data: allProjects } = await getProjectsInWorkspace()
      const available = allProjects
        .filter(p => !registered.has(p.gid))
        .sort((a, b) => a.name.localeCompare(b.name))
      return res.json({ projects: available })
    }

    const teams = await getTeamsForUser(asanaUser.gid)
    const [teamProjectArrays, teamlessProjects] = await Promise.all([
      Promise.all(teams.map(t => getProjectsForTeam(t.gid))),
      getTeamlessProjectsForUser(asanaUser.gid)
    ])

    const seen = new Set()
    const available = [...teamProjectArrays.flat(), ...teamlessProjects]
      .filter(p => {
        if (registered.has(p.gid) || seen.has(p.gid)) return false
        seen.add(p.gid)
        return true
      })
      .sort((a, b) => a.name.localeCompare(b.name))

    res.json({ projects: available })
  } catch (error) {
    console.error('Error getting projects:', error)
    res.sendStatus(500)
  }
}

export async function lookupProjectUI (req, res) {
  try {
    const { gid } = req.params
    const existing = WebhookRepository.findByGid(gid)
    if (existing) {
      // Don't trust the local record blindly — verify the webhook still
      // exists in Asana. If it's gone (a stale "ghost" record), self-heal
      // by dropping the record so the project can be registered again.
      const { data: asanaWebhooks } = await getWebhooks()
      const stillLive = asanaWebhooks.some(w => w.gid === existing.webhookId)
      if (stillLive) {
        return res.status(409).json({ message: 'This project already has a webhook registered.' })
      }
      console.warn(`Removing stale webhook record for project ${gid} (webhook ${existing.webhookId} no longer exists in Asana)`)
      WebhookRepository.delete({ _id: existing._id })
    }
    const result = await getProjectById(gid)
    const { gid: projectGid, name } = result.data
    res.json({ gid: projectGid, name })
  } catch (error) {
    console.error('Error looking up project:', error)
    res.status(404).json({ message: 'Project not found. Check the URL or GID and try again.' })
  }
}

export async function registerWebhookUI (req, res) {
  const { gid } = req.body
  if (!gid) return res.status(400).json({ message: 'Project GID is required' })

  let webhookUUID
  try {
    webhookUUID = WebhookRepository.create({ path: '/first-response-time', resourceId: gid })
    const response = await createFRTWebhook(gid)
    const { gid: webhookId, resource: { resource_type: resourceType } } = response.data
    WebhookRepository.update(webhookUUID, { webhookId, resourceType })
    res.status(201).json({ message: 'Webhook registered successfully' })
  } catch (error) {
    if (webhookUUID) WebhookRepository.delete({ _id: webhookUUID })
    console.error('Error registering webhook:', error)
    res.status(500).json({ message: 'Failed to register webhook' })
  }
}

export async function deleteWebhookUI (req, res) {
  try {
    const { id } = req.params
    try {
      await deleteWebhook(id)
    } catch (asanaError) {
      // If Asana says the webhook is already gone, that's fine — still clean up locally
      console.warn(`Asana webhook delete warning (${id}):`, asanaError.message)
    }
    WebhookRepository.delete({ webhookId: id })
    res.json({ message: 'Webhook deleted' })
  } catch (error) {
    console.error('Error deleting webhook:', error)
    res.sendStatus(500)
  }
}
