const TeamspaceMembership = require('../models/TeamspaceMembership');

function extractTeamspaceId(req, res, next) {
  req.teamspaceId = req.query?.teamspaceId
    || req.body?.teamspaceId
    || req.params?.teamspaceId
    || req.headers['x-teamspace-id'];
  next();
}

async function requireTeamspaceMembership(req, res, next) {
  const { userId } = req.user;
  const teamspaceId = req.teamspaceId;

  if (!teamspaceId || teamspaceId === 'undefined') {
    return res.status(400).json({ error: 'Valid teamspaceId is required' });
  }

  if (teamspaceId === '__personal__') {
    req.membership = { role: 'admin' };
    req.teamspaceRole = 'admin';
    return next();
  }

  const membership = await TeamspaceMembership.findOne({
    userId,
    teamspaceId,
    status: 'active'
  });

  if (!membership) {
    return res.status(403).json({ error: 'No access to this teamspace' });
  }

  req.membership = membership;
  req.teamspaceRole = membership.role;
  next();
}

const ROLE_HIERARCHY = { viewer: 0, member: 1, admin: 2 };

function requireRole(minimumRole) {
  return (req, res, next) => {
    const userLevel = ROLE_HIERARCHY[req.teamspaceRole] ?? -1;
    const requiredLevel = ROLE_HIERARCHY[minimumRole];
    if (userLevel < requiredLevel) {
      return res.status(403).json({ error: `Requires ${minimumRole} role` });
    }
    next();
  };
}

// Stricter than requireRole('admin'): only the teamspace's actual `ownerId`
// (or a workspace SuperAdmin) passes. Used to gate governance routes —
// time plans, plan approvals, team mgmt, teamspace control — so a regular
// member who happens to have admin role in the membership table still can't
// touch them.
async function requireTeamspaceOwner(req, res, next) {
  try {
    const Teamspace = require('../models/Teamspace');
    const User      = require('../models/User');
    const tsId = req.teamspaceId;
    if (!tsId) return res.status(400).json({ error: 'teamspaceId required' });
    const me = await User.findById(req.user.userId).select('isSuperAdmin').lean();
    if (me?.isSuperAdmin) return next();
    const ts = await Teamspace.findById(tsId).select('ownerId').lean();
    if (!ts) return res.status(404).json({ error: 'Teamspace not found' });
    if (String(ts.ownerId) !== String(req.user.userId)) {
      return res.status(403).json({ error: 'Only the teamspace owner can access this.' });
    }
    next();
  } catch (err) { res.status(500).json({ error: err.message }); }
}

module.exports = { extractTeamspaceId, requireTeamspaceMembership, requireRole, requireTeamspaceOwner };
