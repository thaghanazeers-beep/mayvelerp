import { useEffect, useMemo, useState } from 'react';
import { useTeamspace } from '../context/TeamspaceContext';
import { useAuth } from '../context/AuthContext';
import { getMyWeek, bulkSaveEntries, submitPeriod, formatINR, todayInTz } from '../api';
import { PageIntro } from '../components/PageIntro';
import './PlanPages.css';

// "2h", "2:30", "2.5", "120m" → minutes (or null on parse error)
function parseDuration(s) {
  if (s == null) return 0;
  const v = String(s).trim();
  if (!v) return 0;
  const m1 = v.match(/^(\d+):(\d{1,2})$/);                      // 2:30
  if (m1) return Number(m1[1]) * 60 + Number(m1[2]);
  const m2 = v.match(/^(\d+(?:\.\d+)?)\s*h$/i);                 // 2h, 2.5h
  if (m2) return Math.round(Number(m2[1]) * 60);
  const m3 = v.match(/^(\d+)\s*m$/i);                           // 120m
  if (m3) return Number(m3[1]);
  const n = Number(v);
  if (!Number.isNaN(n)) return Math.round(n * 60);              // bare number = hours
  return null;
}
function fmtMinutes(min) {
  if (!min) return '';
  const h = Math.floor(min / 60), m = min % 60;
  return m === 0 ? `${h}h` : `${h}:${String(m).padStart(2,'0')}`;
}

const STATUS_BADGE = {
  open:               { label: 'Draft',                 cls: 'plan-badge-draft' },
  submitted:          { label: 'Submitted',             cls: 'plan-badge-pending' },
  partially_approved: { label: 'Partially approved',    cls: 'plan-badge-pending' },
  approved:           { label: 'Approved',              cls: 'plan-badge-approved' },
  rejected:           { label: 'Rejected',              cls: 'plan-badge-rejected' },
};

const isoDate = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const r = new Date(d); r.setUTCDate(r.getUTCDate() + n); return r; };
const mondayOf = (s) => {
  const d = new Date(s + 'T00:00:00Z');
  const w = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (w === 0 ? -6 : 1 - w));
  return d;
};
export default function MyTimesheetPage() {
  const { activeTeamspaceId } = useTeamspace();
  const { user } = useAuth();
  // Compute "today" in the user's profile timezone so a Tokyo user logging at
  // 11pm doesn't accidentally land on tomorrow's UTC date.
  const today = todayInTz(user?.timezone);
  const [weekStart, setWeekStart] = useState(() => isoDate(mondayOf(today)));
  const [data,     setData]       = useState(null);  // { period, allocations, entries, slices, weekStart, weekEnd }
  // Local edits keyed by `${allocationId}::${YYYY-MM-DD}` → minutes (number) or empty
  const [draft,    setDraft]      = useState({});
  const [busy,     setBusy]       = useState(false);
  const [error,    setError]      = useState('');
  const [info,     setInfo]       = useState('');

  const days = useMemo(() => {
    const m = new Date(weekStart + 'T00:00:00Z');
    return Array.from({ length: 5 }, (_, i) => isoDate(addDays(m, i)));
  }, [weekStart]);

  const reload = async () => {
    setError(''); setInfo('');
    const r = await getMyWeek({ weekStart });
    setData(r.data);
    // Seed draft from server entries
    const seed = {};
    for (const e of r.data.entries) {
      seed[`${e.allocationId}::${e.date}`] = e.minutes;
    }
    setDraft(seed);
  };
  useEffect(() => { reload(); }, [weekStart]);

  if (!data) return <div className="plan-page"><div className="plan-empty">Loading…</div></div>;

  const editable = ['open', 'rejected'].includes(data.period.status);

  const cellKey = (allocId, day) => `${allocId}::${day}`;
  const setCell = (allocId, day, raw) => {
    const minutes = parseDuration(raw);
    if (minutes === null) { setError(`Couldn't parse "${raw}" — try 2h, 2:30, 2.5, or 120m`); return; }
    setError('');
    setDraft(prev => ({ ...prev, [cellKey(allocId, day)]: minutes }));
  };
  const cellValue = (allocId, day) => fmtMinutes(draft[cellKey(allocId, day)] || 0);

  // Per-row totals (across the 5 days, from draft)
  const rowTotal = (allocId) => days.reduce((s, d) => s + (draft[cellKey(allocId, d)] || 0), 0);
  // Per-day totals
  const dayTotal = (day) => data.allocations.reduce((s, a) => s + (draft[cellKey(a._id, day)] || 0), 0);
  const weekTotal = () => Object.values(draft).reduce((s, v) => s + (v || 0), 0);

  const handleSave = async () => {
    setBusy(true); setError(''); setInfo('');
    try {
      const entries = [];
      for (const a of data.allocations) {
        for (const d of days) {
          const m = draft[cellKey(a._id, d)] || 0;
          if (m > 0) entries.push({
            date: d, projectId: a.projectId._id || a.projectId,
            taskId: a.taskId?._id || a.taskId, allocationId: a._id, minutes: m,
          });
        }
      }
      await bulkSaveEntries({ weekStart, entries });
      await reload();
      setInfo('Saved');
      setTimeout(() => setInfo(''), 1800);
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  };

  const handleSubmit = async () => {
    if (weekTotal() === 0) { setError('Add at least one hour before submitting'); return; }
    if (!confirm(`Submit ${(weekTotal()/60).toFixed(1)}h for the week? You won't be able to edit until it's approved or rejected.`)) return;
    setBusy(true); setError('');
    try {
      await handleSave();   // ensure latest state is persisted first
      await submitPeriod(data.period._id);
      await reload();
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  };

  const dayLabel = (d) => {
    const dt = new Date(d + 'T00:00:00Z');
    return dt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  };
  const projectName  = (a) => (a.projectId?.name) || '—';
  const projectIcon  = (a) => (a.projectId?.icon) || '📁';
  const taskTitle    = (a) => (a.taskId?.title) || '(unnamed task)';

  // Slice status per project, used to show the rejection reason if any
  const sliceByProject = Object.fromEntries(data.slices.map(s => [String(s.projectId), s]));
  const rejectedSlice = data.slices.find(s => s.status === 'rejected');

  return (
    <div className="plan-page">
      <PageIntro
        icon="⏱️"
        title="My Timesheet"
        actor="You"
        purpose="Log the hours you worked this week against each project you\'re allocated to. Submit the week when you\'re done so finance can roll it into P&L."
        storageKey="my-timesheet"
        youCanDo={[
          'Type hours into the cells for each project × day combination',
          'Use the arrows to switch weeks (past weeks are read-only after submission)',
          'Save a draft as often as you like; it only locks when you submit',
        ]}
        whatHappensNext={[
          'Save → entries are stored as Draft, no one is notified',
          'Submit → your week-slice goes to your manager\'s Week Approvals queue',
          'Manager approves → hours feed into project P&L and actual cost',
          'Manager rejects → week unlocks for editing, you see their comment',
        ]}
      />

      <div className="plan-toolbar">
        <button className="btn btn-ghost btn-sm" onClick={() => setWeekStart(isoDate(addDays(new Date(weekStart + 'T00:00:00Z'), -7)))}>◀</button>
        <div style={{ flex: 1 }}>
          <div className="plan-h-title">
            Week of {new Date(weekStart + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            <span className={`plan-badge ${STATUS_BADGE[data.period.status]?.cls || 'plan-badge-draft'}`} style={{ marginLeft: 12 }}>
              {STATUS_BADGE[data.period.status]?.label || data.period.status}
            </span>
          </div>
          <div className="plan-h-sub">{data.allocations.length} allocated row{data.allocations.length === 1 ? '' : 's'} · weekly total <strong>{(weekTotal()/60).toFixed(2)}h</strong></div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setWeekStart(isoDate(mondayOf(today)))}>This week</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setWeekStart(isoDate(addDays(new Date(weekStart + 'T00:00:00Z'), 7)))}>▶</button>
        {editable && (
          <>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={handleSave}>💾 Save</button>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={handleSubmit}>📤 Submit week</button>
          </>
        )}
      </div>

      {error && <div className="plan-banner plan-banner-reject">{error}</div>}
      {info  && <div className="plan-banner plan-banner-approved">{info}</div>}
      {rejectedSlice && (
        <div className="plan-banner plan-banner-reject">
          <strong>Rejected by your project owner:</strong> {rejectedSlice.rejectionReason} — fix and resubmit.
        </div>
      )}

      {data.allocations.length === 0 ? (
        <div className="plan-empty">
          <div style={{ fontSize: 36, marginBottom: 8 }}>🗓</div>
          <p>No tasks allocated to you this week. Talk to a Project Owner to get hours allocated.</p>
        </div>
      ) : (
        <div className="plan-grid-wrap">
          <table className="plan-grid">
            <thead>
              <tr>
                <th style={{ minWidth: 220 }}>Project / Task</th>
                <th>Allocated</th>
                {days.map(d => <th key={d} className="num">{dayLabel(d)}</th>)}
                <th className="num">Row total</th>
              </tr>
            </thead>
            <tbody>
              {data.allocations.map(a => {
                const allocated = a.allocatedHours;
                const rowMin = rowTotal(a._id);
                const consumedH = (rowMin / 60).toFixed(2);
                return (
                  <tr key={a._id} className={a.billable ? '' : 'plan-row-nb'}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{projectIcon(a)} {projectName(a)}</div>
                      <div className="muted" style={{ fontSize: '0.75rem' }}>{taskTitle(a)} · {a.billable ? 'Billable' : 'Non-billable'}</div>
                    </td>
                    <td className="num">
                      <span className={Number(consumedH) > allocated ? 'plan-loss' : 'muted'} style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {consumedH}/{allocated}h
                      </span>
                    </td>
                    {days.map(d => (
                      <td key={d} className="num">
                        <input
                          type="text" disabled={!editable}
                          defaultValue={cellValue(a._id, d)}
                          onBlur={(e) => {
                            const v = e.target.value;
                            setCell(a._id, d, v);
                            // Re-render the formatted value
                            e.target.value = fmtMinutes(parseDuration(v) || 0);
                          }}
                          placeholder="0"
                          style={{ width: 70 }}
                          title="2h | 2:30 | 2.5 | 120m"
                        />
                      </td>
                    ))}
                    <td className="num strong">{fmtMinutes(rowMin)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} className="num strong">Daily total</td>
                {days.map(d => <td key={d} className="num strong">{fmtMinutes(dayTotal(d))}</td>)}
                <td className="num strong" style={{ fontSize: '0.95rem' }}>{fmtMinutes(weekTotal())}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {data.slices.length > 0 && (
        <div className="plan-totals">
          <div className="plan-h-title" style={{ fontSize: '0.9rem', marginBottom: 8 }}>This week by project (slice approval status)</div>
          <table className="plan-table">
            <thead><tr><th>Project</th><th className="num">Hours</th><th className="num">Cost</th><th>Status</th></tr></thead>
            <tbody>
              {data.slices.map(s => (
                <tr key={s._id}>
                  <td>{s.projectId.toString()}</td>
                  <td className="num">{(s.totalMinutes/60).toFixed(2)}h</td>
                  <td className="num">{formatINR(s.totalCostCents)}</td>
                  <td><span className={`plan-badge ${STATUS_BADGE[s.status]?.cls || 'plan-badge-draft'}`}>{STATUS_BADGE[s.status]?.label || s.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
