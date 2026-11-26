import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CalendarDays, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, Edit3, FileClock, MessageCircle, Plus, Send, Sparkles, Trash2, X } from 'lucide-react';

type Draft = { id: number; project: string; hours: number; summary: string; source: 'Calendar' | '手動補登'; };

type CalendarEvent = {
  id: number;
  time: string;
  title: string;
  project: string;
  hours: number;
  confidence: 'high' | 'uncertain' | 'skip';
  skipReason?: string;
};

const calendarEvents: CalendarEvent[] = [
  { id: 1, time: '09:00 – 10:00', title: 'Sprint Planning', project: 'ACME-12', hours: 1, confidence: 'high' },
  { id: 2, time: '10:00 – 11:30', title: 'API Review', project: 'GLOBEX-5', hours: 1.5, confidence: 'high' },
  { id: 3, time: '13:00 – 14:00', title: '午餐 - David', project: '', hours: 1, confidence: 'uncertain' },
  { id: 4, time: '14:00 – 15:00', title: '1:1 Manager', project: '', hours: 1, confidence: 'skip', skipReason: '非專案會議' },
  { id: 5, time: '18:30 – 19:30', title: '瑜珈課', project: '', hours: 1, confidence: 'skip', skipReason: '私人行程' },
];

const initialDrafts: Draft[] = [
  { id: 11, project: 'ACME-12', hours: 1, summary: 'Sprint Planning', source: 'Calendar' },
  { id: 12, project: 'GLOBEX-5', hours: 1.5, summary: 'API Review', source: 'Calendar' },
  { id: 13, project: 'ACME-1', hours: 5.5, summary: '開發與測試', source: '手動補登' },
];

type DayWorklog = { project: string; hours: number; summary: string; };

// 2026 台灣國定假日 (11月沒有國定假日，加幾個示意)
const holidays: Record<string, string> = {
  '2026-01-01': '元旦',
  '2026-01-29': '除夕',
  '2026-01-30': '春節',
  '2026-01-31': '春節',
  '2026-02-01': '春節',
  '2026-02-02': '春節',
  '2026-02-28': '和平紀念日',
  '2026-04-04': '兒童節',
  '2026-04-05': '清明節',
  '2026-05-01': '勞動節',
  '2026-06-19': '端午節',
  '2026-09-25': '中秋節',
  '2026-10-10': '國慶日',
  '2026-10-11': '國慶日(補假)',
};

const dayWorklogs: Record<number, DayWorklog[]> = {
  2: [{ project: 'ACME-1', hours: 4, summary: '功能開發' }, { project: 'GLOBEX-5', hours: 4, summary: 'API 設計' }],
  3: [{ project: 'ACME-1', hours: 6, summary: '功能開發' }, { project: 'ACME-12', hours: 2, summary: 'Sprint Review' }],
  4: [{ project: 'GLOBEX-5', hours: 5, summary: 'API 測試' }, { project: 'ACME-1', hours: 3, summary: 'Code Review' }],
  5: [{ project: 'ACME-1', hours: 4, summary: '功能開發' }, { project: 'GLOBEX-5', hours: 4, summary: 'POC 展示' }],
  6: [{ project: 'ACME-12', hours: 3, summary: 'Sprint Planning' }, { project: 'ACME-1', hours: 5, summary: '功能開發' }],
  9: [{ project: 'ACME-1', hours: 8, summary: '功能開發與測試' }],
  10: [{ project: 'GLOBEX-5', hours: 4, summary: 'API 開發' }, { project: 'ACME-1', hours: 4, summary: 'Bug 修復' }],
  11: [{ project: 'ACME-1', hours: 6, summary: '功能開發' }, { project: 'ACME-12', hours: 2, summary: 'Backlog Grooming' }],
  12: [{ project: 'GLOBEX-5', hours: 8, summary: 'API 整合測試' }],
  13: [{ project: 'ACME-1', hours: 4, summary: '功能開發' }, { project: 'GLOBEX-5', hours: 4, summary: '文件撰寫' }],
  16: [{ project: 'ACME-1', hours: 8, summary: '功能開發' }],
  17: [{ project: 'GLOBEX-5', hours: 5, summary: 'API Review' }, { project: 'ACME-1', hours: 3, summary: 'Code Review' }],
  18: [{ project: 'ACME-1', hours: 8, summary: '功能開發與測試' }],
  19: [{ project: 'ACME-12', hours: 2, summary: 'Sprint Review' }, { project: 'ACME-1', hours: 6, summary: '功能開發' }],
  20: [{ project: 'ACME-1', hours: 4, summary: '功能開發' }, { project: 'GLOBEX-5', hours: 4, summary: 'API 文件' }],
  23: [{ project: 'ACME-1', hours: 8, summary: '功能開發' }],
  24: [{ project: 'GLOBEX-5', hours: 4, summary: 'API 開發' }, { project: 'ACME-1', hours: 4, summary: 'Bug 修復' }],
  25: [{ project: 'ACME-1', hours: 6, summary: '功能開發' }, { project: 'ACME-12', hours: 2, summary: 'Backlog Grooming' }],
};

const monthDays = Array.from({ length: 42 }, (_, index) => {
  const dateValue = new Date(2026, 9, 26 + index);
  const date = dateValue.getDate();
  const inNovember = dateValue.getMonth() === 10;
  const today = inNovember && date === 26;
  const isWeekend = dateValue.getDay() === 0 || dateValue.getDay() === 6;
  const dateKey = `${dateValue.getFullYear()}-${String(dateValue.getMonth() + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
  const holidayName = holidays[dateKey];
  const isHoliday = !!holidayName;
  const isWorkday = !isWeekend && !isHoliday;
  const worklogs = inNovember ? dayWorklogs[date] : undefined;
  const totalHours = worklogs ? worklogs.reduce((s, w) => s + w.hours, 0) : 0;
  const hoursLabel = today ? '5.5h' : inNovember && isWorkday && totalHours > 0 ? `${totalHours}h` : '—';
  return { date, hours: hoursLabel, totalHours, today, muted: !inNovember, isWorkday, isWeekend, isHoliday, holidayName, worklogs };
});

function Worklogs() {
  const [drafts, setDrafts] = useState(initialDrafts);
  const [selectedEvents, setSelectedEvents] = useState<number[]>([1, 2]);
  const [uncertainDecisions, setUncertainDecisions] = useState<Record<number, 'work' | 'skip'>>({});
  const [command, setCommand] = useState('');
  const [message, setMessage] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState(26);
  const [showSkipped, setShowSkipped] = useState(false);
  const [showOverview, setShowOverview] = useState(true);
  const [overviewMode, setOverviewMode] = useState<'week' | 'month'>('week');
  const totalHours = useMemo(() => drafts.reduce((total, draft) => total + draft.hours, 0), [drafts]);

  const highConfidence = calendarEvents.filter((e) => e.confidence === 'high');
  const uncertain = calendarEvents.filter((e) => e.confidence === 'uncertain');
  const skipped = calendarEvents.filter((e) => e.confidence === 'skip');

  const toggleEvent = (id: number) => {
    setSelectedEvents((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const handleUncertainDecision = (id: number, decision: 'work' | 'skip') => {
    setUncertainDecisions((prev) => ({ ...prev, [id]: decision }));
    if (decision === 'work') {
      setSelectedEvents((current) => current.includes(id) ? current : [...current, id]);
    } else {
      setSelectedEvents((current) => current.filter((item) => item !== id));
    }
  };

  const addCalendarSuggestions = () => {
    const additions = calendarEvents
      .filter((event) => selectedEvents.includes(event.id))
      .filter((event) => !drafts.some((draft) => draft.source === 'Calendar' && draft.summary === event.title))
      .map((event) => ({ id: Date.now() + event.id, project: event.project || '待選票卡', hours: event.hours, summary: event.title, source: 'Calendar' as const }));
    setDrafts((current) => [...current, ...additions]);
    setMessage(additions.length ? `已將 ${additions.length} 筆行程加入草稿。` : '選取的行程已在草稿中。');
  };

  const updateHours = (id: number, hours: number) => {
    if (!Number.isFinite(hours) || hours <= 0) return;
    setDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, hours } : draft));
  };

  const addManualDraft = () => {
    if (!command.trim()) return;
    setDrafts((current) => [...current, { id: Date.now(), project: '待選票卡', hours: 1, summary: command.trim(), source: '手動補登' }]);
    setCommand('');
    setMessage('已新增一筆待確認草稿；專案、時數與票卡仍需確認。');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      addManualDraft();
    }
  };

  return (
    <div className="worklog-page">
      <section className="page-heading worklog-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-dot" />工時管理</div>
          <h1>Jira 工時紀錄</h1>
          <p>整理日曆建議與手動補登，確認後再送出。</p>
        </div>
        <div className="date-switcher"><button type="button" aria-label="前一天" disabled><ChevronLeft size={17} /></button><span><CalendarDays size={16} />今天・11/26（四）</span><button type="button" aria-label="後一天" disabled><ChevronRight size={17} /></button></div>
      </section>

      <section className="worklog-summary-strip">
        <div className="summary-week"><span className="summary-label">本週進度</span><strong>32<span>/40</span><small>小時</small></strong><div className="mini-progress"><i /></div></div>
        <div className="summary-divider" />
        <div className="summary-day"><span className="summary-label">今日已排入</span><strong>{totalHours}<small>小時</small></strong></div>
        <div className="summary-callout"><Clock3 size={16} /><span>建議工作時數 8 小時</span><strong>還差 {Math.max(8 - totalHours, 0)} 小時</strong></div>
      </section>

      {/* Calendar + Drafts side by side on wide screens */}
      <div className="worklog-two-col">
        <section className="work-section calendar-section">
          <div className="section-heading-row">
            <div className="section-title-wrap"><span className="section-icon calendar-icon"><CalendarDays size={17} /></span><div><h2>行事曆建議</h2><p>AI 自動分析</p></div></div>
            <span className="connection-label"><i />示意資料</span>
          </div>

          {highConfidence.length > 0 && (
            <div className="calendar-group">
              <div className="calendar-group-header"><Check size={13} className="confidence-high-icon" /><span className="confidence-label confidence-high">自動勾選</span></div>
              <div className="calendar-suggestion-list">
                {highConfidence.map((event) => (
                  <label className="calendar-suggestion" key={event.id}>
                    <input type="checkbox" checked={selectedEvents.includes(event.id)} onChange={() => toggleEvent(event.id)} />
                    <span className="suggestion-check"><Check size={12} /></span>
                    <span className="suggestion-time">{event.time}</span>
                    <span className="suggestion-title">{event.title}</span>
                    <span className="suggestion-project">{event.project}</span>
                    <span className="suggestion-hours">{event.hours}h</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {uncertain.length > 0 && (
            <div className="calendar-group">
              <div className="calendar-group-header"><CircleHelp size={13} className="confidence-uncertain-icon" /><span className="confidence-label confidence-uncertain">請你決定</span></div>
              <div className="calendar-suggestion-list uncertain-list">
                {uncertain.map((event) => {
                  const decision = uncertainDecisions[event.id];
                  return (
                    <div className={`calendar-suggestion uncertain-suggestion ${decision ? 'decided' : ''}`} key={event.id}>
                      <span className="suggestion-time">{event.time}</span>
                      <span className="suggestion-title">{event.title}</span>
                      {!decision ? (
                        <span className="uncertain-actions">
                          <button className="uncertain-btn work-btn" type="button" onClick={() => handleUncertainDecision(event.id, 'work')}>工作</button>
                          <button className="uncertain-btn skip-btn" type="button" onClick={() => handleUncertainDecision(event.id, 'skip')}>跳過</button>
                        </span>
                      ) : (
                        <span className={`uncertain-decided ${decision}`}>
                          {decision === 'work' ? '✓ 列入' : '已跳過'}
                          <button className="undo-decision" type="button" onClick={() => {
                            setUncertainDecisions((prev) => { const next = { ...prev }; delete next[event.id]; return next; });
                            setSelectedEvents((current) => current.filter((item) => item !== event.id));
                          }}><X size={12} /></button>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {skipped.length > 0 && (
            <div className="calendar-group">
              <button className="collapsible-header" type="button" onClick={() => setShowSkipped(!showSkipped)}>
                <span className="confidence-label confidence-skip"><X size={13} className="confidence-skip-icon" /> 已跳過 {skipped.length} 筆</span>
                <ChevronDown size={14} className={`collapse-chevron ${showSkipped ? 'open' : ''}`} />
              </button>
              {showSkipped && (
                <div className="calendar-suggestion-list skipped-list">
                  {skipped.map((event) => (
                    <div className="calendar-suggestion skipped" key={event.id}>
                      <span className="suggestion-time">{event.time}</span>
                      <span className="suggestion-title">{event.title}</span>
                      <span className="skip-reason">{event.skipReason}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="calendar-actions">
            <span>你的選擇會被記住</span>
            <button className="small-text-button" type="button" onClick={addCalendarSuggestions}><Plus size={14} />加入草稿</button>
          </div>
        </section>

        <section className="work-section draft-section">
          <div className="section-heading-row">
            <div className="section-title-wrap"><span className="section-icon draft-icon"><FileClock size={17} /></span><div><h2>今日草稿</h2><p>確認後送出</p></div></div>
            <div className="draft-total"><strong>{totalHours}h</strong><span className="draft-ready"><Check size={12} /></span></div>
          </div>
          {drafts.length ? <div className="draft-table-wrap">
            <table className="draft-table">
              <thead><tr><th>票卡</th><th>內容</th><th>時數</th><th><span className="sr-only">操作</span></th></tr></thead>
              <tbody>{drafts.map((draft) => (
                <tr key={draft.id}>
                  <td><span className={`project-dot ${draft.project === '待選票卡' ? 'project-dot-pending' : ''}`} />{draft.project}</td>
                  <td>{draft.summary}</td>
                  <td>{editingId === draft.id ? <input className="hours-input" type="number" min="0.25" step="0.25" value={draft.hours} onChange={(event) => updateHours(draft.id, Number(event.target.value))} onBlur={() => setEditingId(null)} aria-label="編輯工時" autoFocus /> : `${draft.hours}h`}</td>
                  <td className="draft-actions"><button type="button" aria-label={`編輯 ${draft.summary}`} onClick={() => setEditingId(draft.id)}><Edit3 size={14} /></button><button type="button" aria-label={`移除 ${draft.summary}`} onClick={() => setDrafts((current) => current.filter((item) => item.id !== draft.id))}><Trash2 size={14} /></button></td>
                </tr>
              ))}</tbody>
            </table>
          </div> : <div className="empty-drafts"><FileClock size={20} /><span>草稿是空的，加入日曆建議或手動補登。</span></div>}

          <div className="inline-composer">
            <Sparkles size={14} className="inline-composer-icon" />
            <input id="worklog-command" value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={handleKeyDown} placeholder="輸入一句話補登，按 Enter 送出" />
            <button className="inline-send" type="button" onClick={addManualDraft} disabled={!command.trim()}><Send size={14} /></button>
          </div>
        </section>
      </div>

      <section className="work-section overview-section">
        <div className="section-heading-row">
          <button className="collapsible-header" type="button" onClick={() => setShowOverview(!showOverview)} style={{ flex: 1 }}>
            <div className="section-title-wrap"><span className="section-icon month-icon"><CalendarDays size={17} /></span><div><h2>工時總覽</h2></div></div>
            <ChevronDown size={16} className={`collapse-chevron ${showOverview ? 'open' : ''}`} />
          </button>
          {showOverview && (
            <div className="overview-tabs">
              <button className={`overview-tab ${overviewMode === 'week' ? 'active' : ''}`} type="button" onClick={() => setOverviewMode('week')}>本週</button>
              <button className={`overview-tab ${overviewMode === 'month' ? 'active' : ''}`} type="button" onClick={() => setOverviewMode('month')}>本月</button>
            </div>
          )}
        </div>

        {showOverview && overviewMode === 'week' && (() => {
          const weekDays = [
            { label: '一', date: 23, fullDate: '11/23' },
            { label: '二', date: 24, fullDate: '11/24' },
            { label: '三', date: 25, fullDate: '11/25' },
            { label: '四', date: 26, fullDate: '11/26' },
            { label: '五', date: 27, fullDate: '11/27' },
            { label: '六', date: 28, fullDate: '11/28' },
            { label: '日', date: 29, fullDate: '11/29' },
          ];
          const weekTotal = weekDays.reduce((sum, d) => {
            if (d.date === 26) return sum + 5.5;
            const wl = dayWorklogs[d.date];
            return sum + (wl ? wl.reduce((s, w) => s + w.hours, 0) : 0);
          }, 0);
          return (
            <>
              <div className="week-header-row">
                <div className="month-switcher"><button type="button" disabled><ChevronLeft size={16} /></button><strong>11/23 — 11/29</strong><button type="button" disabled><ChevronRight size={16} /></button></div>
                <span className="week-total-label">{weekTotal} / 40h</span>
              </div>
              <div className="week-grid">
                {weekDays.map((d) => {
                  const isToday = d.date === 26;
                  const isWeekend = d.label === '六' || d.label === '日';
                  const wl = d.date === 26 ? undefined : dayWorklogs[d.date];
                  const hrs = isToday ? 5.5 : wl ? wl.reduce((s, w) => s + w.hours, 0) : 0;
                  const isSelected = d.date === selectedDate;
                  const needsFill = !isWeekend && !isToday && hrs === 0;
                  return (
                    <button
                      className={`week-cell${isToday ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}${isWeekend ? ' is-off' : ''}${needsFill ? ' needs-fill' : ''}`}
                      type="button"
                      key={d.date}
                      onClick={() => setSelectedDate(d.date)}
                    >
                      <span className="week-cell-label">{d.label}</span>
                      <span className="week-cell-date">{d.date}</span>
                      <div className="week-cell-bar-area"><span className="week-cell-bar" style={{ height: `${Math.max(hrs / 8 * 100, 4)}%` }} /></div>
                      <span className="week-cell-hours">{isWeekend ? '休' : hrs > 0 ? `${hrs}h` : '—'}</span>
                    </button>
                  );
                })}
              </div>
              {(() => {
                const sel = weekDays.find((d) => d.date === selectedDate);
                if (!sel) return null;
                const isToday = sel.date === 26;
                const isWeekend = sel.label === '六' || sel.label === '日';
                const wl = dayWorklogs[sel.date];
                const hrs = isToday ? 5.5 : wl ? wl.reduce((s, w) => s + w.hours, 0) : 0;
                return (
                  <div className="selected-day-panel">
                    <div className="selected-day-header">
                      <strong>{sel.fullDate} ({sel.label})</strong>
                      {isWeekend && <span className="day-off-tag">休息日</span>}
                      {!isWeekend && <span className="day-hours-tag">{hrs} / 8h</span>}
                    </div>
                    {isWeekend ? (
                      <div className="day-detail-empty">週末，不需填寫工時</div>
                    ) : wl && wl.length > 0 ? (
                      <div className="day-detail-list">
                        {wl.map((w, i) => (
                          <div className="day-detail-row" key={i}>
                            <span className="day-detail-project"><span className="project-dot" />{w.project}</span>
                            <span className="day-detail-summary">{w.summary}</span>
                            <span className="day-detail-hours">{w.hours}h</span>
                          </div>
                        ))}
                      </div>
                    ) : isToday ? (
                      <div className="day-detail-list">
                        <div className="day-detail-info">草稿尚未送出，確認後會顯示在這裡</div>
                      </div>
                    ) : (
                      <div className="day-detail-empty">尚未記錄工時</div>
                    )}
                  </div>
                );
              })()}
              <div className="month-legend"><span><i className="legend-filled" />有工時</span><span><i className="legend-empty-day" />尚未填寫</span><span><i className="legend-off" />週末</span></div>
            </>
          );
        })()}

        {showOverview && overviewMode === 'month' && (
          <>
            <div className="month-switcher-row">
              <div className="month-switcher"><button type="button" disabled><ChevronLeft size={16} /></button><strong>2026 年 11 月</strong><button type="button" disabled><ChevronRight size={16} /></button></div>
              <span className="week-total-label">152 / 176h</span>
            </div>
            <div className="month-calendar">
              {['一', '二', '三', '四', '五', '六', '日'].map((day) => <span className="month-weekday" key={day}>{day}</span>)}
              {monthDays.map((item, index) => {
                const isSelected = item.date === selectedDate && !item.muted;
                const needsFill = !item.muted && item.isWorkday && !item.today && item.hours === '—' && item.date < 26;
                return (
                  <button
                    className={`month-day${item.today ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}${item.muted ? ' is-muted' : ''}${(item.isWeekend || item.isHoliday) && !item.muted ? ' is-off' : ''}${needsFill ? ' needs-fill' : ''}${item.hours === '—' ? ' no-hours' : ''}`}
                    type="button"
                    key={`${item.date}-${index}`}
                    disabled={item.muted}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedDate(item.date)}
                    title={item.holidayName || undefined}
                  >
                    <span>{item.date}</span>
                    <small>{item.isHoliday && !item.muted ? '假' : item.isWeekend && !item.muted ? '休' : item.hours}</small>
                  </button>
                );
              })}
            </div>
            {(() => {
              const sel = monthDays.find((item) => item.date === selectedDate && !item.muted);
              if (!sel) return null;
              const worklogs = sel.worklogs;
              const isToday = sel.today;
              const isOff = sel.isWeekend || sel.isHoliday;
              return (
                <div className="selected-day-panel">
                  <div className="selected-day-header">
                    <strong>11/{selectedDate}</strong>
                    {sel.holidayName && <span className="day-holiday-tag">{sel.holidayName}</span>}
                    {isOff && !sel.holidayName && <span className="day-off-tag">休息日</span>}
                    {!isOff && <span className="day-hours-tag">{isToday ? '5.5 / 8h' : sel.totalHours > 0 ? `${sel.totalHours} / 8h` : '0 / 8h'}</span>}
                  </div>
                  {isOff ? (
                    <div className="day-detail-empty">{sel.holidayName || '週末'}，不需填寫工時</div>
                  ) : worklogs && worklogs.length > 0 ? (
                    <div className="day-detail-list">
                      {worklogs.map((w, i) => (
                        <div className="day-detail-row" key={i}>
                          <span className="day-detail-project"><span className="project-dot" />{w.project}</span>
                          <span className="day-detail-summary">{w.summary}</span>
                          <span className="day-detail-hours">{w.hours}h</span>
                        </div>
                      ))}
                    </div>
                  ) : isToday ? (
                    <div className="day-detail-list">
                      <div className="day-detail-info">草稿尚未送出，確認後會顯示在這裡</div>
                    </div>
                  ) : (
                    <div className="day-detail-empty">尚未記錄工時</div>
                  )}
                </div>
              );
            })()}
            <div className="month-legend"><span><i className="legend-filled" />有工時</span><span><i className="legend-empty-day" />尚未填寫</span><span><i className="legend-off" />假日/週末</span><span className="holiday-note"><AlertTriangle size={13} />依 Nextlink 工作日曆</span></div>
          </>
        )}
      </section>

      <div className="sticky-submit-bar">
        <div className="sticky-submit-inner">
          <span className="draft-security"><CheckCheck size={15} />確認前不會寫入 Jira</span>
          <div className="sticky-submit-right">
            <span className="sticky-total">{drafts.length} 筆・<strong>{totalHours}h</strong></span>
            <button className="button button-primary" type="button" disabled={!drafts.length} onClick={() => setShowConfirm(true)}>確認送出 <ArrowRight size={16} /></button>
          </div>
        </div>
      </div>

      {message && <div className="toast-message" role="status">{message}<button type="button" onClick={() => setMessage('')} aria-label="關閉">×</button></div>}
      {showConfirm && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowConfirm(false); }}><section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><span className="modal-icon"><AlertTriangle size={21} /></span><h2 id="confirm-title">目前尚未連接 Jira</h2><p>這是介面示意資料。送出功能會在 Jira API、權限檢查與確認流程完成後啟用；目前不會建立或更新任何 Jira 工時。</p><div className="modal-summary"><span>目前草稿</span><strong>{drafts.length} 筆・{totalHours} 小時</strong></div><button className="button button-primary modal-close" type="button" onClick={() => setShowConfirm(false)}>知道了</button></section></div>}
      <div className="preview-footnote">介面預覽資料不會送到 Jira；Calendar 與 AI 解析 API 尚未串接。</div>
    </div>
  );
}

export default Worklogs;
