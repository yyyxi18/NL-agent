import { NavLink, Outlet, useLocation } from 'react-router';
import { BriefcaseBusiness, CalendarDays, ChevronDown, CircleHelp, FileText, Home, PenLine, Sparkles } from 'lucide-react';
import '../style/App.css';

const navigation = [
  { to: '/', label: '首頁', icon: Home, end: true },
  { to: '/reports', label: '結案報告製作', icon: FileText, soon: true },
  { to: '/sow', label: 'SOW 撰寫', icon: PenLine, soon: true },
  { to: '/worklogs', label: 'Jira 工時紀錄', icon: BriefcaseBusiness },
];

function App() {
  const location = useLocation();
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
          <div className="account-row">
            <div className="account-avatar">NL</div>
            <div className="account-copy"><strong>工作帳號</strong><span>登入功能待串接</span></div>
            <ChevronDown size={15} className="account-chevron" />
          </div>
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
            <div className="topbar-avatar">N</div>
          </div>
        </header>
        <div className="page-content"><Outlet /></div>
      </main>
    </div>
  );
}

export default App;
