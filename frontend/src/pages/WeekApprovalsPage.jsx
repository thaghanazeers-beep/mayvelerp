import { useEffect, useState } from 'react';
import { useTeamspace } from '../context/TeamspaceContext';
import { getWeekApprovalQueue, approveSlice, rejectSlice, formatINR } from '../api';
import './PlanPages.css';

export default function WeekApprovalsPage() {
  const { activeTeamspaceId } = useTeamspace();
  const [slices, setSlices] = useState([]);
  const [busy, setBusy]     = useState(false);
  const [showReject, setShowReject] = useState(null);   // slice id
  const [reason, setReason] = useState('');

  const reload = async () => {
    const r = await getWeekApprovalQueue();
    setSlices(r.data);
  };
  useEffect(() => { reload(); }, [activeTeamspaceId]);

  const doApprove = async (s) => {
    if (!confirm(`Approve ${(s.totalMinutes/60).toFixed(1)}h on ${s.projectId.name} for ${s.userId.name}?`)) return;
    setBusy(true);
    try { await approveSlice(s._id); await reload(); }
    catch (e) { alert(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  };
  const doReject = async () => {
    if (reason.trim().length < 10) return alert('Reason must be at least 10 characters');
    setBusy(true);
    try { await rejectSlice(showReject, reason); setShowReject(null); setReason(''); await reload(); }
    catch (e) { alert(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="plan-page">
      <div className="plan-toolbar">
        <h2 style={{ margin: 0 }}>Week Approvals</h2>
        <span className="muted">{slices.length} pending</span>
      </div>

      {slices.length === 0 ? (
        <div className="plan-empty">
          <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
          <p>No pending weekly time submissions for projects you own.</p>
        </div>
      ) : (
        <div className="plan-approval-list">
          {slices.map(s => (
            <div key={s._id} className="plan-approval-card" style={{ cursor: 'default' }}>
              <div className="plan-approval-head">
                <div>
                  <div className="plan-approval-title">
                    {s.projectId?.icon} {s.projectId?.name} — Week of {new Date(s.weekStart).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                  <div className="muted">Submitted by <strong>{s.userId?.name}</strong> ({s.userId?.email})</div>
                </div>
                <div className="plan-approval-meta">
                  <div className="muted">{s.submittedAt ? new Date(s.submittedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : ''}</div>
                </div>
              </div>
              <div className="plan-approval-stats">
                <div><span className="muted">Hours</span> <strong>{(s.totalMinutes/60).toFixed(2)}h</strong></div>
                <div><span className="muted">Cost</span> <strong>{formatINR(s.totalCostCents)}</strong></div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => doApprove(s)}>✅ Approve</button>
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setShowReject(s._id); setReason(''); }}>❌ Reject…</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showReject && (
        <div className="modal-overlay" onClick={() => setShowReject(null)}>
          <div className="modal animate-in" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Reject this week</h2>
              <button className="btn-icon" onClick={() => setShowReject(null)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="modal-form">
              <p className="muted">The user will receive your reason. Minimum 10 characters.</p>
              <textarea className="input" rows={4} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Hours don't match what we discussed for this week — please re-submit." />
              <div className="modal-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => setShowReject(null)}>Cancel</button>
                <button className="btn btn-primary btn-sm" disabled={busy || reason.trim().length < 10} onClick={doReject}>Reject</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
