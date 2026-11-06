// SPDX-License-Identifier: GPL-3.0-only

export interface LiveSyncHandle {
  close: () => void;
}

/** What the companion tells the API about the character being played. */
export interface LivePresence {
  characterId: string;
  zone?: string;
  level?: number;
}

export const HEARTBEAT_MS = 20_000;
const RECONNECT_MS = 5_000;

/** Convert an http(s) base URL to a ws(s) URL for the API's /ws endpoint. */
export function wsUrl(baseUrl: string): string {
  const u = new URL(baseUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/ws';
  u.search = '';
  return u.toString();
}

/**
 * Keeps a WebSocket to the API open while `active()` is true. A browser WebSocket cannot send an Authorization
 * header, so the first message is `{ type: 'auth', token }`. After that a presence heartbeat goes out every
 * HEARTBEAT_MS (and at once on open), so the API sees the character as online while this socket lives and as
 * offline as soon as it drops. Reconnects while `active()` stays true.
 */
export function connectLiveSync(
  baseUrl: string,
  getToken: () => string | undefined,
  getPresence: () => LivePresence | undefined,
  active: () => boolean,
): LiveSyncHandle {
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let beatTimer: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const beat = () => {
    const p = getPresence();
    if (!p || !socket || socket.readyState !== 1) return;
    try { socket.send(JSON.stringify({ type: 'presence', ...p })); } catch { /* the close handler reconnects */ }
  };

  const stopBeat = () => { if (beatTimer) clearInterval(beatTimer); beatTimer = undefined; };

  const scheduleReconnect = () => {
    if (closed || !active()) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, RECONNECT_MS);
  };

  function connect() {
    const token = getToken();
    if (closed || !active() || !token) { scheduleReconnect(); return; }
    let s: WebSocket;
    try {
      s = new WebSocket(wsUrl(baseUrl));
    } catch {
      scheduleReconnect();
      return;
    }
    socket = s;
    s.onopen = () => {
      s.send(JSON.stringify({ type: 'auth', token }));
      beat();
      stopBeat();
      beatTimer = setInterval(beat, HEARTBEAT_MS);
    };
    s.onclose = () => { stopBeat(); if (socket === s) socket = null; scheduleReconnect(); };
    s.onerror = () => { try { s.close(); } catch { /* ignore */ } };
  }

  connect();

  return {
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      stopBeat();
      try { socket?.close(); } catch { /* ignore */ }
      socket = null;
    },
  };
}
