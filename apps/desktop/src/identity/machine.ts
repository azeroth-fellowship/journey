// SPDX-License-Identifier: GPL-3.0-only
/** Pure state machine for the companion's identity / pairing windows. */

export interface Identity {
  deviceId: string;
  deviceToken: string;
}

export type ApprovalState =
  | { step: 'prompt' }
  | { step: 'submitting' }
  | { step: 'done' }
  | { step: 'error'; message: string; kind?: 'device-unregistered' };

export type AppState =
  | { phase: 'loading' }
  | { phase: 'first-run'; creating: boolean; error?: string; pendingCode?: string; mode?: 'link' }
  | { phase: 'ready'; identity: Identity; approval?: { code: string } & ApprovalState };

export type AppEvent =
  | { type: 'identity-loaded'; identity: Identity | null }
  | { type: 'link-opened' }
  | { type: 'link-closed' }
  | { type: 'create-submitted' }
  | { type: 'create-failed'; message: string }
  | { type: 'create-succeeded'; identity: Identity }
  | { type: 'pairing-received'; code: string }
  | { type: 'approve-submitted' }
  | { type: 'approve-succeeded' }
  | { type: 'approve-failed'; message: string; kind?: 'device-unregistered' }
  | { type: 'approval-dismissed' }
  | { type: 'identity-cleared' };

export const initialState: AppState = { phase: 'loading' };

export function reduce(state: AppState, event: AppEvent): AppState {
  switch (event.type) {
    case 'identity-loaded':
      if (state.phase !== 'loading') return state;
      return event.identity
        ? { phase: 'ready', identity: event.identity }
        : { phase: 'first-run', creating: false };

    // "I already have an account": same first-run phase, showing the link-code form instead of the name form.
    case 'link-opened': {
      if (state.phase !== 'first-run' || state.creating) return state;
      const { error: _error, ...rest } = state;
      return { ...rest, mode: 'link' };
    }

    case 'link-closed': {
      if (state.phase !== 'first-run' || state.creating) return state;
      const { error: _error, mode: _mode, ...rest } = state;
      return rest;
    }

    case 'create-submitted': {
      if (state.phase !== 'first-run' || state.creating) return state;
      const { error: _error, ...rest } = state;
      return { ...rest, creating: true };
    }

    case 'create-failed':
      return state.phase === 'first-run' ? { ...state, creating: false, error: event.message } : state;

    case 'create-succeeded': {
      if (state.phase !== 'first-run') return state;
      const next: AppState = { phase: 'ready', identity: event.identity };
      return state.pendingCode ? { ...next, approval: { code: state.pendingCode, step: 'prompt' } } : next;
    }

    case 'pairing-received':
      if (state.phase === 'first-run') return { ...state, pendingCode: event.code };
      if (state.phase === 'ready') {
        // Don't replace a request that is mid-submit; otherwise a new code supersedes the old one.
        if (state.approval?.step === 'submitting') return state;
        return { ...state, approval: { code: event.code, step: 'prompt' } };
      }
      return state;

    case 'approve-submitted':
      // A device-unregistered failure can't be fixed by retrying.
      if (state.phase === 'ready' && state.approval && (state.approval.step === 'prompt' || (state.approval.step === 'error' && !state.approval.kind))) {
        return { ...state, approval: { code: state.approval.code, step: 'submitting' } };
      }
      return state;

    case 'approve-succeeded':
      if (state.phase === 'ready' && state.approval?.step === 'submitting') {
        return { ...state, approval: { code: state.approval.code, step: 'done' } };
      }
      return state;

    case 'approve-failed':
      if (state.phase === 'ready' && state.approval?.step === 'submitting') {
        return { ...state, approval: { code: state.approval.code, step: 'error', message: event.message, ...(event.kind ? { kind: event.kind } : {}) } };
      }
      return state;

    case 'approval-dismissed':
      if (state.phase === 'ready' && state.approval && state.approval.step !== 'submitting') {
        return { phase: 'ready', identity: state.identity };
      }
      return state;

    case 'identity-cleared':
      return { phase: 'first-run', creating: false };
  }
}
