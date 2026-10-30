// SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { buildReport, checkHealth, redact, type DiagnosticsInfo } from './diagnostics';

const base: DiagnosticsInfo = {
  appVersion: '0.0.0',
  apiUrl: 'http://localhost:3001',
  health: { ok: true, message: 'HTTP 200, 4 ms' },
  websiteUrl: 'http://localhost:3000',
  deviceId: 'dev-1',
  queuedEvents: 3,
  paused: false,
  wowDir: 'C:\WoW\_retail_',
  folderCheck: { ok: true, message: 'Found 2 characters.' },
  lastSync: '2 min ago',
  lastError: null,
};

describe('redact', () => {
  it('hides tokens and bearer values', () => {
    expect(redact('Authorization: Bearer abc.def-123')).not.toContain('abc.def');
    expect(redact('deviceToken=s3cr3t')).toBe('deviceToken=[redacted]');
    expect(redact('{"token":"xyz"}')).not.toContain('xyz');
  });
});

describe('buildReport', () => {
  it('includes the device id and redacts secrets in errors', () => {
    const r = buildReport({ ...base, lastError: 'failed: token=abc123' });
    expect(r).toContain('device dev-1');
    expect(r).toContain('Events waiting: 3');
    expect(r).not.toContain('abc123');
  });
  it('reports no identity', () => {
    expect(buildReport({ ...base, deviceId: null })).toContain('Device identity: none');
  });
});

describe('checkHealth', () => {
  it('ok / http error / network error', async () => {
    expect((await checkHealth('http://x/', vi.fn().mockResolvedValue({ ok: true, status: 200 }) as never)).ok).toBe(true);
    expect(await checkHealth('http://x', vi.fn().mockResolvedValue({ ok: false, status: 500 }) as never)).toEqual({ ok: false, message: 'HTTP 500' });
    expect(await checkHealth('http://x', vi.fn().mockRejectedValue(new Error('boom')) as never)).toEqual({ ok: false, message: 'boom' });
  });
});
