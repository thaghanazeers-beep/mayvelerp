/**
 * For every task with a notionId, fetch the Notion page's child blocks,
 * convert them to the app's block format, and write the JSON into task.description.
 *
 * Idempotent — re-running just refreshes the descriptions from Notion.
 */

const { Client } = require('@notionhq/client');
const mongoose = require('mongoose');
const { Task } = require('../models/Task');

const NOTION_TOKEN = process.env.NOTION_TOKEN || '';
const MONGO_URI    = process.env.MONGO_URI    || 'mongodb://localhost:27017/mayvel_task';
const TEAMSPACE_ID = process.env.TEAMSPACE_ID || '69f0d4c70c14f3d081540d9f';
const NOTION_DELAY = 350; // ms — respects Notion's 3 req/s limit

const notion = new Client({ auth: NOTION_TOKEN });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const richTextToString = (rich) => {
  if (!rich || !Array.isArray(rich)) return '';
  return rich.map(t => {
    if (t.type === 'mention' && t.mention) {
      if (t.mention.type === 'user') return `@${t.mention.user?.name || 'user'}`;
      if (t.mention.type === 'page') return `📄 ${t.plain_text}`;
      if (t.mention.type === 'date') return `📅 ${t.mention.date?.start || t.plain_text}`;
    }
    return t.plain_text || '';
  }).join('');
};

const convertBlock = (block) => {
  const id = block.id;
  switch (block.type) {
    case 'paragraph':
      return { id, type: 'text',     content: richTextToString(block.paragraph?.rich_text) };
    case 'heading_1':
    case 'heading_2':
    case 'heading_3':
      return { id, type: 'heading',  content: richTextToString(block[block.type]?.rich_text) };
    case 'bulleted_list_item':
      return { id, type: 'bullet',   content: richTextToString(block.bulleted_list_item?.rich_text) };
    case 'numbered_list_item':
      return { id, type: 'bullet',   content: richTextToString(block.numbered_list_item?.rich_text) };
    case 'to_do':
      return { id, type: 'checkbox', content: (block.to_do?.checked ? '[x] ' : '') + richTextToString(block.to_do?.rich_text) };
    case 'quote':
      return { id, type: 'quote',    content: richTextToString(block.quote?.rich_text) };
    case 'code':
      return { id, type: 'code',     content: richTextToString(block.code?.rich_text) };
    case 'callout':
      return { id, type: 'callout',  content: richTextToString(block.callout?.rich_text) };
    case 'divider':
      return { id, type: 'divider',  content: '' };
    case 'toggle':
      return { id, type: 'text',     content: '▸ ' + richTextToString(block.toggle?.rich_text) };
    case 'image': {
      const url = block.image?.file?.url || block.image?.external?.url || '';
      const cap = richTextToString(block.image?.caption);
      return { id, type: 'text', content: (cap ? cap + ' — ' : '') + url };
    }
    case 'file': {
      const url = block.file?.file?.url || block.file?.external?.url || '';
      const name = richTextToString(block.file?.caption) || 'file';
      return { id, type: 'text', content: `📎 ${name}: ${url}` };
    }
    default: {
      const k = block[block.type];
      if (k?.rich_text) return { id, type: 'text', content: richTextToString(k.rich_text) };
      return null;
    }
  }
};

async function fetchBlocks(pageId) {
  const blocks = [];
  let cursor;
  try {
    do {
      const r = await notion.blocks.children.list({ block_id: pageId, start_cursor: cursor, page_size: 100 });
      for (const b of r.results) {
        const c = convertBlock(b);
        if (c) blocks.push(c);
      }
      cursor = r.has_more ? r.next_cursor : null;
    } while (cursor);
  } catch (e) {
    return { error: e.message };
  }
  return { blocks };
}

(async () => {
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  const TS = new mongoose.Types.ObjectId(TEAMSPACE_ID);
  const tasks = await Task.find({ teamspaceId: TS, notionId: { $nin: [null, ''] } }, { _id: 1, id: 1, title: 1, notionId: 1 }).lean();
  console.log(`📋 Found ${tasks.length} tasks with notionId`);

  let updated = 0, skipped = 0, failed = 0;
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const { blocks, error } = await fetchBlocks(t.notionId);
    if (error) { failed++; console.log(`  ⚠ [${i+1}/${tasks.length}] ${t.title}: ${error}`); }
    else if (!blocks || blocks.length === 0) {
      skipped++;
    } else {
      await Task.updateOne({ _id: t._id }, { $set: { description: JSON.stringify(blocks) } });
      updated++;
      if (updated % 25 === 0) console.log(`  ✓ progress: ${updated} updated`);
    }
    await sleep(NOTION_DELAY);
  }

  console.log(`\n✅ Done. Updated ${updated} | Empty ${skipped} | Failed ${failed} | Total ${tasks.length}`);
  await mongoose.disconnect();
})().catch(e => { console.error('❌', e); process.exit(1); });
