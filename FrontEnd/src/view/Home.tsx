import { ArrowDownRight, ArrowRight, BriefcaseBusiness, CalendarDays, CircleAlert, Clock3, Plus } from 'lucide-react';
import { Link } from 'react-router';

const week = [
  { day: '一', date: '23', hours: 8, state: 'done' },
  { day: '二', date: '24', hours: 8, state: 'done' },
  { day: '三', date: '25', hours: 8, state: 'done' },
  { day: '四', date: '26', hours: 8, state: 'today' },
  { day: '五', date: '27', hours: 0, state: 'empty' },
];

function Home() {
  return (
    <div className="home-page">
      <section className="page-heading home-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-dot" />星期四・11 月 26 日</div>
          <h1>工時總覽</h1>
          <p>掌握本週紀錄，快速補上還沒填寫的工作。</p>
        </div>
        <Link className="button button-primary" to="/worklogs"><Plus size={17} />新增工時</Link>
      </section>

      <section className="metric-grid" aria-label="本週工時摘要">
        <article className="metric-card metric-card-highlight">
          <div className="metric-top"><span>本週已記錄</span><span className="metric-icon"><Clock3 size={17} /></span></div>
          <div className="metric-value">32<span className="metric-unit">小時</span></div>
          <div className="metric-foot"><span>目標 40 小時</span><span className="metric-trend"><ArrowDownRight size={14} /> 8 小時待補</span></div>
          <div className="progress-track"><span style={{ width: '80%' }} /></div>
        </article>
        <article className="metric-card">
          <div className="metric-top"><span>今日已記錄</span><span className="metric-icon mint"><CalendarDays size={17} /></span></div>
          <div className="metric-value">5.5<span className="metric-unit">小時</span></div>
          <div className="metric-foot"><span>建議工作時數 8 小時</span><span className="metric-muted">尚差 2.5 小時</span></div>
        </article>
        <article className="metric-card">
          <div className="metric-top"><span>待確認草稿</span><span className="metric-icon amber"><CircleAlert size={17} /></span></div>
          <div className="metric-value">3<span className="metric-unit">筆</span></div>
          <div className="metric-foot"><span>確認後才會送出到 Jira</span><Link to="/worklogs">查看草稿 <ArrowRight size={13} /></Link></div>
        </article>
      </section>

      <section className="home-lower-grid">
        <article className="surface-card week-card">
          <div className="section-header">
            <div><div className="section-kicker">WEEKLY OVERVIEW</div><h2>本週工時</h2></div>
            <button className="text-button" type="button">11/23 — 11/27 <CalendarDays size={15} /></button>
          </div>
          <div className="week-days">
            {week.map((item) => (
              <div className={`week-day ${item.state}`} key={item.date}>
                <span className="week-day-label">{item.day}</span>
                <span className="week-day-date">{item.date}</span>
                <div className="week-bar-area"><span className="week-bar" style={{ height: `${Math.max(item.hours / 8 * 100, 4)}%` }} /></div>
                <span className="week-day-hours">{item.hours ? `${item.hours}h` : '—'}</span>
              </div>
            ))}
          </div>
          <div className="week-legend"><span><i className="legend-current" />今日</span><span><i className="legend-recorded" />已填寫</span><span><i className="legend-empty" />尚未填寫</span></div>
        </article>

        <article className="surface-card attention-card">
          <div className="section-header">
            <div><div className="section-kicker">NEEDS ATTENTION</div><h2>待處理事項</h2></div>
            <span className="count-pill">2</span>
          </div>
          <Link className="attention-item" to="/worklogs">
            <span className="attention-symbol amber-symbol"><Clock3 size={16} /></span>
            <span className="attention-copy"><strong>今日還有 2.5 小時待補</strong><small>工時紀錄・11 月 26 日</small></span>
            <ArrowRight size={16} />
          </Link>
          <Link className="attention-item" to="/worklogs">
            <span className="attention-symbol blue-symbol"><BriefcaseBusiness size={16} /></span>
            <span className="attention-copy"><strong>有 3 筆草稿等你確認</strong><small>確認後才會建立 Jira 工時</small></span>
            <ArrowRight size={16} />
          </Link>
          <div className="attention-note">假日與請假日不會列入未填提醒。</div>
        </article>
      </section>

      <section className="home-quick-row">
        <div><span className="quick-icon"><BriefcaseBusiness size={18} /></span><span><strong>需要補登工作？</strong><small>輸入一句話，整理成工時草稿再確認。</small></span></div>
        <Link className="button button-secondary" to="/worklogs">前往工時紀錄 <ArrowRight size={16} /></Link>
      </section>
      <div className="preview-footnote">畫面資料為介面示意，尚未連接 Jira 或 Google Calendar。</div>
    </div>
  );
}

export default Home;
