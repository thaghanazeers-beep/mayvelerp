/**
 * Load org chart V2 (the PDF the user uploaded) into the DB.
 *
 * Design choices:
 *   - One node per unique PERSON. Multi-role people (e.g. Murali = CEO + MHS AM,
 *     Ravi = IT Infra Director + Auchan AM + Biltdata PM + Seyo PO) get extra
 *     `EXTRA_EDGES` so they're correctly tied to every division they own/lead.
 *   - Division headers (Seyo, MHS, Auchan, Bacsys, …) are nodes too with
 *     orgRole='Division' so the Members API can filter them out.
 *   - Existing User accounts auto-link by exact name match (case-insensitive).
 *
 * Run with:  node loadOrgChartV3.js
 */
const mongoose = require('mongoose');
const OrgChart = require('./models/OrgChart');
const User     = require('./models/User');

// id, name, role, department, parentId  (parentId can be null for the root)
const ROWS = [
  // ── ROOT ──
  ['ceo',          'Murali',         'CEO',         'Mayvel',                 null],

  // ── LEVEL 1 — divisions reporting to CEO ──
  ['div_itinfra',  'IT Infra',       'Division',    'IT Infra',               'ceo'],
  ['div_hrpmo',    'HR/PMO',         'Division',    'HR/PMO',                 'ceo'],
  ['div_finance',  'Finance',        'Division',    'Finance',                'ceo'],
  ['div_sales',    'Sales & Marketing', 'Division', 'Sales & Marketing',      'ceo'],
  ['div_ops',      'OPS',            'Division',    'OPS',                    'ceo'],
  ['div_product',  'Product',        'Division',    'Product',                'ceo'],
  ['div_bacsys',   'Bacsys',         'Division',    'Bacsys (SBU)',           'ceo'],

  // ── IT Infra ──
  ['ravi',         'Ravi',           'Director',    'IT Infra',               'div_itinfra'],
  ['chandra',      'Chandra',        'Member',      'Reflect Security',       'ravi'],
  ['vishvesh',     'Vishvesh',       'Member',      'System Administrator',   'ravi'],

  // ── HR/PMO ──
  ['deva',         'Deva',           'Director',    'HR/PMO',                 'div_hrpmo'],
  ['lushyanthi',   'Lushyanthi',     'Consultant',  'HR Consultant',          'deva'],
  ['sivanesh',     'Sivanesh',       'Manager',     'HR Operations',          'deva'],
  ['div_admin',    'Admin',          'Division',    'Admin',                  'sivanesh'],
  ['jeyalakshmi',  'Jeyalakshmi',    'Member',      'House Keeping',          'div_admin'],

  // ── Finance ──
  ['sundaraman',   'Sundaraman',     'Manager',     'Account Manager',        'div_finance'],
  ['francisco',    'Francisco',      'Manager',     'PT Accounts Manager',    'div_finance'],

  // ── Sales & Marketing ──
  ['pooja',        'Pooja',          'Manager',     'BD Manager (Trigital)',  'div_sales'],

  // ── OPS — Raja heads it ──
  ['raja',         'Raja',           'Director',    'OPS',                    'div_ops'],

  // OPS sub-divisions
  ['div_design',   'Design',         'Division',    'Design',                 'raja'],
  ['div_mhs',      'MHS',            'Division',    'MHS',                    'raja'],
  ['div_auchan',   'Auchan',         'Division',    'Auchan',                 'raja'],
  ['div_sgc',      'SGC',            'Division',    'SGC',                    'raja'],
  ['div_geotab',   'Geotab',         'Division',    'Geotab',                 'raja'],
  ['div_biltdata', 'Biltdata',       'Division',    'Biltdata',               'raja'],
  ['div_qa',       'QA',             'Division',    'QA',                     'raja'],

  // Design
  ['viki',         'Viki',           'Consultant',  'UI/UX',                  'div_design'],
  ['nazeer',       'Nazeer',         'Lead',        'UI/UX Design',           'div_design'],
  ['johnpraveen',  'John Praveen',   'Member',      'On-Site Coordinator',    'nazeer'],
  ['praveenkumar', 'Praveenkumar',   'Developer',   'Sr. Developer',          'nazeer'],

  // MHS — Saravanakumar is Team Lead (Murali is AM, wired via EXTRA_EDGES)
  ['saravanakumar','Saravanakumar',  'Lead',        'Team Lead',              'div_mhs'],
  ['sudarsan',     'Sudarsan',       'Developer',   'Software Developer',     'saravanakumar'],
  ['naveen',       'Naveen',         'Developer',   'Jr. Developer',          'saravanakumar'],
  ['udesh',        'Udesh',          'Developer',   'Jr. Developer',          'saravanakumar'],

  // Auchan — Ravi is AM (wired via EXTRA_EDGES)
  ['div_sirius',   'Sirius',         'Division',    'Sirius (Auchan)',        'div_auchan'],
  ['div_digital',  'Digital',        'Division',    'Digital (Auchan)',       'div_auchan'],
  ['yogesh',       'Yogesh',         'Developer',   'Software Developer',     'deva'],   // Sirius — Deva PM
  ['satheesh',     'Satheesh',       'Developer',   'Software Developer',     'saravanakumar'], // Digital + Pro-Inspector

  // SGC
  ['thevatharshini','Thevatharshini','Developer',   'Sr. Developer',          'div_sgc'],

  // Geotab — Deva PM
  ['sreevishnu',   'Sreevishnu',     'Developer',   'Sr. Developer',          'deva'],   // Geotab + Pro-Inspector

  // Biltdata — Ravi PM
  ['vigneshkumar', 'Vigneshkumar',   'Developer',   'Software Developer',     'ravi'],

  // QA
  ['subhasree',    'Subha Sree',     'Lead',        'QA Lead',                'div_qa'],
  ['sabari',       'Sabari',         'Trainee',     'QA Trainee',             'subhasree'],

  // ── Product (Open) ──
  ['div_seyo',     'Seyo',           'Division',    'Seyo',                   'div_product'],
  ['div_proinsp',  'Pro-Inspector',  'Division',    'Pro-Inspector',          'div_product'],

  // Seyo — Ravi PO (wired via EXTRA_EDGES)
  ['karthick',     'Karthick',       'Developer',   'Sr. Developer',          'ravi'],
  ['karthika',     'Karthika',       'Developer',   'Jr. Developer',          'karthick'],
  ['suha',         'Suha',           'Member',      'Product Enthusiast',     'ravi'],

  // Pro-Inspector — Manikandan
  ['manikandan',   'Manikandan',     'Manager',     'Product Owner',          'div_proinsp'],
  ['kumuthamani',  'Kumuthamani',    'Developer',   'Associate Developer',    'manikandan'],
  ['abhinandhana', 'Abhinandhana',   'Developer',   'Jr. Developer',          'manikandan'],
  ['sharonkk',     'Sharon KK',      'Trainee',     'Trainee Developer',      'abhinandhana'],
  ['sahadevan',    'Sahadevan',      'Developer',   'Sr. Developer',          'manikandan'],

  // ── Bacsys ──
  ['nagendaran',   'Nagendaran',     'Manager',     'SBU Head',               'div_bacsys'],
  ['vijaysheety',  'Vijay Sheety',   'Lead',        'Sales Lead',             'nagendaran'],
  ['daniel',       'Daniel',         'Lead',        'SW Leader',              'nagendaran'],
  ['anandkumar',   'Anandkumar',     'Developer',   'Sr. SW Developer',       'daniel'],
  ['sharon',       'Sharon',         'Developer',   'Jr. SW Developer',       'daniel'],
  ['ashok',        'Ashok',          'Lead',        'HW Leader',              'nagendaran'],
  ['harikesav',    'Harikesav',      'Designer',    '3D Designer',            'ashok'],
  ['vignesh',      'Vignesh',        'Developer',   'SW Niagra Dev',          'nagendaran'],
  ['vaishak',      'Vaishak',        'Developer',   'Sr. SW Developer',       'vignesh'],
];

// Extra edges for multi-role people: their "second hat" parents.
const EXTRA_EDGES = [
  ['ceo',          'div_mhs'],         // Murali is also MHS Account Manager
  ['ravi',         'div_auchan'],      // Ravi is also Auchan AM
  ['ravi',         'div_biltdata'],    // Ravi is also Biltdata PM
  ['ravi',         'div_seyo'],        // Ravi is also Seyo PO
  ['deva',         'div_sirius'],      // Deva is also Sirius PM
  ['deva',         'div_geotab'],      // Deva is also Geotab PM
  ['div_digital',  'saravanakumar'],   // Digital → Saravanakumar (Team Lead)
  ['manikandan',   'satheesh'],        // Satheesh also reports to Manikandan in Pro-Inspector
  ['manikandan',   'sreevishnu'],      // Sreevishnu also reports to Manikandan in Pro-Inspector
];

// ─── Layout: tree breadth-first, x-spread by leaf-count of subtree ───
function layout(rows, primaryEdges) {
  const childMap = {};
  for (const [from, to] of primaryEdges) (childMap[from] = childMap[from] || []).push(to);
  const NODE_W = 170, NODE_H = 76, X_GAP = 24, Y_GAP = 100;

  // Compute leaf-count per subtree (so wider subtrees get more horizontal space)
  const leafCount = {};
  function leaves(id) {
    if (leafCount[id] !== undefined) return leafCount[id];
    const kids = childMap[id] || [];
    if (!kids.length) return (leafCount[id] = 1);
    return (leafCount[id] = kids.reduce((s, c) => s + leaves(c), 0));
  }
  rows.forEach(r => leaves(r[0]));

  const pos = {};
  function place(id, leftX, depth) {
    const kids   = childMap[id] || [];
    const totalW = leaves(id) * (NODE_W + X_GAP);
    const myX    = leftX + (totalW - NODE_W) / 2;
    pos[id] = { x: Math.round(myX), y: depth * Y_GAP };
    let cx = leftX;
    for (const c of kids) {
      place(c, cx, depth + 1);
      cx += leaves(c) * (NODE_W + X_GAP);
    }
  }
  place('ceo', 0, 0);
  return pos;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/mayvel_task');
  console.log('Connected.');

  // ── Build primary edges (used for layout — tree shape only) ──
  const primaryEdges = ROWS.filter(r => r[4]).map(r => [r[4], r[0]]);
  const pos = layout(ROWS, primaryEdges);

  // ── Build node + edge documents ──
  const nodes = ROWS.map(([id, name, role, dept, _]) => ({
    id,
    name,
    orgRole: role,
    department: dept,
    memberId: null,                        // filled below by user matching
    x: (pos[id]?.x ?? 0),
    y: (pos[id]?.y ?? 0),
    w: 170, h: 76,
  }));

  // Auto-link existing User accounts by case-insensitive name match
  const users = await User.find({}).select('_id name').lean();
  const norm  = (s) => (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
  const userByName = new Map(users.map(u => [norm(u.name), u]));
  let linked = 0;
  for (const node of nodes) {
    const u = userByName.get(norm(node.name));
    if (u) { node.memberId = String(u._id); linked++; }
  }
  console.log(`Auto-linked ${linked} of ${users.length} user accounts to chart nodes.`);

  // Combine primary + extra edges (dedupe; chart can have a single edge per (from,to))
  const allEdges = [...primaryEdges.map(([f, t]) => ({ from: f, to: t })),
                    ...EXTRA_EDGES.map(([f, t]) => ({ from: f, to: t }))];
  const seen = new Set();
  const edges = [];
  for (const e of allEdges) {
    const key = `${e.from}->${e.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ id: `e_${e.from}_${e.to}`, from: e.from, to: e.to });
  }

  // Upsert the global chart (teamspaceId: null)
  await OrgChart.findOneAndUpdate(
    { teamspaceId: null },
    { nodes, edges, updatedBy: 'loadOrgChartV3', updatedAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const peopleCount = nodes.filter(n => n.orgRole !== 'Division').length;
  const divCount    = nodes.filter(n => n.orgRole === 'Division').length;
  console.log(`Saved org chart: ${nodes.length} nodes (${peopleCount} people · ${divCount} divisions), ${edges.length} edges.`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
