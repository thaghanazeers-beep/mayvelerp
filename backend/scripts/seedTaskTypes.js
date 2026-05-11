/**
 * Seed the 12 TaskTypes from the Excel screenshot, scoped to one teamspace.
 *   Usage: node scripts/seedTaskTypes.js [TEAMSPACE_ID]
 */
const mongoose = require('mongoose');
const TaskType = require('../models/TaskType');

const MONGO_URI    = process.env.MONGO_URI    || 'mongodb://localhost:27017/mayvel_task';
const TEAMSPACE_ID = process.argv[2] || process.env.TEAMSPACE_ID || '69f0d4c70c14f3d081540d9f';

const TYPES = [
  'Analysis & Documentation',
  'Deployment',
  'Design',
  'Development',
  'Digital Marketing',
  'Maintenance',
  'Project Management',
  'Sales',
  'Support',
  'Testing',
  'Training',
  'UAT',
];

(async () => {
  await mongoose.connect(MONGO_URI);
  const tsId = new mongoose.Types.ObjectId(TEAMSPACE_ID);

  let created = 0, updated = 0;
  for (let i = 0; i < TYPES.length; i++) {
    const existing = await TaskType.findOne({ teamspaceId: tsId, name: TYPES[i] });
    if (existing) {
      existing.sortOrder = i; existing.active = true; await existing.save();
      updated++;
    } else {
      await TaskType.create({ teamspaceId: tsId, name: TYPES[i], sortOrder: i, active: true });
      created++;
    }
  }
  console.log(`✅ TaskTypes — created ${created}, updated ${updated}, total ${TYPES.length}`);
  await mongoose.disconnect();
})().catch(e => { console.error('❌', e); process.exit(1); });
