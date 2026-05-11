/**
 * Import Notion Projects + Sprints into Mongo, then backfill task.projectId/sprintId
 * from the notionProjectId/notionSprintId set during the earlier task import.
 *
 * Usage:  node scripts/importProjectsAndSprints.js
 */

const { Client } = require('@notionhq/client');
const mongoose = require('mongoose');
const Project = require('../models/Project');
const Sprint = require('../models/Sprint');
const { Task } = require('../models/Task');

const NOTION_TOKEN  = process.env.NOTION_TOKEN  || '';
const PROJECTS_DS   = process.env.PROJECTS_DS   || '6ef7615b-1f51-4462-ab63-2b374be4e160';
const SPRINTS_DS    = process.env.SPRINTS_DS    || '2d56766e-0a70-8092-a5bf-000bae4ed2d1';
const MONGO_URI     = process.env.MONGO_URI     || 'mongodb://localhost:27017/mayvel_task';
const TEAMSPACE_ID  = process.env.TEAMSPACE_ID  || '69f0d4c70c14f3d081540d9f';

const notion = new Client({ auth: NOTION_TOKEN });

const pickProp = (props, ...names) => {
  for (const n of names) if (props[n]) return props[n];
  // case-insensitive fallback
  for (const k of Object.keys(props)) {
    if (names.some(n => n.toLowerCase() === k.toLowerCase())) return props[k];
  }
  return null;
};

const extract = (prop) => {
  if (!prop) return null;
  switch (prop.type) {
    case 'title':       return prop.title?.map(t => t.plain_text).join('') || '';
    case 'rich_text':   return prop.rich_text?.map(t => t.plain_text).join('') || '';
    case 'select':      return prop.select?.name || '';
    case 'status':      return prop.status?.name || '';
    case 'date':        return prop.date || null;
    default:            return null;
  }
};

const mapSprintStatus = (s) => {
  if (!s) return 'planned';
  const v = s.toLowerCase();
  if (v.includes('active') || v.includes('progress') || v.includes('current')) return 'active';
  if (v.includes('done') || v.includes('complete') || v.includes('finished'))   return 'completed';
  return 'planned';
};

async function fetchAll(dataSourceId) {
  const out = [];
  let cursor;
  do {
    const r = await notion.dataSources.query({ data_source_id: dataSourceId, page_size: 100, start_cursor: cursor });
    out.push(...r.results);
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return out;
}

(async () => {
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  const tsId = new mongoose.Types.ObjectId(TEAMSPACE_ID);

  // ─── PROJECTS ───────────────────────────────────────────────────
  console.log('📦 Fetching Projects from Notion...');
  const notionProjects = await fetchAll(PROJECTS_DS);
  console.log(`   Found ${notionProjects.length} project pages`);

  const projectMap = {}; // notionId → Mongo _id
  for (const page of notionProjects) {
    const p = page.properties || {};
    const name = extract(pickProp(p, 'Name', 'Project name', 'Project', 'Title')) || 'Untitled Project';
    const description = extract(pickProp(p, 'Description', 'Notes', 'Summary')) || '';
    const status = extract(pickProp(p, 'Status')) || 'Active';

    const doc = await Project.findOneAndUpdate(
      { notionId: page.id },
      {
        notionId: page.id,
        name,
        description,
        status,
        teamspaceId: tsId,
        icon: '📁',
        color: '#6c5ce7',
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    projectMap[page.id] = doc._id;
  }
  console.log(`   ✅ Upserted ${Object.keys(projectMap).length} projects`);

  // ─── SPRINTS ────────────────────────────────────────────────────
  console.log('🏃 Fetching Sprints from Notion...');
  const notionSprints = await fetchAll(SPRINTS_DS);
  console.log(`   Found ${notionSprints.length} sprint pages`);

  const sprintMap = {}; // notionId → Mongo _id
  for (const page of notionSprints) {
    const p = page.properties || {};
    const name = extract(pickProp(p, 'Name', 'Sprint name', 'Sprint', 'Title')) || 'Untitled Sprint';
    const goal = extract(pickProp(p, 'Goal', 'Description', 'Notes')) || '';
    const statusRaw = extract(pickProp(p, 'Status'));
    const status = mapSprintStatus(statusRaw);
    const dateProp = pickProp(p, 'Dates', 'Sprint Dates', 'Date', 'Start - End');
    const dateObj = extract(dateProp);
    const startDate = dateObj?.start ? new Date(dateObj.start) : null;
    const endDate   = dateObj?.end   ? new Date(dateObj.end)   : null;

    const doc = await Sprint.findOneAndUpdate(
      { notionId: page.id },
      {
        notionId: page.id,
        name,
        goal,
        status,
        startDate,
        endDate,
        teamspaceId: tsId,
        ...(status === 'completed' ? { completedAt: endDate || new Date() } : {}),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    sprintMap[page.id] = doc._id;
  }
  console.log(`   ✅ Upserted ${Object.keys(sprintMap).length} sprints`);

  // ─── BACKFILL TASKS ────────────────────────────────────────────
  console.log('🔗 Backfilling task.projectId / task.sprintId ...');
  const tasksColl = mongoose.connection.db.collection('tasks');
  let updProj = 0, updSprint = 0, missingProj = 0, missingSprint = 0;

  const cursor = tasksColl.find({ teamspaceId: tsId, $or: [
    { notionProjectId: { $nin: [null, ''] } },
    { notionSprintId:  { $nin: [null, ''] } },
  ] });

  while (await cursor.hasNext()) {
    const t = await cursor.next();
    const update = {};
    if (t.notionProjectId) {
      const mid = projectMap[t.notionProjectId];
      if (mid) { update.projectId = mid.toString(); updProj++; } else missingProj++;
    }
    if (t.notionSprintId) {
      const mid = sprintMap[t.notionSprintId];
      if (mid) { update.sprintId = mid.toString(); updSprint++; } else missingSprint++;
    }
    if (Object.keys(update).length) {
      await tasksColl.updateOne({ _id: t._id }, { $set: update });
    }
  }
  console.log(`   ✅ projectId set on ${updProj} tasks (${missingProj} unmatched)`);
  console.log(`   ✅ sprintId  set on ${updSprint} tasks (${missingSprint} unmatched)`);

  await mongoose.disconnect();
  console.log('Done.');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
