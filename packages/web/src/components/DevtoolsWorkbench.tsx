import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DevToolsTelemetryEvent } from '@wha/core';
import { matchedNode, type RecordedEvent, type RecordingSession } from '../devtools/session.js';
import { useGrimoireStore } from '../store/useGrimoireStore.js';

interface Props {
  onClose: () => void;
  onFocusNode: (id: string) => void;
  onFocusDependency: (id: string) => void;
  onStartLocator?: () => Promise<{ locate: boolean; expiresAt: number }>;
}
type Tab = 'record' | 'compare' | 'vue' | 'libraries';
const bytes = (value: number) => `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KiB`;
const clock = (value: number) => new Date(value).toLocaleTimeString();
const duration = (event: DevToolsTelemetryEvent) => event.durationKind === 'unavailable' || event.type === 'DOM_UPDATE' ? '—' : `${event.durationMs.toFixed(1)} ms`;
const eventColor = (event: DevToolsTelemetryEvent) => event.type === 'LONG_TASK' ? '#bc4a30' : event.type === 'INTERACTION' ? '#4b80a3' : event.type === 'LOCATE' ? '#32916c' : event.type === 'RENDER' ? '#c18b2f' : '#9a85a8';
const eventTypeLabel = (event: DevToolsTelemetryEvent, ru: boolean) => ru ? ({ RENDER: 'обновление', DOM_UPDATE: 'изменение DOM', LONG_TASK: 'долгая задача', INTERACTION: 'действие', LOCATE: 'выбор элемента', STATE_MUTATION: 'изменение state', EFFECT_TRIGGER: 'вызов эффекта', HELLO: 'подключение' }[event.type]) : event.type.toLowerCase().replaceAll('_', ' ');
const mappingExplanation = (value: string, ru: boolean) => ({
  'node-id': ru ? 'ID узла' : 'node ID', manual: ru ? 'выбрано вручную' : 'manual choice', 'file-and-name': ru ? 'файл и имя' : 'file and name',
  'same-file-and-name': ru ? 'несколько узлов в файле' : 'multiple nodes in the file', 'unique-name': ru ? 'уникальное имя' : 'unique name',
  'parent-path': ru ? 'связь с родителем' : 'parent relationship', 'duplicate-name': ru ? 'имя повторяется' : 'duplicate name',
  'file-only': ru ? 'только файл' : 'file only', 'unknown-file-and-name': ru ? 'файл и имя не найдены' : 'file and name not found',
  'unknown-name': ru ? 'имя не найдено' : 'name not found',
}[value] || value);
const reasonLabel = (reason: string, ru: boolean) => {
  if (!ru) return reason;
  if (reason.startsWith('prop:')) { const [, name, change] = reason.split(':'); return `prop ${name}: ${change === 'identity' ? 'изменилась ссылка' : 'изменилось значение'}`; }
  if (reason === 'state changed') return 'изменилось state';
  if (reason === 'parent update observed') return 'наблюдалось обновление родителя';
  if (reason === 'trigger unknown') return 'триггер неизвестен';
  return reason;
};

export const DevtoolsWorkbench: React.FC<Props> = ({ onClose, onFocusNode, onFocusDependency, onStartLocator }) => {
  const store = useGrimoireStore();
  const { locale, nodes, graph, coverage, runtimeConnections, currentSession, savedSessions, buildSnapshots, locatorResult,
    recording, startRecording, stopRecording, clearRecording, importSession, resolveRuntime, resolveRecordedEvent, selectNode, selectDependency } = store;
  const ru = locale === 'ru';
  const label = (russian: string, english: string) => ru ? russian : english;
  const [tab, setTab] = useState<Tab>('record');
  const [sessionId, setSessionId] = useState('current');
  const [eventId, setEventId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');
  const [source, setSource] = useState('all');
  const [olderId, setOlderId] = useState('');
  const [newerId, setNewerId] = useState('');
  const [message, setMessage] = useState('');
  const [locatorStarted, setLocatorStarted] = useState(0);
  const [now, setNow] = useState(Date.now());
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 10000); return () => clearInterval(timer); }, []);

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', close, true);
    return () => window.removeEventListener('keydown', close, true);
  }, [onClose]);
  useEffect(() => {
    if (!locatorStarted) return;
    const timeout = window.setTimeout(() => {
      if (!locatorResult || locatorResult.event.timestamp < locatorStarted) setMessage(label('Время выбора истекло. Проверьте, что приложение запущено с обновлённым адаптером, и попробуйте ещё раз.', 'Picker timed out. Check that the app runs with the refreshed adapter, then try again.'));
    }, 31000);
    return () => clearTimeout(timeout);
  }, [locatorStarted, locatorResult, locale]);

  const session = sessionId === 'current' ? currentSession || savedSessions[0] : savedSessions.find((item) => item.id === sessionId) || currentSession || savedSessions[0];
  const entries = session?.events || [];
  const shown = useMemo(() => entries.filter((entry) => (kind === 'all' || entry.event.type === kind) && (source === 'all' || entry.event.source === source)
    && (!search || `${entry.event.componentName} ${entry.event.file || ''} ${entry.event.hierarchyPath?.join(' ') || ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())))
    .slice(-250).reverse(), [entries, kind, source, search]);
  const selected = entries.find((entry) => entry.id === eventId) || shown[0];
  const timeline = useMemo(() => {
    const grouped = new Map<string, { entry: RecordedEvent; count: number }>();
    for (const entry of entries) {
      const key = entry.event.type === 'RENDER' && entry.event.commitId != null
        ? `${entry.event.pageId || 'page'}:${entry.event.source || 'unknown'}:${entry.event.commitId}` : entry.id;
      const existing = grouped.get(key);
      if (existing) existing.count++;
      else grouped.set(key, { entry, count: 1 });
    }
    const values = [...grouped.values()];
    return values.length > 180 ? values.filter((_, index) => index % Math.ceil(values.length / 180) === 0) : values;
  }, [entries]);
  const span = Math.max(1, (session?.stoppedAt || Date.now()) - (session?.startedAt || Date.now()));
  const renderEntries = entries.filter((entry) => entry.event.type === 'RENDER');
  const mapped = renderEntries.filter((entry) => entry.match.nodeId).length;
  const episodes = useMemo(() => {
    const sorted = [...entries].sort((a, b) => a.event.timestamp - b.event.timestamp);
    return sorted.filter((entry) => entry.event.type === 'INTERACTION' && entry.event.durationKind !== 'event-timing').slice(-12).map((action) => {
      const following = sorted.filter((entry) => entry.event.pageId === action.event.pageId && entry.id !== action.id &&
        (action.event.interactionId && entry.event.interactionId === action.event.interactionId
          || entry.event.timestamp >= action.event.timestamp && entry.event.timestamp <= action.event.timestamp + 1000));
      return { action, renders: following.filter((entry) => entry.event.type === 'RENDER'), tasks: following.filter((entry) => entry.event.type === 'LONG_TASK') };
    }).reverse();
  }, [entries]);

  const older = savedSessions.find((item) => item.id === olderId) || savedSessions[1];
  const newer = savedSessions.find((item) => item.id === newerId) || savedSessions[0];
  const sessionMetrics = (value?: RecordingSession) => {
    const result = new Map<string, { count: number; total: number }>();
    for (const item of value?.events || []) {
      if (item.event.type !== 'RENDER' || item.event.changeReasons?.[0] === 'mount') continue;
      const key = item.match.nodeId || `${item.event.file || ''}#${item.event.componentName}`;
      const previous = result.get(key) || { count: 0, total: 0 };
      result.set(key, { count: previous.count + 1, total: previous.total + item.event.durationMs });
    }
    return result;
  };
  const beforeMetrics = useMemo(() => sessionMetrics(older), [older]);
  const afterMetrics = useMemo(() => sessionMetrics(newer), [newer]);
  const renderSources = (value?: RecordingSession) => [...new Set(value?.events.filter((item) => item.event.type === 'RENDER').map((item) => item.event.source || 'unknown') || [])].sort().join(', ');
  const sourceMismatch = Boolean(older && newer && renderSources(older) !== renderSources(newer));
  const comparison = [...new Set([...beforeMetrics.keys(), ...afterMetrics.keys()])].map((key) => ({
    key, before: beforeMetrics.get(key), after: afterMetrics.get(key), name: nodes.find((node) => node.id === key)?.name || key.split('#').at(-1) || key,
  })).sort((a, b) => Math.abs((b.after?.count || 0) - (b.before?.count || 0)) - Math.abs((a.after?.count || 0) - (a.before?.count || 0))).slice(0, 40);

  const vueLinks = useMemo(() => {
    const map = new Map<string, { targetId: string; key: string; tracked: Set<string>; triggered: Set<string> }>();
    for (const entry of entries) {
      if (entry.event.type !== 'RENDER') continue;
      const component = entry.match.nodeId || entry.event.componentName;
      for (const value of entry.event.reactiveTracked || []) {
        const id = `${entry.event.pageId}:${value.targetId}:${value.key}`;
        const record = map.get(id) || { targetId: value.targetId, key: value.key, tracked: new Set<string>(), triggered: new Set<string>() };
        record.tracked.add(component); map.set(id, record);
      }
      for (const value of entry.event.reactiveTriggers || []) {
        const id = `${entry.event.pageId}:${value.targetId}:${value.key}`;
        const record = map.get(id) || { targetId: value.targetId, key: value.key, tracked: new Set<string>(), triggered: new Set<string>() };
        record.triggered.add(component); map.set(id, record);
      }
    }
    return [...map.values()].sort((a, b) => b.triggered.size - a.triggered.size || b.tracked.size - a.tracked.size).slice(0, 50);
  }, [entries]);

  const currentBuild = buildSnapshots[0];
  const activeConnections = Object.values(runtimeConnections).filter((event) => now - event.timestamp < 90000);
  const connectedModes = [...new Set(activeConnections.map((event) => `${event.framework ? event.framework === 'vue' ? 'Vue 3' : 'React' : label('Приложение', 'App')} · ${event.source === 'fiber' ? label('компоненты', 'components') : event.source === 'adapter' ? label('адаптер', 'adapter') : label('браузер', 'browser')}`))];
  const previousBuild = buildSnapshots[1];
  const bundleRows = [...new Set([...Object.keys(currentBuild?.packages || {}), ...Object.keys(previousBuild?.packages || {})])].map((name) => ({
    name, current: currentBuild?.packages[name], previous: previousBuild?.packages[name],
  })).sort((a, b) => Math.abs((b.current?.bytes || 0) - (b.previous?.bytes || 0)) - Math.abs((a.current?.bytes || 0) - (a.previous?.bytes || 0)));

  const focus = (nodeId: string) => { selectNode(nodeId); onClose(); onFocusNode(nodeId); };
  const exportSession = () => {
    if (!session) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `grimoire-session-${session.id}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 2_000_000) { setMessage(label('Файл больше 2 МБ.', 'File exceeds 2 MB.')); return; }
    try {
      const value: unknown = JSON.parse(await file.text());
      if (!importSession(value)) throw new Error(label('Формат или проект не совпадают.', 'Invalid format or different project.'));
      setMessage(label('Сессия импортирована.', 'Session imported.'));
    } catch (error) { setMessage(String(error instanceof Error ? error.message : error)); }
    if (fileRef.current) fileRef.current.value = '';
  };
  const startLocator = async () => {
    if (!onStartLocator) return;
    try { await onStartLocator(); setLocatorStarted(Date.now()); setMessage(label('Перейдите в приложение и нажмите на элемент в течение 30 секунд.', 'Go to the app and click an element within 30 seconds.')); }
    catch (error) { setMessage(String(error instanceof Error ? error.message : error)); }
  };

  return createPortal(<div className="workbench-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="devtools-workbench" role="dialog" aria-modal="true" aria-labelledby="workbench-title">
      <header className="workbench-head"><div><h2 id="workbench-title">⚡ {label('Анализ DevTools', 'DevTools analysis')}</h2><p>{label('Действие → обновление → свидетельство → сравнение', 'Interaction → update → evidence → comparison')}</p></div><button onClick={onClose} aria-label={label('Закрыть', 'Close')}>✕</button></header>
      <div className="workbench-status">
        <span className={activeConnections.length ? 'status-connected' : 'status-idle'}>● {activeConnections.length ? `${label('Подключено', 'Connected')}: ${connectedModes.join(', ')} (${activeConnections.length})` : label('Нет активного подключения · откройте приложение с DevTools', 'No active connection · open the app with DevTools')}</span>
        <span>{label('Сопоставлено', 'Matched')}: {coverage.matched + coverage.inferred}/{coverage.received}</span>
        <span>{label('По имени или пути', 'Inferred')}: {coverage.inferred}</span>
        <span>{label('Неоднозначно', 'Ambiguous')}: {coverage.ambiguous}</span>
        {onStartLocator && <button className="workbench-link" onClick={startLocator}>⌖ {label('Выбрать в приложении', 'Pick in app')}</button>}
      </div>
      {locatorResult && (!locatorStarted || locatorResult.event.timestamp >= locatorStarted) && <div className="workbench-locator" role="status">
        {label('Выбрано', 'Picked')}: {locatorResult.event.componentName} · {locatorResult.event.interactionTarget || 'element'} · {locatorResult.match.nodeId ? label('печать найдена', 'seal found') : label('печать не сопоставлена', 'seal not matched')}
        {locatorResult.match.nodeId && <button onClick={() => focus(locatorResult.match.nodeId!)}>{label('Показать на карте', 'Show on map')}</button>}
      </div>}
      {message && <div className="workbench-message" role="status">{message}</div>}
      <nav className="workbench-tabs" role="tablist" aria-label={label('Разделы анализа', 'Analysis sections')}>
        {([['record', label('Запись и события', 'Recording & events')], ['compare', label('Сравнение', 'Compare')], ['vue', label('Связи Vue', 'Vue graph')], ['libraries', label('Библиотеки', 'Libraries')]] as Array<[Tab, string]>).map(([id, title]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{title}</button>)}
      </nav>
      <div className="workbench-body">
        {tab === 'record' && <>
          <div className="workbench-controls">
            {recording ? <button className="workbench-primary" onClick={stopRecording}>■ {label('Остановить и сохранить', 'Stop & save')}</button>
              : <button className="workbench-primary" onClick={() => { startRecording(); setSessionId('current'); setEventId(null); }}>● {label('Начать запись', 'Start recording')}</button>}
            <button onClick={clearRecording} disabled={!currentSession || recording}>{label('Очистить текущую', 'Clear current')}</button>
            <select aria-label={label('Сессия', 'Session')} value={sessionId === 'current' && !currentSession ? savedSessions[0]?.id || 'current' : sessionId} onChange={(event) => { setSessionId(event.target.value); setEventId(null); }}>
              {currentSession && <option value="current">{recording ? label('Текущая запись', 'Current recording') : label('Последняя запись', 'Latest recording')} · {currentSession.name}</option>}
              {savedSessions.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.events.length}</option>)}
              {!currentSession && !savedSessions.length && <option value="current">{label('Сессий пока нет', 'No sessions yet')}</option>}
            </select>
            <button onClick={exportSession} disabled={!session}>{label('Экспорт JSON', 'Export JSON')}</button>
            <button onClick={() => fileRef.current?.click()}>{label('Импорт JSON', 'Import JSON')}</button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(event) => void importFile(event.target.files?.[0])} />
          </div>
          {session ? <>
            <div className="workbench-session-summary">{label('Рендеры', 'Renders')}: {renderEntries.length} · {label('Сопоставлено', 'Matched')}: {mapped}/{renderEntries.length} · {label('Отброшено из буфера', 'Dropped from buffer')}: {session.dropped}</div>
            <div className="workbench-timeline" aria-label={label('Временная шкала событий', 'Event timeline')}>
              {timeline.map(({ entry, count }) => <button key={entry.id} style={{ left: `${Math.min(99, Math.max(0, (entry.event.timestamp - session.startedAt) / span * 100))}%`, background: eventColor(entry.event), scale: count > 1 ? String(Math.min(1.8, 1 + Math.log2(count) * .16)) : undefined }}
                className={selected?.id === entry.id || Boolean(count > 1 && selected && selected.event.commitId === entry.event.commitId && selected.event.pageId === entry.event.pageId) ? 'active' : ''} title={`${clock(entry.event.timestamp)} ${eventTypeLabel(entry.event, ru)} · ${count} ${label('событий', 'events')}`} onClick={() => setEventId(entry.id)} />)}
            </div>
            <div className="timeline-legend"><span>● {label('Действие', 'Interaction')}</span><span>● {label('Обновление', 'Render')}</span><span>● {label('Долгая задача', 'Long task')}</span></div>
            {episodes.length > 0 && <><div className="workbench-episodes-title">{label('После действий пользователя · связь по времени до 1 секунды', 'After user interactions · associated by time up to 1 second')}</div><div className="workbench-episodes">{episodes.map(({ action, renders, tasks }) => <button key={action.id} onClick={() => setEventId(renders[0]?.id || action.id)}><strong>{action.event.interactionType} · {action.event.interactionTarget || 'element'}</strong><span>→ {renders.length} {label('обновлений', 'renders')} · {tasks.length} {label('долгих задач', 'long tasks')}</span></button>)}</div></>}
            <div className="workbench-event-layout">
              <div className="workbench-event-list">
                <div className="workbench-filter"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={label('Компонент или файл', 'Component or file')} /><select value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">{label('Все события', 'All events')}</option><option value="RENDER">{label('Рендеры', 'Renders')}</option><option value="INTERACTION">{label('Действия', 'Interactions')}</option><option value="LONG_TASK">{label('Долгие задачи', 'Long tasks')}</option><option value="DOM_UPDATE">DOM</option><option value="LOCATE">{label('Выбор', 'Picker')}</option></select><select aria-label={label('Источник событий', 'Event source')} value={source} onChange={(event) => setSource(event.target.value)}><option value="all">{label('Все источники', 'All sources')}</option><option value="fiber">React Fiber</option><option value="adapter">{label('Адаптер', 'Adapter')}</option><option value="browser">{label('Браузер', 'Browser')}</option></select></div>
                <small>{label('Показано', 'Shown')}: {shown.length}/{entries.length}</small>
                {shown.map((item) => <button key={item.id} className={`workbench-event-row ${selected?.id === item.id ? 'active' : ''}`} onClick={() => setEventId(item.id)}>
                  <span className="event-dot" style={{ background: eventColor(item.event) }} /><span><strong>{item.event.componentName}</strong><small>{clock(item.event.timestamp)} · {eventTypeLabel(item.event, ru)} · {duration(item.event)}</small></span>
                </button>)}
              </div>
              <EventDetails entry={selected} entries={entries} nodes={nodes} ru={ru} onFocus={focus} onResolve={resolveRuntime} onResolveEvent={resolveRecordedEvent} />
            </div>
          </> : <p className="workbench-empty">{label('Нажмите «Начать запись», выполните действие в приложении и остановите запись. Живая сводка продолжает работать и без записи.', 'Start recording, interact with the app, then stop. The live overview works without recording.')}</p>}
        </>}
        {tab === 'compare' && <>
          <p className="workbench-explainer">{label('Сравнивайте одинаковые действия в одинаковых условиях. Время поддеревьев не складывается в общее CPU-время.', 'Compare the same interaction under similar conditions. Subtree times are not added as total CPU time.')}</p>
          {savedSessions.length < 2 ? <p className="workbench-empty">{label('Для сравнения сохраните две записи.', 'Save two recordings to compare them.')}</p> : <>
            <div className="workbench-compare-select"><label>{label('До', 'Before')}<select value={older?.id || ''} onChange={(event) => setOlderId(event.target.value)}>{savedSessions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>{label('После', 'After')}<select value={newer?.id || ''} onChange={(event) => setNewerId(event.target.value)}>{savedSessions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
            <p className="workbench-session-summary">{label('Источники до', 'Before sources')}: {[...new Set(older?.events.filter((item) => item.event.type === 'RENDER').map((item) => item.event.source || 'unknown'))].join(', ') || '—'} · {label('после', 'after')}: {[...new Set(newer?.events.filter((item) => item.event.type === 'RENDER').map((item) => item.event.source || 'unknown'))].join(', ') || '—'}</p>
            {sourceMismatch && <p className="workbench-message">{label('Источники измерения различаются. Сравнение количества событий полезно, но среднее время может быть несопоставимо.', 'Measurement sources differ. Event counts can still be compared, but average durations may not be comparable.')}</p>}
            {older?.id === newer?.id && <p className="workbench-message">{label('Выберите две разные записи.', 'Choose two different recordings.')}</p>}
            <div className="workbench-table"><div className="workbench-table-head"><span>{label('Компонент', 'Component')}</span><span>{label('До', 'Before')}</span><span>{label('После', 'After')}</span><span>Δ</span></div>
              {comparison.map((row) => <div className="workbench-table-row" key={row.key}><button onClick={() => graph?.nodes.some((node) => node.id === row.key) && focus(row.key)}>{row.name}</button><span>{row.before?.count || 0} / {row.before?.count ? (row.before.total / row.before.count).toFixed(1) : '—'} ms</span><span>{row.after?.count || 0} / {row.after?.count ? (row.after.total / row.after.count).toFixed(1) : '—'} ms</span><strong className={(row.after?.count || 0) > (row.before?.count || 0) ? 'delta-up' : 'delta-down'}>{(row.after?.count || 0) - (row.before?.count || 0) > 0 ? '+' : ''}{(row.after?.count || 0) - (row.before?.count || 0)}</strong></div>)}
            </div>
          </>}
        </>}
        {tab === 'vue' && <>
          <p className="workbench-explainer">{label('Ключ → компонент: какие реактивные зависимости были прочитаны и какие запустили обновление. Доступно для обновлённого dev-адаптера Vue 3.', 'Key → component: tracked reactive dependencies and triggers. Available with the refreshed Vue 3 dev adapter.')}</p>
          {vueLinks.length ? <div className="vue-links">{vueLinks.map((link) => <div className="vue-link" key={`${link.targetId}:${link.key}`}><div><strong>◈ {link.key}</strong><small>{link.targetId}</small></div><div className="vue-link-components">{[...new Set([...link.tracked, ...link.triggered])].map((id) => <button key={id} className={link.triggered.has(id) ? 'triggered' : ''} onClick={() => graph?.nodes.some((node) => node.id === id) && focus(id)}>{nodes.find((node) => node.id === id)?.name || id}</button>)}</div><span>{link.triggered.size ? label('запускало обновление', 'triggered update') : label('отслеживается', 'tracked')}</span></div>)}</div>
            : <p className="workbench-empty">{label('В выбранной записи нет данных о реактивных ключах Vue.', 'No Vue reactive keys in this recording.')}</p>}
        </>}
        {tab === 'libraries' && <>
          <p className="workbench-explainer">{label('Разница оценённых JS-байтов между двумя ручными Vite-сборками. Значения не равны gzip-размеру или времени выполнения.', 'Estimated JS byte difference between two manually triggered Vite builds. Values are not gzip size or runtime cost.')}</p>
          {currentBuild ? <><div className="workbench-session-summary">{label('Последнее измерение', 'Latest measurement')}: {new Date(currentBuild.measuredAt).toLocaleString()} · {currentBuild.source || label('источник неизвестен', 'unknown source')} · {currentBuild.configuration || '—'} · {previousBuild ? `${label('Предыдущее', 'Previous')}: ${new Date(previousBuild.measuredAt).toLocaleString()} · ${previousBuild.source || label('источник неизвестен', 'unknown source')} · ${previousBuild.configuration || '—'}` : label('Сделайте второе измерение для сравнения.', 'Measure again for a comparison.')}</div>
            {previousBuild && (currentBuild.source !== previousBuild.source || currentBuild.configuration !== previousBuild.configuration) && <p className="workbench-message">{label('Источники или приложения различаются; изменение размера нельзя считать точным сравнением.', 'Sources or applications differ; size changes are not directly comparable.')}</p>}
            <div className="workbench-table"><div className="workbench-table-head"><span>{label('Библиотека', 'Library')}</span><span>{label('Было', 'Before')}</span><span>{label('Стало', 'After')}</span><span>Δ</span></div>
              {bundleRows.map((row) => { const change = (row.current?.bytes || 0) - (row.previous?.bytes || 0); const placement = (initial: boolean) => initial ? label('начальная загрузка', 'initial load') : label('ленивые чанки', 'lazy chunks'); return <div className="workbench-table-row" key={row.name}><button onClick={() => { const dependency = graph?.dependencies?.find((item) => item.name === row.name); if (dependency) { selectDependency(dependency.id); onClose(); onFocusDependency(dependency.id); } }}>{row.name}<small>{row.previous && row.current && row.previous.initial !== row.current.initial ? `${placement(row.previous.initial)} → ${placement(row.current.initial)}` : placement(Boolean(row.current?.initial ?? row.previous?.initial))}</small></button><span>{row.previous ? bytes(row.previous.bytes) : '—'}</span><span>{row.current ? bytes(row.current.bytes) : '—'}</span><strong className={change > 0 ? 'delta-up' : 'delta-down'}>{previousBuild ? `${change > 0 ? '+' : ''}${bytes(change)}` : '—'}</strong></div>; })}
            </div></> : <p className="workbench-empty">{label('Измерьте Vite-сборку кнопкой в сводке DevTools. Сборка запускается только по нажатию.', 'Measure a Vite build from the DevTools overview. A build runs only on click.')}</p>}
        </>}
      </div>
    </section>
  </div>, document.body);
};

const EventDetails: React.FC<{ entry?: RecordedEvent; entries: RecordedEvent[]; nodes: ReturnType<typeof useGrimoireStore.getState>['nodes']; ru: boolean; onFocus: (id: string) => void; onResolve: (runtimeId: string, nodeId: string | null) => void; onResolveEvent: (eventId: string, nodeId: string | null) => void }> = ({ entry, entries, nodes, ru, onFocus, onResolve, onResolveEvent }) => {
  const label = (russian: string, english: string) => ru ? russian : english;
  if (!entry) return <div className="workbench-event-detail workbench-empty">{label('Выберите событие на шкале или в списке.', 'Select an event in the timeline or list.')}</div>;
  const event = entry.event;
  const sameCommit = event.type === 'RENDER' && event.commitId != null ? entries.filter((item) => item.event.type === 'RENDER' && item.event.pageId === event.pageId && item.event.commitId === event.commitId) : [];
  const parentInCommit = event.parentRuntimeId ? sameCommit.find((item) => item.event.runtimeId === event.parentRuntimeId) : undefined;
  const childrenInCommit = event.runtimeId ? sameCommit.filter((item) => item.event.parentRuntimeId === event.runtimeId) : [];
  const matchedInteraction = event.interactionId ? entries.find((item) => item.event.type === 'INTERACTION' && item.event.pageId === event.pageId && item.event.interactionId === event.interactionId) : undefined;
  const nearbyInteraction = matchedInteraction || entries.filter((item) => item.event.type === 'INTERACTION' && item.event.pageId === event.pageId && item.event.timestamp <= event.timestamp && event.timestamp - item.event.timestamp < 1000).at(-1);
  const reasons = (event.changeReasons || []).slice(1);
  const reactive = event.reactiveTriggers || [];
  const runtimeKey = event.runtimeId ? `${event.pageId || 'page'}:${event.runtimeId}` : '';
  const node = matchedNode(entry, nodes);
  return <div className="workbench-event-detail">
    <h3>{event.componentName}</h3><p className="detail-meta">{clock(event.timestamp)} · {eventTypeLabel(event, ru)} · {duration(event)} · {event.source || label('неизвестный источник', 'unknown source')}</p>
    <p className="detail-meta">{event.durationKind === 'profiler-subtree' ? label('Длительность поддерева', 'Subtree duration') : event.durationKind === 'vue-lifecycle' ? label('Интервал lifecycle, включая возможную работу детей', 'Lifecycle interval, possibly including children') : event.durationKind === 'event-timing' ? label('Задержка события браузера', 'Browser event duration') : label('Время рендера недоступно', 'Render duration unavailable')}</p>
    <div className="detail-divider" /><strong>{label('Сопоставление', 'Mapping')}</strong><p>{entry.match.status === 'exact' ? label('Точное', 'Exact') : entry.match.status === 'inferred' ? label('По имени или пути', 'Inferred from name or path') : entry.match.status === 'ambiguous' ? label('Несколько кандидатов', 'Multiple candidates') : label('Не найдено', 'Unmatched')} · {mappingExplanation(entry.match.explanation, ru)}</p>
    {node && <button className="workbench-link" onClick={() => onFocus(node.id)}>⌖ {label('Показать печать', 'Show seal')}: {node.name}</button>}
    {entry.match.explanation === 'manual' && <button className="workbench-link" onClick={() => runtimeKey ? onResolve(runtimeKey, null) : onResolveEvent(entry.id, null)}>{label('Сбросить ручную связь', 'Reset manual mapping')}</button>}
    {!node && entry.match.candidates.length > 0 && <div className="candidate-list">{entry.match.candidates.map((id) => <button key={id} onClick={() => runtimeKey ? onResolve(runtimeKey, id) : onResolveEvent(entry.id, id)}>{nodes.find((item) => item.id === id)?.name || id}<small>{nodes.find((item) => item.id === id)?.file}</small></button>)}</div>}
    <div className="detail-divider" /><strong>{label('Путь в дереве', 'Tree path')}</strong><p>{event.hierarchyPath?.join(' → ') || event.parentComponentName || '—'}</p>
    {event.type === 'RENDER' && <div className="detail-family"><div><small>{label('Родитель в этом commit', 'Parent in this commit')}</small><strong>{parentInCommit?.event.componentName || (event.parentComponentName ? `${event.parentComponentName} · ${label('в записи не обновлялся', 'no recorded update')}` : '—')}</strong></div><div><small>{label('Прямых потомков обновилось', 'Direct children updated')}</small><strong>{childrenInCommit.length}</strong></div></div>}
    <strong>{label('Наблюдаемые изменения', 'Observed changes')}</strong>{reasons.length || reactive.length ? <ul>{reasons.map((reason, index) => <li key={`${reason}-${index}`}>{reasonLabel(reason, ru)}</li>)}{reactive.map((item, index) => <li key={`${item.targetId}-${item.key}-${index}`}>Vue {item.operation}: {item.key} <small>{item.targetId}</small></li>)}</ul> : <p>—</p>}
    {nearbyInteraction && <p className="detail-caution">{matchedInteraction ? label('Общий ID взаимодействия', 'Shared interaction ID') : label('По времени рядом с действием', 'Near an interaction in time')}: {nearbyInteraction.event.interactionType} {nearbyInteraction.event.interactionTarget}. {label('Связь не доказывает причину затрат.', 'Association does not prove the cause of the cost.')}</p>}
    {sameCommit.length > 1 && <><div className="detail-divider" /><strong>{label('Компоненты того же commit', 'Components in the same commit')} ({sameCommit.length})</strong><div className="commit-list">{sameCommit.slice(0, 35).map((item) => <div key={item.id} className={item.id === entry.id ? 'current' : ''}>{item.event.hierarchyPath?.join(' → ') || item.event.componentName}<span>{duration(item.event)}</span></div>)}</div><p className="detail-caution">{label('Вложенные времена поддеревьев не суммируются.', 'Nested subtree durations must not be summed.')}</p></>}
  </div>;
};
