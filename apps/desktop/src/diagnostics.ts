// SPDX-License-Identifier: GPL-3.0-only
export interface DiagnosticsInfo {
  appVersion: string;
  /** Update status line; omitted when unknown. */
  updates?: string;
  apiUrl: string;
  /** Result of a live GET /health; null while checking. */
  health: { ok: boolean; message: string } | null;
  websiteUrl: string;
  deviceId: string | null;
  queuedEvents: number;
  paused: boolean;
  wowDir: string;
  folderCheck: { ok: boolean; message: string } | null;
  lastSync: string;
  lastError: string | null;
}

/** Strips anything that looks like a credential. Defence in depth: the report never includes the token or key to begin with. */
export function redact(text: string): string {
  return text
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]')
    .replace(/((?:token|secret|private[ _-]?key|password|authorization)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1[redacted]');
}

export function buildReport(d: DiagnosticsInfo): string {
  const lines = [
    `App version: ${d.appVersion}`,
    ...(d.updates ? [`Updates: ${d.updates}`] : []),
    `API: ${d.apiUrl} (${d.health ? `${d.health.ok ? 'OK' : 'FAILED'} - ${d.health.message}` : 'checking'})`,
    `Website: ${d.websiteUrl}`,
    `Device identity: ${d.deviceId ? `present (device ${d.deviceId})` : 'none'}`,
    `Syncing: ${d.paused ? 'paused' : 'active'}`,
    `Events waiting: ${d.queuedEvents}`,
    `WoW folder: ${d.wowDir || '(not set)'} (${d.folderCheck ? `${d.folderCheck.ok ? 'valid' : 'invalid'} - ${d.folderCheck.message}` : 'checking'})`,
    `Last sync: ${d.lastSync}`,
    `Last error: ${d.lastError ?? 'none'}`,
  ];
  return redact(lines.join('\n'));
}

/** GET {apiUrl}/health with a timeout. Never throws. */
export async function checkHealth(apiUrl: string, fetchFn: typeof fetch = fetch, timeoutMs = 5000): Promise<{ ok: boolean; message: string }> {
  const started = Date.now();
  try {
    const res = await fetchFn(`${apiUrl.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    const ms = Date.now() - started;
    return res.ok ? { ok: true, message: `HTTP ${res.status}, ${ms} ms` } : { ok: false, message: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
