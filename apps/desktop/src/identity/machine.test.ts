// SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it } from 'vitest';
import { initialState, reduce, type AppEvent, type AppState, type Identity } from './machine';

const identity: Identity = { deviceId: 'dev-1', deviceToken: 'tok' };
const run = (events: AppEvent[], from: AppState = initialState) => events.reduce(reduce, from);

describe('identity state machine', () => {
  it('goes to first-run without identity and ready with one', () => {
    expect(run([{ type: 'identity-loaded', identity: null }])).toEqual({ phase: 'first-run', creating: false });
    expect(run([{ type: 'identity-loaded', identity }])).toEqual({ phase: 'ready', identity });
  });

  it('first-run: submit, fail, retry, succeed', () => {
    const s = run([
      { type: 'identity-loaded', identity: null },
      { type: 'create-submitted' },
      { type: 'create-failed', message: 'taken' },
    ]);
    expect(s).toEqual({ phase: 'first-run', creating: false, error: 'taken' });
    const t = run([{ type: 'create-submitted' }], s);
    expect(t).toEqual({ phase: 'first-run', creating: true });
    expect(run([{ type: 'create-succeeded', identity }], t)).toEqual({ phase: 'ready', identity });
  });

  it('ignores double submit', () => {
    const s = run([{ type: 'identity-loaded', identity: null }, { type: 'create-submitted' }]);
    expect(reduce(s, { type: 'create-submitted' })).toBe(s);
  });

  it('pairing request opens the approve window and approve completes', () => {
    const s = run([
      { type: 'identity-loaded', identity },
      { type: 'pairing-received', code: 'WOLF-3K7P' },
    ]);
    expect(s).toEqual({ phase: 'ready', identity, approval: { code: 'WOLF-3K7P', step: 'prompt' } });
    const done = run([{ type: 'approve-submitted' }, { type: 'approve-succeeded' }], s);
    expect(done).toMatchObject({ approval: { code: 'WOLF-3K7P', step: 'done' } });
    expect(run([{ type: 'approval-dismissed' }], done)).toEqual({ phase: 'ready', identity });
  });

  it('approve failure can be retried or dismissed ("Not me")', () => {
    const failed = run([
      { type: 'identity-loaded', identity },
      { type: 'pairing-received', code: 'WOLF-3K7P' },
      { type: 'approve-submitted' },
      { type: 'approve-failed', message: 'expired' },
    ]);
    expect(failed).toMatchObject({ approval: { step: 'error', message: 'expired' } });
    expect(run([{ type: 'approve-submitted' }], failed)).toMatchObject({ approval: { step: 'submitting' } });
    expect(run([{ type: 'approval-dismissed' }], failed)).toEqual({ phase: 'ready', identity });
  });

  it('device-unregistered failure cannot be retried, can be dismissed, and reset drops the code', () => {
    const failed = run([
      { type: 'identity-loaded', identity },
      { type: 'pairing-received', code: 'WOLF-3K7P' },
      { type: 'approve-submitted' },
      { type: 'approve-failed', message: 'invalid signature', kind: 'device-unregistered' },
    ]);
    expect(failed).toMatchObject({ approval: { step: 'error', kind: 'device-unregistered' } });
    expect(reduce(failed, { type: 'approve-submitted' })).toBe(failed);
    expect(run([{ type: 'approval-dismissed' }], failed)).toEqual({ phase: 'ready', identity });
    expect(run([{ type: 'identity-cleared' }], failed)).toEqual({ phase: 'first-run', creating: false });
  });

  it('cannot dismiss or be superseded while submitting', () => {
    const s = run([
      { type: 'identity-loaded', identity },
      { type: 'pairing-received', code: 'WOLF-3K7P' },
      { type: 'approve-submitted' },
    ]);
    expect(reduce(s, { type: 'approval-dismissed' })).toBe(s);
    expect(reduce(s, { type: 'pairing-received', code: 'ABCD-1234' })).toBe(s);
  });

  it('a newer code supersedes a pending prompt', () => {
    const s = run([
      { type: 'identity-loaded', identity },
      { type: 'pairing-received', code: 'WOLF-3K7P' },
      { type: 'pairing-received', code: 'ABCD-1234' },
    ]);
    expect(s).toMatchObject({ approval: { code: 'ABCD-1234', step: 'prompt' } });
  });

  it('keeps a code received during first-run and prompts after account creation', () => {
    const s = run([
      { type: 'identity-loaded', identity: null },
      { type: 'pairing-received', code: 'WOLF-3K7P' },
      { type: 'create-submitted' },
      { type: 'create-succeeded', identity },
    ]);
    expect(s).toEqual({ phase: 'ready', identity, approval: { code: 'WOLF-3K7P', step: 'prompt' } });
  });

  it('ignores pairing and approval events while loading', () => {
    expect(reduce(initialState, { type: 'pairing-received', code: 'WOLF-3K7P' })).toBe(initialState);
    expect(reduce(initialState, { type: 'approve-succeeded' })).toBe(initialState);
  });

  it('link mode: open, fail, retry, succeed keeps a pending pairing code', () => {
    const opened = run([{ type: 'identity-loaded', identity: null }, { type: 'pairing-received', code: 'WOLF-3K7P' }, { type: 'link-opened' }]);
    expect(opened).toEqual({ phase: 'first-run', creating: false, pendingCode: 'WOLF-3K7P', mode: 'link' });
    const failed = run([{ type: 'create-submitted' }, { type: 'create-failed', message: 'expired' }], opened);
    expect(failed).toMatchObject({ mode: 'link', creating: false, error: 'expired' });
    const retry = run([{ type: 'create-submitted' }], failed);
    expect(retry).toEqual({ phase: 'first-run', creating: true, pendingCode: 'WOLF-3K7P', mode: 'link' });
    expect(run([{ type: 'create-succeeded', identity }], retry)).toEqual({
      phase: 'ready', identity, approval: { code: 'WOLF-3K7P', step: 'prompt' },
    });
  });

  it('link mode can be left again but not while submitting; the error is cleared', () => {
    const failed = run([{ type: 'identity-loaded', identity: null }, { type: 'link-opened' }, { type: 'create-submitted' }, { type: 'create-failed', message: 'x' }]);
    expect(run([{ type: 'link-closed' }], failed)).toEqual({ phase: 'first-run', creating: false });
    const busy = run([{ type: 'create-submitted' }], failed);
    expect(reduce(busy, { type: 'link-closed' })).toBe(busy);
    expect(reduce(busy, { type: 'link-opened' })).toBe(busy);
  });

  it('identity-cleared after a link returns to the plain first-run form', () => {
    expect(run([{ type: 'identity-loaded', identity }, { type: 'identity-cleared' }])).toEqual({ phase: 'first-run', creating: false });
  });

  it('identity-cleared returns to first-run', () => {
    expect(run([{ type: 'identity-loaded', identity }, { type: 'identity-cleared' }])).toEqual({ phase: 'first-run', creating: false });
  });
});
