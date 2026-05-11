# Mayvel Task

Project management + ERP timesheet platform. React 19 + Vite frontend, Node 22 + Express 5 + Mongoose 9 backend, MongoDB 8 storage.

## What's in here

- **PM core** — Tasks (board / table / list views), Projects, Sprints (with burndown), Workflows (rule engine, plan + task triggers), Team management, Org Chart with auto-layout, Notifications.
- **ERP timesheet** — Project hours plans (multi-plan/month, billable + non-billable), allocations (per-week, per-employee), time entries (Mon–Fri only, hard-capped), weekly slice approvals, P&L per project, contract value + billing type (T&M / fixed-bid), forecast loss model.
- **Organization Members page** — All users + chart-only nodes, rate bucket cost, current-month workload, admin-editable bucket.
- **AI assistant** — Full-screen chat (`/ai`) backed by Gemini 2.5 Flash with tool-use over the live database + the project's PRDs in the system prompt. Streams responses, persists chat history per browser, search + rename + delete.
- **Authentication** — bcrypt-hashed passwords (legacy plaintext auto-upgraded on first login), JWT bearer, password-reset email flow with Ethereal fallback in dev.

The full product spec lives in [PRD.md](PRD.md) and [TIMESHEET_PRD.md](TIMESHEET_PRD.md). Architectural notes in [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Quick start

### Prerequisites

- **Node.js ≥ 20** (v22 LTS recommended)
- **MongoDB ≥ 6** running locally on `27017` (or set `MONGODB_URI`)
- A **Google AI Studio API key** for the AI chat (free tier at [aistudio.google.com](https://aistudio.google.com)) — optional; chat returns 503 without it

### Backend

```bash
cd backend
npm install
cp .env.example .env   # if no .env.example, create .env manually (see below)
node server.js
```

Server runs on `http://127.0.0.1:3001`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Dev server runs on `http://localhost:5173`.

### Required `.env` (backend)

```ini
# Mongo
MONGODB_URI=mongodb://localhost:27017/mayvel_task

# JWT
JWT_SECRET=change-me-in-prod

# Optional — SMTP for password reset / invite emails. Without these, dev mode
# uses Ethereal (logs preview URLs to console) and shows reset URLs in API responses.
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=

# Optional — Gemini API key for the AI assistant. Without this, /api/chat returns 503.
GEMINI_API_KEY=

# Optional — base URLs for emails / file uploads
APP_URL=http://localhost:5173
PUBLIC_BASE_URL=http://127.0.0.1:3001
```

---

## First-run seeding

The platform expects a few baseline records. Run these scripts (in order) the first time:

```bash
cd backend

# 1. Rate buckets — used to compute employee cost rates
node seedRateBuckets.js

# 2. Task types — pre-defined task type picklist for plan lines
node seedTaskTypes.js

# 3. Org chart V2 — 44 employees + 19 division headers, with edges
node loadOrgChartV3.js

# 4. Default workflows — 6 task + 4 plan workflows wired to notifications
node seedWorkflows.js

# 5. Optional — assign existing users to rate buckets by name match
node assignUserBuckets.js
```

After this, sign up a user via `POST /api/auth/signup` (or use the frontend), grant yourself `Admin` role in Mongo, and you're ready.

---

## Project layout

```
Task/
├── backend/
│   ├── server.js              # Express app + routes for users/tasks/projects/sprints/workflows/notifications/orgchart
│   ├── routes/
│   │   ├── timesheets.js      # /api/time/* — plans, allocations, time entries, slices, P&L, Excel/PDF export
│   │   └── chat.js            # /api/chat — Gemini-backed AI assistant + tool-use
│   ├── workflowEngine.js      # Trigger evaluation + action execution
│   ├── models/                # Mongoose schemas
│   ├── middleware/            # auth (JWT) + teamspace access
│   ├── seed*.js / load*.js    # One-shot seeders
│   └── uploads/               # Task attachments + avatars (auth-gated)
├── frontend/
│   ├── src/
│   │   ├── pages/             # Routed top-level pages
│   │   ├── components/        # Layout, NotificationBell, AiChat sidebar (legacy), etc.
│   │   ├── context/           # Auth, Theme, Teamspace, Org contexts
│   │   ├── api.js             # All HTTP client wrappers
│   │   └── App.jsx            # Router
│   └── vite.config.js
├── PRD.md                     # Pre-ERP product spec + post-ERP changelog (§21)
├── TIMESHEET_PRD.md           # Full ERP timesheet spec + changelog (§13)
├── ARCHITECTURE.md            # System diagrams + data flow
└── README.md                  # This file
```

---

## API conventions

- All `/api/*` routes (except `/api/auth/*`) require a JWT in `Authorization: Bearer <token>`.
- Most data routes also expect `x-teamspace-id: <id>` so the backend can scope queries.
- File downloads under `/uploads/*` accept the JWT via `?t=<token>` query param so `<img>`, `<iframe>`, `<a download>` work without JS interception.
- Currency is always **cents (paise)** in the DB — `formatINR()` (frontend) and the various PDF/Excel exports format on display.
- Dates: store as `Date` objects. Time-entry `date` field is `YYYY-MM-DD` strings (no timezone drift).

---

## Development tips

- **Restart backend** after editing any backend file. There's no auto-reload (`nodemon` not wired by default — feel free to add).
- **Backups**: take a tarball before destructive operations (e.g., re-running an importer). The `backup.sh` style would be `tar -czf Task_backup_$(date +%Y%m%dT%H%M%SZ).tar.gz Task/` from the parent dir.
- **Bootstrap CSS** is still globally imported in the frontend even though we don't use Bootstrap components. Several CSS overrides exist in [`frontend/src/index.css`](frontend/src/index.css) to defeat its defaults (modal sizing, checkbox appearance, etc.). Removing it cleanly is a multi-PR task.

---

## Known limitations / what's left

See **PRD.md §19** and the conversation history with the engineering team for the working punch list. High-level:

- Plaintext passwords have been migrated to bcrypt; legacy hashes are auto-upgraded on first login.
- `/uploads/*` is now JWT-gated — but old image URLs stored in DB rows pre-date the gate; they need `?t=<token>` appended at render time (handled by `signedFileUrl()` in [api.js](frontend/src/api.js)).
- No automated test suite. CI / production deploy story is still TODO.
- AI chat costs nothing in dev (Gemini free tier — 1500 req/day on Flash) but rate-limits will bite at scale; switching to Anthropic Claude is a 30-line change (provider-agnostic SDK shape).

---

## License

Internal — Mayvel Task team only.
