// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useRef, useState } from 'react';
import { buildReport, type DiagnosticsInfo } from '../diagnostics';
import type { UpdateState } from '../update';
import { UpdateBanner } from './UpdateBanner';

interface Props {
  info: DiagnosticsInfo;
  onBack: () => void;
  update: UpdateState;
  onCheckUpdate: () => void;
  onInstallUpdate: () => void;
  onRetryUpdate: () => void;
}

export function Diagnostics({ info, onBack, update, onCheckUpdate, onInstallUpdate, onRetryUpdate }: Props) {
  const backRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null);
  useEffect(() => backRef.current?.focus(), []);

  const report = buildReport(info);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied('ok');
    } catch {
      setCopied('failed');
    }
  };

  const rows: [string, string][] = [
    ['App version', info.appVersion],
    ...(info.updates ? [['Updates', info.updates] as [string, string]] : []),
    ['API', `${info.apiUrl} · ${info.health ? `${info.health.ok ? 'OK' : 'Failed'} (${info.health.message})` : 'Checking…'}`],
    ['Website', info.websiteUrl],
    ['Device identity', info.deviceId ? `Present (${info.deviceId})` : 'None'],
    ['Syncing', info.paused ? 'Paused' : 'Active'],
    ['Events waiting', String(info.queuedEvents)],
    ['WoW folder', `${info.wowDir || 'Not set'} · ${info.folderCheck ? `${info.folderCheck.ok ? 'Valid' : 'Invalid'} (${info.folderCheck.message})` : 'Checking…'}`],
    ['Last sync', info.lastSync],
    ['Last error', info.lastError ?? 'None'],
  ];

  return (
    <main className="window">
      <div className="frame">
        <header className="status-head">
          <button ref={backRef} type="button" className="btn btn-secondary" onClick={onBack}>
            Back
          </button>
          <h1>Diagnostics</h1>
        </header>
        <dl className="diag-list">
          {rows.map(([k, v]) => (
            <div key={k} className="diag-row">
              <dt className="eyebrow">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <UpdateBanner state={update} onInstall={onInstallUpdate} onRetry={onRetryUpdate} />
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={update.kind === 'disabled' || update.kind === 'checking' || update.kind === 'installing'}
            onClick={onCheckUpdate}
          >
            Check for updates
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void copy()}>
            Copy report
          </button>
        </div>
        <p role="status" className={copied === 'failed' ? 'error' : 'ok-line'}>
          {copied === 'ok' ? 'Report copied. Tokens are not included.' : copied === 'failed' ? 'Could not copy. Select the text and copy it manually.' : ''}
        </p>
        <p className="meta">Secrets are never shown here; only the device id.</p>
      </div>
    </main>
  );
}
