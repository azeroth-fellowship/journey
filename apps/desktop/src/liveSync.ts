// SPDX-License-Identifier: GPL-3.0-only

export interface LiveSyncHandle {
  close: () => void;
}

/** Convert an http(s) base URL to a ws(s) URL for the API's /ws endpoint. */
export function wsUrl(baseUrl: string): string {
  const u = new URL(baseUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/ws';
  u.search = '';
  return u.toString();
}

/**
 * Open a WebSocket to the API for live sync / presence. Calls `onSync` whenever
 * the socket opens or a message arrives, so the caller can re-run capture+upload.
 * Returns a handle whose `close()` tears the socket down. Reconnects on drop
 * while `active` stays true.
 */
export function connectLiveSync(
  baseUrl: string,
  token: string | undefined,
  onSync: () => void,
  active: () => boolean,
): LiveSyncHandle {
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const connect = () => {
    if (closed || !active()) return;
    try {
      socket = new WebSocket(wsUrl(baseUrl));
    } catch {
      scheduleReconnect();
      return;
    }
    socket.onopen = () => {
      if (token) socket?.send(JSON.stringify({ type: 'auth', token }));
      onSync();
    };
    socket.onmessage = () => { onSync(); };
    socket.onclose = () => { socket = null; scheduleReconnect(); };
    socket.onerror = () => { try { socket?.close(); } catch { /* ignore */ } };
  };

  const scheduleReconnect = () => {
    if (closed || !active()) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 5000);
  };

  connect();

  return {
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try { socket?.close(); } catch { /* ignore */ }
      socket = null;
    },
  };
}