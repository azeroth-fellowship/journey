// SPDX-License-Identifier: GPL-3.0-only
import { getVersion } from '@tauri-apps/api/app';
import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import type { DiscoveredCharacter } from '@azeroth/contracts';
import { ApiClient } from '@azeroth/api-client';
import { API_BASE_URL, WEBSITE_URL } from '../config';
import { checkHealth, type DiagnosticsInfo } from '../diagnostics';
import { classifyApproveError, createIdentityApi, describeLinkError } from '../identity/api';
import { firstPairingCode } from '../identity/deeplink';
import { initialState, reduce } from '../identity/machine';
import * as native from '../identity/native';
import { UploadQueue, uploadedTotal } from '../queue';
import { statusView } from '../status';
import { syncSavedVariables } from '../sync';
import { describeUpdate, UpdateController } from '../update';
import { nativeUpdateDeps } from '../updateNative';
import { ApproveSignIn } from './ApproveSignIn';
import { Diagnostics } from './Diagnostics';
import { FirstRun } from './FirstRun';
import { LinkAccount } from './LinkAccount';
import { StatusWindow } from './StatusWindow';

const api = createIdentityApi(API_BASE_URL);
const WOW_DIR_KEY = 'azeroth.wowDir';
const SHARE_LIVE_KEY = 'azeroth.shareLive';
const PAUSED_KEY = 'azeroth.paused';
const LAST_SYNC_KEY = 'azeroth.lastSyncAt';
const RETRY_SECONDS = 30;
/** How often the addon's SavedVariables file is re-read (WoW itself only rewrites it on logout or /reload). */
const SYNC_SECONDS = 30;

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function App() {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [wowDir, setWowDir] = useState(() => localStorage.getItem(WOW_DIR_KEY) ?? '');
  const [characters, setCharacters] = useState<DiscoveredCharacter[]>([]);
  const [folderCheck, setFolderCheck] = useState<{ ok: boolean; message: string } | null>(null);
  const [shareLive, setShareLive] = useState(() => localStorage.getItem(SHARE_LIVE_KEY) === '1');
  const [resetError, setResetError] = useState<string | null>(null);
  const [paused, setPaused] = useState(() => localStorage.getItem(PAUSED_KEY) === '1');

  const changePaused = useCallback((next: boolean) => {
    setPaused(next);
    localStorage.setItem(PAUSED_KEY, next ? '1' : '0');
  }, []);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // Keep the tray label in step, and let the tray toggle the state.
  useEffect(() => { void native.setPaused(paused).catch(() => {}); }, [paused]);
  useEffect(() => {
    let un: (() => void) | undefined;
    let cancelled = false;
    void native.onTrayTogglePause(() => changePaused(!pausedRef.current)).then(
      (f) => { if (cancelled) f(); else un = f; },
      () => {},
    );
    return () => { cancelled = true; un?.(); };
  }, [changePaused]);

  const pickFolder = useCallback(async () => {
    try {
      const picked = await native.pickFolder(wowDir || undefined);
      if (picked) setWowDir(picked); // the folder effect re-runs discovery + validation
    } catch (e) {
      setFolderCheck({ ok: false, message: `Could not open the folder picker: ${errorMessage(e)}` });
    }
  }, [wowDir]);

  // Boot: load identity, replay launch deep links, subscribe to new ones.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const identity = await native.loadIdentity();
        if (cancelled) return;
        dispatch({ type: 'identity-loaded', identity });
        const code = firstPairingCode(await native.initialDeepLinks());
        if (code) dispatch({ type: 'pairing-received', code });
        const un = await native.onDeepLink((urls) => {
          const c = firstPairingCode(urls);
          if (c) dispatch({ type: 'pairing-received', code: c });
        });
        if (cancelled) un(); else unlisten = un;
      } catch (e) {
        dispatch({ type: 'identity-loaded', identity: null });
        dispatch({ type: 'create-failed', message: `Could not reach the system keychain: ${errorMessage(e)}` });
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // WoW folder: default guess when unset, then probe it for characters.
  useEffect(() => {
    if (wowDir) return;
    void native.defaultWowDir().then((d) => { if (d) setWowDir(d); }).catch(() => {});
  }, [wowDir]);

  useEffect(() => {
    if (!wowDir) {
      setCharacters([]);
      setFolderCheck({ ok: false, message: 'Enter the path to your World of Warcraft folder.' });
      return;
    }
    localStorage.setItem(WOW_DIR_KEY, wowDir);
    let stale = false;
    const t = setTimeout(() => {
      native.discoverCharacters(wowDir).then(
        (found) => {
          if (stale) return;
          setCharacters(found);
          setFolderCheck({ ok: true, message: found.length ? `Found ${found.length} character${found.length === 1 ? '' : 's'}.` : 'Folder found, but no characters in it yet.' });
        },
        (e) => {
          if (stale) return;
          setCharacters([]);
          setFolderCheck({ ok: false, message: `Can't read that folder: ${errorMessage(e)}` });
        },
      );
    }, 250);
    return () => { stale = true; clearTimeout(t); };
  }, [wowDir]);

  const identity = state.phase === 'ready' ? state.identity : null;

  const createJourney = useCallback(async (travellerName: string) => {
    dispatch({ type: 'create-submitted' });
    try {
      const [devicePublicKey, deviceName] = await Promise.all([native.ensureDevicePublicKey(), native.deviceName()]);
      const res = await api.createAccountDevice({ travellerName, devicePublicKey, deviceName, ...(characters.length ? { characters } : {}) });
      const next = { deviceId: res.device.id, deviceToken: res.deviceToken };
      await native.saveIdentity(next);
      dispatch({ type: 'create-succeeded', identity: next });
    } catch (e) {
      dispatch({ type: 'create-failed', message: errorMessage(e) });
    }
  }, [characters]);

  // Existing account on a new PC: redeem a website link code for this PC's key, then behave like a fresh sign-up.
  const linkAccount = useCallback(async (code: string) => {
    dispatch({ type: 'create-submitted' });
    try {
      const [devicePublicKey, deviceName] = await Promise.all([native.ensureDevicePublicKey(), native.deviceName()]);
      const res = await api.linkDevice({ code, devicePublicKey, deviceName });
      const next = { deviceId: res.device.id, deviceToken: res.deviceToken };
      await native.saveIdentity(next);
      dispatch({ type: 'create-succeeded', identity: next });
    } catch (e) {
      dispatch({ type: 'create-failed', message: describeLinkError(e) });
    }
  }, []);

  const approve = useCallback(async () => {
    if (state.phase !== 'ready' || !state.approval) return;
    const { code } = state.approval;
    const { deviceId, deviceToken } = state.identity;
    dispatch({ type: 'approve-submitted' });
    try {
      const signature = await native.signPairing(code);
      await api.approvePairing({ code, deviceId, signature }, deviceToken);
      dispatch({ type: 'approve-succeeded' });
    } catch (e) {
      dispatch({ type: 'approve-failed', ...classifyApproveError(e) });
    }
  }, [state]);

  // Discards the local key + token and returns to first-run (which also drops any pending code).
  const resetDevice = useCallback(async () => {
    setResetError(null);
    try {
      await native.clearIdentity();
      dispatch({ type: 'identity-cleared' });
    } catch (e) {
      setResetError(`Could not reset this device: ${errorMessage(e)}`);
    }
  }, []);

  const dismiss = useCallback(() => dispatch({ type: 'approval-dismissed' }), []);

  // Self-update: checks on start and every 6 h, but never while the approve-sign-in window is open.
  // The status window registers a flush of the upload queue here; it runs just before an update is installed.
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const [updater] = useState(() => new UpdateController(nativeUpdateDeps(() => flushRef.current())));
  useEffect(() => {
    void updater.start();
    return () => updater.stop();
  }, [updater]);
  const approvalOpen = state.phase === 'ready' && !!state.approval;
  useEffect(() => { updater.setBlocked(approvalOpen); }, [updater, approvalOpen]);

  if (state.phase === 'loading') return <main className="window" aria-busy="true" />;
  if (state.phase === 'first-run') {
    if (state.mode === 'link') {
      return (
        <LinkAccount
          linking={state.creating}
          error={state.error}
          onLink={(c) => void linkAccount(c)}
          onBack={() => dispatch({ type: 'link-closed' })}
        />
      );
    }
    return (
      <FirstRun
        characters={characters}
        creating={state.creating}
        error={state.error}
        onCreate={(n) => void createJourney(n)}
        onHaveAccount={() => dispatch({ type: 'link-opened' })}
      />
    );
  }
  if (state.approval) {
    return (
      <ApproveSignIn
        code={state.approval.code}
        state={state.approval}
        resetError={resetError}
        onApprove={() => void approve()}
        onDismiss={dismiss}
        onReset={() => void resetDevice()}
      />
    );
  }
  return (
    <StatusContainer
      deviceToken={identity!.deviceToken}
      deviceId={identity!.deviceId}
      paused={paused}
      onPausedChange={changePaused}
      onPickFolder={() => void pickFolder()}
      wowDir={wowDir}
      onWowDirChange={setWowDir}
      folderCheck={folderCheck}
      characters={characters}
      shareLive={shareLive}
      onShareLiveChange={(v) => { setShareLive(v); localStorage.setItem(SHARE_LIVE_KEY, v ? '1' : '0'); }}
      resetError={resetError}
      onReset={() => void resetDevice()}
      updater={updater}
      flushRef={flushRef}
    />
  );
}

interface ContainerProps {
  deviceToken: string;
  deviceId: string;
  paused: boolean;
  onPausedChange: (v: boolean) => void;
  onPickFolder: () => void;
  wowDir: string;
  onWowDirChange: (p: string) => void;
  folderCheck: { ok: boolean; message: string } | null;
  characters: DiscoveredCharacter[];
  shareLive: boolean;
  onShareLiveChange: (v: boolean) => void;
  resetError: string | null;
  onReset: () => void;
  updater: UpdateController;
  flushRef: { current: () => Promise<void> };
}

/** Owns the upload queue and a 1 s tick; flushes every RETRY_SECONDS. */
function StatusContainer({ deviceToken, deviceId, paused, updater, flushRef, ...rest }: ContainerProps) {
  const tokenRef = useRef(deviceToken);
  tokenRef.current = deviceToken;
  const queueRef = useRef<UploadQueue | null>(null);
  if (!queueRef.current) {
    queueRef.current = UploadQueue.load(new ApiClient({ baseUrl: API_BASE_URL, getToken: () => tokenRef.current }));
  }
  const queue = queueRef.current;
  const [now, setNow] = useState(() => Date.now());
  const [countdown, setCountdown] = useState(RETRY_SECONDS);
  const [lastSyncAt, setLastSyncAt] = useState(() => localStorage.getItem(LAST_SYNC_KEY) ?? undefined);
  const [view, setView] = useState<'status' | 'diagnostics'>('status');
  const [health, setHealth] = useState<DiagnosticsInfo['health']>(null);
  const [appVersion, setAppVersion] = useState('unknown');
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const uploadedRef = useRef(uploadedTotal(queue.getState()));

  // Pausing stops the flush loop; resuming flushes immediately.
  useEffect(() => {
    if (paused) { queue.pause(); return; }
    queue.resume();
    setCountdown(RETRY_SECONDS);
    void queue.flush();
  }, [paused, queue]);

  // Capture -> upload: read the addon's SavedVariables, register characters, queue new events (the queue uploads them).
  const [syncError, setSyncError] = useState<string | null>(null);
  const wowDirRef = useRef(rest.wowDir);
  wowDirRef.current = rest.wowDir;
  const syncing = useRef(false);
  const sync = useCallback(async () => {
    if (syncing.current || pausedRef.current || !wowDirRef.current) return;
    syncing.current = true;
    try {
      const dir = wowDirRef.current;
      const api = new ApiClient({ baseUrl: API_BASE_URL, getToken: () => tokenRef.current });
      const r = await syncSavedVariables({ readFiles: () => native.readSavedVariables(dir), api, queue, deviceId });
      setSyncError(r.errors[0] ?? null);
      if (r.queued > 0) void queue.flush();
    } catch (e) {
      setSyncError(errorMessage(e));
    } finally {
      syncing.current = false;
    }
  }, [queue, deviceId]);
  useEffect(() => {
    void sync();
    const id = setInterval(() => void sync(), SYNC_SECONDS * 1000);
    return () => clearInterval(id);
  }, [sync, rest.wowDir, paused]);

  // Before an update restarts the app: pick up fresh captures and upload what is queued. While paused the queue is
  // left alone (it is persisted and resumes after the restart).
  useEffect(() => {
    flushRef.current = async () => {
      if (pausedRef.current) return;
      await sync();
      await queue.flush();
    };
    return () => { flushRef.current = async () => {}; };
  }, [flushRef, sync, queue]);
  const update = useSyncExternalStore(updater.subscribe, updater.getState);

  useEffect(() => {
    if (view !== 'diagnostics') return;
    let stale = false;
    setHealth(null);
    void checkHealth(API_BASE_URL).then((h) => { if (!stale) setHealth(h); });
    void getVersion().then((v) => { if (!stale) setAppVersion(v); }).catch(() => {});
    return () => { stale = true; };
  }, [view]);

  useEffect(() => {
    let remaining = RETRY_SECONDS;
    const id = setInterval(() => {
      setNow(Date.now());
      if (pausedRef.current) return;
      remaining -= 1;
      if (remaining <= 0) {
        remaining = RETRY_SECONDS;
        void queue.flush();
      }
      setCountdown(remaining);
      const uploaded = uploadedTotal(queue.getState());
      if (uploaded > uploadedRef.current) {
        uploadedRef.current = uploaded;
        const iso = new Date().toISOString();
        localStorage.setItem(LAST_SYNC_KEY, iso);
        setLastSyncAt(iso);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [queue]);

  const q = { ...queue.getState() };
  const status = statusView(q, lastSyncAt, now, countdown, paused);

  if (view === 'diagnostics') {
    const info: DiagnosticsInfo = {
      appVersion,
      updates: describeUpdate(update),
      apiUrl: API_BASE_URL,
      health,
      websiteUrl: WEBSITE_URL,
      deviceId,
      queuedEvents: status.eventsWaiting,
      paused,
      wowDir: rest.wowDir,
      folderCheck: rest.folderCheck,
      lastSync: status.lastSync,
      lastError: syncError ?? [...q.batches].reverse().find((b) => b.lastError)?.lastError ?? null,
    };
    return (
      <Diagnostics
        info={info}
        onBack={() => setView('status')}
        update={update}
        onCheckUpdate={() => void updater.check(true)}
        onInstallUpdate={() => void updater.install()}
        onRetryUpdate={() => void updater.retry()}
      />
    );
  }
  return (
    <StatusWindow
      status={status}
      paused={paused}
      onOpenWebsite={() => void native.openWebsite()}
      onOpenDiagnostics={() => setView('diagnostics')}
      update={update}
      onInstallUpdate={() => void updater.install()}
      onRetryUpdate={() => void updater.retry()}
      {...rest}
    />
  );
}
