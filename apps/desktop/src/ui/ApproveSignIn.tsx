// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useRef } from 'react';
import type { ApprovalState } from '../identity/machine';

interface Props {
  code: string;
  state: ApprovalState;
  onApprove: () => void;
  onDismiss: () => void;
  /** Discard the local identity and start over (device-unregistered recovery). */
  onReset: () => void;
  resetError?: string | null;
}

export function ApproveSignIn({ code, state, onApprove, onDismiss, onReset, resetError }: Props) {
  const approveRef = useRef<HTMLButtonElement>(null);
  const resetRef = useRef<HTMLButtonElement>(null);
  const submitting = state.step === 'submitting';
  const done = state.step === 'done';
  const unregistered = state.step === 'error' && state.kind === 'device-unregistered';

  useEffect(() => {
    (unregistered ? resetRef : approveRef).current?.focus();
  }, [code, unregistered]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submitting, onDismiss]);

  return (
    <main className="window">
      <div className="frame" role="dialog" aria-modal="true" aria-labelledby="approve-title" aria-describedby="approve-desc">
        <p className="eyebrow">Sign-in request</p>
        <h1 id="approve-title">{done ? 'Signed in' : 'Sign in on the website?'}</h1>
        {done ? (
          <>
            <p id="approve-desc">The website should sign you in within a few seconds.</p>
            <button type="button" className="btn btn-primary" onClick={onDismiss} style={{ width: '100%' }}>
              Done
            </button>
          </>
        ) : (
          <>
            <p id="approve-desc" className="meta">Only approve if this code matches the one on the website.</p>
            <p className="code" aria-label={`Code ${code.split('').join(' ')}`}>{code}</p>
            {state.step === 'error' && (
              <p className="error" role="alert" aria-live="assertive">
                {unregistered ? "This device isn't registered with the server. It may have been reset." : state.message}
              </p>
            )}
            {resetError && <p className="error" role="alert">{resetError}</p>}
            <div className="btn-row">
              {unregistered ? (
                <button ref={resetRef} type="button" className="btn btn-primary" onClick={onReset}>
                  Set up again
                </button>
              ) : (
                <button ref={approveRef} type="button" className="btn btn-primary" disabled={submitting} onClick={onApprove}>
                  {submitting ? 'Approving…' : 'Approve'}
                </button>
              )}
              <button type="button" className="btn btn-secondary" disabled={submitting} onClick={onDismiss}>
                Not me
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
