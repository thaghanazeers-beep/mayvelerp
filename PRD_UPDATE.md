# PRD Update — Production Deployment & Workspace Governance
## Mayvel Task — May 2026 iteration

> Snapshot of every change made on top of [PRD.md](PRD.md) during the production
> rollout, role-management refactor, and notification system overhaul. Read this
> alongside the original PRD — it does not repeat features that are unchanged.

---

## 1. What's new at a glance

| Area | Before | After |
|---|---|---|
| Hosting | Local dev only | Live on Netlify (frontend) + Render (backend) + Atlas (DB) |
| Email | Ethereal dev inbox | Brevo HTTP API (HTTPS, no SMTP) |
| Push notifications | — | Real Web Push via FCM/VAPID, per-browser opt-in |
| Roles | Admin / Member | Super Admin / Admin / Member + per-teamspace `viewer / member / admin` |
| Org chart | Editable by any admin | Read-only for everyone, edit-only for Super Admin |
| Projects | One project = one teamspace | Org-wide: every teamspace sees every project; each contributes its own tasks + budget |
| Personal workspace | — | Opt-in private space per user (tasks-only) |
| Notifications | In-app only, global | In-app + push + email, per-teamspace bell badges, notification carries `teamspaceId` |
| Notification triggers | Manual on a few routes | Lifecycle: created / assigned / status moved / approved / rejected / deleted / @mention / plan & timesheet events |
| Toasts | `window.alert` | App-wide `useToast()` pills (success / error / info) |
| File attachments | Local-only paths | Migrated 92 files to Render; `signedFileUrl` rewrites legacy hosts |

---

## 2. Deployment

### 2.1 Hosting layout

```
Browser  ─►  Netlify (mayvelerp.netlify.app)        ─►  Render (mayvelerp.onrender.com)  ─►  Atlas (MongoDB)
                static React + service worker            Node/Express                          + Brevo HTTP API for mail
```

- **Netlify**: builds `frontend/` on every push to `main`. `netlify.toml` ships SPA fallback + base/publish config. Env: `VITE_API_URL`.
- **Render** (free tier): node web service, root `backend/`, build `npm install`, start `npm start`. Auto-redeploys on push.
- **MongoDB Atlas** (M0): one cluster, network access `0.0.0.0/0`, single user `thaghanazeers_db_user`.

### 2.2 Render env vars (canonical list)

```
MONGODB_URI        Atlas connection string
JWT_SECRET         long random string
GEMINI_API_KEY     Google Gemini for AI assistant
NOTION_TOKEN       optional, for legacy import scripts
APP_URL            https://mayvelerp.netlify.app   (used in every email link)
PUBLIC_BASE_URL    https://mayvelerp.onrender.com  (returned by /api/uploads)
BREVO_API_KEY      xkeysib-…    (HTTPS email API)
MAIL_FROM          thaghanazeer.s@mayvel.ai
VAPID_PUBLIC_KEY   base64-url, generated once via Node crypto
VAPID_PRIVATE_KEY  base64-url
VAPID_SUBJECT      mailto:thaghanazeer.s@mayvel.ai
```

### 2.3 Render-specific quirks we hit (and the fixes shipped)

| Symptom | Root cause | Fix |
|---|---|---|
| Outbound SMTP hangs 60s | Render container has no IPv6 routing; `smtp.gmail.com` resolves v6-first via happy-eyeballs | Pre-resolve to IPv4 + `family: 4` + custom `connectionTimeout` (kept as fallback when `BREVO_API_KEY` is unset) — but the real solution was switching to Brevo HTTP API |
| Render free tier blocks port 587 entirely | (Even with IPv4, blocked) | All mail now goes via HTTPS `POST /v3/smtp/email` to `api.brevo.com` — see `makeBrevoTransport()` in `server.js` |
| `/uploads/*` returns 404 in live | Render disk is ephemeral; only local uploads existed | One-shot migration `backend/scripts/migrateUploadsToLive.js` uploaded all 92 files to Render via `/api/uploads` and rewrote DB references |
| 470 MB upload folder, two videos > 50 MB | Old multer limit was 50 MB | Bumped to **200 MB** in `server.js` |

⚠️ Render free tier still has an ephemeral disk — files persist for the active session but get wiped on restart. For permanent storage upgrade to Render Starter (paid disk) or move uploads to S3 / Cloudinary.

### 2.4 Migration scripts (one-offs)

- `backend/scripts/migrateLocalToAtlas.js` — copies every collection from local Mongo to Atlas
- `backend/scripts/importDumpToAtlas.js` — imports a JSON dump if Mongo is unreachable
- `backend/scripts/migrateUploadsToLive.js` — pushes local `backend/uploads/*` to Render, rewrites `127.0.0.1:3001/uploads/…` URLs in Mongo

---

## 3. Authentication & roles

### 3.1 Public signup is OFF

`POST /api/auth/signup` returns **HTTP 403 — "Public signup is disabled. Ask a Super Admin to add you."** The Sign Up link is removed from the auth page.

The Super Admin creates users from **/access** (the Access Control page).

### 3.2 Three tiers

```
SuperAdmin   = workspace owner. One per workspace. Hard flag User.isSuperAdmin.
Admin        = global User.role === 'Admin' — historical role still used in lots of UI gates.
Member       = User.role === 'Member'
```

Plus, **per-teamspace** roles via `TeamspaceMembership.role`:

```
admin / member / viewer
```

So a user is e.g. *Admin globally + admin in Marketing + viewer in Product Design*. Backend has `requireTeamspaceMembership` and `requireTeamspaceOwner` middleware in `middleware/teamspaceAccess.js`.

### 3.3 "View as" impersonation

`POST /api/admin/impersonate { userId }` signs a JWT as the target user and returns it. SuperAdmin only. Frontend:

- Header shows **👁️ View as…** dropdown (only for SuperAdmin, only when NOT already impersonating)
- Clicking a user swaps token + reloads
- Yellow banner appears: *"👁️ Viewing as Pooja  [Switch back to Thagha Nazeer]"*
- Original token kept in `sessionStorage` so it auto-clears on tab close

### 3.4 Super Admin / Normal mode toggle

A pill in the header lets the SuperAdmin downgrade their own view to look like a regular Admin (no owner-bypass, no Access Control link). State persists in `localStorage.mayvel_superAdminMode`.

### 3.5 Access Control page (`/access`)

SuperAdmin-only. Three sections:

1. **Add user** — name + email + temp password + role
2. **All users table** — change global role, delete
3. **Per-teamspace memberships matrix** — one card per teamspace, list of members with role dropdowns + remove buttons, owner shown with badge
4. **Role permission reference** — what each role can do per page (view / create / edit / delete)

Backend endpoints:

```
POST    /api/users                  super-admin only — create user with role
GET     /api/users                  super-admin only — list all
DELETE  /api/users/:id              super-admin only — also wipes memberships
PUT     /api/users/:id              self or super-admin (strips role on non-super)
GET     /api/admin/memberships      list every TS membership with populated user+ts
POST    /api/admin/memberships      upsert {userId, teamspaceId, role}
PUT     /api/admin/memberships/:id  change role
DELETE  /api/admin/memberships/:id  remove
POST    /api/admin/impersonate      sign JWT as target user
```

### 3.6 Visibility gates

| UI element | Visible to |
|---|---|
| Organization + Members sidebar entries | global Admin or SuperAdmin (`user.role === 'Admin' \|\| isSuperAdminActive`) |
| Org chart edit (Save, Add, Load, click-to-edit) | SuperAdmin only (`isSuperAdminActive`) — backend rejects others with 403 |
| Access Control sidebar entry | SuperAdmin in elevated mode only |
| Time · Plans, Plan Approvals, Week Approvals, Team, Teamspace Control | teamspace **owner** only (or SuperAdmin in elevated mode) |
| Sprints / Projects / Tasks / Workflows / My Timesheet | any member of that teamspace |

---

## 4. Teamspaces

### 4.1 Personal workspace (opt-in)

`Teamspace.isPersonal: Boolean` + `ownerId`. On-demand button in sidebar:

> 🔒 Create personal space

Click → `POST /api/teamspaces/personal` → creates `"<your name>'s space"` with the user as the sole admin member. Sidebar shows ONLY **Tasks** for personal teamspaces (no Projects/Sprints/Team/Workflows). Hidden from everyone but the owner via `GET /api/teamspaces` filter.

### 4.2 Owner concept

Each teamspace has `ownerId`. The owner gets governance access (Plans, Approvals, Team, Control). Owner badge shows in the Access Control matrix and (yellow pill) in role displays.

---

## 5. Projects

### 5.1 Org-wide by default

`GET /api/projects` now returns **every project**, regardless of which teamspace the caller is viewing. The legacy `teamspaceId` query param is accepted but ignored. The "Org-wide" checkbox in the create form was removed.

Rationale: a project like *Seyo* gets contributions from Design, Dev, and Testing departments. Tasks within it stay scoped to their `teamspaceId` (department), but the project itself is one row, visible everywhere.

### 5.2 Project model addition

```js
Project.scope: 'teamspace' | 'org'    // legacy hint; not used for filtering since list returned to all
Project.ownerId: ObjectId<User>       // approves the monthly plan + weekly slices
```

---

## 6. Time / ERP

### 6.1 Plans page — project-first flow

`/t/:tsId/time/plans` now:

1. User picks a project from a dropdown
2. Table shows that project's plans **filtered to plans the current user created** (`?mine=1`)
3. "+ New Plan" button (disabled until project selected) creates a draft with auto-named title
4. Approval status + date shown per row

`?mine=1` filters `ProjectHoursPlan.createdBy === current user's name` on the backend.

### 6.2 Plan Approvals page

`/t/:tsId/time/approvals/plans` now uses `?awaitingMyApproval=1`. Backend filters to:

- `status: 'pending'`
- `projectId ∈ projects where Project.ownerId === req.user.userId`

Empty state explains: *"Only plans submitted for projects you own appear here."*

### 6.3 Rate buckets + task types

Still per-teamspace (no model change). When a new teamspace is created with no buckets, the **+ Add row** in PlanEditor now shows a friendly toast: *"No rate buckets exist for this teamspace. Ask Super Admin to set them up."*

For the demo we copied Product Design's 11 buckets + 12 task types to Marketing manually.

---

## 7. Notifications

### 7.1 Three delivery channels

Every notification fires through **three pipes** simultaneously, all gated by the user's `notificationPrefs[type]`:

1. **In-app row** in Mongo `notifications` collection (consumed by bell + Notifications page)
2. **Web push** to every subscribed browser (via web-push lib + VAPID + FCM)
3. **Email** via Brevo HTTP API

The single helper `createNotification({ type, title, message, userId, taskId, teamspaceId, actorName })` does all three. Wraps `Notification.createIfAllowed` so workflow engine + timesheet routes get the full pipeline for free.

### 7.2 Lifecycle events covered

```
task_created          new task with assignee
task_assigned         re-assignment
status_changed        any status move (catch-all for moves not covered below)
review_requested      → In Review (all admins)
task_completed        → Completed (assignee)
task_rejected         → Rejected (assignee)
task_deleted          assignee + creator
task_comment          someone commented on your task
comment_mention       @you in a comment
plan_submitted        admins of teamspace
plan_approved         plan creator
plan_rejected         plan creator (with reason)
allocation_created    user who got hours allocated
time_submitted        project owner
time_approved         submitter
time_rejected         submitter (with reason)
budget_overrun        project owner
workflow_notification user-defined workflow alerts
```

### 7.3 Schema change

```js
Notification.teamspaceId: ObjectId<Teamspace>  // denormalized so the sidebar can count fast
```

`createNotification` auto-resolves teamspaceId from `taskId` if the caller didn't pass it. `notify()` in `routes/timesheets.js` forwards it from `plan.teamspaceId` / `slice.teamspaceId`.

### 7.4 Per-teamspace bell

`GET /api/notifications/unread-by-teamspace?user=NAME` returns `{ teamspaceId: count }`. Sidebar renders a 🔔 + badge next to each teamspace that has unread items. Click → jumps into that teamspace's Tasks list.

### 7.5 Click-through navigation

Clicking a notification row now uses **`notification.teamspaceId`** (not `activeTeamspaceId`) so cross-teamspace deep links work even when you're viewing a different team.

### 7.6 Web Push

```
backend/lib/push.js                  configures web-push with VAPID
backend/models/PushSubscription.js   userId(name) + endpoint + keys
backend/server.js                    routes: /api/push/vapid-public-key,
                                     /api/push/subscribe, /api/push/unsubscribe, /api/push/test

frontend/public/sw.js                service worker (push + notificationclick handlers)
frontend/src/utils/push.js           subscribe/unsubscribe helpers + isPushSupported()
frontend/src/components/NotificationBell.jsx  "🔔 Enable push" toggle + Send test
frontend/src/main.jsx                registers /sw.js on app boot
```

User clicks **🔔 Enable push** → browser prompts → service worker subscribes via FCM → endpoint stored on backend. Every `createNotification` fires a parallel push to all the user's subscriptions. Pruned automatically on 404 / 410.

### 7.7 Email via Brevo HTTP API

```
frontend                       backend                          Brevo
  │  task action                 │                               │
  ├──────────────────────────►   │                               │
  │                              │  createNotification(…)        │
  │                              │  ├─ save Mongo row            │
  │                              │  ├─ sendPushToUser(…)         │
  │                              │  └─ sendNotificationEmail(…)──┼─►  POST /v3/smtp/email
  │                              │                               │       (HTTPS, port 443)
```

`makeBrevoTransport(apiKey, defaultFrom)` returns an object with `.sendMail()` matching nodemailer's shape, so existing `transporter.sendMail({ from, to, subject, html })` callers work unchanged. `initTransporter()` picks Brevo first if `BREVO_API_KEY` is set, falls back to SMTP via nodemailer otherwise.

Email body links use `process.env.APP_URL` so every "Open task" / "Reset password" button goes to the live Netlify site.

---

## 8. UX polish

### 8.1 Toast system

`frontend/src/context/ToastContext.jsx` — `useToast()` returns `{ success, error, info }`. Pills top-right, animated, auto-dismiss after 4–6s. Replaces all `window.alert` calls in PlanEditor + PlanList. Other pages can opt in with one import.

### 8.2 Editable email on Profile

`/profile` — the Email field used to be read-only text; now an `<input>` saved through the existing "Save profile" button. Backend `PUT /api/users/:id`:

- Lowercases + format-validates
- Rejects duplicates with **HTTP 409**
- Strips `role` / `isSuperAdmin` from the body when caller is not super admin

### 8.3 Editable attachments via signedFileUrl rewrite

`signedFileUrl(url)` in `frontend/src/api.js` now rewrites any `…/uploads/X` URL to `${API_ROOT}/uploads/X`. Old DB records hardcoded to `http://127.0.0.1:3001/uploads/…` from local-mode now resolve through Render automatically.

---

## 9. Data migrations executed

| Migration | Scope | Result |
|---|---|---|
| Local Mongo → Atlas (`migrateLocalToAtlas.js`) | 22 collections, 685 docs | ✓ |
| Upload migration (`migrateUploadsToLive.js`) | 92 files, 470 MB | ✓ 92/92 uploaded |
| Upload URL rewrite | 25 task docs | ✓ |
| Notification `teamspaceId` backfill | 232 task notifs + 51 plan/time notifs | ✓ |
| User merges | `pooja@mayvel.local` → `pooja.s@mayvel.ai`, `suha.amir@mayvel.ai` → `suha.a@mayvel.ai` | ✓ no data loss |
| Email domain renames | `thaha.naseer.local → .ai`, `hdr.user.local → hr@mayvel.ai`, `smk.user.local → .ai` | ✓ |
| User deletions | `smk.user@mayvel.ai` (with personal data) | ✓ |
| Notion API tokens stripped | 7 backend scripts | ✓ — GitHub push protection now passes |
| Atlas password rotated | `MayvelDemo2026` set | ⚠ exposed in chat — rotate again post-demo |
| Set Thagha as SuperAdmin | `users.isSuperAdmin = true` for thaghanazeer.s@mayvel.ai | ✓ |
| Marketing teamspace + Pooja owner | Created `Marketing`, owner = Pooja, membership rows added | ✓ |
| Rate buckets + task types for Marketing | Copied from Product Design (11 + 12) | ✓ |

---

## 10. Known production caveats (post-demo cleanup)

1. **Atlas password**, **Gemini API key**, **Brevo API key**, **GitHub PAT**, **Notion tokens** were all pasted into chat at various points. Rotate each before going to real production.
2. **Render free tier**:
   - First request after 15 min idle takes ~30 s to wake the dyno
   - Uploads folder is ephemeral — re-run `migrateUploadsToLive.js` after a restart, or move to S3
   - Outbound SMTP port 587 blocked (mitigated by Brevo HTTP API)
3. **CORS** is open (`app.use(cors())`). Lock down to `https://mayvelerp.netlify.app` only for production.
4. **`X-Forwarded-For` warning** in Render logs — `express-rate-limit` complains about the missing `trust proxy` setting. Add `app.set('trust proxy', 1)` to silence; not fatal.
5. **Backend auth on Organization + Members pages** is frontend-only. Direct API calls (`GET /api/orgchart`, `GET /api/team`) still return data to any authenticated user. Add backend gates if needed.
6. **smoke@test.local** + **test.1778502251@example.com** still in DB. Safe to delete.

---

## 11. File index of new code

```
backend/
  lib/
    push.js                            ◀ NEW   web-push send wrapper
  models/
    PushSubscription.js                ◀ NEW
    Notification.js                    + teamspaceId field
    User.js                            + isSuperAdmin flag
    Project.js                         + scope field
    Teamspace.js                       + isPersonal / ownerId
  middleware/
    teamspaceAccess.js                 + requireTeamspaceOwner
  routes/
    timesheets.js                      + ?mine=1, ?awaitingMyApproval=1 filters;
                                       notify() carries teamspaceId
  scripts/
    importDumpToAtlas.js               ◀ NEW
    migrateLocalToAtlas.js             ◀ NEW
    migrateUploadsToLive.js            ◀ NEW
  server.js                            + Brevo HTTP transport
                                       + IPv4 SMTP pre-resolve (fallback)
                                       + impersonation + access endpoints
                                       + personal-teamspace endpoint
                                       + notification email send
                                       + multer 50→200 MB
                                       + lifecycle notifications

frontend/
  public/
    sw.js                              ◀ NEW   service worker
  src/
    context/
      ToastContext.{jsx,css}           ◀ NEW
      AuthContext.jsx                  + superAdminMode + impersonation
    pages/
      AccessControlPage.jsx            ◀ NEW
      PlanListPage.jsx                 rewritten — project-first flow
      PlanEditorPage.jsx               + toasts
      OrgChartPage.jsx                 read-only for non-super-admin
      ProjectsPage.jsx                 - org-wide checkbox removed
      ProfilePage.jsx                  editable email
    utils/
      push.js                          ◀ NEW   subscribe/unsubscribe/test
    components/
      Layout.jsx                       + super-admin toggle
                                       + view-as switcher + banner
                                       + per-teamspace bell badges
                                       + personal-space create button
                                       + owner-only nav filter
                                       + Org chart / Members admin gate
    api.js                             + push, access-control, impersonation,
                                       per-teamspace unread, personal-ts helpers
                                       signedFileUrl rewrites legacy hosts
    main.jsx                           + registerServiceWorker()
    App.jsx                            + ToastProvider, /access route
  netlify.toml                         ◀ NEW   build + SPA redirect
  .env.example                         ◀ NEW
```

---

## 12. Commit log (this iteration)

```
bc976e7  Fix notification navigation + per-teamspace bell counts
123edad  Add app-wide toast system; convert PlanEditor + PlanList alerts to toasts
f9cafe4  Org chart edit restricted to Super Admin (read-only for everyone else)
b94a9a5  Time.Plan project-first flow; Plan Approvals shows only plans for projects you own
9a8e736  Org chart + Members hidden from non-admins; projects now visible to every teamspace
27e2f82  Refresh user list when switcher opens; auto-recover from stale-ID 404
75bcce2  SuperAdmin impersonation: 'View as <user>' switcher in header
0e48df2  Per-teamspace notification bell with unread badge in sidebar
fa28b54  Super Admin header toggle: switch between full SuperAdmin view and Normal mode
9e8adf2  Access control: per-teamspace role matrix + CRUD permissions reference
ffe6766  Disable public signup; add Super Admin role + access-control page
d293972  Org-wide projects + auto-create personal workspace per user
3f93a86  Add migrateUploadsToLive script to push local files to Render and rewrite DB URLs
d0b54b4  Fix attachments on live: rewrite legacy host URLs in signedFileUrl, bump upload limit to 200MB
f5b85b2  Add Brevo HTTP API transport (works on hosts that block SMTP port 587)
a1dbe93  SMTP: pre-resolve to IPv4 address (Render free tier has no IPv6 routing)
ea53718  Force IPv4 DNS so SMTP works on Render
abc716b  Notify on every lifecycle event: created, status moved, deleted
3cc0fb1  Allow users to edit their email on Profile page
cff5f45  Send email on every notification, not just specific events
77e6661  Add Web Push notifications + wire SMTP fallback
02b07e5  Initial commit: backend + frontend ready for deployment
```
