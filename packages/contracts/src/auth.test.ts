// SPDX-License-Identifier: GPL-3.0-only
import { describe, it, expect } from 'vitest';
import {
  CreateAccountDeviceRequest,
  CreatePairingResponse,
  ApprovePairingRequest,
  PairingStatus,
  Credential,
} from './index';

const key = 'A'.repeat(43) + '=';
const sig = 'A'.repeat(86) + '==';

describe('auth schemas', () => {
  it('parses a create-account request with optional characters', () => {
    const r = CreateAccountDeviceRequest.parse({ travellerName: 'Wolf_1', devicePublicKey: key, deviceName: 'Desktop' });
    expect(r.characters).toBeUndefined();
    expect(() => CreateAccountDeviceRequest.parse({ travellerName: 'x', devicePublicKey: key, deviceName: 'd' })).toThrow();
    expect(() => CreateAccountDeviceRequest.parse({ travellerName: 'Wolf', devicePublicKey: 'short', deviceName: 'd' })).toThrow();
  });

  it('validates pairing code format and approve request', () => {
    expect(ApprovePairingRequest.parse({ code: 'WOLF-3K7P', deviceId: 'd1', signature: sig }).code).toBe('WOLF-3K7P');
    expect(() => ApprovePairingRequest.parse({ code: 'wolf-3k7p', deviceId: 'd1', signature: sig })).toThrow();
    expect(() => ApprovePairingRequest.parse({ code: 'WOLF-3K7P', deviceId: 'd1', signature: 'bad' })).toThrow();
    expect(CreatePairingResponse.parse({ code: 'WOLF-3K7P', expiresAt: '2026-10-29T12:00:00.000Z', secret: 's' }).secret).toBe('s');
  });

  it('restricts enums', () => {
    expect(PairingStatus.options).toEqual(['pending', 'approved', 'expired', 'consumed']);
    expect(() => Credential.parse({ id: '1', userId: 'u', type: 'password', identifier: 'x', createdAt: '2026-10-29T12:00:00.000Z' })).toThrow();
  });
});
