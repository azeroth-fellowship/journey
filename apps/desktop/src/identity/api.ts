// SPDX-License-Identifier: GPL-3.0-only
import {
  ApprovePairingRequest,
  ApprovePairingResponse,
  CreateAccountDeviceRequest,
  CreateAccountDeviceResponse,
  LinkDeviceRequest,
  LinkDeviceResponse,
} from '@azeroth/contracts';

export class IdentityApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'IdentityApiError';
  }
}

export type ApproveFailureKind = 'device-unregistered';

export interface ApproveFailure {
  message: string;
  kind?: ApproveFailureKind;
}

/**
 * The server answers 401 for both an unknown device and a bad signature, so a 401 on approve
 * most likely means this device's identity is stale (e.g. the server store was reset).
 */
export function classifyApproveError(e: unknown): ApproveFailure {
  if (e instanceof IdentityApiError && e.status === 401) return { message: e.message, kind: 'device-unregistered' };
  return { message: e instanceof Error ? e.message : String(e) };
}

/** User-facing text for a failed link attempt; the API gives the same 400 for unknown, expired and used codes. */
export function describeLinkError(e: unknown): string {
  if (e instanceof IdentityApiError) {
    if (e.status === 400) return 'That code is not valid or has expired. Create a new one on the website and try again.';
    if (e.status === 429) return 'Too many attempts. Wait a few minutes, then try again.';
    if (e.status === 409) return 'This computer is already linked to an account. Close and reopen the companion.';
  }
  return e instanceof Error ? e.message : String(e);
}

export interface IdentityApi {
  createAccountDevice(req: CreateAccountDeviceRequest): Promise<CreateAccountDeviceResponse>;
  linkDevice(req: LinkDeviceRequest): Promise<LinkDeviceResponse>;
  approvePairing(req: ApprovePairingRequest, deviceToken: string): Promise<ApprovePairingResponse>;
}

export function createIdentityApi(baseUrl: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): IdentityApi {
  async function post(path: string, body: unknown, token?: string): Promise<unknown> {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let message = `Request failed (${res.status})`;
      try {
        const err = (await res.json()) as { error?: unknown };
        if (typeof err?.error === 'string') message = err.error;
      } catch { /* non-JSON error body */ }
      throw new IdentityApiError(res.status, message);
    }
    return res.json();
  }

  return {
    async createAccountDevice(req) {
      const body = CreateAccountDeviceRequest.parse(req);
      return CreateAccountDeviceResponse.parse(await post('/accounts/device', body));
    },
    async linkDevice(req) {
      const body = LinkDeviceRequest.parse(req);
      return LinkDeviceResponse.parse(await post('/accounts/device/link', body));
    },
    async approvePairing(req, deviceToken) {
      const body = ApprovePairingRequest.parse(req);
      return ApprovePairingResponse.parse(await post('/auth/pairing/approve', body, deviceToken));
    },
  };
}
