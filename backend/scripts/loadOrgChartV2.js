/**
 * Load the Mayvel Org Chart V2 (from "Mayvel Org Chart V2 (1).pdf") into Mongo.
 * Auto-lays out the tree (subtree-width algorithm) so the OrgChart UI renders
 * cleanly without manual dragging.
 *
 *   Usage: node scripts/loadOrgChartV2.js
 *   Env:   TEAMSPACE_ID (default: Product Design teamspace)
 */

const mongoose = require('mongoose');
const OrgChart = require('../models/OrgChart');

const MONGO_URI    = process.env.MONGO_URI    || 'mongodb://localhost:27017/mayvel_task';
const TEAMSPACE_ID = process.env.TEAMSPACE_ID || '69f0d4c70c14f3d081540d9f';

// ─── Define the org as a flat list of [id, name, role, dept] ──────────────────
const N = (id, name, orgRole = 'Member', department = '') => ({ id, name, orgRole, department, memberId: null });
const NODES = [
  // ROOT
  N('ceo', 'Murali', 'CEO', 'Mayvel'),

  // ── L1 — Direct reports of CEO ──
  N('itinfra', 'Ravi',        'Director',  'IT Infra'),
  N('hrpmo',   'Deva',        'Director',  'HR/PMO'),
  N('finance', '— Open —',    'Director',  'Finance'),
  N('sales',   '— Open —',    'Director',  'Sales & Marketing'),
  N('ops',     'Raja',        'Director',  'OPS'),
  N('product', '— Open —',    'Director',  'Product'),
  N('bacsys',  'Nagendaran',  'SBU Head',  'Bacsys'),

  // ── IT Infra ──
  N('chandra',  'Chandra',  'Reflect Security',     'IT Infra'),
  N('vishvesh', 'Vishvesh', 'System Administrator', 'IT Infra'),

  // ── HR/PMO ──
  N('lushyanthi', 'Lushyanthi', 'HR Consultant', 'HR/PMO'),
  N('sivanesh',   'Sivanesh',   'HR Operations', 'HR/PMO'),
  N('jeyalakshmi','Jeyalakshmi','House Keeping', 'Admin'),

  // ── Finance ──
  N('sundaraman', 'Sundaraman', 'Account Manager',    'Finance'),
  N('francisco',  'Francisco',  'PT Accounts Manager','Finance'),

  // ── Sales & Marketing ──
  N('pooja', 'Pooja', 'BD Manager (Trigital)', 'Sales & Marketing'),

  // ── OPS sub-departments ──
  N('design',   'Design',   'Department', 'OPS'),
  N('mhs',      'MHS',      'Department', 'OPS'),
  N('auchan',   'Auchan',   'Department', 'OPS'),
  N('sgc',      'SGC',      'Department', 'OPS'),
  N('geotab',   'Geotab',   'Department', 'OPS'),
  N('biltdata', 'Biltdata', 'Department', 'OPS'),
  N('qa',       'QA',       'Department', 'OPS'),

  // Design
  N('viki',         'Viki',         'UI/UX Consultant',    'Design'),
  N('nazeer',       'Nazeer',       'UI/UX Design Lead',   'Design'),
  N('praveenkumar', 'Praveenkumar', 'Sr. Developer',       'Design'),
  N('johnpraveen',  'John Praveen', 'On-Site Coordinator', 'Design'),

  // MHS
  N('mhs_murali',     'Murali',         'Account Manager',     'MHS'),
  N('saravanakumar1', 'Saravanakumar',  'Team Lead',           'MHS'),
  N('sudarsan',       'Sudarsan',       'Software Developer',  'MHS'),
  N('naveen',         'Naveen',         'Jr. Developer',       'MHS'),
  N('udesh',          'Udesh',          'Jr. Developer',       'MHS'),

  // Auchan → Sirius / Digital
  N('auchan_ravi',    'Ravi',           'Account Manager',     'Auchan'),
  N('sirius',         'Sirius',         'Subgroup',            'Auchan'),
  N('digital',        'Digital',        'Subgroup',            'Auchan'),
  N('sirius_deva',    'Deva',           'Project Manager',     'Sirius'),
  N('yogesh',         'Yogesh',         'Software Developer',  'Sirius'),
  N('digital_sara',   'Saravanakumar',  'Team Lead',           'Digital'),
  N('digital_satheesh','Satheesh',      'Software Developer',  'Digital'),

  // SGC
  N('thevatharshini', 'Thevatharshini', 'Sr. Developer', 'SGC'),

  // Geotab
  N('geotab_deva',    'Deva',           'Project Manager','Geotab'),

  // Biltdata
  N('biltdata_ravi',  'Ravi',           'Project Manager',    'Biltdata'),
  N('sreevishnu_b',   'Sreevishnu',     'Software Developer', 'Biltdata'),
  N('vigneshkumar',   'Vigneshkumar',   'Software Developer', 'Biltdata'),

  // QA
  N('subhasree', 'Subha Sree', 'QA Lead',    'QA'),
  N('sabari',    'Sabari',     'QA Trainee', 'QA'),

  // ── Product → Seyo / Pro-Inspector ──
  N('seyo',         'Seyo',          'Product',          'Product'),
  N('proinspector', 'Pro-Inspector', 'Product',          'Product'),
  N('seyo_ravi',    'Ravi',          'Product Owner',    'Seyo'),
  N('karthick',     'Karthick',      'Sr. Developer',    'Seyo'),
  N('suha',         'Suha',          'Product Enthusiast','Seyo'),
  N('karthika',     'Karthika',      'Jr. Developer',    'Seyo'),
  N('manikandan',   'Manikandan',    'Product Owner',    'Pro-Inspector'),
  N('kumuthamani',  'Kumuthamani',   'Associate Developer','Pro-Inspector'),
  N('abhinandhana', 'Abhinandhana',  'Jr. Developer',    'Pro-Inspector'),
  N('sahadevan',    'Sahadevan',     'Sr. Developer',    'Pro-Inspector'),
  N('sreevishnu_p', 'SreeVishnu',    'Sr. Developer',    'Pro-Inspector'),
  N('pi_satheesh',  'Satheesh',      'Software Developer','Pro-Inspector'),
  N('sharonkk',     'Sharon KK',     'Trainee Developer','Pro-Inspector'),

  // ── Bacsys ──
  N('vijaysheety', 'Vijay Sheety', 'Sales Lead',          'Bacsys'),
  N('daniel',      'Daniel',       'SW Leader',           'Bacsys'),
  N('ashok',       'Ashok',        'HW Leader',           'Bacsys'),
  N('vignesh',     'Vignesh',      'SW Niagra Dev Work',  'Bacsys'),
  N('anandkumar',  'Anandkumar',   'Sr. SW Developer',    'Bacsys'),
  N('sharon',      'Sharon',       'Jr. SW Developer',    'Bacsys'),
  N('harikesav',   'Harikesav',    '3D Designer',         'Bacsys'),
  N('vaishak',     'Vaishak',      'Sr. SW Developer',    'Bacsys'),
];

// Edges as parent → [children]
const TREE = {
  ceo: ['itinfra','hrpmo','finance','sales','ops','product','bacsys'],
  itinfra:    ['chandra','vishvesh'],
  hrpmo:      ['lushyanthi','sivanesh'],
  sivanesh:   ['jeyalakshmi'],
  finance:    ['sundaraman','francisco'],
  sales:      ['pooja'],
  ops:        ['design','mhs','auchan','sgc','geotab','biltdata','qa'],
  design:     ['viki','nazeer'],
  nazeer:     ['praveenkumar','johnpraveen'],
  mhs:        ['mhs_murali'],
  mhs_murali: ['saravanakumar1'],
  saravanakumar1: ['sudarsan','naveen','udesh'],
  auchan:     ['auchan_ravi'],
  auchan_ravi:['sirius','digital'],
  sirius:     ['sirius_deva','yogesh'],
  digital:    ['digital_sara','digital_satheesh'],
  sgc:        ['thevatharshini'],
  geotab:     ['geotab_deva'],
  biltdata:   ['biltdata_ravi'],
  biltdata_ravi: ['sreevishnu_b','vigneshkumar'],
  qa:         ['subhasree'],
  subhasree:  ['sabari'],
  product:    ['seyo','proinspector'],
  seyo:       ['seyo_ravi'],
  seyo_ravi:  ['karthick','suha','karthika'],
  proinspector: ['manikandan'],
  manikandan: ['kumuthamani','abhinandhana','sahadevan','sreevishnu_p','pi_satheesh'],
  pi_satheesh: ['sharonkk'],
  bacsys:     ['vijaysheety','daniel','ashok','vignesh'],
  daniel:     ['anandkumar','sharon'],
  ashok:      ['harikesav'],
  vignesh:    ['vaishak'],
};

// ─── Tree layout (Reingold-Tilford-ish, simplified) ──────────────────────────
const NODE_W = 160, NODE_H = 72, GAP_X = 24, GAP_Y = 60;

// Compute the visual width of each subtree (in node-slots).
function subtreeWidth(id) {
  const kids = TREE[id] || [];
  if (!kids.length) return 1;
  return kids.reduce((s, k) => s + subtreeWidth(k), 0);
}
// Position every node — root at x=0, top at y=0.
function place(id, leftX, depth, positions) {
  const w = subtreeWidth(id);
  const myX = leftX + (w * (NODE_W + GAP_X)) / 2 - NODE_W / 2;
  positions[id] = { x: myX, y: depth * (NODE_H + GAP_Y) };
  let cursor = leftX;
  for (const k of TREE[id] || []) {
    place(k, cursor, depth + 1, positions);
    cursor += subtreeWidth(k) * (NODE_W + GAP_X);
  }
}

(async () => {
  await mongoose.connect(MONGO_URI);
  const tsId = new mongoose.Types.ObjectId(TEAMSPACE_ID);

  // Layout
  const positions = {};
  place('ceo', 0, 0, positions);

  const totalWidth = subtreeWidth('ceo') * (NODE_W + GAP_X);
  const offset = -totalWidth / 2 + 1200; // shift so root sits around x=1200 (matches existing center)

  const finalNodes = NODES.map(n => {
    const p = positions[n.id] || { x: 0, y: 0 };
    return { ...n, x: Math.round(p.x + offset), y: Math.round(p.y + 50), w: NODE_W, h: NODE_H };
  });

  const finalEdges = [];
  for (const [from, kids] of Object.entries(TREE)) {
    for (const to of kids) finalEdges.push({ id: `e_${from}_${to}`, from, to });
  }

  await OrgChart.findOneAndUpdate(
    { teamspaceId: tsId },
    { teamspaceId: tsId, nodes: finalNodes, edges: finalEdges, updatedAt: new Date(), updatedBy: 'loadOrgChartV2.js' },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  console.log(`✅ Org chart updated: ${finalNodes.length} nodes, ${finalEdges.length} edges`);
  await mongoose.disconnect();
})().catch(e => { console.error('❌', e); process.exit(1); });
