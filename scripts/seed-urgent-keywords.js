// One-off seed script: adds the urgent-trigger keywords to the KeywordsRepository.
// Safe to re-run — existing keywords are skipped, not duplicated.
//
// Run from the app root (so db-local's relative './db' path resolves to the
// real persistent disk, not some other cwd):
//   node scripts/seed-urgent-keywords.js
//
// On production (Kinsta), run this from the Web process terminal, then
// restart/redeploy the app so the running process picks up the new file
// (db-local only reads its JSON into memory at startup).

import { KeywordsRepository } from '../src/schemas/db-local/keywords.js'

const KEYWORDS = [
  'ASAP',
  'urgent',
  'emergency',
  'as soon as possible',
  'website down',
  'site down',
  'time sensitive',
  'not working',
  'payment issue',
  'homepage broken',
  'broken layout',
  'store down',
  'shipping issue',
  'hack',
  'speak to a manager',
  'speak to manager',
  'speak to supervisor',
  'escalate',
  'immediate action'
]

for (const keyword of KEYWORDS) {
  try {
    KeywordsRepository.create(keyword)
    console.log(`Added: "${keyword}"`)
  } catch (error) {
    if (error.message === 'Keyword already exists') {
      console.log(`Skipped (already exists): "${keyword}"`)
    } else {
      console.error(`Failed to add "${keyword}":`, error.message)
    }
  }
}

console.log('\nCurrent keyword list:', KeywordsRepository.findAll().map(k => k.keyword))
