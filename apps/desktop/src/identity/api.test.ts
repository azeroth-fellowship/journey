// SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { classifyApproveError, createIdentityApi, describeLinkError, IdentityApiError } from './api';

const KEY = 'A'.repeat(43) + '=';
const SIG = 'B'.repeat(86) + '==';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const accountResponse = {
  user: { id: 'u1', travellerName: 'Tester', createdAt: '2026-01-01T00:00:00.000Z' },
  device: { id: 'd1', userId: 'u1', publicKey: KEY, name: 'PC', createdAt: '2026-01-01T00:00:00.000Z' },
  deviceToken: 'tok-123',
};

describe('identity api', () => {
  it('createAccountDevice posts the request and parses the response', async () => {
    const fetchMock = vi.fn(async () => json(201, accountResponse));
    const api = createIdentityApi('http://api', fetchMock as unknown as typeof fetch);
    const res = await api.createAccountDevice({ travellerName: 'Tester', devicePublicKey: KEY, deviceName: 'PC' });
    expect(res.deviceToken).toBe('tok-123');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api/accounts/device');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ travellerName: 'Tester', devicePublicKey: KEY, deviceName: 'PC' });
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('rejects an invalid request without calling fetch', async () => {
    const fetchMock = vi.fn();
    const api = createIdentityApi('http://api', fetchMock as unknown as typeof fetch);
    await expect(api.createAccountDevice({ travellerName: 'x', devicePublicKey: KEY, deviceName: 'PC' })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces the API error message and status', async () => {
    const api = createIdentityApi('http://api', (async () => json(409, { error: 'name taken' })) as unknown as typeof fetch);
    const err = await api.createAccountDevice({ travellerName: 'Tester', devicePublicKey: KEY, deviceName: 'PC' }).catch((e) => e);
    expect(err).toBeInstanceOf(IdentityApiError);
    expect(err).toMatchObject({ status: 409, message: 'name taken' });
  });

  it('falls back to a generic message for non-JSON errors', async () => {
    const api = createIdentityApi('http://api', (async () => new Response('boom', { status: 502 })) as unknown as typeof fetch);
    await expect(api.approvePairing({ code: 'WOLF-3K7P', deviceId: 'd1', signature: SIG }, 't')).rejects.toMatchObject({
      status: 502,
      message: 'Request failed (502)',
    });
  });

  it('approvePairing sends the bearer token', async () => {
    const fetchMock = vi.fn(async () => json(200, { status: 'approved' }));
    const api = createIdentityApi('http://api', fetchMock as unknown as typeof fetch);
    await expect(api.approvePairing({ code: 'WOLF-3K7P', deviceId: 'd1', signature: SIG }, 'tok-123')).resolves.toEqual({ status: 'approved' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api/auth/pairing/approve');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
  });

  it('classifies an approve 401 as device-unregistered and keeps other messages', () => {
    expect(classifyApproveError(new IdentityApiError(401, 'invalid signature'))).toEqual({ message: 'invalid signature', kind: 'device-unregistered' });
    expect(classifyApproveError(new IdentityApiError(410, 'code expired'))).toEqual({ message: 'code expired' });
    expect(classifyApproveError(new IdentityApiError(502, 'Request failed (502)'))).toEqual({ message: 'Request failed (502)' });
    expect(classifyApproveError(new Error('network down'))).toEqual({ message: 'network down' });
    expect(classifyApproveError('weird')).toEqual({ message: 'weird' });
  });

  it('linkDevice posts the code and key without auth and parses the response', async () => {
    const fetchMock = vi.fn(async () => json(201, accountResponse));
    const api = createIdentityApi('http://api', fetchMock as unknown as typeof fetch);
    const res = await api.linkDevice({ code: 'LINK-8H2Q-K7ZM', devicePublicKey: KEY, deviceName: 'PC' });
    expect(res).toMatchObject({ deviceToken: 'tok-123', user: { travellerName: 'Tester' } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api/accounts/device/link');
    expect(JSON.parse(init.body as string)).toEqual({ code: 'LINK-8H2Q-K7ZM', devicePublicKey: KEY, deviceName: 'PC' });
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('linkDevice rejects a malformed code locally and maps server errors to friendly text', async () => {
    const fetchMock = vi.fn();
    const local = createIdentityApi('http://api', fetchMock as unknown as typeof fetch);
    await expect(local.linkDevice({ code: 'bad', devicePublicKey: KEY, deviceName: 'PC' })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();

    const fail = async (status: number) => {
      const api = createIdentityApi('http://api', (async () => json(status, { error: 'raw' })) as unknown as typeof fetch);
      return describeLinkError(await api.linkDevice({ code: 'LINK-8H2Q-K7ZM', devicePublicKey: KEY, deviceName: 'PC' }).catch((e) => e));
    };
    expect(await fail(400)).toMatch(/not valid or has expired/);
    expect(await fail(429)).toMatch(/too many attempts/i);
    expect(await fail(409)).toMatch(/already linked/);
    expect(await fail(500)).toBe('raw');
    expect(describeLinkError(new Error('network down'))).toBe('network down');
  });

  it('rejects malformed success responses', async () => {
    const api = createIdentityApi('http://api', (async () => json(200, { nope: true })) as unknown as typeof fetch);
    await expect(api.approvePairing({ code: 'WOLF-3K7P', deviceId: 'd1', signature: SIG }, 't')).rejects.toThrow();
  });
});
