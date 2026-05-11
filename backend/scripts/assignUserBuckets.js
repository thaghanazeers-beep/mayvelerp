/**
 * Backfill User.rateBucketId from the name → bucket map in the Excel screenshot.
 * Match by user.name (case-insensitive contains, e.g. "Pooja" matches "Pooja.S" or "Pooja").
 *
 * Users not in the map default to `Junior` (admins can promote later).
 *
 *   Usage: node scripts/assignUserBuckets.js [TEAMSPACE_ID]
 */
const mongoose = require('mongoose');
const User = require('../models/User');
const RateBucket = require('../models/RateBucket');

const MONGO_URI    = process.env.MONGO_URI    || 'mongodb://localhost:27017/mayvel_task';
const TEAMSPACE_ID = process.argv[2] || process.env.TEAMSPACE_ID || '69f0d4c70c14f3d081540d9f';

// From the Excel screenshot — first-name → bucket
const NAME_TO_BUCKET = {
  'Abhinandana':     'Trainee',
  'Anandha Prakash': 'Junior',
  'Daniel':          'Junior',
  'Devaraj':         'Management',
  'Hariharan':       'Junior',
  'Harikeshev':      'Junior',
  'Johnpravin':      'Senior',
  'John Praveen':    'Senior',
  'Karthick':        'Junior',
  'Kesavan':         'Management',
  'Kumuthamani':     'Trainee',
  'Manikandan':      'Associate',
  'Murali':          'Management',
  'Naveen':          'Trainee',
  'Naveen Kumar':    'Trainee',
  'Nithish':         'Junior',
  'Praveenkumar':    'Associate',
  'Ravikumar':       'Management',
  'Ravi':            'Management',     // catches "Ravi" — adjust if multiple Ravis exist
  'Sahadevan':       'Manager',
  'Saranraj':        'Junior',
  'Saravanakumar':   'Manager',
  'Satheesh':        'Associate',
  'Sreevishnu':      'Associate',
  'Ssudharsan':      'Associate',
  'Sudarsan':        'Associate',
  'Thaghanazeer':    'Lead',
  'Thagha':          'Lead',
  'Thaha':           'Lead',
  'Thevatharshini':  'Associate',
  'Venkatesh':       'Trainee',
  'Vigneshkumar':    'Associate',
  'Vignesh':         'Associate',
  'Yogeshwaran':     'Junior',
  'Yogesh':          'Junior',
  'Pooja':           'Associate',
  'Suha':            'Trainee',
  'Udheshganth':     'Trainee',
  'Udesh':           'Trainee',
  'Karthika':        'Trainee',
  'Chandru':         'Trainee',
  'Chandra':         'Trainee',
  'Vishvesh':        'Junior',
  'Sivanesh':        'Junior',
  'Lushyanthi':      'Junior',
  'Sundaraman':      'Manager',
  'Francisco':       'Manager',
  'Vijay Sheety':    'Lead',
  'Sharon KK':       'Trainee',
  'Sharon':          'Junior',
  'Anandkumar':      'Associate',
  'Ashok':           'Manager',
  'Vaishak':         'Associate',
  'Harikesav':       'Associate',
  'Nagendaran':      'Management',
  'Deva':            'Manager',
  'Subha Sree':      'Lead',
  'Sabari':          'Trainee',
  'Viki':            'Lead',
  'Nazeer':          'Lead',
  'Jeyalakshmi':     'Junior',
};

(async () => {
  await mongoose.connect(MONGO_URI);
  const tsId = new mongoose.Types.ObjectId(TEAMSPACE_ID);

  const buckets = await RateBucket.find({ teamspaceId: tsId });
  const bucketByName = Object.fromEntries(buckets.map(b => [b.name.toLowerCase(), b._id]));

  const defaultBucketId = bucketByName['junior'];
  if (!defaultBucketId) { console.error('❌ Run seedRateBuckets.js first'); process.exit(1); }

  const users = await User.find({});
  let matched = 0, defaulted = 0, unchanged = 0;

  for (const u of users) {
    // Try exact-then-prefix matches (case-insensitive)
    const uname = (u.name || '').toLowerCase();
    let bucketName = null;
    for (const [needle, bucket] of Object.entries(NAME_TO_BUCKET)) {
      if (uname.includes(needle.toLowerCase())) { bucketName = bucket; break; }
    }
    const targetBucketId = bucketName ? bucketByName[bucketName.toLowerCase()] : defaultBucketId;
    if (!targetBucketId) continue;

    if (String(u.rateBucketId) === String(targetBucketId)) { unchanged++; continue; }

    u.rateBucketId = targetBucketId;
    await u.save();
    if (bucketName) matched++; else defaulted++;
  }

  console.log(`✅ User buckets — matched ${matched}, defaulted ${defaulted}, unchanged ${unchanged}, total ${users.length}`);

  // Summary table
  const populated = await User.find({}).populate('rateBucketId', 'name ratePerHourCents');
  const counts = {};
  for (const u of populated) {
    const k = u.rateBucketId?.name || '(none)';
    counts[k] = (counts[k] || 0) + 1;
  }
  console.log('\nDistribution:'); console.table(counts);

  await mongoose.disconnect();
})().catch(e => { console.error('❌', e); process.exit(1); });
