// SPDX-License-Identifier: GPL-3.0-only
import type { ReactNode } from 'react';
import { progressPercent, type UpdateState } from '../update';

interface Props {
  state: UpdateState;
  onInstall: () => void;
  onRetry: () => void;
}

const STAGE_LABEL = { flushing: 'Finishing uploads…', downloading: 'Downloading…', restarting: 'Restarting…' } as const;

/** Quiet row shown only when there is something to say. The live region is always mounted so changes are announced. */
export function UpdateBanner({ state, onInstall, onRetry }: Props) {
  let body: ReactNode = null;

  if (state.kind === 'available') {
    body = (
      <>
        <p className="update-line"><strong>Update {state.version} available</strong></p>
        {state.notes ? (
          <details className="update-details">
            <summary>release notes</summary>
            <pre className="update-notes">{state.notes}</pre>
          </details>
        ) : null}
        <button type="button" className="btn btn-primary update-btn" onClick={onInstall}>Install and restart</button>
      </>
    );
  } else if (state.kind === 'installing') {
    const pct = progressPercent(state);
    body = (
      <>
        <p className="update-line">Updating to {state.version}. {STAGE_LABEL[state.stage]}</p>
        {state.stage === 'downloading' && (
          <progress className="update-progress" aria-label="Download progress" {...(pct === null ? {} : { value: pct, max: 100 })} />
        )}
      </>
    );
  } else if (state.kind === 'error') {
    body = (
      <>
        <p className="error update-line">
          {state.during === 'check' ? 'Could not check for updates' : `Could not install ${state.version ?? 'the update'}`}: {state.message}
        </p>
        <button type="button" className="btn btn-secondary update-btn" onClick={onRetry}>Try again</button>
      </>
    );
  } else if (state.kind === 'checking' && state.manual) {
    body = <p className="update-line meta">Checking for updates…</p>;
  }

  return (
    <div className={body ? 'update-banner filled' : 'update-banner'} role="status" aria-live="polite">
      {body}
    </div>
  );
}
