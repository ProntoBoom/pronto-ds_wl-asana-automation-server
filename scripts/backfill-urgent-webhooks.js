// One-time backfill: registers the urgent-keyword webhook for every project
// that already has the FRT webhook but not yet /urgent-request — i.e. every
// project registered before this feature existed.
//
// Reads WebhookRepository directly to find the gap, which is safe (read-only,
// and a freshly-started process reflects the DB file's current state).
// Registration itself goes through the app's own live HTTP API, same as
// add-urgent-webhook.js and for the same reason: the already-running server
// has to be the one handling the DB write + Asana handshake, not this
// script's process — see add-urgent-webhook.js for the full explanation.
//
// Run from the Web process terminal, once (uses HOST and API_KEY from the
// live environment):
//   node scripts/backfill-urgent-webhooks.js

import { WebhookRepository } from '../src/schemas/db-local/webhooks.js'

const host = process.env.HOST
const apiKey = process.env.API_KEY

if (!host || !apiKey) {
  console.error('HOST and API_KEY must be set in the environment to run this script.')
  process.exit(1)
}

const frtGids = new Set(WebhookRepository.findByPath('/first-response-time').map(w => w.resourceId))
const urgentGids = new Set(WebhookRepository.findByPath('/urgent-request').map(w => w.resourceId))

const missingGids = [...frtGids].filter(gid => !urgentGids.has(gid))

if (missingGids.length === 0) {
  console.log('Every registered project already has the urgent-keyword webhook. Nothing to do.')
  process.exit(0)
}

console.log(`Found ${missingGids.length} project(s) missing the urgent-keyword webhook:`, missingGids)
console.log('')

const succeeded = []
const failed = []

for (const gid of missingGids) {
  try {
    const response = await fetch(`${host}/api/webhook/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      body: JSON.stringify({ path: '/urgent-request', gid })
    })

    if (response.ok) {
      console.log(`Registered: ${gid}`)
      succeeded.push(gid)
    } else {
      console.error(`Failed: ${gid} (HTTP ${response.status})`)
      failed.push(gid)
    }
  } catch (error) {
    console.error(`Failed: ${gid} (${error.message})`)
    failed.push(gid)
  }
}

console.log(`\nDone. Registered: ${succeeded.length}, Failed: ${failed.length}`)
if (failed.length > 0) console.log('Failed project GIDs (check server logs for why):', failed)
