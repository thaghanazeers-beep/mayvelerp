/**
 * Dump every collection in mayvel_task to JSON files for backup.
 *   Usage: node scripts/dumpDb.js [outDir]
 *   Default outDir: ./db_dump
 *
 * Restore (rough guide): for each <coll>.json, db.<coll>.insertMany(JSON.parse(file)).
 * Prefer Mongo's `mongorestore` against the *.bson if you switch to mongodump later.
 */

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/mayvel_task';
const outDir = process.argv[2] || path.join(process.cwd(), 'db_dump');

(async () => {
  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;
  fs.mkdirSync(outDir, { recursive: true });

  const collections = await db.listCollections().toArray();
  const summary = [];
  for (const c of collections) {
    const docs = await db.collection(c.name).find({}).toArray();
    const file = path.join(outDir, `${c.name}.json`);
    fs.writeFileSync(file, JSON.stringify(docs, null, 2));
    summary.push({ name: c.name, count: docs.length, bytes: fs.statSync(file).size });
  }

  // Manifest for traceability
  const manifest = {
    dumpedAt: new Date().toISOString(),
    mongoUri: MONGO_URI,
    nodeVersion: process.version,
    collections: summary,
  };
  fs.writeFileSync(path.join(outDir, '_manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`✅ Dumped ${summary.length} collections to ${outDir}`);
  console.table(summary);
  await mongoose.disconnect();
})().catch(e => { console.error('❌', e); process.exit(1); });
