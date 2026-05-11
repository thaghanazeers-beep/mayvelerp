/**
 * Notion Import Script for Mayvel Task
 * Imports pages and databases from the last 30 days into MongoDB
 */

const { Client } = require('@notionhq/client');
const mongoose = require('mongoose');
const { Task } = require('./models/Task');

const NOTION_TOKEN = process.env.NOTION_TOKEN || '';

const notion = new Client({ auth: NOTION_TOKEN });

// Connect MongoDB
mongoose.connect('mongodb://localhost:27017/mayvel_task')
  .then(() => console.log('✓ Connected to MongoDB'))
  .catch(err => { console.error('MongoDB error:', err); process.exit(1); });

// ---- Step 1: Discover workspace ----
async function discoverWorkspace() {
  console.log('\n🔍 Discovering Notion workspace...\n');

  // Search for all content
  const allSearch = await notion.search({
    sort: { direction: 'descending', timestamp: 'last_edited_time' },
  });

  const databases = allSearch.results.filter(r => r.object === 'database');
  const allPages = allSearch.results.filter(r => r.object === 'page');

  console.log(`📊 Found ${databases.length} databases:`);
  for (const db of databases) {
    const title = db.title?.map(t => t.plain_text).join('') || 'Untitled';
    console.log(`   - ${title} (${db.id}) — last edited: ${db.last_edited_time}`);
  }

  // Filter pages from last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentPages = allPages.filter(p => 
    new Date(p.last_edited_time) >= thirtyDaysAgo
  );

  console.log(`\n📄 Found ${recentPages.length} pages edited in the last 30 days`);

  return { databases, pages: recentPages };
}

// ---- Step 2: Extract page title ----
function extractTitle(page) {
  // Check common title property names
  const props = page.properties || {};
  for (const [key, val] of Object.entries(props)) {
    if (val.type === 'title' && val.title) {
      return val.title.map(t => t.plain_text).join('') || 'Untitled';
    }
  }
  return 'Untitled';
}

// ---- Step 3: Extract properties ----
function extractProperties(page) {
  const props = page.properties || {};
  const result = {
    status: 'To Do',
    assignee: '',
    dueDate: null,
  };

  for (const [key, val] of Object.entries(props)) {
    const keyLower = key.toLowerCase();

    // Status
    if (val.type === 'status' && val.status) {
      const statusName = val.status.name?.toLowerCase() || '';
      if (statusName.includes('progress') || statusName.includes('doing') || statusName.includes('active')) {
        result.status = 'In Progress';
      } else if (statusName.includes('done') || statusName.includes('complete') || statusName.includes('finish')) {
        result.status = 'Done';
      } else {
        result.status = 'To Do';
      }
    }

    if (val.type === 'select' && keyLower.includes('status') && val.select) {
      const statusName = val.select.name?.toLowerCase() || '';
      if (statusName.includes('progress') || statusName.includes('doing')) {
        result.status = 'In Progress';
      } else if (statusName.includes('done') || statusName.includes('complete')) {
        result.status = 'Done';
      }
    }

    // Assignee
    if (val.type === 'people' && val.people?.length > 0) {
      result.assignee = val.people.map(p => p.name || p.id).join(', ');
    }
    if (val.type === 'person' && val.person) {
      result.assignee = val.person.name || '';
    }

    // Due Date
    if (val.type === 'date' && val.date && (keyLower.includes('due') || keyLower.includes('date') || keyLower.includes('deadline'))) {
      result.dueDate = val.date.start;
    }
  }

  return result;
}

// ---- Step 4: Fetch page blocks (content) ----
async function fetchBlocks(pageId) {
  const blocks = [];
  let cursor;

  try {
    do {
      const response = await notion.blocks.children.list({
        block_id: pageId,
        start_cursor: cursor,
        page_size: 100,
      });

      for (const block of response.results) {
        const converted = convertBlock(block);
        if (converted) blocks.push(converted);
      }

      cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);
  } catch (err) {
    // Some pages may not be accessible
    console.log(`   ⚠ Could not fetch blocks for ${pageId}: ${err.message}`);
  }

  return blocks;
}

function convertBlock(block) {
  const id = block.id;

  switch (block.type) {
    case 'paragraph':
      return {
        id,
        type: 'text',
        content: richTextToString(block.paragraph?.rich_text),
      };
    case 'heading_1':
    case 'heading_2':
    case 'heading_3':
      return {
        id,
        type: 'heading',
        content: richTextToString(block[block.type]?.rich_text),
      };
    case 'bulleted_list_item':
      return {
        id,
        type: 'bullet',
        content: richTextToString(block.bulleted_list_item?.rich_text),
      };
    case 'numbered_list_item':
      return {
        id,
        type: 'bullet',
        content: richTextToString(block.numbered_list_item?.rich_text),
      };
    case 'to_do':
      return {
        id,
        type: 'checkbox',
        content: (block.to_do?.checked ? '[x] ' : '') + richTextToString(block.to_do?.rich_text),
      };
    case 'quote':
      return {
        id,
        type: 'quote',
        content: richTextToString(block.quote?.rich_text),
      };
    case 'code':
      return {
        id,
        type: 'code',
        content: richTextToString(block.code?.rich_text),
      };
    case 'callout':
      return {
        id,
        type: 'callout',
        content: richTextToString(block.callout?.rich_text),
      };
    case 'divider':
      return { id, type: 'divider', content: '' };
    case 'toggle':
      return {
        id,
        type: 'text',
        content: '▸ ' + richTextToString(block.toggle?.rich_text),
      };
    default:
      // For unsupported blocks, try to extract any text
      const textKey = block[block.type];
      if (textKey?.rich_text) {
        return { id, type: 'text', content: richTextToString(textKey.rich_text) };
      }
      return null;
  }
}

function richTextToString(richText) {
  if (!richText || !Array.isArray(richText)) return '';
  return richText.map(t => {
    let text = t.plain_text || '';
    // Preserve mentions
    if (t.type === 'mention') {
      if (t.mention?.type === 'user') {
        text = `@${t.mention.user?.name || 'user'}`;
      } else if (t.mention?.type === 'page') {
        text = `📄 ${t.plain_text}`;
      } else if (t.mention?.type === 'date') {
        text = `📅 ${t.mention.date?.start || t.plain_text}`;
      }
    }
    return text;
  }).join('');
}

// ---- Step 5: Import database items ----
async function importDatabase(database) {
  const title = database.title?.map(t => t.plain_text).join('') || 'Untitled';
  console.log(`\n📊 Importing database: "${title}"`);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  let cursor;
  let imported = 0;

  try {
    do {
      const response = await notion.databases.query({
        database_id: database.id,
        start_cursor: cursor,
        page_size: 100,
        filter: {
          timestamp: 'last_edited_time',
          last_edited_time: {
            on_or_after: thirtyDaysAgo.toISOString(),
          },
        },
        sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      });

      for (const page of response.results) {
        await importPage(page, title);
        imported++;
      }

      cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);
  } catch (err) {
    console.log(`   ⚠ Could not query database: ${err.message}`);
    
    // Try without filter (some databases don't support timestamp filter)
    try {
      const response = await notion.databases.query({
        database_id: database.id,
        page_size: 50,
        sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      });

      for (const page of response.results) {
        if (new Date(page.last_edited_time) >= thirtyDaysAgo) {
          await importPage(page, title);
          imported++;
        }
      }
    } catch (err2) {
      console.log(`   ⚠ Fallback also failed: ${err2.message}`);
    }
  }

  console.log(`   ✓ Imported ${imported} items from "${title}"`);
  return imported;
}

// ---- Step 6: Import a single page ----
async function importPage(page, sourceDb = '') {
  const pageTitle = extractTitle(page);
  const props = extractProperties(page);
  const blocks = await fetchBlocks(page.id);

  // Add a small delay to respect API rate limits
  await new Promise(r => setTimeout(r, 350));

  const taskId = `notion_${page.id.replace(/-/g, '')}`;

  const taskData = {
    id: taskId,
    title: pageTitle,
    description: JSON.stringify(blocks.length > 0 ? blocks : [{ id: '1', type: 'text', content: '' }]),
    status: props.status,
    assignee: props.assignee,
    dueDate: props.dueDate,
    createdDate: page.created_time,
    customProperties: sourceDb ? [{ definitionId: 'source', value: `Notion: ${sourceDb}` }] : [],
    attachments: [],
    parentId: null,
  };

  // Upsert: update if exists, create if not
  await Task.findOneAndUpdate(
    { id: taskId },
    taskData,
    { upsert: true, new: true }
  );

  console.log(`   ✓ ${pageTitle}`);
}

// ---- Main ----
async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  Notion → Mayvel Task Importer');
  console.log('═══════════════════════════════════════════');

  try {
    const { databases, pages } = await discoverWorkspace();

    let totalImported = 0;

    // Import from databases
    for (const db of databases) {
      const count = await importDatabase(db);
      totalImported += count;
    }

    // Import standalone pages (not in databases)
    const dbPageIds = new Set();
    // We've already imported pages from databases, so just import standalone pages
    for (const page of pages) {
      if (page.parent?.type !== 'database_id') {
        await importPage(page, 'Standalone');
        totalImported++;
      }
    }

    console.log('\n═══════════════════════════════════════════');
    console.log(`  ✅ Import complete! ${totalImported} tasks imported.`);
    console.log('═══════════════════════════════════════════\n');
  } catch (err) {
    console.error('\n❌ Import error:', err.message);
    if (err.code === 'unauthorized') {
      console.error('   → Make sure you shared your pages with the integration!');
    }
  }

  mongoose.disconnect();
}

main();
