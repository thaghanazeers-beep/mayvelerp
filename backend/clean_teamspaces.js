const mongoose = require('mongoose');
const Project = require('./models/Project');
const Sprint = require('./models/Sprint');
const { Task } = require('./models/Task');
const Teamspace = require('./models/Teamspace');
const User = require('./models/User');
const { Workflow, WorkflowLog } = require('./models/Workflow');
const Page = require('./models/Page');

async function cleanDB() {
  await mongoose.connect('mongodb://localhost:27017/mayvel_task');
  console.log('Connected to DB');

  const teamspaces = await Teamspace.find();
  
  let targetTs = teamspaces.find(t => t.name === 'Product Design');
  if (!targetTs) {
    console.log('Product Design teamspace not found. Looking for others...');
    targetTs = teamspaces[0]; // fallback
    if (!targetTs) {
      console.log('No teamspaces at all.');
      process.exit(0);
    }
  }

  const targetTsId = targetTs._id.toString();
  console.log(`Keeping data for Teamspace: ${targetTs.name} (${targetTsId})`);

  // Delete other teamspaces
  const deletedTs = await Teamspace.deleteMany({ _id: { $ne: targetTs._id } });
  console.log(`Deleted ${deletedTs.deletedCount} other teamspaces`);

  // Delete data NOT belonging to the target teamspace
  
  const delProjects = await Project.deleteMany({ teamspaceId: { $ne: targetTsId } });
  console.log(`Deleted ${delProjects.deletedCount} projects`);

  const delSprints = await Sprint.deleteMany({ teamspaceId: { $ne: targetTsId } });
  console.log(`Deleted ${delSprints.deletedCount} sprints`);

  const delTasks = await Task.deleteMany({ teamspaceId: { $ne: targetTsId } });
  console.log(`Deleted ${delTasks.deletedCount} tasks`);

  const delWorkflows = await Workflow.deleteMany({ teamspaceId: { $ne: targetTsId } });
  console.log(`Deleted ${delWorkflows.deletedCount} workflows`);

  const delPages = await Page.deleteMany({ teamspaceId: { $ne: targetTsId } });
  console.log(`Deleted ${delPages.deletedCount} pages`);

  console.log('Done cleaning up database.');
  process.exit(0);
}

cleanDB().catch(console.error);
