require('dotenv').config({ path: '../.env' });
const { Client } = require('@notionhq/client');
const mongoose = require('mongoose');

const NOTION_TOKEN = process.env.NOTION_TOKEN || '';
const TASKS_DB    = '3d95e268-c3e7-4340-9b22-925c2348f5a3';
const MONGO_URI   = process.env.MONGO_URI || 'mongodb://localhost:27017/mayvel_task';

const notion = new Client({ auth: NOTION_TOKEN });

// ─── Mongoose Schemas ─────────────────────────────────────────────────────────

const taskSchema = new mongoose.Schema({
  id:             { type: String, required: true, unique: true },
  notionId:       { type: String },
  title:          { type: String, required: true },
  description:    { type: String, default: '' },
  status:         { type: String, default: 'Not Yet Started' },
  priority:       { type: String, default: '' },
  assignee:       { type: String, default: '' },
  dueDate:        { type: Date },
  startDate:      { type: Date },
  estimatedHours: { type: Number, default: 0 },
  actualHours:    { type: Number, default: 0 },
  taskType:       { type: [String], default: [] },
  projectId:      { type: String },
  sprintId:       { type: String },
  parentId:       { type: String },
  notionProjectId:{ type: String },
  notionSprintId: { type: String },
  createdDate:    { type: Date, default: Date.now },
  attachments:    { type: Array, default: [] },
  customProperties: { type: Array, default: [] },
  updatedBy:      { type: String },
});

const Task = mongoose.models.Task || mongoose.model('Task', taskSchema);

// ─── Status Mapping ───────────────────────────────────────────────────────────
function mapStatus(notionStatus) {
  if (!notionStatus) return 'Not Yet Started';
  const s = notionStatus.toLowerCase();
  if (s === 'done' || s === 'completed' || s === 'complete') return 'Completed';
  if (s === 'in progress' || s === 'in-progress' || s === 'doing') return 'In Progress';
  if (s === 'in review' || s === 'review' || s === 'under review') return 'In Review';
  if (s === 'rejected' || s === 'cancelled' || s === 'canceled') return 'Rejected';
  if (s === 'not started' || s === 'todo' || s === 'to do' || s === 'backlog') return 'Not Yet Started';
  return 'Not Yet Started';
}

// ─── Extract simple value from property ──────────────────────────────────────
function extractProp(prop) {
  if (!prop) return null;
  switch (prop.type) {
    case 'title':        return prop.title?.map(t => t.plain_text).join('') || '';
    case 'rich_text':    return prop.rich_text?.map(t => t.plain_text).join('') || '';
    case 'select':       return prop.select?.name || '';
    case 'status':       return prop.status?.name || '';
    case 'multi_select': return prop.multi_select?.map(s => s.name) || [];
    case 'date':         return prop.date?.start || null;
    case 'number':       return prop.number ?? null;
    case 'checkbox':     return prop.checkbox ?? false;
    case 'url':          return prop.url || '';
    case 'people':       return prop.people?.map(p => p.name).join(', ') || '';
    case 'relation':     return prop.relation?.map(r => r.id) || [];
    case 'unique_id':    return prop.unique_id?.number ? String(prop.unique_id.number) : null;
    default:             return null;
  }
}

// ─── Fetch all pages from a datasource ───────────────────────────────────────
async function fetchAll(dataSourceId) {
  let results = [];
  let cursor;
  let page = 1;
  do {
    const resp = await notion.dataSources.query({
      data_source_id: dataSourceId,
      page_size: 100,
      start_cursor: cursor,
    });
    results = results.concat(resp.results);
    cursor = resp.has_more ? resp.next_cursor : null;
    process.stdout.write(`\r  Fetched ${results.length} records...`);
    page++;
  } while (cursor);
  console.log(`\r  ✅ Fetched ${results.length} total records`);
  return results;
}

// ─── Main Import ──────────────────────────────────────────────────────────────
async function main() {
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB\n');

  // 1. Clear old tasks
  console.log('🗑️  Clearing old tasks...');
  const deletedCount = await Task.deleteMany({});
  console.log(`   Removed ${deletedCount.deletedCount} old tasks\n`);

  // 2. Fetch all tasks from Notion
  console.log('📥 Fetching tasks from Notion...');
  const notionTasks = await fetchAll(TASKS_DB);
  console.log(`\n📊 Total Notion tasks: ${notionTasks.length}\n`);

  // 3. Map and insert
  console.log('💾 Importing into MongoDB...');
  let inserted = 0;
  let skipped  = 0;
  const BATCH = 100;

  for (let i = 0; i < notionTasks.length; i += BATCH) {
    const batch = notionTasks.slice(i, i + BATCH);
    const docs = [];

    for (const page of batch) {
      const p = page.properties;

      const title = extractProp(p['Task name']) || extractProp(p['Name']) || extractProp(p['Title']) || 'Untitled';
      if (!title || title === 'Untitled' && Object.keys(p).length < 3) { skipped++; continue; }

      const rawStatus   = extractProp(p['Status']) || '';
      const status      = mapStatus(rawStatus);
      const priority    = extractProp(p['Priority']) || '';
      const assigneeRaw = extractProp(p['Assignee']) || '';
      const assignee    = typeof assigneeRaw === 'string' ? assigneeRaw.split(',')[0].trim() : '';
      const startDate   = extractProp(p['Start Date']);
      const endDate     = extractProp(p['End Date']);
      const estHours    = extractProp(p['Estimated Time']);
      const actHours    = extractProp(p['Elapsed Time']);
      const taskType    = extractProp(p['Task type']) || [];
      const sprintRels  = extractProp(p['Sprint']) || [];
      const projectRels = extractProp(p['Project']) || [];
      const parentRels  = extractProp(p['Parent task']) || [];

      docs.push({
        id:             `notion_${page.id.replace(/-/g,'')}`,
        notionId:       page.id,
        title,
        status,
        priority,
        assignee,
        startDate:      startDate ? new Date(startDate) : null,
        dueDate:        endDate ? new Date(endDate) : null,
        estimatedHours: estHours ? Number(estHours) : 0,
        actualHours:    actHours ? Number(actHours) : 0,
        taskType:       Array.isArray(taskType) ? taskType : [taskType].filter(Boolean),
        notionSprintId: sprintRels[0] || null,
        notionProjectId:projectRels[0] || null,
        parentId:       parentRels[0] ? `notion_${parentRels[0].replace(/-/g,'')}` : null,
        createdDate:    new Date(page.created_time),
        description:    '',
        customProperties: [],
        attachments:    [],
      });
    }

    if (docs.length > 0) {
      await Task.insertMany(docs, { ordered: false });
      inserted += docs.length;
    }
    process.stdout.write(`\r  Progress: ${Math.min(i + BATCH, notionTasks.length)}/${notionTasks.length}`);
  }

  console.log(`\n\n✅ Import complete!`);
  console.log(`   Inserted: ${inserted}`);
  console.log(`   Skipped:  ${skipped}`);

  // 4. Quick summary
  const counts = {};
  const allTasks = await Task.find({}, { status: 1 });
  for (const t of allTasks) counts[t.status] = (counts[t.status] || 0) + 1;
  console.log('\n📊 Task breakdown by status:');
  for (const [s, c] of Object.entries(counts)) console.log(`   ${s}: ${c}`);

  await mongoose.disconnect();
  console.log('\n🔌 Disconnected. Done!');
}

main().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
