// SPDX-License-Identifier: GPL-3.0-only
import {
  type AddEmailRequest,
  type Character,
  CharacterJourneyResponse,
  EventPageResponse,
  type EventType,
  ListCharactersResponse,
  type Session,
  ConsumeEmailTokenResponse,
  CreateDeviceResponse,
  CreateLinkCodeResponse,
  CreatePairingResponse,
  DungeonIndexResponse,
  DungeonProgressResponse,
  FriendDungeonsResponse,
  type Credential,
  type Device,
  EmailSentResponse,
  FriendActivityResponse,
  FriendRequestSentResponse,
  FriendRequestsResponse,
  ListFriendsResponse,
  ListCredentialsResponse,
  PasskeyLoginResponse,
  PasskeyOptionsResponse,
  PasskeyRegisterResponse,
  ListDevicesResponse,
  MeResponse,
  PairingStatusResponse,
  PublicJourney,
  RevokeDeviceResponse,
  type SharingScope,
  SharingSettings,
  type UpdateSharingRequest,
  type UploadBatchRequest,
  type UploadBatchResponse,
} from '@azeroth/contracts';

export interface JourneyPageOptions {
  cursor?: string | undefined;
  limit?: number | undefined;
  order?: 'asc' | 'desc' | undefined;
  types?: readonly EventType[] | undefined;
  /** Journey route only: also return at most N location/zone_changed events spread over the whole journey. */
  routeSample?: number | undefined;
}

function pageQuery(o: JourneyPageOptions): string {
  const q = new URLSearchParams();
  if (o.cursor) q.set('cursor', o.cursor);
  if (o.limit !== undefined) q.set('limit', String(o.limit));
  if (o.order) q.set('order', o.order);
  if (o.types?.length) q.set('types', o.types.join(','));
  if (o.routeSample) q.set('routeSample', String(o.routeSample));
  const qs = q.toString();
  return qs ? `?${qs}` : '';
}

/** Non-2xx API response; `message` is the API's `{error}` text when present. */
export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  getToken?: () => string | undefined;
  /** Pass 'include' to send/receive the session cookie cross-origin (same-origin proxies don't need it). */
  credentials?: RequestCredentials;
  /** Sent on every request (server-side callers: the visitor's `cookie`, `x-forwarded-for`). */
  headers?: Record<string, string>;
  /** Abort a request after this long (undefined: no limit). */
  timeoutMs?: number;
}

export class ApiClient {
  constructor(private readonly options: ApiClientOptions) {}

  private headers(): HeadersInit {
    const token = this.options.getToken?.();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  private async request<T = void>(
    schema: { parse(data: unknown): T } | undefined,
    path: string,
    init: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
  ): Promise<T> {
    const res = await fetch(`${this.options.baseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers: { ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...this.options.headers, ...this.headers(), ...init.headers },
      ...(this.options.timeoutMs ? { signal: AbortSignal.timeout(this.options.timeoutMs) } : {}),
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      ...(this.options.credentials ? { credentials: this.options.credentials } : {}),
    });
    if (!res.ok) {
      let message = `request failed: ${res.status}`;
      try {
        const body = (await res.json()) as { error?: unknown };
        if (typeof body?.error === 'string') message = body.error;
      } catch { /* non-JSON error body */ }
      throw new ApiError(res.status, message);
    }
    if (!schema) return undefined as T;
    return schema.parse(await res.json());
  }

  createPairing(): Promise<CreatePairingResponse> {
    return this.request(CreatePairingResponse, '/auth/pairing', { method: 'POST' });
  }

  getPairingStatus(code: string, secret: string): Promise<PairingStatusResponse> {
    return this.request(PairingStatusResponse, `/auth/pairing/${encodeURIComponent(code)}`, {
      headers: { 'X-Pairing-Secret': secret },
    });
  }

  me(): Promise<MeResponse> {
    return this.request(MeResponse, '/auth/me');
  }

  async logout(): Promise<void> {
    await this.request(undefined, '/auth/logout', { method: 'POST' });
  }

  async listDevices(): Promise<Device[]> {
    return (await this.request(ListDevicesResponse, '/devices')).devices;
  }

  async revokeDevice(id: string): Promise<Device> {
    return (await this.request(RevokeDeviceResponse, `/devices/${encodeURIComponent(id)}/revoke`, { method: 'POST' })).device;
  }

  // ---- recovery ----

  passkeyRegisterOptions(): Promise<PasskeyOptionsResponse> {
    return this.request(PasskeyOptionsResponse, '/auth/passkeys/register/options', { method: 'POST' });
  }

  async passkeyRegisterVerify(challengeId: string, response: Record<string, unknown>): Promise<Credential> {
    return (await this.request(PasskeyRegisterResponse, '/auth/passkeys/register/verify', { method: 'POST', body: { challengeId, response } })).credential;
  }

  passkeyLoginOptions(): Promise<PasskeyOptionsResponse> {
    return this.request(PasskeyOptionsResponse, '/auth/passkeys/login/options', { method: 'POST' });
  }

  passkeyLoginVerify(challengeId: string, response: Record<string, unknown>): Promise<PasskeyLoginResponse> {
    return this.request(PasskeyLoginResponse, '/auth/passkeys/login/verify', { method: 'POST', body: { challengeId, response } });
  }

  async listCredentials(): Promise<Credential[]> {
    return (await this.request(ListCredentialsResponse, '/auth/credentials')).credentials;
  }

  async deleteCredential(id: string): Promise<void> {
    await this.request(undefined, `/auth/credentials/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async addEmail(email: AddEmailRequest['email']): Promise<void> {
    await this.request(EmailSentResponse, '/auth/email', { method: 'POST', body: { email } });
  }

  async requestEmailLogin(email: string): Promise<void> {
    await this.request(EmailSentResponse, '/auth/email/login', { method: 'POST', body: { email } });
  }

  consumeEmailToken(token: string): Promise<ConsumeEmailTokenResponse> {
    return this.request(ConsumeEmailTokenResponse, '/auth/email/consume', { method: 'POST', body: { token } });
  }

  createDevice(devicePublicKey: string, deviceName: string): Promise<CreateDeviceResponse> {
    return this.request(CreateDeviceResponse, '/devices', { method: 'POST', body: { devicePublicKey, deviceName } });
  }

  createLinkCode(): Promise<CreateLinkCodeResponse> {
    return this.request(CreateLinkCodeResponse, '/devices/link-codes', { method: 'POST' });
  }

  // ---- characters and journeys ----

  listCharacters(): Promise<Character[]> {
    return this.request(ListCharactersResponse, '/v1/characters');
  }

  /**
   * One page of a journey, newest first unless `order: 'asc'`, with aggregates over the whole journey.
   * 404 (ApiError.status) for unknown and not-yours alike.
   */
  getCharacterJourney(characterId: string, page: JourneyPageOptions = {}): Promise<CharacterJourneyResponse> {
    return this.request(CharacterJourneyResponse, `/v1/characters/${encodeURIComponent(characterId)}/journey${pageQuery(page)}`);
  }

  /** Events only (the next page after a journey's `nextCursor`). */
  getCharacterEvents(characterId: string, page: JourneyPageOptions = {}): Promise<EventPageResponse> {
    return this.request(EventPageResponse, `/v1/characters/${encodeURIComponent(characterId)}/events${pageQuery(page)}`);
  }

  /** Upsert; the server keeps the owner's sharing choice. */
  async registerCharacter(character: Character): Promise<void> {
    await this.request(undefined, '/v1/characters', { method: 'POST', body: character });
  }

  async upsertSession(session: Session): Promise<void> {
    await this.request(undefined, '/v1/sessions', { method: 'POST', body: session });
  }

  // ---- sharing ----

  getSharing(characterId: string): Promise<SharingSettings> {
    return this.request(SharingSettings, `/v1/characters/${encodeURIComponent(characterId)}/sharing`);
  }

  updateSharing(characterId: string, patch: UpdateSharingRequest): Promise<SharingSettings> {
    return this.request(SharingSettings, `/v1/characters/${encodeURIComponent(characterId)}/sharing`, { method: 'PATCH', body: patch });
  }

  rotatePublicLink(characterId: string): Promise<SharingSettings> {
    return this.request(SharingSettings, `/v1/characters/${encodeURIComponent(characterId)}/sharing/public-link/rotate`, { method: 'POST' });
  }

  setGrant(characterId: string, userId: string, scope: SharingScope): Promise<SharingSettings> {
    return this.request(SharingSettings, `/v1/characters/${encodeURIComponent(characterId)}/sharing/grants/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      body: { scope },
    });
  }

  revokeGrant(characterId: string, userId: string): Promise<SharingSettings> {
    return this.request(SharingSettings, `/v1/characters/${encodeURIComponent(characterId)}/sharing/grants/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    });
  }

  // ---- friends ----

  /** Always resolves the same way (202) whether or not the traveller exists. */
  async sendFriendRequest(travellerName: string): Promise<void> {
    await this.request(FriendRequestSentResponse, '/v1/friend-requests', { method: 'POST', body: { travellerName } });
  }

  listFriends(): Promise<ListFriendsResponse> {
    return this.request(ListFriendsResponse, '/v1/friends');
  }

  listFriendRequests(): Promise<FriendRequestsResponse> {
    return this.request(FriendRequestsResponse, '/v1/friend-requests');
  }

  /** What each friend lets the caller see. */
  getFriendActivity(): Promise<FriendActivityResponse> {
    return this.request(FriendActivityResponse, '/v1/friends/activity');
  }

  /** Per-dungeon progress of one character (own, or a friend's with view_history). */
  getCharacterDungeons(characterId: string): Promise<DungeonProgressResponse> {
    return this.request(DungeonProgressResponse, `/v1/characters/${encodeURIComponent(characterId)}/dungeons`);
  }

  /** Who among friends has progress in this dungeon (only characters shared with view_history). */
  getFriendDungeons(dungeonId: string): Promise<FriendDungeonsResponse> {
    return this.request(FriendDungeonsResponse, `/v1/friends/dungeons?dungeonId=${encodeURIComponent(dungeonId)}`);
  }

  /** Dungeons known across the caller's and friends' visible characters (for a picker). */
  getDungeonIndex(): Promise<DungeonIndexResponse> {
    return this.request(DungeonIndexResponse, '/v1/friends/dungeons/index');
  }

  async acceptFriendRequest(id: string): Promise<void> {
    await this.request(undefined, `/v1/friend-requests/${encodeURIComponent(id)}/accept`, { method: 'POST' });
  }

  async declineFriendRequest(id: string): Promise<void> {
    await this.request(undefined, `/v1/friend-requests/${encodeURIComponent(id)}/decline`, { method: 'POST' });
  }

  /** The sender withdraws a pending request. */
  async cancelFriendRequest(id: string): Promise<void> {
    await this.request(undefined, `/v1/friend-requests/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async unfriend(userId: string): Promise<void> {
    await this.request(undefined, `/v1/friends/${encodeURIComponent(userId)}`, { method: 'DELETE' });
  }

  /** No auth. 404 (ApiError.status) for unknown and revoked slugs alike. */
  getPublicJourney(slug: string): Promise<PublicJourney> {
    return this.request(PublicJourney, `/public/journeys/${encodeURIComponent(slug)}`);
  }

  async uploadBatch(request: UploadBatchRequest): Promise<UploadBatchResponse> {
    const res = await fetch(`${this.options.baseUrl}/v1/uploads/batches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.options.headers, ...this.headers() },
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error(`uploadBatch failed: ${res.status}`);
    return (await res.json()) as UploadBatchResponse;
  }

  async uploadBatchWithRetry(
    request: UploadBatchRequest,
    options: { maxAttempts?: number; baseDelayMs?: number } = {},
  ): Promise<UploadBatchResponse> {
    const maxAttempts = options.maxAttempts ?? 3;
    const baseDelayMs = options.baseDelayMs ?? 10;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.uploadBatch(request);
      } catch (err) {
        lastError = err;
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, baseDelayMs * attempt));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('uploadBatchWithRetry failed');
  }
}

export type { ConsumeEmailTokenResponse, CreateDeviceResponse, CreateLinkCodeResponse, Credential, PasskeyOptionsResponse, PasskeyLoginResponse, CreatePairingResponse, Device, MeResponse, PairingStatusResponse, UploadBatchRequest, UploadBatchResponse };