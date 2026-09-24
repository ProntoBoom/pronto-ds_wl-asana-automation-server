// One-off script: registers ONLY the urgent-keyword webhook for a project
// that predates the urgent-keyword feature (already has FRT registered).
//
// This calls the app's OWN running HTTP API (POST /api/webhook/) instead of
// writing to the local DB directly. That's essential, not a style choice:
// db-local loads its JSON file into memory once at process startup and
// never re-reads it on its own. A separate `node scripts/...` process
// writing a new webhook record straight to disk would be invisible to the
// already-running server — so when Asana immediately sends its handshake
// request back to confirm the webhook, the live server would look up the
// record in its own (stale) in-memory copy, find nothing, and reject the
// handshake with a 404, causing the whole registration to fail.
//
// Going through the real endpoint sidesteps that entirely: the
// ALREADY-RUNNING process handles the DB write, the Asana API call, and the
// handshake itself, all in the same memory space — exactly like the UI's
// "Register" flow does. The endpoint (createWebhookHandler, path
// '/urgent-request') only touches the urgent-keyword webhook, and safely
// no-ops (HTTP 500, nothing created) if one is already registered for this
// project, since WebhookRepository.create() throws on a duplicate
// resourceId+path before any Asana call is made.
//
// Run from the Web process terminal, once per project that needs it (uses
// HOST and API_KEY from the live environment):
//   node scripts/add-urgent-webhook.js <projectGid>

const gid = process.argv[2]

if (!gid) {
  console.error('Usage: node scripts/add-urgent-webhook.js <projectGid>')
  process.exit(1)
}

const host = process.env.HOST
const apiKey = process.env.API_KEY

if (!host || !apiKey) {
  console.error('HOST and API_KEY must be set in the environment to run this script.')
  process.exit(1)
}

const response = await fetch(`${host}/api/webhook/`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': apiKey
  },
  body: JSON.stringify({ path: '/urgent-request', gid })
})

if (response.ok) {
  console.log(`Urgent Keyword webhook registered for project ${gid}`)
} else {
  console.error(`Failed to register urgent-keyword webhook for project ${gid}: HTTP ${response.status} (this project may already have one registered)`)
  process.exit(1)
}
