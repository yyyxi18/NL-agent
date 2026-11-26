import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CalendarDays, Check, CheckCheck, ChevronLeft, ChevronRight, CircleHelp, Clock3, Edit3, FileClock, MessageCircle, Plus, Send, Sparkles, Trash2 } from 'lucide-react';

type Draft = { id: number; project: string; hours: number; summary: string; source: 'Calendar' | '手動補登'; };

const calendarEvents = [
  { id: 1, time: '09:00 – 10:00', title: 'Sprint Planning', project: 'ACME-12', hours: 1 },
  { id: 2, time: '10:00 – 11:30', title: 'API Review', project: 'GLOBEX-5', hours: 1.5 },
  { id: 3, time: '14:00 – 15:00', title: '1:1 Manager', project: '略過', hours: 1 },
];

const initialDrafts: Draft[] = [
  { id: 11, project: 'ACME-12', hours: 1, summary: 'Sprint Planning', source: 'Calendar' },
  { id: 12, project: 'GLOBEX-5', hours: 1.5, summary: 'API Review', source: 'Calendar' },
  { id: 13, project: 'ACME-1', hours: 5.5, summary: '開發與測試', source: '手動補登' },
];

const monthDays = Array.from({ length: 42 }, (_, index) => {
  const dateValue = new Date(2026, 9, 26 + index);
  const date = dateValue.getDate();
  const inNovember = dateValue.getMonth() === 10;
  const today = inNovember && date === 26;
  const isWorkday = dateValue.getDay() > 0 && dateValue.getDay() < 6;
  return { date, hours: today ? '5.5h' : inNovember && isWorkday ? '8h' : '—', today, muted: !inNovember, isWorkday };
});

function Worklogs() {
  const [drafts, setDrafts] = useState(initialDrafts);
  const [selectedEvents, setSelectedEvents] = useState<number[]>([1, 2]);
  const [command, setCommand] = useState('');
  const [message, setMessage] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState(26);
  const totalHours = useMemo(() => drafts.reduce((total, draft) => total + draft.hours, 0), [drafts]);

  const toggleEvent = (id: number) => {
    setSelectedEvents((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const addCalendarSuggestions = () => {
    const additions = calendarEvents
      .filter((event) => selectedEvents.includes(event.id))
      .filter((event) => !drafts.some((draft) => draft.source === 'Calendar' && draft.summary === event.title))
      .map((event) => ({ id: Date.now() + event.id, project: event.project, hours: event.hours, summary: event.title, source: 'Calendar' as const }));
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

  return (
    <div className="worklog-page">
      <section className="page-heading worklog-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-dot" />工時管理</div>
          <h1>Jira 工時紀錄</h1>
          <p>整理日曆建議與手動補登，確認後再送出。</p>
        </div>
        <div className="date-switcher"><button type="button" aria-label="日期切換待串接" disabled><ChevronLeft size={17} /></button><span><CalendarDays size={16} />今天・11/26（四）</span><button type="button" aria-label="日期切換待串接" disabled><ChevronRight size={17} /></button></div>
      </section>

      <section className="worklog-summary-strip">
        <div className="summary-week"><span className="summary-label">本週進度</span><strong>32<span>/40</span><small>小時</small></strong><div className="mini-progress"><i /></div></div>
        <div className="summary-divider" />
        <div className="summary-day"><span className="summary-label">今日已排入</span><strong>{totalHours}<small>小時</small></strong></div>
        <div className="summary-callout"><Clock3 size={16} /><span>建議工作時數 8 小時</span><strong>還差 {Math.max(8 - totalHours, 0)} 小時</strong></div>
      </section>

      <section className="work-section calendar-section">
        <div className="section-heading-row">
          <div className="section-title-wrap"><span className="section-icon calendar-icon"><CalendarDays size={17} /></span><div><h2>Google Calendar 建議</h2><p>挑選可列入工時的行程</p></div></div>
          <span className="connection-label"><i />示意資料・尚未連結</span>
        </div>
        <div className="calendar-suggestion-list">
          {calendarEvents.map((event) => {
            const isSelected = selectedEvents.includes(event.id);
            const skip = event.project === '略過';
            return (
              <label className={`calendar-suggestion${skip ? ' skipped' : ''}`} key={event.id}>
                <input type="checkbox" checked={isSelected} disabled={skip} onChange={() => toggleEvent(event.id)} />
                <span className="suggestion-check"><Check size={12} /></span>
                <span className="suggestion-time">{event.time}</span>
                <span className="suggestion-title">{event.title}</span>
                <span className="suggestion-project">{event.project}</span>
                <span className="suggestion-hours">{skip ? '略過' : `${event.hours}h`}</span>
              </label>
            );
          })}
        </div>
        <div className="calendar-actions">
          <span>私人、全天或不確定事件預設不加入</span>
          <button className="small-text-button" type="button" onClick={addCalendarSuggestions}><Plus size={14} />加入今日草稿</button>
        </div>
      </section>

      <section className="work-section draft-section">
        <div className="section-heading-row">
          <div className="section-title-wrap"><span className="section-icon draft-icon"><FileClock size={17} /></span><div><h2>今日工時草稿</h2><p>檢查專案、時數與描述後再送出</p></div></div>
          <div className="draft-total"><span>{drafts.length} 筆</span><strong>合計 {totalHours}h</strong><span className="draft-ready"><Check size={12} /></span></div>
        </div>
        {drafts.length ? <div className="draft-table-wrap">
          <table className="draft-table">
            <thead><tr><th>專案／票卡</th><th>工作內容</th><th>來源</th><th>時數</th><th><span className="sr-only">操作</span></th></tr></thead>
            <tbody>{drafts.map((draft) => (
              <tr key={draft.id}>
                <td><span className={`project-dot ${draft.project === '待選票卡' ? 'project-dot-pending' : ''}`} />{draft.project}</td>
                <td>{draft.summary}</td>
                <td><span className="source-tag">{draft.source}</span></td>
                <td>{editingId === draft.id ? <input className="hours-input" type="number" min="0.25" step="0.25" value={draft.hours} onChange={(event) => updateHours(draft.id, Number(event.target.value))} onBlur={() => setEditingId(null)} aria-label="編輯工時" autoFocus /> : `${draft.hours}h`}</td>
                <td className="draft-actions"><button type="button" aria-label={`編輯 ${draft.summary}`} onClick={() => setEditingId(draft.id)}><Edit3 size={14} /></button><button type="button" aria-label={`移除 ${draft.summary}`} onClick={() => setDrafts((current) => current.filter((item) => item.id !== draft.id))}><Trash2 size={14} /></button></td>
              </tr>
            ))}</tbody>
          </table>
          <button className="add-row-button" type="button" onClick={() => { setCommand(''); document.getElementById('worklog-command')?.focus(); }}><Plus size={14} />新增手動工時</button>
        </div> : <div className="empty-drafts"><FileClock size={20} /><span>草稿清單目前是空的，加入日曆建議或手動補登。</span></div>}
        <div className="draft-footer">
          <span className="draft-security"><CheckCheck size={15} />確認前不會寫入 Jira</span>
          <button className="button button-primary" type="button" disabled={!drafts.length} onClick={() => setShowConfirm(true)}>檢視並確認 <ArrowRight size={16} /></button>
        </div>
      </section>

      <section className="work-section chat-section">
        <div className="section-heading-row">
          <div className="section-title-wrap"><span className="section-icon chat-icon"><MessageCircle size={17} /></span><div><h2>用一句話補登</h2><p>可在日曆建議之外補上其他工作</p></div></div>
          <span className="ai-label"><Sparkles size={14} />自然語言</span>
        </div>
        <div className="chat-composer">
          <textarea id="worklog-command" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="例如：今天在支付平台處理登入逾時問題 2 小時，補上重試機制測試" rows={2} />
          <button className="send-command" type="button" onClick={addManualDraft} disabled={!command.trim()}><Send size={15} /><span>加入草稿</span></button>
        </div>
        <div className="chat-footnote"><CircleHelp size={14} />新增內容會先列為草稿，專案、票卡與時數要確認後才可送出。</div>
      </section>

      <section className="work-section month-section">
        <div className="section-heading-row">
          <div className="section-title-wrap"><span className="section-icon month-icon"><CalendarDays size={17} /></span><div><h2>本月工時總覽</h2><p>點選日期查看每日明細</p></div></div>
          <div className="month-switcher"><button type="button" aria-label="月份切換待串接" disabled><ChevronLeft size={16} /></button><strong>2026 年 11 月</strong><button type="button" aria-label="月份切換待串接" disabled><ChevronRight size={16} /></button></div>
        </div>
        <div className="month-calendar">
          {['一', '二', '三', '四', '五', '六', '日'].map((day) => <span className="month-weekday" key={day}>{day}</span>)}
          {monthDays.map((item, index) => <button className={`month-day${item.today ? ' is-today' : ''}${item.date === selectedDate && !item.muted ? ' is-selected' : ''}${item.muted ? ' is-muted' : ''}${item.hours === '—' ? ' no-hours' : ''}`} type="button" key={`${item.date}-${index}`} disabled={item.muted} aria-pressed={item.date === selectedDate} onClick={() => setSelectedDate(item.date)}><span>{item.date}</span><small>{item.hours}</small></button>)}
        </div>
        <div className="selected-day-detail"><strong>11/{selectedDate}</strong><span>{selectedDate === 26 ? '5.5 小時已記錄，草稿尚未送出' : monthDays.find((item) => item.date === selectedDate && !item.muted)?.hours === '—' ? '目前沒有已記錄工時' : '8 小時已記錄'}</span></div>
        <div className="month-legend"><span><i className="legend-filled" />有工時</span><span><i className="legend-empty-day" />尚未填寫</span><span className="holiday-note"><AlertTriangle size={13} />假日依工作日曆計算</span></div>
      </section>

      {message && <div className="toast-message" role="status">{message}<button type="button" onClick={() => setMessage('')} aria-label="關閉">×</button></div>}
      {showConfirm && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowConfirm(false); }}><section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><span className="modal-icon"><AlertTriangle size={21} /></span><h2 id="confirm-title">目前尚未連接 Jira</h2><p>這是介面示意資料。送出功能會在 Jira API、權限檢查與確認流程完成後啟用；目前不會建立或更新任何 Jira 工時。</p><div className="modal-summary"><span>目前草稿</span><strong>{drafts.length} 筆・{totalHours} 小時</strong></div><button className="button button-primary modal-close" type="button" onClick={() => setShowConfirm(false)}>知道了</button></section></div>}
      <div className="preview-footnote">介面預覽資料不會送到 Jira；Calendar 與 AI 解析 API 尚未串接。</div>
    </div>
  );
}

export default Worklogs;
