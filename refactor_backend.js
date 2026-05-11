const fs = require('fs');

let serverFile = fs.readFileSync('backend/server.js', 'utf8');

// 1. Add required imports at the top
if (!serverFile.includes("const { authenticate }")) {
  serverFile = serverFile.replace(
    "const cors = require('cors');",
    "const cors = require('cors');\nconst { authenticate, generateToken } = require('./middleware/auth');\nconst { extractTeamspaceId, requireTeamspaceMembership, requireRole } = require('./middleware/teamspaceAccess');\nconst TeamspaceMembership = require('./models/TeamspaceMembership');"
  );
}

// 2. Add JWT to signup
serverFile = serverFile.replace(
  "res.status(201).json(user);",
  "const token = generateToken(user);\n    res.status(201).json({ user, token });"
);

// 3. Add JWT to login
serverFile = serverFile.replace(
  "res.json(user);",
  "const token = generateToken(user);\n    res.json({ user, token });"
);

// 4. Inject global auth middleware AFTER login routes but BEFORE teamspace routes
// Finding the section break
serverFile = serverFile.replace(
  "// ==================== TEAMSPACE ROUTES ====================",
  "// ==================== GLOBAL MIDDLEWARE ====================\napp.use('/api', authenticate);\napp.use('/api', extractTeamspaceId);\n\n// ==================== TEAMSPACE ROUTES ===================="
);

// 5. Update GET /api/teamspaces to use TeamspaceMembership
serverFile = serverFile.replace(
  "const teamspaces = await Teamspace.find().populate('members.userId', 'name email profilePictureUrl').sort('-createdAt');",
  "const memberships = await TeamspaceMembership.find({ userId: req.user.userId, status: 'active' }).populate('teamspaceId');\n    const teamspaces = memberships.map(m => m.teamspaceId).filter(Boolean);"
);

// 6. Update GET /api/teamspaces/:id/members to replace GET /api/team
serverFile = serverFile.replace(
  "app.get('/api/team', async (req, res) => {",
  "app.get('/api/team', requireTeamspaceMembership, async (req, res) => {"
);
serverFile = serverFile.replace(
  "const teamspace = await Teamspace.findById(req.teamspaceId).populate('members.userId', 'name email profilePictureUrl');\n    if (!teamspace) return res.status(404).json({ message: 'Teamspace not found' });\n\n    const team = teamspace.members.map(m => ({\n      ...m.userId.toObject(),\n      role: m.role\n    }));\n    res.json(team);",
  "const memberships = await TeamspaceMembership.find({ teamspaceId: req.teamspaceId, status: 'active' }).populate('userId', 'name email profilePictureUrl');\n    const team = memberships.map(m => ({\n      ...(m.userId ? m.userId.toObject() : {}),\n      role: m.role\n    }));\n    res.json(team);"
);

// 7. Update POST /api/team/invite
serverFile = serverFile.replace(
  "app.post('/api/team/invite', async (req, res) => {",
  "app.post('/api/team/invite', requireTeamspaceMembership, requireRole('admin'), async (req, res) => {"
);
serverFile = serverFile.replace(
  "teamspace.members.push({ userId: user._id, role: role || 'Member' });\n    await teamspace.save();",
  "await TeamspaceMembership.create({ userId: user._id, teamspaceId: teamspace._id, role: role ? role.toLowerCase() : 'member', status: 'active', invitedBy: req.user.userId });"
);

// 8. Update DELETE /api/team/:id
serverFile = serverFile.replace(
  "app.delete('/api/team/:id', async (req, res) => {",
  "app.delete('/api/team/:id', requireTeamspaceMembership, requireRole('admin'), async (req, res) => {"
);
serverFile = serverFile.replace(
  "const teamspace = await Teamspace.findById(req.teamspaceId);\n    if (teamspace) {\n      teamspace.members = teamspace.members.filter(m => m.userId.toString() !== req.params.id);\n      await teamspace.save();\n    }",
  "await TeamspaceMembership.findOneAndUpdate({ userId: req.params.id, teamspaceId: req.teamspaceId }, { status: 'removed' });"
);

// 9. Update Tasks route with requireTeamspaceMembership
serverFile = serverFile.replace(
  "app.get('/api/tasks', async (req, res) => {",
  "app.get('/api/tasks', requireTeamspaceMembership, async (req, res) => {"
);
serverFile = serverFile.replace(
  "app.post('/api/tasks', async (req, res) => {",
  "app.post('/api/tasks', requireTeamspaceMembership, async (req, res) => {"
);
serverFile = serverFile.replace(
  "app.put('/api/tasks/:id', async (req, res) => {",
  "app.put('/api/tasks/:id', requireTeamspaceMembership, async (req, res) => {"
);
serverFile = serverFile.replace(
  "app.delete('/api/tasks/:id', async (req, res) => {",
  "app.delete('/api/tasks/:id', requireTeamspaceMembership, async (req, res) => {"
);

fs.writeFileSync('backend/server.js', serverFile);
console.log('Done refactoring server.js');
