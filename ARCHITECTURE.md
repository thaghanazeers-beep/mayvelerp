# Mayvel — Architecture & Development Playbook

> **Purpose of this file:** This is the source of truth for Mayvel's architecture. Any AI agent (Antigravity, Claude Code, Cursor, etc.) or human developer must follow these rules before writing or modifying code. Most bugs in this project come from violating one of the **Three Golden Rules** in Section 2.

---

## 0. TL;DR — Read Before Touching Any Code

1. Mayvel is a **multi-tenant** project management SaaS. Tenancy is at the **Teamspace** level, not Organization.
2. Every resource (Project, Sprint, Task, Workflow, Member) belongs to **exactly one Teamspace**.
3. Permissions live in a **`TeamspaceMembership`** collection, not on the User document.
4. Every API call filters by `teamspaceId`. Every frontend call sends `activeTeamspaceId`. No exceptions.
5. After every mutation (create/update/delete), the relevant query **must be invalidated/refetched**.

If you violate any of these, you will reproduce the bugs we already fixed once.

---

## 1. Stack

| Layer        | Technology                          |
|--------------|-------------------------------------|
| Frontend     | React (JSX) + Context API           |
| Backend      | Node.js + Express                   |
| Database     | MongoDB (local) + Mongoose          |
| Auth         | JWT (sent via `Authorization` header) |
| State sync   | React Context + manual refetch (no React Query yet — adding it is recommended) |

### Folder Structure (target)

```
/backend
  /models          ← Mongoose schemas. ONE file per model.
  /routes          ← Express routers. Grouped by resource.
  /middleware      ← auth.js, requireTeamspaceAccess.js
  /controllers     ← business logic, kept thin
  /utils
  server.js
/frontend
  /src
    /context       ← OrgContext, TeamspaceContext, AuthContext
    /pages         ← Page-level components (DashboardPage, SprintsPage…)
    /components    ← Reusable UI
    /hooks         ← useTeamspace, usePermission, useApi
    /api           ← api.js (axios instance + interceptors)
    /utils
```

---

## 2. The Three Golden Rules (Non-Negotiable)

### 2.1 Teamspace Isolation Rule

**Every resource document MUST have a `teamspaceId` field, indexed, required.**

```js
teamspaceId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'Teamspace',
  required: true,
  index: true
}
```

**Every query MUST filter by `teamspaceId`.** Use a query helper:

```js
// In every schema file
schema.query.byTeamspace = function (teamspaceId) {
  return this.where({ teamspaceId });
};

// Usage
const tasks = await Task.find().byTeamspace(req.teamspaceId);
```

If you ever write `Task.find({})` without `teamspaceId`, you have introduced a cross-tenant data leak. This is a **P0 bug**.

### 2.2 Membership-Based Access Rule

**DO NOT** store teamspaces on the User document like this (this is the bug you're hitting now):

```js
// ❌ WRONG — causes "member sees all teamspaces"
User { teamspaces: [ObjectId] }
```

**DO** use a dedicated `TeamspaceMembership` collection:

```js
// ✅ CORRECT
TeamspaceMembership {
  userId: ObjectId,
  teamspaceId: ObjectId,
  role: 'admin' | 'member' | 'viewer',
  status: 'active' | 'pending' | 'removed',
  invitedBy: ObjectId,
  joinedAt: Date
}
```

This single change fixes:
- "Member sees all teamspaces" (now they only see teamspaces where a membership exists)
- "Adding member not reflecting" (insert into this collection, refetch, done)
- Per-teamspace role differences (a user can be admin in one space, member in another)

### 2.3 Cache Invalidation Rule

**Every successful mutation must trigger a refetch of any list it affects.**

Until React Query is added, do this manually:

```jsx
const handleInviteUser = async (email) => {
  await api.post('/team/invite', { email, teamspaceId: activeTeamspaceId });
  await refetchTeam();        // ← REQUIRED
  await refetchOrgChart();    // if org chart shows this user
};
```

If you forget this step, the UI lies to the user. This is the cause of the "Adding team member not reflecting" bug.

---

## 3. Data Models (Required Schemas)

### User
```js
{
  _id,
  email: { type: String, unique: true, required: true, lowercase: true },
  name: String,
  avatarUrl: String,
  passwordHash: String,
  organizationId: { type: ObjectId, ref: 'Organization' },
  systemRole: { enum: ['superadmin', 'user'], default: 'user' }, // platform-level
  createdAt, updatedAt
}
```
> Note: `systemRole` is for the platform itself. Per-teamspace role lives in `TeamspaceMembership`.

### Organization
```js
{
  _id,
  name,
  ownerId: { type: ObjectId, ref: 'User' },
  plan: { enum: ['free', 'pro', 'enterprise'], default: 'free' },
  createdAt
}
```

### Teamspace
```js
{
  _id,
  organizationId: { type: ObjectId, ref: 'Organization', required: true, index: true },
  name,
  emoji,
  description,
  createdBy: { type: ObjectId, ref: 'User' },
  createdAt
}
```

### TeamspaceMembership ⭐ (the model that fixes most of your bugs)
```js
{
  _id,
  userId: { type: ObjectId, ref: 'User', required: true, index: true },
  teamspaceId: { type: ObjectId, ref: 'Teamspace', required: true, index: true },
  role: { type: String, enum: ['admin', 'member', 'viewer'], default: 'member' },
  status: { type: String, enum: ['active', 'pending', 'removed'], default: 'active' },
  invitedBy: { type: ObjectId, ref: 'User' },
  joinedAt: Date,
  createdAt, updatedAt
}

// Compound unique index — one user can only have one role per teamspace
membershipSchema.index({ userId: 1, teamspaceId: 1 }, { unique: true });
```

### Project, Sprint, Task, Workflow
All of these MUST include:
```js
{
  teamspaceId: { type: ObjectId, ref: 'Teamspace', required: true, index: true },
  // ... domain fields
}
```

### Permission Matrix

| Action                          | Viewer | Member | Admin |
|---------------------------------|:------:|:------:|:-----:|
| View tasks/sprints/projects     |   ✅   |   ✅   |  ✅   |
| Create tasks                    |   ❌   |   ✅   |  ✅   |
| Edit own tasks                  |   ❌   |   ✅   |  ✅   |
| Edit any task                   |   ❌   |   ❌   |  ✅   |
| Delete tasks                    |   ❌   |   ❌   |  ✅   |
| Create/edit Sprints, Projects   |   ❌   |   ❌   |  ✅   |
| Create/edit Workflows           |   ❌   |   ❌   |  ✅   |
| Invite/remove members           |   ❌   |   ❌   |  ✅   |
| Change member roles             |   ❌   |   ❌   |  ✅   |
| Delete teamspace                |   ❌   |   ❌   |  ✅ (creator only) |

---

## 4. Backend (Express) Patterns

### 4.1 Required Middleware Stack

Every authenticated route runs through this order:

```js
router.use(authenticate);                    // verifies JWT, attaches req.user
router.use(extractTeamspaceId);              // pulls teamspaceId from query/body/params
router.use(requireTeamspaceMembership);      // checks membership exists & active
// then per-route:
router.delete('/tasks/:id', requireRole('admin'), deleteTask);
```

### 4.2 The `requireTeamspaceMembership` middleware

```js
async function requireTeamspaceMembership(req, res, next) {
  const { userId } = req.user;
  const teamspaceId = req.teamspaceId; // set by extractTeamspaceId

  if (!teamspaceId) {
    return res.status(400).json({ error: 'teamspaceId is required' });
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
```

### 4.3 The `requireRole` middleware

```js
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
```

### 4.4 Route Naming Conventions

```
GET    /api/teamspaces                         → list user's teamspaces (via membership join)
POST   /api/teamspaces                         → create
GET    /api/teamspaces/:id                     → details
GET    /api/teamspaces/:id/members             → list members (via membership)
POST   /api/teamspaces/:id/members             → invite (admin only)
PATCH  /api/teamspaces/:id/members/:userId     → change role (admin only)
DELETE /api/teamspaces/:id/members/:userId     → remove (admin only)

GET    /api/tasks?teamspaceId=...&filters...   → list (filtered server-side)
POST   /api/tasks                              → create (body has teamspaceId)
PATCH  /api/tasks/:id                          → update
DELETE /api/tasks/:id                          → delete
```

### 4.5 Server-Side Filtering (fixes your filtering bug)

**Filter on the server, never on the client after pagination.**

```js
// GET /api/tasks?teamspaceId=...&status=in_progress&assignee=...&priority=high&search=...
async function listTasks(req, res) {
  const { status, assignee, priority, search, page = 1, limit = 50 } = req.query;
  const query = { teamspaceId: req.teamspaceId };

  if (status)   query.status = status;
  if (assignee) query.assignee = assignee;
  if (priority) query.priority = priority;
  if (search)   query.$text = { $search: search }; // requires text index

  const tasks = await Task.find(query)
    .sort({ updatedAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));

  const total = await Task.countDocuments(query);
  res.json({ tasks, total, page: Number(page) });
}
```

---

## 5. Frontend (React) Patterns

### 5.1 Context Setup

```jsx
// TeamspaceContext.jsx
const TeamspaceContext = createContext(null);

export function TeamspaceProvider({ children }) {
  const [teamspaces, setTeamspaces] = useState([]);
  const [activeTeamspaceId, setActiveTeamspaceId] = useState(
    localStorage.getItem('activeTeamspaceId')
  );

  // persist active teamspace
  useEffect(() => {
    if (activeTeamspaceId) localStorage.setItem('activeTeamspaceId', activeTeamspaceId);
  }, [activeTeamspaceId]);

  // fetch only teamspaces the user is a member of
  useEffect(() => {
    api.get('/teamspaces').then(res => setTeamspaces(res.data));
  }, []);

  return (
    <TeamspaceContext.Provider value={{ teamspaces, activeTeamspaceId, setActiveTeamspaceId }}>
      {children}
    </TeamspaceContext.Provider>
  );
}

export const useTeamspace = () => useContext(TeamspaceContext);
```

### 5.2 Always Read `activeTeamspaceId` From Context

```jsx
// ✅ CORRECT
const { activeTeamspaceId } = useTeamspace();
useEffect(() => {
  if (!activeTeamspaceId) return;
  api.get('/tasks', { params: { teamspaceId: activeTeamspaceId } })
     .then(res => setTasks(res.data.tasks));
}, [activeTeamspaceId]);
```

```jsx
// ❌ WRONG — hardcoded, stale, or pulled from URL only
api.get('/tasks').then(...);
```

### 5.3 Axios Instance With Interceptor

```js
// /src/api/api.js
const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      // token expired — redirect to login
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);
```

### 5.4 Permission-Gated UI

```jsx
// usePermission hook
export function usePermission() {
  const { activeTeamspaceId } = useTeamspace();
  const [role, setRole] = useState(null);

  useEffect(() => {
    if (!activeTeamspaceId) return;
    api.get(`/teamspaces/${activeTeamspaceId}/my-role`).then(r => setRole(r.data.role));
  }, [activeTeamspaceId]);

  return {
    role,
    isAdmin: role === 'admin',
    isMember: role === 'member' || role === 'admin',
    canEdit: role === 'admin' || role === 'member',
    canDelete: role === 'admin'
  };
}

// Usage
function TaskActions({ task }) {
  const { canDelete } = usePermission();
  return (
    <div>
      <EditButton />
      {canDelete && <DeleteButton />}
    </div>
  );
}
```

> **Important:** UI permission checks are for UX only. The server is the only source of truth for security. Always enforce roles on the backend too.

### 5.5 Mutation + Refetch Pattern

```jsx
async function inviteMember(email) {
  try {
    setLoading(true);
    await api.post(`/teamspaces/${activeTeamspaceId}/members`, { email });
    await fetchMembers();           // ← refetch to update UI
    toast.success('Invitation sent');
  } catch (err) {
    toast.error(err.response?.data?.error ?? 'Failed to invite');
  } finally {
    setLoading(false);
  }
}
```

### 5.6 Filters (URL-synced, server-side)

```jsx
// useFilters.js
export function useFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = {
    status:   searchParams.get('status')   ?? '',
    assignee: searchParams.get('assignee') ?? '',
    priority: searchParams.get('priority') ?? '',
    search:   searchParams.get('search')   ?? ''
  };
  const setFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    value ? next.set(key, value) : next.delete(key);
    setSearchParams(next);
  };
  return { filters, setFilter };
}
```

Filters become part of the API call params — never filter `tasks.filter(...)` on the client when the server has paginated the result, because you'd be filtering only the current page.

---

## 6. Known Bug Patterns & Their Cures

| Symptom | Root Cause | Fix |
|--------|-----------|-----|
| Members can see all teamspaces in sidebar | `GET /teamspaces` returns all teamspaces, not just memberships | Query `TeamspaceMembership.find({ userId, status: 'active' }).populate('teamspaceId')` |
| Adding a member doesn't show in Team page | List isn't refetched after mutation | Call `await fetchMembers()` after `POST /members` |
| Filters don't work / show wrong data | Client-side filtering of paginated server data | Move filtering to query params, server-side |
| Wrong role permissions applied | Role read from User instead of Membership | Read role from `TeamspaceMembership` for `activeTeamspaceId` |
| Tasks from other teamspace appear briefly | No teamspace check on the API or stale state on switch | Add backend filter + clear local state in `useEffect` cleanup |
| Workflow runs on wrong teamspace | Workflow doc missing `teamspaceId` | Add field, filter trigger evaluation by teamspaceId |
| User remains in `members` array after removal | Soft delete done on User, not on Membership | Set `membership.status = 'removed'` |
| Switching teamspace shows old data | Components don't re-run on `activeTeamspaceId` change | Add `activeTeamspaceId` to dependency arrays |

---

## 7. Pre-Merge Checklist (For New Features)

Before considering a feature done, verify each item:

### Database
- [ ] Schema has `teamspaceId` (required, indexed)
- [ ] Compound indexes added where queries are common (e.g., `{ teamspaceId, status }`)
- [ ] Migration written if production data exists

### Backend
- [ ] Route is registered under `authenticate` + `extractTeamspaceId` + `requireTeamspaceMembership`
- [ ] `requireRole(...)` applied where action is admin/member-restricted
- [ ] All `find` / `findOne` calls use `byTeamspace(req.teamspaceId)` or include `teamspaceId` in query
- [ ] `POST` / `PATCH` validate `req.body.teamspaceId === req.teamspaceId`
- [ ] Errors return 400/403/404 with descriptive messages

### Frontend
- [ ] `activeTeamspaceId` read from `useTeamspace()`
- [ ] API calls include `teamspaceId` query param or in body
- [ ] `useEffect` dependency array includes `activeTeamspaceId`
- [ ] After mutation, the relevant list/query is refetched
- [ ] Loading, error, and empty states are rendered
- [ ] Admin-only UI is wrapped in a permission check

### Verification
- [ ] Tested with a `member` (non-admin) account: cannot access admin UI/API
- [ ] Tested with a user who has zero memberships: sees onboarding, not blank screen
- [ ] Tested teamspace switching: data updates, no leakage from previous space
- [ ] Created records have correct `teamspaceId`

---

## 8. Glossary

- **Organization**: Top-level billing entity. One per company.
- **Teamspace**: A workspace inside an Organization (e.g., "Bacsys", "Product Design"). The unit of tenancy.
- **Membership**: The link between a User and a Teamspace, with a role.
- **`activeTeamspaceId`**: The teamspace the user is currently viewing in the UI. Stored in context + localStorage.
- **`teamspaceId`**: The foreign key on every domain resource. The single most important field in the database.
- **Sprint**: A time-boxed group of tasks within a Teamspace.
- **Project**: A long-lived grouping of tasks within a Teamspace.
- **Workflow**: An automation rule (trigger → conditions → actions) scoped to a Teamspace.

---

## 9. When In Doubt

Re-read **Section 2: The Three Golden Rules**. 95% of the bugs in this project are violations of one of those three rules.

If a feature feels hard to implement cleanly, the schema is probably wrong — not your code.
