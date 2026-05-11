// One-shot: import the JSON files under ../db_dump into a MongoDB Atlas cluster.
// The local dump stores `_id` and reference ids as plain hex strings; this
// script converts 24-char hex strings to ObjectId so the data lines up with
// the production schema. Existing collections are emptied first so the import
// is idempotent.
//
// Usage:  ATLAS_URI="mongodb+srv://..." node backend/scripts/importDumpToAtlas.js

const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId } = require('../node_modules/mongodb');

const URI = process.env.ATLAS_URI;
if (!URI || !URI.startsWith('mongodb')) {
  console.error('Missing ATLAS_URI env var. Example:\n  ATLAS_URI="mongodb+srv://user:pass@host/db?..." node backend/scripts/importDumpToAtlas.js');
  process.exit(1);
}

const DUMP_DIR = path.join(__dirname, '..', '..', 'db_dump');
const HEX24 = /^[a-f0-9]{24}$/;

// Walk a document tree, converting any 24-char hex string into ObjectId.
// Safe for nested arrays / sub-objects. Skips the `password` field because
// passwords like "mv_dcd71935" are not 24 hex chars and bcrypt hashes don't
// match the pattern anyway.
function castIds(value, key) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(v => castIds(v, key));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = castIds(v, k);
    return out;
  }
  if (typeof value === 'string' && HEX24.test(value)) return new ObjectId(value);
  return value;
}

(async () => {
  const client = new MongoClient(URI);
  await client.connect();
  console.log('✅ Connected to Atlas');
  const db = client.db();
  console.log('Target database:', db.databaseName);

  const files = fs.readdirSync(DUMP_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  const summary = [];

  for (const file of files) {
    const collName = file.replace(/\.json$/, '');
    const raw = fs.readFileSync(path.join(DUMP_DIR, file), 'utf8');
    let docs;
    try { docs = JSON.parse(raw); } catch (e) {
      console.error(`✗ ${collName}: invalid JSON —`, e.message);
      summary.push({ coll: collName, inserted: 0, error: e.message });
      continue;
    }
    if (!Array.isArray(docs) || docs.length === 0) {
      summary.push({ coll: collName, inserted: 0, skipped: 'empty' });
      continue;
    }
    const casted = docs.map(d => castIds(d));
    await db.collection(collName).deleteMany({});
    const res = await db.collection(collName).insertMany(casted, { ordered: false });
    summary.push({ coll: collName, inserted: res.insertedCount });
    console.log(`  ${collName}: ${res.insertedCount} docs`);
  }

  console.log('\n=== Summary ===');
  console.table(summary);

  await client.close();
  console.log('Done.');
})().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
