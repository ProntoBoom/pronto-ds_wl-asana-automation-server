// One-off script: removes a single keyword from the KeywordsRepository.
// Run from the app root (so db-local's relative './db' path resolves to the
// real persistent disk, not some other cwd):
//   node scripts/remove-urgent-keyword.js "not working"
//
// On production (Kinsta), run this from the Web process terminal, then
// restart/redeploy the app so the running process picks up the new file
// (db-local only reads its JSON into memory at startup).

import { KeywordsRepository } from '../src/schemas/db-local/keywords.js'

const keyword = process.argv[2]

if (!keyword) {
  console.error('Usage: node scripts/remove-urgent-keyword.js "<keyword>"')
  process.exit(1)
}

const lowerCaseKeyword = keyword.toLowerCase()
const entry = KeywordsRepository.findAll().find(k => k.keyword === lowerCaseKeyword)

if (!entry) {
  console.log(`Keyword "${keyword}" not found — nothing to remove.`)
  process.exit(0)
}

KeywordsRepository.delete(entry._id)

console.log(`Removed: "${keyword}"`)
console.log('Current keyword list:', KeywordsRepository.findAll().map(k => k.keyword))
