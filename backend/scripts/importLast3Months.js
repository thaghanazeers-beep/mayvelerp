require('dotenv').config({ path: '../.env' });
const { Client } = require('@notionhq/client');
const mongoose = require('mongoose');

const NOTION_TOKEN = process.env.NOTION_TOKEN || '';
const TASKS_DB    = '3d95e268-c3e7-4340-9b22-925c2348f5a3';
const MONGO_URI   = process.env.MONGO_URI || 'mongodb://localhost:27017/mayvel_task';
const TEAMSPACE_ID = '69f0d4c70c14f3d081540d9f'; // Product Design teamspace

const notion = new Client({ auth: NOTION_TOKEN });

// ─── Mongoose Schema ─────────────────────────────────────────────────────────
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
  teamspaceId:    { type: String },
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

async function fetchLast3Months(databaseId) {
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  let results = [];
  let cursor;
  let page = 1;
  do {
    const resp = await notion.dataSources.query({
      data_source_id: databaseId,
      filter: {
        timestamp: 'created_time',
        created_time: {
          on_or_after: threeMonthsAgo.toISOString()
        }
      },
      page_size: 100,
      start_cursor: cursor,
    });
    results = results.concat(resp.results);
    cursor = resp.has_more ? resp.next_cursor : null;
    process.stdout.write(`\r  Fetched ${results.length} records...`);
    page++;
  } while (cursor);
  console.log(`\r  ✅ Fetched ${results.length} total records from last 3 months`);
  return results;
}

async function main() {
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  
  console.log('📥 Fetching tasks from Notion...');
  const notionTasks = await fetchLast3Months(TASKS_DB);
  
  console.log('💾 Upserting into MongoDB...');
  let upserted = 0;
  let skipped = 0;

  for (const page of notionTasks) {
    const p = page.properties;
    const title = extractProp(p['Task name']) || extractProp(p['Name']) || extractProp(p['Title']) || 'Untitled';
    if (!title || (title === 'Untitled' && Object.keys(p).length < 3)) { skipped++; continue; }

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

    const taskId = `notion_${page.id.replace(/-/g,'')}`;
    const updateData = {
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
      teamspaceId:    TEAMSPACE_ID
    };

    await Task.findOneAndUpdate(
      { id: taskId },
      { $set: updateData },
      { upsert: true, new: true }
    );
    upserted++;
  }

  console.log(`\n✅ Import complete!`);
  console.log(`   Upserted: ${upserted}`);
  console.log(`   Skipped:  ${skipped}`);
  
  await mongoose.disconnect();
}

main().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
