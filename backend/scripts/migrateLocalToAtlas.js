// Live migration: copy every collection from local Mongo to Atlas, overwriting
// the Atlas data. Use this when the dump on disk is stale and the source of
// truth is the running local mongod.
//
//   ATLAS_URI="mongodb+srv://..." \
//   LOCAL_URI="mongodb://localhost:27017/mayvel_task" \
//   node backend/scripts/migrateLocalToAtlas.js

const { MongoClient } = require('../node_modules/mongodb');

const LOCAL = process.env.LOCAL_URI || 'mongodb://localhost:27017/mayvel_task';
const ATLAS = process.env.ATLAS_URI;
if (!ATLAS || !ATLAS.startsWith('mongodb')) {
  console.error('Missing ATLAS_URI env var.');
  process.exit(1);
}

const BATCH = 500;

(async () => {
  const local = new MongoClient(LOCAL);
  const atlas = new MongoClient(ATLAS);
  await Promise.all([local.connect(), atlas.connect()]);
  console.log('✅ Both connections open');

  const ldb = local.db();
  const adb = atlas.db();
  console.log('Source:', ldb.databaseName, '→ Target:', adb.databaseName);

  const colls = await ldb.listCollections().toArray();
  const summary = [];

  for (const { name } of colls) {
    const srcCount = await ldb.collection(name).countDocuments();
    if (srcCount === 0) { summary.push({ coll: name, copied: 0, note: 'empty' }); continue; }

    // wipe target, then stream-copy in batches so memory stays bounded
    await adb.collection(name).deleteMany({});
    let copied = 0;
    const cursor = ldb.collection(name).find({}, { batchSize: BATCH });
    let buf = [];
    for await (const doc of cursor) {
      buf.push(doc);
      if (buf.length >= BATCH) {
        await adb.collection(name).insertMany(buf, { ordered: false });
        copied += buf.length;
        buf = [];
      }
    }
    if (buf.length) {
      await adb.collection(name).insertMany(buf, { ordered: false });
      copied += buf.length;
    }
    summary.push({ coll: name, copied });
    console.log(`  ${name}: ${copied} docs`);
  }

  console.log('\n=== Summary ===');
  console.table(summary);

  await Promise.all([local.close(), atlas.close()]);
  console.log('Done.');
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
