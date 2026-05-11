/**
 * Seed the 11 RateBuckets from the Excel screenshot, scoped to one teamspace.
 *   Usage: node scripts/seedRateBuckets.js [TEAMSPACE_ID]
 *   Default TEAMSPACE_ID: 69f0d4c70c14f3d081540d9f (Product Design)
 */
const mongoose = require('mongoose');
const RateBucket = require('../models/RateBucket');

const MONGO_URI    = process.env.MONGO_URI    || 'mongodb://localhost:27017/mayvel_task';
const TEAMSPACE_ID = process.argv[2] || process.env.TEAMSPACE_ID || '69f0d4c70c14f3d081540d9f';

const BUCKETS = [
  { name: 'Trainee',           ratePerHourCents:    34600, kind: 'labor'   },
  { name: 'Junior',            ratePerHourCents:    50100, kind: 'labor'   },
  { name: 'Associate',         ratePerHourCents:    69600, kind: 'labor'   },
  { name: 'Lead',              ratePerHourCents:   104000, kind: 'labor'   },
  { name: 'Manager',           ratePerHourCents:   139800, kind: 'labor'   },
  { name: 'Management',        ratePerHourCents:   176000, kind: 'labor'   },
  { name: 'Senior',            ratePerHourCents:   243100, kind: 'labor'   },
  { name: 'ExpensesBucket1',   ratePerHourCents:   200000, kind: 'expense' },
  { name: 'ExpensesBucket2',   ratePerHourCents:   500000, kind: 'expense' },
  { name: 'ExpensesBucket3',   ratePerHourCents:  1000000, kind: 'expense' },
  { name: 'ExpensesBucket4',   ratePerHourCents:  2500000, kind: 'expense' },
];

(async () => {
  await mongoose.connect(MONGO_URI);
  const tsId = new mongoose.Types.ObjectId(TEAMSPACE_ID);

  let created = 0, updated = 0;
  for (const b of BUCKETS) {
    const existing = await RateBucket.findOne({ teamspaceId: tsId, name: b.name });
    if (existing) {
      Object.assign(existing, { ratePerHourCents: b.ratePerHourCents, kind: b.kind, active: true });
      await existing.save();
      updated++;
    } else {
      await RateBucket.create({ teamspaceId: tsId, ...b, active: true });
      created++;
    }
  }
  console.log(`✅ RateBuckets — created ${created}, updated ${updated}, total ${BUCKETS.length}`);
  await mongoose.disconnect();
})().catch(e => { console.error('❌', e); process.exit(1); });
