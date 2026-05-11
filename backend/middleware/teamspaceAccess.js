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

module.exports = { extractTeamspaceId, requireTeamspaceMembership, requireRole };
