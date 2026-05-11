/**
 * For every task with a notionId, walk the Notion page blocks and:
 *   - Download every image/file/pdf/video block to /uploads
 *   - Attach to task.attachments as proper {id, name, sizeBytes, path, mimeType, addedAt}
 *   - Strip those blocks from the rendered description so the editor doesn't
 *     show stale s3 URLs (the file moves into the Attachments section instead).
 *
 * Notion file URLs (file.file.url) are signed S3 links that expire ~1 hour after
 * the page was fetched, so we have to download immediately.
 *
 * Idempotent — re-running de-dupes by Notion block id (stored in attachment.notionBlockId).
 */

const { Client } = require('@notionhq/client');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { Task } = require('../models/Task');

const NOTION_TOKEN = process.env.NOTION_TOKEN || '';
const MONGO_URI    = process.env.MONGO_URI    || 'mongodb://localhost:27017/mayvel_task';
const TEAMSPACE_ID = process.env.TEAMSPACE_ID || '69f0d4c70c14f3d081540d9f';
const PUBLIC_BASE  = process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:3001';
const UPLOADS_DIR  = path.join(__dirname, '..', 'uploads');
const NOTION_DELAY = 350;

const notion = new Client({ auth: NOTION_TOKEN });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const richTextToString = (rich) => (rich || []).map(t => t.plain_text || '').join('');

const slugify = (s) => (s || 'file').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 100);

async function downloadToUploads(url, suggestedName, mimeHint) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  // Choose a filename: prefer suggestedName, else last URL segment.
  let base = slugify(suggestedName);
  if (!path.extname(base)) {
    const urlPath = (() => { try { return new URL(url).pathname; } catch { return ''; } })();
    const ext = path.extname(urlPath);
    if (ext) base += ext;
  }
  const filename = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + base;
  const dest = path.join(UPLOADS_DIR, filename);
  fs.writeFileSync(dest, buf);
  return {
    url: `${PUBLIC_BASE}/uploads/${filename}`,
    sizeBytes: buf.length,
    mimeType: res.headers.get('content-type') || mimeHint || 'application/octet-stream',
    name: suggestedName || base,
  };
}

const richTextToContent = (rich) => richTextToString(rich);

const convertBlock = (block) => {
  const id = block.id;
  switch (block.type) {
    case 'paragraph':
      return { id, type: 'text',     content: richTextToContent(block.paragraph?.rich_text) };
    case 'heading_1':
    case 'heading_2':
    case 'heading_3':
      return { id, type: 'heading',  content: richTextToContent(block[block.type]?.rich_text) };
    case 'bulleted_list_item':
      return { id, type: 'bullet',   content: richTextToContent(block.bulleted_list_item?.rich_text) };
    case 'numbered_list_item':
      return { id, type: 'bullet',   content: richTextToContent(block.numbered_list_item?.rich_text) };
    case 'to_do':
      return { id, type: 'checkbox', content: (block.to_do?.checked ? '[x] ' : '') + richTextToContent(block.to_do?.rich_text) };
    case 'quote':
      return { id, type: 'quote',    content: richTextToContent(block.quote?.rich_text) };
    case 'code':
      return { id, type: 'code',     content: richTextToContent(block.code?.rich_text) };
    case 'callout':
      return { id, type: 'callout',  content: richTextToContent(block.callout?.rich_text) };
    case 'divider':
      return { id, type: 'divider',  content: '' };
    case 'toggle':
      return { id, type: 'text',     content: '▸ ' + richTextToContent(block.toggle?.rich_text) };
    default:
      return null;
  }
};

const fileLikeBlock = (block) => {
  if (!['image', 'file', 'pdf', 'video'].includes(block.type)) return null;
  const node = block[block.type];
  const url  = node?.file?.url || node?.external?.url;
  if (!url) return null;
  const caption = richTextToString(node.caption);
  const isExternal = !node.file;
  const filenameHint = node?.name || caption || '';
  return { url, caption, isExternal, filenameHint, kind: block.type };
};

async function processTask(t) {
  let cursor;
  const newBlocks = [];
  const fileEntries = []; // { notionBlockId, url, caption, isExternal, filenameHint, kind }

  do {
    const r = await notion.blocks.children.list({ block_id: t.notionId, start_cursor: cursor, page_size: 100 });
    for (const b of r.results) {
      const file = fileLikeBlock(b);
      if (file) {
        fileEntries.push({ notionBlockId: b.id, ...file });
      } else {
        const conv = convertBlock(b);
        if (conv) newBlocks.push(conv);
      }
    }
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);

  // De-dupe against existing attachments (by notionBlockId)
  const existing = Array.isArray(t.attachments) ? t.attachments : [];
  const haveBlockIds = new Set(existing.filter(a => a.notionBlockId).map(a => a.notionBlockId));

  const newAttachments = [...existing];
  let dl = 0, dlSkip = 0;
  for (const f of fileEntries) {
    if (haveBlockIds.has(f.notionBlockId)) { dlSkip++; continue; }
    try {
      const downloaded = await downloadToUploads(f.url, f.filenameHint, f.kind === 'image' ? 'image/*' : null);
      newAttachments.push({
        id: Date.now().toString() + Math.random().toString(36).slice(2, 8),
        notionBlockId: f.notionBlockId,
        name: downloaded.name,
        sizeBytes: downloaded.sizeBytes,
        mimeType: downloaded.mimeType,
        path: downloaded.url,
        addedAt: new Date().toISOString(),
      });
      dl++;
    } catch (e) {
      console.log(`     ⚠ download failed (${f.kind}): ${e.message}`);
    }
  }

  return { description: JSON.stringify(newBlocks), attachments: newAttachments, dl, dlSkip, fileCount: fileEntries.length };
}

(async () => {
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  const TS = new mongoose.Types.ObjectId(TEAMSPACE_ID);
  const tasks = await Task.find({ teamspaceId: TS, notionId: { $nin: [null, ''] } }).lean();
  console.log(`📋 ${tasks.length} tasks with notionId`);

  let updated = 0, totalDl = 0, totalSkip = 0, withFiles = 0, failed = 0;

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    try {
      const { description, attachments, dl, dlSkip, fileCount } = await processTask(t);
      if (fileCount > 0) withFiles++;
      totalDl += dl; totalSkip += dlSkip;
      await Task.updateOne({ _id: t._id }, { $set: { description, attachments } });
      updated++;
      if (dl > 0) console.log(`  ✓ [${i+1}/${tasks.length}] ${t.title}  → +${dl} files`);
    } catch (e) {
      failed++;
      console.log(`  ⚠ [${i+1}/${tasks.length}] ${t.title}: ${e.message}`);
    }
    await sleep(NOTION_DELAY);
  }

  console.log(`\n✅ Done. Updated ${updated}/${tasks.length}. Tasks with file blocks: ${withFiles}. Files downloaded: ${totalDl} (${totalSkip} skipped as already-saved). Failed: ${failed}.`);
  await mongoose.disconnect();
})().catch(e => { console.error('❌', e); process.exit(1); });
