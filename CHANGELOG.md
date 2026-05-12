# Changelog

All notable changes shipped on top of the original [PRD.md](PRD.md). For the
full design rationale of these changes see [PRD_UPDATE.md](PRD_UPDATE.md).

## 2026-05-12 — Production rollout + governance pass

### Added
- **Live deployment**: Netlify (frontend), Render (backend), MongoDB Atlas (DB).
- **Brevo HTTP API** for transactional email (HTTPS, no SMTP — works on Render free tier which blocks port 587).
- **Web Push notifications** (FCM + VAPID). Opt-in toggle on the bell.
- **Super Admin** role (`User.isSuperAdmin`). Single workspace-owner with bypass on every gate.
- **"View as user"** impersonation switcher in the header (Super Admin only).
- **Super Admin / Normal mode** toggle — lets the workspace owner sandbox into a regular-admin view.
- **Access Control page** (`/access`) — Super Admin manages users, per-teamspace roles, and sees a CRUD permission matrix.
- **Per-teamspace bell badges** in the sidebar with unread counts.
- **Personal workspace** (opt-in) — tasks-only private space per user.
- **Org-wide projects** — every project visible to every teamspace; each contributes its own tasks + budget.
- **Notification lifecycle coverage** — created / assigned / status moved / approved / rejected / deleted / @mention + plan & timesheet events. Email + push + in-app for each.
- **App-wide toast system** (`useToast()`). Replaced `window.alert` calls.
- **Editable email** on the Profile page (with backend uniqueness check).
- Project-first flow on the **Time · Plans** page — pick a project, see your plans + approval history, then add new.
- **migrateUploadsToLive.js**, **migrateLocalToAtlas.js**, **importDumpToAtlas.js** scripts.

### Changed
- **Public signup disabled** — `/api/auth/signup` returns 403. Users are only created from the Access Control page.
- **Org chart is read-only** for everyone except Super Admin. Backend rejects unauthorized saves with 403.
- **Plan Approvals** filters to plans for projects you own (`?awaitingMyApproval=1`).
- **Time · Plans** filters to plans you created (`?mine=1`).
- **Upload size limit** raised from 50 MB → 200 MB.
- **`signedFileUrl`** rewrites any legacy `127.0.0.1` URL to the live backend host.
- **Notification.teamspaceId** added — denormalized so the sidebar can count per-team without joining.
- **Time Plans / Approvals / Team / Teamspace Control** are now hidden from anyone except the teamspace owner (or Super Admin in elevated mode).

### Fixed
- IPv6 SMTP `ENETUNREACH` on Render — pre-resolve to IPv4 + `family: 4`. Superseded by Brevo HTTP API.
- Notification click navigated using the user's *active* teamspace instead of the *notification's* teamspace — fixed.
- Per-teamspace bell counts were missing all plan/time notifications (no `teamspaceId` set on the row) — `notify()` in `routes/timesheets.js` now forwards it.
- Stale-ID 404 in the "View as" dropdown — list is re-fetched every time the dropdown opens.
- File attachments + video previews failed in live because URLs pointed at localhost — `signedFileUrl` rewrite + Render upload migration.

### Migrated
- Local Mongo → Atlas (22 collections, 685 docs)
- 92 upload files → Render's disk (~470 MB), with DB references rewritten
- 232 task notifications + 51 plan/time notifications backfilled with `teamspaceId`
- Duplicate users merged: `pooja@mayvel.local → pooja.s@mayvel.ai`, `suha.amir@mayvel.ai → suha.a@mayvel.ai`
- Domain renames: `*@mayvel.local → *@mayvel.ai` (Thaha, HR, smk)
- 7 hardcoded Notion tokens stripped from backend scripts (unblocked GitHub push protection)

### Security TODO (post-demo)
- Rotate: Atlas password, Gemini API key, Brevo API key, GitHub PAT, Notion tokens
- Lock CORS to `https://mayvelerp.netlify.app`
- Add `app.set('trust proxy', 1)` for `express-rate-limit`
- Backend gates on `/api/orgchart` (GET), `/api/team` for non-admins
- Delete remaining test users (`smoke@test.local`, `test.1778502251@example.com`)

### Outstanding
- Render free tier ephemeral disk → uploads vanish on restart. Move to S3 / Cloudinary for stable production.
- Cross-team task assignee dropdown (option C from earlier discussion) — deferred.

---

## Earlier history

See [PRD.md](PRD.md) for the pre-ERP feature snapshot and [TIMESHEET_PRD.md](TIMESHEET_PRD.md) for the ERP / timesheet module spec.
