// SPDX-License-Identifier: GPL-3.0-only
/** Matches the events of @tauri-apps/plugin-updater's Update.downloadAndInstall. */
export type DownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' };

/** The slice of the plugin's `Update` object this app uses (so tests can mock it). */
export interface UpdateHandle {
  version: string;
  body?: string | null;
  downloadAndInstall(onEvent: (e: DownloadEvent) => void): Promise<void>;
}

export interface UpdateDeps {
  /** False in builds without an updater config (dev, cargo check). */
  isEnabled(): Promise<boolean>;
  check(): Promise<UpdateHandle | null>;
  relaunch(): Promise<void>;
  /** Runs before the download starts: the Windows installer ends the process, so this is the last safe moment to flush the upload queue. */
  beforeInstall(): Promise<void>;
}

export type UpdateState =
  | { kind: 'disabled' }
  | { kind: 'idle'; checkedAt?: number; upToDate: boolean; lastError?: string }
  | { kind: 'checking'; manual: boolean }
  | { kind: 'available'; version: string; notes: string }
  | { kind: 'installing'; version: string; stage: 'flushing' | 'downloading' | 'restarting'; downloaded: number; total?: number }
  | { kind: 'error'; during: 'check' | 'install'; message: string; version?: string };

export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Upper bound on the pre-install queue flush; the queue is persisted, so giving up is safe. */
export const FLUSH_TIMEOUT_MS = 10_000;

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Download progress 0..100, or null when the size is unknown. */
export function progressPercent(s: Extract<UpdateState, { kind: 'installing' }>): number | null {
  if (s.stage !== 'downloading' || !s.total) return null;
  return Math.min(100, Math.round((s.downloaded / s.total) * 100));
}

export class UpdateController {
  private state: UpdateState = { kind: 'idle', upToDate: false };
  private listeners = new Set<() => void>();
  private handle: UpdateHandle | null = null;
  private blocked = false;
  private skipped = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  constructor(private deps: UpdateDeps, private now: () => number = Date.now) {}

  getState = (): UpdateState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  private set(next: UpdateState): void {
    this.state = next;
    this.listeners.forEach((l) => l());
  }

  /** Checks once now, then every CHECK_INTERVAL_MS. */
  async start(): Promise<void> {
    let enabled = false;
    try { enabled = await this.deps.isEnabled(); } catch { /* treat as disabled */ }
    if (!enabled) { this.set({ kind: 'disabled' }); return; }
    if (this.timer) return;
    this.timer = setInterval(() => { void this.check(false); }, CHECK_INTERVAL_MS);
    await this.check(false);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  /** While true (the approve-sign-in window is open) automatic checks are deferred, then run once when it closes. */
  setBlocked(blocked: boolean): void {
    this.blocked = blocked;
    if (!blocked && this.skipped) {
      this.skipped = false;
      void this.check(false);
    }
  }

  async check(manual: boolean): Promise<void> {
    if (this.state.kind === 'disabled' || this.busy) return;
    if (this.state.kind === 'available' || this.state.kind === 'installing') return;
    if (!manual && this.blocked) { this.skipped = true; return; }
    this.busy = true;
    const prev = this.state;
    this.set({ kind: 'checking', manual });
    try {
      const update = await this.deps.check();
      this.handle = update;
      if (update) this.set({ kind: 'available', version: update.version, notes: (update.body ?? '').trim() });
      else this.set({ kind: 'idle', upToDate: true, checkedAt: this.now() });
    } catch (e) {
      const message = errorMessage(e);
      // A failed background check is not worth interrupting anyone for; only a manual one shows an error.
      if (manual) this.set({ kind: 'error', during: 'check', message });
      else this.set({ kind: 'idle', upToDate: prev.kind === 'idle' && prev.upToDate, ...(prev.kind === 'idle' && prev.checkedAt ? { checkedAt: prev.checkedAt } : {}), lastError: message });
    } finally {
      this.busy = false;
    }
  }

  /** Flush the queue, download + install, relaunch. */
  async install(): Promise<void> {
    const handle = this.handle;
    if (!handle || this.busy || this.blocked) return;
    if (this.state.kind !== 'available' && !(this.state.kind === 'error' && this.state.during === 'install')) return;
    this.busy = true;
    const version = handle.version;
    const installing = (stage: 'flushing' | 'downloading' | 'restarting', downloaded = 0, total?: number): UpdateState =>
      ({ kind: 'installing', version, stage, downloaded, ...(total ? { total } : {}) });
    this.set(installing('flushing'));
    try {
      await this.flush();
      let downloaded = 0;
      let total: number | undefined;
      this.set(installing('downloading'));
      await handle.downloadAndInstall((e) => {
        if (e.event === 'Started') total = e.data.contentLength;
        else if (e.event === 'Progress') downloaded += e.data.chunkLength;
        else return;
        this.set(installing('downloading', downloaded, total));
      });
      this.set(installing('restarting', downloaded, total));
      await this.deps.relaunch();
    } catch (e) {
      this.set({ kind: 'error', during: 'install', message: errorMessage(e), version });
    } finally {
      this.busy = false;
    }
  }

  /** Retry after an error: reuse the found update for a failed install, otherwise check again. */
  async retry(): Promise<void> {
    if (this.state.kind !== 'error') return;
    if (this.state.during === 'install' && this.handle) return this.install();
    this.set({ kind: 'idle', upToDate: false });
    return this.check(true);
  }

  private async flush(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, FLUSH_TIMEOUT_MS); });
    try {
      await Promise.race([this.deps.beforeInstall(), timeout]);
    } catch {
      /* the queue is persisted locally; a failed flush must not block the update */
    } finally {
      clearTimeout(timer);
    }
  }
}

/** One line for Diagnostics and the manual-check status. */
export function describeUpdate(s: UpdateState): string {
  switch (s.kind) {
    case 'disabled': return 'Updates are off in this build.';
    case 'checking': return 'Checking for updates…';
    case 'available': return `Update ${s.version} available.`;
    case 'installing': return `Installing ${s.version}…`;
    case 'error': return `Update ${s.during === 'check' ? 'check' : 'install'} failed: ${s.message}`;
    case 'idle': return s.upToDate ? 'You are up to date.' : s.lastError ? `Last check failed: ${s.lastError}` : 'Not checked yet.';
  }
}
