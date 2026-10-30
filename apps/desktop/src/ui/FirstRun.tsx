// SPDX-License-Identifier: GPL-3.0-only
import { useId, useState, type FormEvent } from 'react';
import type { DiscoveredCharacter } from '@azeroth/contracts';
import { validateTravellerName } from '../identity/validation';

interface Props {
  characters: DiscoveredCharacter[];
  creating: boolean;
  error: string | undefined;
  onCreate: (travellerName: string) => void;
  onHaveAccount: () => void;
}

export function FirstRun({ characters, creating, error, onCreate, onHaveAccount }: Props) {
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const inputId = useId();
  const msgId = useId();
  const check = validateTravellerName(name);
  const showInvalid = touched && !check.ok;

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (check.ok && !creating) onCreate(check.value);
  }

  return (
    <main className="window">
      <form className="frame" onSubmit={submit} noValidate aria-labelledby="first-run-title">
        <p className="eyebrow">Welcome</p>
        <h1 id="first-run-title">Start your journal</h1>

        <section className="section" aria-label="Characters found">
          <p className="meta">
            {characters.length === 0
              ? 'No characters found yet. They will appear here once the addon has run.'
              : `Found ${characters.length} ${characters.length === 1 ? 'character' : 'characters'}`}
          </p>
          {characters.length > 0 && (
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

        <div className="field">
          <label htmlFor={inputId}>Traveller name</label>
          <input
            id={inputId}
            type="text"
            value={name}
            autoComplete="off"
            spellCheck={false}
            maxLength={24}
            aria-invalid={showInvalid}
            aria-describedby={msgId}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched(true)}
          />
          <p id={msgId} className={showInvalid || error ? 'error' : 'ok-line'} role={error ? 'alert' : undefined}>
            {error ?? (showInvalid && !check.ok ? check.message : 'This is how friends find you. 3-24 letters, digits, _ or -.')}
          </p>
        </div>

        <p className="hint">
          Your journal lives on this PC until you add a passkey or email in settings. If you lose this PC before then, you lose the account.
        </p>

        <button type="submit" className="btn btn-primary" disabled={creating} style={{ width: '100%' }}>
          {creating ? 'Creating…' : 'Create my journal'}
        </button>
        <button type="button" className="btn" disabled={creating} onClick={onHaveAccount} style={{ width: '100%', marginTop: 8 }}>
          I already have an account
        </button>
      </form>
    </main>
  );
}
