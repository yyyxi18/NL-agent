import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { BriefcaseBusiness, CalendarDays, ChevronDown, CircleHelp, FileText, Home, PenLine, Sparkles } from 'lucide-react';
import '../style/App.css';

const navigation = [
  { to: '/', label: '首頁', icon: Home, end: true },
  { to: '/reports', label: '結案報告製作', icon: FileText, soon: true },
  { to: '/sow', label: 'SOW 撰寫', icon: PenLine, soon: true },
  { to: '/worklogs', label: 'Jira 工時紀錄', icon: BriefcaseBusiness },
];

type SignedInUser = { id: string; email: string; name?: string };
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1').replace(/\/$/, '');

function App() {
  const location = useLocation();
  const [user, setUser] = useState<SignedInUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE_URL}/auth/me`, { credentials: 'include' })
      .then((response) => response.ok ? response.json() as Promise<SignedInUser> : null)
      .then((profile) => setUser(profile))
      .catch(() => setUser(null))
      .finally(() => setAuthLoading(false));
  }, []);

  const handleAccountClick = async () => {
    if (!user) {
      window.location.assign(`${API_BASE_URL}/auth/google`);
      return;
    }
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
    } finally {
      setUser(null);
    }
  };

  const accountLabel = authLoading ? '確認登入狀態…' : user?.name || user?.email || '使用 Google 登入';
  const avatarLabel = user?.name?.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()
    || user?.email?.[0]?.toUpperCase() || 'N';
  const pageTitle = navigation.find((item) =>
    item.end ? location.pathname === item.to : location.pathname.startsWith(item.to),
  )?.label ?? '首頁';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink to="/" className="brand" aria-label="NL-agent 首頁">
          <span className="brand-mark"><Sparkles size={17} strokeWidth={2.2} /></span>
          <span>NL-agent</span>
        </NavLink>

        <div className="workspace-label">工作空間</div>
        <nav className="side-nav" aria-label="主要導覽">
          {navigation.map(({ to, label, icon: Icon, end, soon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}${soon ? ' nav-link-soon' : ''}`}
            >
              <Icon size={17} strokeWidth={1.8} />
              <span>{label}</span>
              {soon && <span className="nav-soon">待開發</span>}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="help-link" title="使用說明功能待開發">
            <CircleHelp size={17} strokeWidth={1.8} />
            <span>使用說明</span>
          </div>
          <button className="account-row account-action" type="button" onClick={handleAccountClick} disabled={authLoading} aria-label={user ? '登出 Google 帳號' : '使用 Google 登入'}>
            <span className="account-avatar">{user ? avatarLabel : 'NL'}</span>
            <span className="account-copy"><strong>{user?.name || '工作帳號'}</strong><span>{user ? user.email : accountLabel}</span></span>
            <ChevronDown size={15} className="account-chevron" />
          </button>
        </div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div className="breadcrumb"><span>NL-agent</span><span className="breadcrumb-slash">/</span><strong>{pageTitle}</strong></div>
          <div className="topbar-right">
            <span className="preview-status"><i />介面預覽</span>
            <span className="topbar-divider" />
            <button className="icon-button" type="button" aria-label="開啟行事曆">
              <CalendarDays size={17} strokeWidth={1.8} />
            </button>
            <button className="topbar-avatar account-action" type="button" onClick={handleAccountClick} disabled={authLoading} aria-label={user ? '登出 Google 帳號' : '使用 Google 登入'} title={user ? `${user.email}（點擊登出）` : '使用 Google 登入'}>{avatarLabel}</button>
          </div>
        </header>
        <div className="page-content"><Outlet /></div>
      </main>
    </div>
  );
}

export default App;
