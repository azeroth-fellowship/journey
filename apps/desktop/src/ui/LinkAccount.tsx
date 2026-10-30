// SPDX-License-Identifier: GPL-3.0-only
import { useId, useState, type FormEvent } from 'react';
import { normalizeLinkCode } from '../identity/validation';

interface Props {
  linking: boolean;
  error: string | undefined;
  onLink: (code: string) => void;
  onBack: () => void;
}

/** Sign in to an existing account on a new PC with a code from the website (Settings > Devices). */
export function LinkAccount({ linking, error, onLink, onBack }: Props) {
  const [code, setCode] = useState('');
  const [touched, setTouched] = useState(false);
  const inputId = useId();
  const msgId = useId();
  const check = normalizeLinkCode(code);
  const showInvalid = touched && !check.ok;

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (check.ok && !linking) onLink(check.value);
  }

  return (
    <main className="window">
      <form className="frame" onSubmit={submit} noValidate aria-labelledby="link-title">
        <p className="eyebrow">Welcome back</p>
        <h1 id="link-title">Sign in to an existing account</h1>

        <ol className="hint">
          <li>On the website, sign in with your passkey or an emailed link.</li>
          <li>Open Settings, then Devices, and choose Link a new computer.</li>
          <li>Enter the code it shows here. It works once and expires after 10 minutes.</li>
        </ol>

        <div className="field">
          <label htmlFor={inputId}>Link code</label>
          <input
            id={inputId}
            type="text"
            value={code}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={16}
            placeholder="LINK-8H2Q-K7ZM"
            aria-invalid={showInvalid}
            aria-describedby={msgId}
            onChange={(e) => setCode(e.target.value)}
            onBlur={() => setTouched(true)}
          />
          <p id={msgId} className={showInvalid || error ? 'error' : 'ok-line'} role={error ? 'alert' : undefined}>
            {error ?? (showInvalid && !check.ok ? check.message : 'Letters and digits only; dashes and case do not matter.')}
          </p>
        </div>

        <button type="submit" className="btn btn-primary" disabled={linking} style={{ width: '100%' }}>
          {linking ? 'Linking…' : 'Link this computer'}
        </button>
        <button type="button" className="btn" disabled={linking} onClick={onBack} style={{ width: '100%', marginTop: 8 }}>
          Back
        </button>
      </form>
    </main>
  );
}
