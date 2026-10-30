// SPDX-License-Identifier: GPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from './index';

const user = { id: 'u1', travellerName: 'Wolf', createdAt: '2026-01-01T00:00:00.000Z' };
const device = {
  id: 'd1',
  userId: 'u1',
  publicKey: 'A'.repeat(43) + '=',
  name: 'Desktop',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(body === undefined ? null : JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('ApiClient auth', () => {
  const client = new ApiClient({ baseUrl: '/api', credentials: 'include' });

  it('createPairing POSTs and validates', async () => {
    const f = mockFetch(201, { code: 'WOLF-3K7P', expiresAt: '2026-01-01T00:10:00.000Z', secret: 's' });
    expect((await client.createPairing()).code).toBe('WOLF-3K7P');
    expect(f).toHaveBeenCalledWith('/api/auth/pairing', expect.objectContaining({ method: 'POST', credentials: 'include' }));
  });

  it('getPairingStatus sends the secret header', async () => {
    const f = mockFetch(200, { status: 'approved', expiresAt: '2026-01-01T00:10:00.000Z', user });
    expect((await client.getPairingStatus('WOLF-3K7P', 'sec')).user?.travellerName).toBe('Wolf');
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toMatchObject({ 'X-Pairing-Secret': 'sec' });
  });

  it('me, listDevices, revokeDevice, logout', async () => {
    mockFetch(200, { user });
    expect((await client.me()).user.id).toBe('u1');
    mockFetch(200, { devices: [device] });
    expect(await client.listDevices()).toHaveLength(1);
    const f = mockFetch(200, { device: { ...device, revokedAt: '2026-01-02T00:00:00.000Z' } });
    expect((await client.revokeDevice('d1')).revokedAt).toBeDefined();
    expect(f.mock.calls[0]![0]).toBe('/api/devices/d1/revoke');
    const g = mockFetch(204);
    await expect(client.logout()).resolves.toBeUndefined();
    expect(g.mock.calls[0]![0]).toBe('/api/auth/logout');
  });

  it('throws ApiError with the API error text', async () => {
    mockFetch(401, { error: 'unauthenticated' });
    await expect(client.me()).rejects.toMatchObject({ status: 401, message: 'unauthenticated' });
    await expect(client.me()).rejects.toBeInstanceOf(ApiError);
  });

  it('rejects malformed responses', async () => {
    mockFetch(200, { user: { id: 1 } });
    await expect(client.me()).rejects.toThrow();
  });

  it('omits credentials when not configured', async () => {
    const f = mockFetch(200, { user });
    await new ApiClient({ baseUrl: '' }).me();
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1]).not.toHaveProperty('credentials');
  });
});
