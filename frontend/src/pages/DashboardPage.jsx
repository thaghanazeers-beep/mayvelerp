import { useSearchParams } from 'react-router-dom';
import OverviewDashboard from './OverviewDashboard';
import TimeDashboardPage from './TimeDashboardPage';
import './DashboardPage.css';

const TABS = [
  { id: 'overview', label: 'Overview',       hint: 'Tasks · Sprints · Team performance' },
  { id: 'finance',  label: 'Finance & Time', hint: 'Plans · P&L · Budget vs Actual' },
];

export default function DashboardPage() {
  const [search, setSearch] = useSearchParams();
  const active = TABS.find(t => t.id === search.get('tab'))?.id || 'overview';
  const setTab = (id) => {
    const next = new URLSearchParams(search);
    if (id === 'overview') next.delete('tab'); else next.set('tab', id);
    setSearch(next, { replace: true });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12, maxWidth: 1280, margin: '0 auto', width: '100%' }}>
      <div className="dash-tabs" role="tablist">
        {TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            className={`dash-tab ${active === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
            title={t.hint}
          >
            <span className="dash-tab-label">{t.label}</span>
            <span className="dash-tab-hint">{t.hint}</span>
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {active === 'overview' && <OverviewDashboard />}
        {active === 'finance'  && <TimeDashboardPage />}
      </div>
    </div>
  );
}
