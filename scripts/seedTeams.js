/**
 * Seed the Firestore `teams` collection with national + top club teams.
 *
 * Doc ID  = sanitized team name (Firestore doc IDs cannot contain `/`).
 * `name`  = original display name.
 *
 * Idempotent: uses `set` with merge, so re-running only updates the `name`
 * field and never deletes existing data.
 *
 * Usage:
 *   node scripts/seedTeams.js
 *   node scripts/seedTeams.js --dry-run     # print what would be written
 *   node scripts/seedTeams.js --nationals   # only national teams
 *   node scripts/seedTeams.js --clubs       # only club teams
 */
require('dotenv').config();

const { NATIONAL_TEAMS, CLUB_TEAMS } = require('./teamsData');
const connectDB = require('../src/services/db');
const Team = require('../src/models/Team');

const FIRESTORE_BATCH_LIMIT = 500;

const sanitizeId = (name) => name.replace(/\//g, '-').trim();

const buildEntries = (names, kind) => {
  const seen = new Map();
  for (const name of names) {
    const id = sanitizeId(name);
    if (!id) continue;
    if (seen.has(id)) {
      console.warn(`  [skip] duplicate id "${id}" (kind=${kind})`);
      continue;
    }
    seen.set(id, { id, name, kind });
  }
  return [...seen.values()];
};

const run = async () => {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const onlyNationals = args.has('--nationals');
  const onlyClubs = args.has('--clubs');

  const nationals = onlyClubs ? [] : buildEntries(NATIONAL_TEAMS, 'national');
  const clubs = onlyNationals ? [] : buildEntries(CLUB_TEAMS, 'club');
  const entries = [...nationals, ...clubs];

  console.log(`Seeding ${entries.length} teams (${nationals.length} national, ${clubs.length} club)`);
  if (dryRun) {
    entries.forEach((e) => console.log(`  ${e.kind}\t${e.id}\t${e.name}`));
    console.log('Dry run — no writes performed.');
    return;
  }

  await connectDB();
  const col = Team.collection();

  let written = 0;
  for (let i = 0; i < entries.length; i += FIRESTORE_BATCH_LIMIT) {
    const chunk = entries.slice(i, i + FIRESTORE_BATCH_LIMIT);
    const batch = col.firestore.batch();
    for (const { id, name } of chunk) {
      batch.set(col.doc(id), { name }, { merge: true });
    }
    await batch.commit();
    written += chunk.length;
    console.log(`  committed ${written}/${entries.length}`);
  }

  console.log(`Done — ${written} teams upserted to "${Team.COLLECTION}".`);
};

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
