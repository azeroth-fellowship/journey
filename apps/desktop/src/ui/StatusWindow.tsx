// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useId, useRef, useState } from 'react';
import type { DiscoveredCharacter } from '@azeroth/contracts';
import type { StatusView } from '../status';
import type { UpdateState } from '../update';
import { UpdateBanner } from './UpdateBanner';

interface Props {
  status: StatusView;
  wowDir: string;
  onWowDirChange: (path: string) => void;
  /** Result of probing the folder: null while unknown. */
  folderCheck: { ok: boolean; message: string } | null;
  characters: DiscoveredCharacter[];
  shareLive: boolean;
  onShareLiveChange: (next: boolean) => void;
  paused: boolean;
  onPausedChange: (next: boolean) => void;
  onPickFolder: () => void;
  onOpenWebsite: () => void;
  onOpenDiagnostics: () => void;
  update: UpdateState;
  onInstallUpdate: () => void;
  onRetryUpdate: () => void;
  /** Discard the local identity. Shown behind a confirm step. */
  onReset: () => void;
  resetError?: string | null;
}

export function StatusWindow({ status, wowDir, onWowDirChange, folderCheck, characters, shareLive, onShareLiveChange, paused, onPausedChange, onPickFolder, onOpenWebsite, onOpenDiagnostics, update, onInstallUpdate, onRetryUpdate, onReset, resetError }: Props) {
  const [confirmingReset, setConfirmingReset] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const resetTitleId = useId();
  const resetDescId = useId();
  useEffect(() => {
    if (confirmingReset) cancelRef.current?.focus();
  }, [confirmingReset]);
  const pathId = useId();
  const pathMsgId = useId();
  const switchLabelId = useId();
  const switchDescId = useId();

  return (
    <main className={`window tone-${status.tone}`}>
      <div className="frame">
        <header className="status-head">
          <span className="status-marker" aria-hidden="true" />
          <h1 role="status">{status.label}</h1>
        </header>

        <UpdateBanner state={update} onInstall={onInstallUpdate} onRetry={onRetryUpdate} />

        <div className="stats">
          <div className="stat">
            <p className="eyebrow">Events waiting</p>
            <div className="stat-value">{status.eventsWaiting}</div>
          </div>
          <div className="stat">
            <p className="eyebrow">Last sync</p>
            <div className="stat-value">{status.lastSync}</div>
          </div>
        </div>

        <div className="btn-row pause-row">
          <button type="button" className="btn btn-secondary" aria-pressed={paused} onClick={() => onPausedChange(!paused)}>
            {paused ? 'Resume syncing' : 'Pause syncing'}
          </button>
        </div>

        <div className="field">
          <label htmlFor={pathId}>WoW folder</label>
          <div className="path-row">
            <input
              id={pathId}
              type="text"
              value={wowDir}
              spellCheck={false}
              aria-describedby={pathMsgId}
              aria-invalid={folderCheck ? !folderCheck.ok : undefined}
              onChange={(e) => onWowDirChange(e.target.value)}
            />
            <button type="button" className="btn btn-secondary" onClick={onPickFolder}>
              Change
            </button>
          </div>
          <p id={pathMsgId} className={folderCheck && !folderCheck.ok ? 'error' : 'ok-line'}>
            {folderCheck?.message ?? 'Checking folder…'}
          </p>
        </div>

        <div className="switch-row">
          <div>
            <div id={switchLabelId}>Share live location</div>
            <div id={switchDescId} className="meta">History still syncs.</div>
          </div>
          {/* STUB: preference is stored locally only; the live-location pipeline does not exist yet. */}
          <button
            type="button"
            role="switch"
            className="switch"
            aria-checked={shareLive}
            aria-labelledby={switchLabelId}
            aria-describedby={switchDescId}
            onClick={() => onShareLiveChange(!shareLive)}
          />
        </div>

        <section className="section" aria-label="Characters found">
          <p className="eyebrow">Characters found</p>
          {characters.length === 0 ? (
            <p className="meta">None yet.</p>
          ) : (
            <ul className="char-list">
              {characters.map((c) => (
                <li key={`${c.realm ?? ''}/${c.name}`}>
                  {c.name}
                  {c.realm ? <span className="realm"> · {c.realm}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="btn-row">
          <button type="button" className="btn btn-secondary" onClick={onOpenWebsite}>
            Open website
          </button>
          <button type="button" className="btn btn-secondary" onClick={onOpenDiagnostics}>
            Diagnostics
          </button>
        </div>

        <div className="reset-zone">
          {confirmingReset ? (
            <div role="alertdialog" aria-labelledby={resetTitleId} aria-describedby={resetDescId}>
              <p id={resetTitleId}><strong>Reset this device?</strong></p>
              <p id={resetDescId} className="meta">
                This deletes the key stored on this PC. Your account stays on the server, but this PC loses access to it
                unless you have a recovery method.
              </p>
              {resetError && <p className="error" role="alert">{resetError}</p>}
              <div className="btn-row">
                <button ref={cancelRef} type="button" className="btn btn-secondary" onClick={() => setConfirmingReset(false)}>
                  Cancel
                </button>
                <button type="button" className="btn btn-secondary btn-danger" onClick={onReset}>
                  Reset this device
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn-quiet" onClick={() => setConfirmingReset(true)}>
              Reset this device
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
