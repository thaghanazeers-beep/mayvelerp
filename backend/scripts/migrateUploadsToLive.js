// One-shot: copy every file in local backend/uploads/ up to the live backend
// via POST /api/uploads, then rewrite every Mongo reference to point at the
// new URL the server returned.
//
//   ATLAS_URI="mongodb+srv://..." \
//   API_BASE="https://mayvelerp.onrender.com" \
//   LOGIN_EMAIL="thaghanazeer.s@mayvel.ai" LOGIN_PW="Demo2026!" \
//   node backend/scripts/migrateUploadsToLive.js
//
// Idempotent enough: re-running will re-upload files (so URLs change again).
// Best to run once after Render has the latest deploy.

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('../node_modules/mongodb');

const ATLAS = process.env.ATLAS_URI;
const API   = (process.env.API_BASE || 'https://mayvelerp.onrender.com').replace(/\/$/, '');
const EMAIL = process.env.LOGIN_EMAIL || 'thaghanazeer.s@mayvel.ai';
const PW    = process.env.LOGIN_PW    || 'Demo2026!';
if (!ATLAS || !ATLAS.startsWith('mongodb')) { console.error('Missing ATLAS_URI'); process.exit(1); }

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

async function login() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PW }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  const data = await res.json();
  return data.token;
}

async function uploadOne(token, filepath, originalName) {
  const buf = fs.readFileSync(filepath);
  const boundary = '----migrate' + Date.now() + Math.random().toString(16).slice(2);
  const header = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${originalName.replace(/"/g, '')}"\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([header, buf, footer]);
  const res = await fetch(`${API}/api/uploads`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': body.length,
    },
    body,
  });
  if (!res.ok) throw new Error(`upload ${originalName} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();   // { url, name, sizeBytes, mimeType }
}

// Walks a document, replaces any string containing oldUrl with newUrl.
function deepReplace(value, oldUrl, newUrl) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.includes(oldUrl) ? value.split(oldUrl).join(newUrl) : value;
  if (Array.isArray(value)) return value.map(v => deepReplace(v, oldUrl, newUrl));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepReplace(v, oldUrl, newUrl);
    return out;
  }
  return value;
}

(async () => {
  const files = fs.readdirSync(UPLOADS_DIR).filter(f => !f.startsWith('.'));
  console.log(`Found ${files.length} files in ${UPLOADS_DIR}`);
  const token = await login();
  console.log('Logged in to', API);

  const mapping = {};   // localFilename → liveUrl
  let i = 0;
  for (const file of files) {
    i++;
    const fp = path.join(UPLOADS_DIR, file);
    const st = fs.statSync(fp);
    if (!st.isFile()) continue;
    if (st.size > 200 * 1024 * 1024) { console.log(`  [skip too large >200MB] ${file}`); continue; }
    try {
      const sizeMB = (st.size / 1048576).toFixed(1);
      process.stdout.write(`  [${i}/${files.length}] ${file} (${sizeMB} MB) … `);
      const r = await uploadOne(token, fp, file);
      mapping[file] = r.url;
      process.stdout.write(`OK → ${r.url}\n`);
    } catch (e) {
      console.log(`FAIL: ${e.message}`);
    }
  }
  console.log(`\nUploaded ${Object.keys(mapping).length} files.`);

  // Now rewrite DB references. Old URL shape: http://127.0.0.1:3001/uploads/<filename>
  const client = new MongoClient(ATLAS); await client.connect();
  const db = client.db();
  const COLLS = ['tasks', 'taskcomments', 'pages', 'users', 'projects', 'sprints'];
  let totalUpdates = 0;
  for (const coll of COLLS) {
    const docs = await db.collection(coll).find({}).toArray();
    for (const doc of docs) {
      let changed = false;
      let updated = doc;
      for (const [oldName, newUrl] of Object.entries(mapping)) {
        const oldUrl = `http://127.0.0.1:3001/uploads/${oldName}`;
        const before = updated;
        updated = deepReplace(updated, oldUrl, newUrl);
        if (JSON.stringify(before) !== JSON.stringify(updated)) changed = true;
      }
      if (changed) {
        await db.collection(coll).replaceOne({ _id: doc._id }, updated);
        totalUpdates++;
      }
    }
    console.log(`  ${coll}: scanned ${docs.length} docs`);
  }
  console.log(`\nUpdated ${totalUpdates} documents.`);
  await client.close();
  console.log('Done.');
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
