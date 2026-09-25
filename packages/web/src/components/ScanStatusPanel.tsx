import React, { useEffect, useState } from 'react';
import { translate, type Locale } from '../i18n.js';
import type { ScanStatus } from '../transport/transport.js';

const phaseKeys: Record<string, Parameters<typeof translate>[1]> = {
  starting: 'scanStarting', discovering: 'scanDiscovering', parsing: 'scanParsing', nodes: 'scanNodes',
  edges: 'scanEdges', diagnostics: 'scanDiagnostics', dependencies: 'scanDependencies', layout: 'scanLayout',
  'layout-clusters': 'scanLayoutClusters', 'layout-finalizing': 'scanLayoutFinalizing', transferring: 'scanTransferring',
};

interface Props {
  status: ScanStatus | null;
  locale: Locale;
  compact: boolean;
  onRetry: () => void;
  onCancel: () => void;
  onWatchPath?: (relativePath: string | null) => Promise<void>;
  onClose?: () => void;
}

export const ScanStatusPanel: React.FC<Props> = ({ status, locale, compact, onRetry, onCancel, onWatchPath, onClose }) => {
  const [now, setNow] = useState(Date.now());
  const [showLogs, setShowLogs] = useState(false);
  const [watchInput, setWatchInput] = useState('');
  const [watchMessage, setWatchMessage] = useState('');
  const [watchBusy, setWatchBusy] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { if (status?.state === 'error' || (status?.state === 'ready' && compact)) setShowLogs(true); }, [status?.state, compact]);
  useEffect(() => { if (status?.watchPath && status.watchPath !== '.') setWatchInput(status.watchPath); }, [status?.watchPath]);
  const changeWatchPath = async (relativePath: string | null) => {
    if (!onWatchPath) return;
    setWatchBusy(true);
    setWatchMessage('');
    try { await onWatchPath(relativePath); }
    catch (error) { setWatchMessage(error instanceof Error ? error.message : String(error)); }
    finally { setWatchBusy(false); }
  };
  const elapsed = status ? Math.floor((now - status.startedAt) / 1000) : 0;
  const idle = status ? Math.floor((now - status.updatedAt) / 1000) : 0;
  const progress = status?.state === 'ready' ? null : status?.total ? Math.min(100, Math.round(100 * (status.completed || 0) / status.total)) : null;
  const isError = status?.state === 'error';
  const isCancelled = status?.state === 'cancelled';
  const title = !status ? translate(locale, 'scanWaiting') : isError ? translate(locale, 'scanError') : isCancelled ? translate(locale, 'scanCancelled') : status.state === 'ready' ? translate(locale, 'scanReady') : translate(locale, 'scanTitle');
  const phase = status?.state === 'ready' ? (compact ? '' : translate(locale, 'scanLoadingGraph')) : status && !isError && !isCancelled ? (phaseKeys[status.phase] ? translate(locale, phaseKeys[status.phase]!) : status.phase) : '';
  return (
    <div className={`scan-status-shell ${compact ? 'scan-status-compact' : ''}`} role="status" aria-live="polite">
      <section className={`scan-status-card ${isError ? 'scan-status-error' : ''}`}>
        <div className="scan-status-heading"><span className="scan-status-sigil" aria-hidden="true">✦</span><h2>{title}</h2></div>
        {phase && <p className="scan-status-phase">{phase}{status?.total != null ? ` · ${status.completed || 0} / ${status.total} ${translate(locale, status.phase === 'layout-clusters' ? 'scanClusters' : 'scanFiles')}` : status?.phase === 'discovering' && status.completed != null ? ` · ${status.completed} ${translate(locale, 'scanFiles')} ${translate(locale, 'scanFound')}` : ''}</p>}
        {!isError && !isCancelled && !(status?.state === 'ready' && compact) && <div className={`scan-status-track ${progress == null ? 'scan-status-indeterminate' : ''}`} role="progressbar" aria-label={phase || title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress ?? undefined}><span style={progress == null ? undefined : { width: `${progress}%` }} /></div>}
        {status?.file && status.state !== 'ready' && <p className="scan-status-file" title={status.file}>{status.file}</p>}
        {status && <p className="scan-status-time">{translate(locale, 'scanElapsed')}: {elapsed} {locale === 'ru' ? 'с' : 's'} · {translate(locale, 'scanLastUpdate')}: {idle} {translate(locale, 'scanSeconds')}</p>}
        {status?.coverage && <p className="scan-status-time">{locale === 'ru' ? 'Разбор файлов' : 'File parsing'}: {status.coverage.complete} {locale === 'ru' ? 'полностью' : 'complete'} · {status.coverage.partial} {locale === 'ru' ? 'частично' : 'partial'} · {status.coverage.unreadable} {locale === 'ru' ? 'не прочитано' : 'unreadable'}{status.coverage.cached ? ` · ${status.coverage.cached} ${locale === 'ru' ? 'из кэша' : 'from cache'}` : ''}</p>}
        {compact && status?.state === 'ready' && onWatchPath && <div className="scan-watch-control">
          <label htmlFor="scan-watch-folder">{locale === 'ru' ? 'Следить за подпапкой (до 5000 файлов)' : 'Watch a folder (up to 5000 files)'}</label>
          <p>{status.watchPath ? `${locale === 'ru' ? 'Слежение' : 'Watching'}: ${status.watchPath}` : locale === 'ru' ? 'Слежение выключено; обновляйте карту вручную.' : 'Watching is off; refresh the map manually.'}</p>
          <div className="scan-watch-row">
            <input id="scan-watch-folder" value={watchInput} onChange={(event) => setWatchInput(event.target.value)} placeholder="packages/my-app" aria-label={locale === 'ru' ? 'Путь к подпапке проекта' : 'Project folder path'} />
            <button type="button" disabled={watchBusy || !watchInput.trim()} onClick={() => void changeWatchPath(watchInput.trim())}>{locale === 'ru' ? 'Включить' : 'Watch'}</button>
            {status.watchPath && <button type="button" disabled={watchBusy} onClick={() => void changeWatchPath(null)}>{locale === 'ru' ? 'Отключить' : 'Stop'}</button>}
          </div>
          {watchMessage && <p className="scan-watch-error" role="alert">{watchMessage}</p>}
        </div>}
        {idle >= 30 && !isError && !isCancelled && status?.state !== 'ready' && <p className="scan-status-stale">{translate(locale, 'scanStale')}</p>}
        {status?.error && <pre className="scan-status-error-text">{status.error}</pre>}
        <div className="scan-status-actions">
          <button type="button" onClick={() => setShowLogs((value) => !value)}>{showLogs ? translate(locale, 'scanHideLogs') : translate(locale, 'scanShowLogs')}{status?.logs.some((entry) => entry.level !== 'info') ? ' ⚠' : ''}</button>
          {onClose && <button type="button" onClick={onClose}>{translate(locale, 'close')}</button>}
          {(isError || isCancelled) && <button type="button" onClick={onRetry}>{translate(locale, 'scanRetry')}</button>}
          {status?.state === 'running' && <button type="button" onClick={onCancel}>{translate(locale, 'scanCancel')}</button>}
        </div>
        {showLogs && <div className="scan-status-logs"><h3>{translate(locale, 'scanLogs')}</h3><div className="scan-status-log-list">{status?.logs.map((entry, index) => <p key={`${entry.time}-${index}`} className={`scan-log-${entry.level}`}><time>{new Date(entry.time).toLocaleTimeString(locale)}</time> {entry.message}</p>)}</div></div>}
      </section>
    </div>
  );
};
