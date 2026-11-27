import { useEffect, useId, useState, type Ref } from 'react';
import { Plus, Search } from 'lucide-react';

type Suggestion = { key: string; summary: string };
type Props = {
  apiBaseUrl: string;
  label?: string;
  inputRef?: Ref<HTMLInputElement>;
  cloudId: string;
  projectKey: string;
  value: string;
  selection: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onClear: () => void;
  onSelect: (suggestion: Suggestion | null) => void;
};

export default function WorklogIssueSearch({
  apiBaseUrl, label = '工時內容或 Jira 票卡關鍵字', inputRef, cloudId, projectKey, value, selection, disabled, onChange, onClear, onSelect,
}: Props) {
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [result, setResult] = useState<{ request: string; issues: Suggestion[]; error?: boolean }>();
  const query = value.trim();
  const request = new URLSearchParams({ cloudId, projectKey, query: query.slice(0, 120) }).toString();
  const open = focused && !composing && !selection && !disabled && Boolean(projectKey && query);
  const current = result?.request === request ? result : undefined;
  const issues = current?.issues ?? [];
  const canCreate = query.length <= 255 && Boolean(current && !current.error);
  const optionCount = issues.length + Number(canCreate);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(apiBaseUrl + '/jira/issues/suggestions?' + request, {
          credentials: 'include', signal: controller.signal,
        });
        if (!response.ok) throw new Error('Issue suggestions unavailable');
        const data = await response.json() as { issues: Suggestion[] };
        if (!controller.signal.aborted) setResult({ request, issues: data.issues });
      } catch {
        if (!controller.signal.aborted) setResult({ request, issues: [], error: true });
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [apiBaseUrl, open, request]);

  const choose = (index: number) => {
    onSelect(issues[index] ?? null);
    setActiveIndex(-1);
  };

  return <div className="worklog-search">
    <div className="worklog-search-input">
      <Search size={15} aria-hidden="true" />
      <input ref={inputRef} aria-label={label} type="text" autoComplete="off" maxLength={1000}
        role="combobox" aria-autocomplete="list" aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex >= 0 && activeIndex < optionCount ? listId + '-' + activeIndex : undefined}
        value={value} placeholder={selection ? '輸入工時內容' : '輸入工時內容或票卡關鍵字'}
        disabled={disabled}
        onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setActiveIndex(-1); }}
        onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
        onChange={(event) => { onChange(event.target.value); setActiveIndex(-1); setFocused(true); }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape' && open) {
            event.preventDefault();
            setFocused(false);
            setActiveIndex(-1);
          } else if (!selection && projectKey && query && event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setFocused(true);
          } else if (open && optionCount && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            const next = event.key === 'ArrowDown' ? (activeIndex + 1) % optionCount
              : activeIndex <= 0 ? optionCount - 1 : activeIndex - 1;
            setActiveIndex(next);
            document.getElementById(listId + '-' + next)?.scrollIntoView({ block: 'nearest' });
          } else if (open && event.key === 'Enter') {
            event.preventDefault();
            if (activeIndex >= 0 && activeIndex < optionCount) choose(activeIndex);
            else if (issues.length) choose(0);
          }
        }}
      />
    </div>
    {selection && <div className="worklog-search-selection">
      <span title={selection}>{selection}</span>
      <button type="button" onClick={onClear} disabled={disabled}>取消選取</button>
    </div>}
    {open && <div className="worklog-search-popup">
      {!issues.length && <p role="status">{!current ? '正在搜尋 Jira…' : current.error ? '搜尋失敗，請重新聚焦欄位重試。' : '沒有符合的 Jira 票卡'}</p>}
      <ul id={listId} role="listbox" aria-label="Jira 票卡建議">
        {issues.map((issue, index) => <li key={issue.key} id={listId + '-' + index} role="option" aria-selected={activeIndex === index}
          onMouseDown={(event) => event.preventDefault()} onClick={() => choose(index)}>
          <strong>{issue.key}</strong><span>{issue.summary}</span>
        </li>)}
        {canCreate && <li id={listId + '-' + issues.length} className="worklog-search-create" role="option" aria-selected={activeIndex === issues.length}
          onMouseDown={(event) => event.preventDefault()} onClick={() => choose(issues.length)}>
          <Plus size={15} aria-hidden="true" /><span>新增票卡「{query}」</span>
        </li>}
      </ul>
    </div>}
  </div>;
}
