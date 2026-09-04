import Asana from 'asana'

let asanaTaskInstance, asanaStoriesInstance, asanaUsersInstance, asanaProjectsInstance, asanaWebhooksInstance, asanaTeamsInstance
let asanaProjectMembershipsInstance, asanaCustomFieldSettingsInstance

const target = process.env.ENV === 'local' ? process.env.WEBHOOK_TARGET : process.env.HOST

const workspace = process.env.ASANA_WORKSPACE

const asanaConfig = () => {
  const client = Asana.ApiClient.instance
  const token = client.authentications.token

  token.accessToken = process.env.ASANA_PAT

  asanaWebhooksInstance = new Asana.WebhooksApi()
  asanaTaskInstance = new Asana.TasksApi()
  asanaStoriesInstance = new Asana.StoriesApi()
  asanaUsersInstance = new Asana.UsersApi()
  asanaProjectsInstance = new Asana.ProjectsApi()
  asanaTeamsInstance = new Asana.TeamsApi()
  asanaProjectMembershipsInstance = new Asana.ProjectMembershipsApi()
  asanaCustomFieldSettingsInstance = new Asana.CustomFieldSettingsApi()
}

// WEBHOOKS

const getWebhooks = async () => {
  const opts = {}
  const result = await asanaWebhooksInstance.getWebhooks(workspace, opts)

  return result
}

// getWebhooks() returns only the first page. Callers that draw conclusions from
// a webhook's *absence* (ghost-record detection, diagnostics) must use this
// instead and honour `complete` — a partial list would flag live webhooks as gone.
const getAllWebhooks = async () => {
  const opts = { limit: 100 }
  const webhooks = []

  try {
    let result = await asanaWebhooksInstance.getWebhooks(workspace, opts)
    while (true) {
      webhooks.push(...(result.data ?? []))
      if (!result.next_page?.offset) break
      result = await asanaWebhooksInstance.getWebhooks(workspace, { ...opts, offset: result.next_page.offset })
    }
  } catch (error) {
    return { webhooks, complete: false, error }
  }

  return { webhooks, complete: true, error: null }
}

const createFRTWebhook = async (resource) => {
  const body = {
    data: {
      resource,
      target: `${target}/api/webhook/first-response-time/${resource}`,
      filters: [
        {
          resource_type: 'story',
          action: 'added',
          resource_subtype: 'comment_added'
        }
      ]
    }
  }
  const opts = {}

  const result = await asanaWebhooksInstance.createWebhook(body, opts)
  return result
}

const createTICWebhook = async (resource) => {
  const body = {
    data: {
      resource,
      target: `${target}/api/webhook/total-interaction-count/${resource}`,
      filters: [
        {
          resource_type: 'task',
          action: 'changed',
          resource_subtype: 'default_task',
          fields: ['completed']
        }
      ]
    }
  }
  const opts = {}
  const result = await asanaWebhooksInstance.createWebhook(body, opts)

  return result
}

const createURWebhook = async (resource) => {
  const body = {
    data: {
      resource,
      target: `${target}/api/webhook/urgent-request/${resource}`
    }
  }
  return asanaWebhooksInstance.createWebhook(body)
}

const deleteWebhook = async (webhookId) => {
  const result = await asanaWebhooksInstance.deleteWebhook(webhookId)

  return result
}
// TASKS

const getTask = async (taskId) => {
  const opts = { opt_fields: 'gid,name,notes,created_at,parent,parent.gid,custom_fields,custom_fields.gid,custom_fields.number_value,custom_fields.display_value' }
  const result = await asanaTaskInstance.getTask(taskId, opts)

  return result
}

const updateTask = async (taskId, customFieldId, value) => {
  const body = { data: { custom_fields: { [customFieldId]: value } } }
  const opts = {}
  const result = await asanaTaskInstance.updateTask(body, taskId, opts)

  return result
}

// STORIES

const getStoriesFromTask = async (taskId) => {
  const opts = {}
  const results = await asanaStoriesInstance.getStoriesForTask(taskId, opts)

  return results
}

const getStory = async (storyId) => {
  const opts = {}
  const results = await asanaStoriesInstance.getStory(storyId, opts)

  return results
}

// USERS

const getUsersInATeam = async (teamId) => {
  const opts = {}
  const results = await asanaUsersInstance.getUsersForTeam(teamId, opts)

  return results
}

const getUserById = async (userId) => {
  const opts = {}
  const result = await asanaUsersInstance.getUser(userId, opts)

  return result
}

// The identity every automation acts as — whoever owns ASANA_PAT.
const getMe = async () => {
  const opts = { opt_fields: 'gid,name,email' }
  const result = await asanaUsersInstance.getUser('me', opts)

  return result
}

// PROJECTS

const getProjectById = async (projectId) => {
  const opts = { opt_fields: 'gid,name,privacy_setting,default_access_level' }
  const result = await asanaProjectsInstance.getProject(projectId, opts)

  return result
}

const getProjectsInWorkspace = async () => {
  const opts = {
    workspace: process.env.ASANA_WORKSPACE,
    opt_fields: 'gid,name',
    archived: false,
    limit: 100
  }
  return asanaProjectsInstance.getProjects(opts)
}

const getUserByEmail = async (email) => {
  const opts = { opt_fields: 'gid,email', limit: 100 }
  let result = await asanaUsersInstance.getUsersForWorkspace(workspace, opts)
  while (true) {
    const found = (result.data ?? []).find(u => u.email === email)
    if (found) return found
    if (!result.next_page?.offset) return null
    result = await asanaUsersInstance.getUsersForWorkspace(workspace, { ...opts, offset: result.next_page.offset })
  }
}

const getTeamsForUser = async (userGid) => {
  const opts = { opt_fields: 'gid,name', limit: 100 }
  const result = await asanaTeamsInstance.getTeamsForUser(userGid, workspace, opts)
  return result.data ?? []
}

const getProjectsForTeam = async (teamGid) => {
  const opts = { opt_fields: 'gid,name', archived: false, limit: 100 }
  const result = await asanaProjectsInstance.getProjectsForTeam(teamGid, opts)
  return result.data ?? []
}

const getTeamlessProjectsForUser = async (userGid) => {
  const opts = {
    workspace: process.env.ASANA_WORKSPACE,
    opt_fields: 'gid,name,team,members',
    archived: false,
    limit: 100
  }
  const matches = []
  let result = await asanaProjectsInstance.getProjects(opts)
  while (true) {
    for (const p of (result.data ?? [])) {
      if (!p.team && (p.members ?? []).some(m => m.gid === userGid)) {
        matches.push({ gid: p.gid, name: p.name })
      }
    }
    if (!result.next_page?.offset) break
    result = await asanaProjectsInstance.getProjects({ ...opts, offset: result.next_page.offset })
  }
  return matches
}

// PROJECT MEMBERSHIPS / CUSTOM FIELD SETTINGS (diagnostics)

// access_level is what the 403 custom_fields_restricted actually turns on:
// a Commenter/Viewer cannot write custom fields even though they can see them.
const getProjectMemberships = async (projectId) => {
  const opts = { opt_fields: 'user.name,user.email,access_level', limit: 100 }
  const memberships = []

  let result = await asanaProjectMembershipsInstance.getProjectMembershipsForProject(projectId, opts)
  while (true) {
    memberships.push(...(result.data ?? []))
    if (!result.next_page?.offset) break
    result = await asanaProjectMembershipsInstance.getProjectMembershipsForProject(projectId, { ...opts, offset: result.next_page.offset })
  }

  return memberships
}

const getCustomFieldSettingsForProject = async (projectId) => {
  const opts = { opt_fields: 'custom_field.gid,custom_field.name', limit: 100 }
  const settings = []

  let result = await asanaCustomFieldSettingsInstance.getCustomFieldSettingsForProject(projectId, opts)
  while (true) {
    settings.push(...(result.data ?? []))
    if (!result.next_page?.offset) break
    result = await asanaCustomFieldSettingsInstance.getCustomFieldSettingsForProject(projectId, { ...opts, offset: result.next_page.offset })
  }

  return settings
}

export {
  asanaConfig,
  getWebhooks,
  getAllWebhooks,
  createFRTWebhook,
  createTICWebhook,
  createURWebhook,
  deleteWebhook,
  getTask,
  getStoriesFromTask,
  getStory,
  getUsersInATeam,
  updateTask,
  getMe,
  getUserById,
  getProjectById,
  getProjectsInWorkspace,
  getUserByEmail,
  getTeamsForUser,
  getProjectsForTeam,
  getTeamlessProjectsForUser,
  getProjectMemberships,
  getCustomFieldSettingsForProject
}
