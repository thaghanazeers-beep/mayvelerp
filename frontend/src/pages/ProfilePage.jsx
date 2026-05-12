import { useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { uploadAvatar, updateUser, signedFileUrl } from '../api';
import './ProfilePage.css';

// Common IANA timezones for the picker. The full list is hundreds; this covers
// the regions we actually have employees in. Users can also paste any IANA name.
const COMMON_TIMEZONES = [
  'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin',
  'America/New_York', 'America/Chicago', 'America/Los_Angeles',
  'Australia/Sydney', 'UTC',
];

export default function ProfilePage() {
  const { user, loginUser, logout } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [editName, setEditName] = useState(false);
  const [name, setName] = useState(user?.name || '');
  const fileRef = useRef(null);

  // Extra-fields edit state — keep in one form blob so we can save in a single PUT.
  const [extra, setExtra] = useState({
    email:        user?.email || '',
    phone:        user?.phone || '',
    slackHandle:  user?.slackHandle || '',
    timezone:     user?.timezone || 'Asia/Kolkata',
    workingHours: user?.workingHours || { start: '09:00', end: '18:00', weekdaysOnly: true },
    bio:          user?.bio || '',
    notificationPrefs: user?.notificationPrefs || {},
    emailNotificationsEnabled: user?.emailNotificationsEnabled !== false,  // default-on
  });
  const togglePref = (type) => setExtra(prev => ({
    ...prev,
    notificationPrefs: { ...prev.notificationPrefs, [type]: prev.notificationPrefs[type] === false }, // toggle from explicit-false ↔ enabled
  }));
  const [savingExtra, setSavingExtra] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const setExtraField = (k, v) => setExtra(prev => ({ ...prev, [k]: v }));
  const setWorkingHours = (k, v) => setExtra(prev => ({ ...prev, workingHours: { ...prev.workingHours, [k]: v } }));

  const saveExtras = async () => {
    // Light email validation — server-side check enforces uniqueness.
    if (extra.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(extra.email)) {
      alert('That email looks invalid. Use the format name@domain.com.');
      return;
    }
    setSavingExtra(true);
    try {
      const r = await updateUser(user._id, extra);
      loginUser({ ...user, ...r.data });
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2500);
    } catch (e) {
      alert('Save failed: ' + (e.response?.data?.error || e.message));
    } finally { setSavingExtra(false); }
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadAvatar(user._id, file);
      loginUser({ ...user, profilePictureUrl: res.data.profilePictureUrl });
    } catch (err) { console.error('Upload failed:', err); }
    finally { setUploading(false); }
  };

  const handleNameSave = async () => {
    if (!name.trim()) return;
    try {
      const res = await updateUser(user._id, { name });
      loginUser({ ...user, name: res.data.name });
      setEditName(false);
    } catch (err) { console.error(err); }
  };

  return (
    <div className="profile-page">
      <div className="profile-card animate-in">
        <div className="profile-header-section">
          <div className="profile-avatar-lg" onClick={() => fileRef.current?.click()} style={{ cursor: 'pointer', position: 'relative' }}>
            {user?.profilePictureUrl ? (
              <img src={signedFileUrl(user.profilePictureUrl)} alt={user.name} />
            ) : (
              <span>{user?.name?.charAt(0)?.toUpperCase()}</span>
            )}
            <div className="avatar-overlay">
              {uploading ? (
                <div className="spinner" style={{ width: 20, height: 20 }} />
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleAvatarUpload} />
          </div>
          <div className="profile-info">
            {editName ? (
              <div className="profile-name-edit">
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') handleNameSave(); if (e.key === 'Escape') setEditName(false); }}
                />
                <button className="btn btn-primary btn-sm" onClick={handleNameSave}>Save</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditName(false)}>Cancel</button>
              </div>
            ) : (
              <h2 onClick={() => setEditName(true)} style={{ cursor: 'pointer' }} title="Click to edit">
                {user?.name}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: 8, opacity: 0.4 }}>
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </h2>
            )}
            <p className="profile-email">{user?.email}</p>
            <span className={`badge ${user?.role === 'Admin' ? 'badge-admin' : 'badge-member'}`}>
              {user?.role}
            </span>
          </div>
        </div>

        <div className="profile-details">
          <div className="profile-field">
            <label className="label">Full Name</label>
            <div className="profile-value">{user?.name}</div>
          </div>
          <div className="profile-field">
            <label className="label">Email Address</label>
            <input
              className="input"
              type="email"
              value={extra.email}
              onChange={e => setExtraField('email', e.target.value)}
              placeholder="name@domain.com"
              autoComplete="email"
            />
            <div className="muted" style={{ fontSize: '0.7rem', marginTop: 4 }}>
              Workflow / notification emails are sent here. Click "Save profile" below to apply.
            </div>
          </div>
          <div className="profile-field">
            <label className="label">Role</label>
            <div className="profile-value">{user?.role}</div>
          </div>
          <div className="profile-field">
            <label className="label">User ID</label>
            <div className="profile-value profile-id">{user?._id || user?.id}</div>
          </div>
        </div>

        {/* Extra profile fields — phone, Slack, timezone, working hours, bio */}
        <h3 style={{ marginTop: 28, marginBottom: 12, fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)' }}>Contact & availability</h3>
        <div className="profile-details">
          <div className="profile-field">
            <label className="label">Phone</label>
            <input className="input" type="tel" value={extra.phone} onChange={e => setExtraField('phone', e.target.value)} placeholder="+91 98765 43210" />
          </div>
          <div className="profile-field">
            <label className="label">Slack handle</label>
            <input className="input" value={extra.slackHandle} onChange={e => setExtraField('slackHandle', e.target.value)} placeholder="@username or full URL" />
          </div>
          <div className="profile-field">
            <label className="label">Timezone</label>
            <input className="input" list="tz-list" value={extra.timezone} onChange={e => setExtraField('timezone', e.target.value)} placeholder="Asia/Kolkata" />
            <datalist id="tz-list">
              {COMMON_TIMEZONES.map(tz => <option key={tz} value={tz} />)}
            </datalist>
            <div className="muted" style={{ fontSize: '0.7rem', marginTop: 4 }}>IANA name. Any value accepted; common ones autocomplete.</div>
          </div>
          <div className="profile-field">
            <label className="label">Working hours</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input className="input" type="time" value={extra.workingHours.start} onChange={e => setWorkingHours('start', e.target.value)} style={{ width: 110 }} />
              <span className="muted">to</span>
              <input className="input" type="time" value={extra.workingHours.end} onChange={e => setWorkingHours('end', e.target.value)} style={{ width: 110 }} />
              <label style={{ marginLeft: 12, fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={extra.workingHours.weekdaysOnly} onChange={e => setWorkingHours('weekdaysOnly', e.target.checked)} />
                Weekdays only
              </label>
            </div>
          </div>
          <div className="profile-field" style={{ gridColumn: '1 / -1' }}>
            <label className="label">Bio</label>
            <textarea className="input" rows={2} value={extra.bio} onChange={e => setExtraField('bio', e.target.value)} placeholder="Short description / current focus" />
          </div>
        </div>
        <h3 style={{ marginTop: 28, marginBottom: 12, fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)' }}>🔔 Notification preferences</h3>

        {/* Master email kill switch. In-app + push notifications are
            unaffected; only inbox spam is suppressed when this is OFF. */}
        <label style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 14px', marginBottom: 12,
          background: extra.emailNotificationsEnabled ? 'rgba(0, 184, 148, 0.08)' : 'var(--bg-elevated)',
          border: '1px solid ' + (extra.emailNotificationsEnabled ? '#00b894' : 'var(--border)'),
          borderRadius: 8, cursor: 'pointer',
        }}>
          <input
            type="checkbox"
            checked={!!extra.emailNotificationsEnabled}
            onChange={e => setExtraField('emailNotificationsEnabled', e.target.checked)}
            style={{ width: 18, height: 18, accentColor: '#00b894' }}
          />
          <span style={{ flex: 1 }}>
            <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
              ✉️ Email notifications: {extra.emailNotificationsEnabled ? 'ON' : 'OFF'}
            </span>
            <div className="muted" style={{ fontSize: '0.74rem', marginTop: 2 }}>
              Master switch. When OFF, no notification emails are sent to {extra.email || 'your inbox'} — but the in-app bell and browser push still work, so you won't miss anything.
            </div>
          </span>
        </label>

        <p className="muted" style={{ fontSize: '0.78rem', margin: '0 0 12px' }}>
          Per-category fine control: mute specific types you don't care about. Affects in-app rows, push notifications, and (if email is ON above) emails too.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
          {[
            { type: 'task_created',     label: '✨ New task created' },
            { type: 'task_assigned',    label: '👤 Task assigned to me' },
            { type: 'status_changed',   label: '🔄 Task status changed' },
            { type: 'task_completed',   label: '✅ Task completed' },
            { type: 'task_rejected',    label: '❌ Task rejected' },
            { type: 'review_requested', label: '📝 Review requested' },
            { type: 'plan_submitted',   label: '📤 Plan submitted (admin only)' },
            { type: 'plan_approved',    label: '✅ Plan approved' },
            { type: 'plan_rejected',    label: '❌ Plan rejected' },
            { type: 'time_submitted',   label: '⏱ Time submitted (owners)' },
            { type: 'time_approved',    label: '👍 Week approved' },
            { type: 'time_rejected',    label: '👎 Week rejected' },
            { type: 'time_overdue',     label: '⏰ Friday EOD reminder' },
            { type: 'budget_overrun',   label: '💸 Budget overrun' },
            { type: 'workflow_notification', label: '⚡ Custom workflow alerts' },
          ].map(({ type, label }) => {
            const muted = extra.notificationPrefs?.[type] === false;
            return (
              <label key={type} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px',
                background: muted ? 'var(--bg-elevated)' : 'var(--bg-surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                opacity: muted ? 0.6 : 1,
                transition: 'all 0.15s ease',
              }}>
                <input type="checkbox" checked={!muted} onChange={() => togglePref(type)} />
                <span style={{ fontSize: '0.78rem' }}>{label}</span>
              </label>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 18 }}>
          <button className="btn btn-primary btn-sm" onClick={saveExtras} disabled={savingExtra}>
            {savingExtra ? 'Saving…' : 'Save profile & preferences'}
          </button>
          {savedAt && <span className="muted" style={{ fontSize: '0.78rem', color: 'var(--accent-green, #00b894)' }}>✓ Saved</span>}
        </div>

        <button className="btn btn-danger" onClick={logout} style={{ marginTop: 24 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16,17 21,12 16,7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Sign Out
        </button>
      </div>
    </div>
  );
}
