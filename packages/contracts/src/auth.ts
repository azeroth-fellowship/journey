// SPDX-License-Identifier: GPL-3.0-only
import { z } from 'zod';
import { Id, IsoTimestamp } from './common';

/** Domain-separation prefix: the device signs `PAIRING_SIGNATURE_PREFIX + code` (UTF-8). */
export const PAIRING_SIGNATURE_PREFIX = 'azeroth-pairing:v1:';

/** Raw 32-byte Ed25519 public key, standard base64 (44 chars). */
export const Ed25519PublicKey = z.string().regex(/^[A-Za-z0-9+/]{43}=$/, 'expected base64 raw Ed25519 public key');

/** Raw 64-byte Ed25519 signature, standard base64 (88 chars). */
export const Ed25519Signature = z.string().regex(/^[A-Za-z0-9+/]{86}==$/, 'expected base64 Ed25519 signature');

/** Unique handle friends use to find a user. */
export const TravellerName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{2,23}$/, '3-24 chars: letters, digits, _ or -');

/** Pairing code shown on the website, e.g. WOLF-3K7P. */
export const PairingCodeString = z.string().regex(/^[A-Z]{4}-[A-Z0-9]{4}$/);

export const AuthUser = z.object({
  id: Id,
  travellerName: TravellerName,
  createdAt: IsoTimestamp,
});

export const Device = z.object({
  id: Id,
  userId: Id,
  publicKey: Ed25519PublicKey,
  name: z.string().min(1).max(80),
  createdAt: IsoTimestamp,
  revokedAt: IsoTimestamp.optional(),
});

export const PairingStatus = z.enum(['pending', 'approved', 'expired', 'consumed']);

export const PairingCode = z.object({
  code: PairingCodeString,
  createdAt: IsoTimestamp,
  expiresAt: IsoTimestamp,
  approvedByDeviceId: Id.optional(),
  approvedAt: IsoTimestamp.optional(),
  consumedAt: IsoTimestamp.optional(),
});

export const CredentialType = z.enum(['passkey', 'email']);

export const Credential = z.object({
  id: Id,
  userId: Id,
  type: CredentialType,
  /** Passkey credential id or email address, depending on type. */
  identifier: z.string().min(1),
  createdAt: IsoTimestamp,
  revokedAt: IsoTimestamp.optional(),
  /** Email credentials only count as recovery once verified; passkeys are verified on creation. */
  verifiedAt: IsoTimestamp.optional(),
});

export const AuthSession = z.object({
  id: Id,
  userId: Id,
  approvedByDeviceId: Id.optional(),
  createdAt: IsoTimestamp,
  expiresAt: IsoTimestamp,
  revokedAt: IsoTimestamp.optional(),
});

// ---- requests / responses ----

export const DiscoveredCharacter = z.object({
  name: z.string().min(1),
  realm: z.string().optional(),
  race: z.string().optional(),
  class: z.string().optional(),
  level: z.number().int().min(1).optional(),
});

export const CreateAccountDeviceRequest = z.object({
  travellerName: TravellerName,
  devicePublicKey: Ed25519PublicKey,
  deviceName: z.string().min(1).max(80),
  characters: z.array(DiscoveredCharacter).optional(),
});

export const CreateAccountDeviceResponse = z.object({
  user: AuthUser,
  device: Device,
  /** Bearer token for the companion. Returned once; the server stores only a hash. */
  deviceToken: z.string().min(1),
});

export const CreatePairingResponse = z.object({
  code: PairingCodeString,
  expiresAt: IsoTimestamp,
  /** Browser-bound secret; returned only here. Send as `X-Pairing-Secret` when polling. */
  secret: z.string().min(1),
});

export const PairingStatusResponse = z.object({
  status: PairingStatus,
  expiresAt: IsoTimestamp,
  /** Present only on the single response that consumes an approved code (session cookie set). */
  user: AuthUser.optional(),
});

export const ApprovePairingRequest = z.object({
  code: PairingCodeString,
  deviceId: Id,
  /** Ed25519 signature over `PAIRING_SIGNATURE_PREFIX + code`. */
  signature: Ed25519Signature,
});

export const ApprovePairingResponse = z.object({
  status: z.literal('approved'),
});

export const MeResponse = z.object({
  user: AuthUser,
  /** Set when authenticated by a companion device token. */
  deviceId: Id.optional(),
});

export const ListDevicesResponse = z.object({ devices: z.array(Device) });

export const RevokeDeviceResponse = z.object({ device: Device });

// ---- recovery: passkeys, email, re-linking a device ----

/** Opaque WebAuthn JSON passed between @simplewebauthn/server and /browser; validated by the server library. */
const WebAuthnJson = z.record(z.string(), z.unknown());

export const PasskeyOptionsResponse = z.object({
  /** Server-side single-use challenge; echo it in the matching verify request. */
  challengeId: z.string().min(1),
  options: WebAuthnJson,
});

export const PasskeyVerifyRequest = z.object({
  challengeId: z.string().min(1),
  response: WebAuthnJson,
});

export const PasskeyRegisterResponse = z.object({ credential: Credential });

export const PasskeyLoginResponse = z.object({ user: AuthUser });

export const ListCredentialsResponse = z.object({ credentials: z.array(Credential) });

export const EmailAddress = z.string().trim().toLowerCase().email().max(254);

export const AddEmailRequest = z.object({ email: EmailAddress });

/** Identical for known and unknown addresses (no account enumeration). */
export const EmailSentResponse = z.object({ status: z.literal('sent') });

export const ConsumeEmailTokenRequest = z.object({ token: z.string().min(16).max(200) });

export const ConsumeEmailTokenResponse = z.discriminatedUnion('purpose', [
  z.object({ purpose: z.literal('login'), user: AuthUser }),
  z.object({ purpose: z.literal('verify'), email: z.string() }),
]);

export const CreateDeviceRequest = z.object({
  devicePublicKey: Ed25519PublicKey,
  deviceName: z.string().min(1).max(80),
});

export const CreateDeviceResponse = z.object({
  device: Device,
  /** Bearer token for the new companion. Returned once; the server stores only a hash. */
  deviceToken: z.string().min(1),
});

/** Link code shown on the website for a new computer, e.g. LINK-8H2Q-K7ZM (8 random characters, ~40 bits). */
export const LinkCodeString = z.string().regex(/^LINK-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

export const CreateLinkCodeResponse = z.object({
  code: LinkCodeString,
  expiresAt: IsoTimestamp,
});

export const LinkDeviceRequest = z.object({
  code: LinkCodeString,
  devicePublicKey: Ed25519PublicKey,
  deviceName: z.string().min(1).max(80),
});

export const LinkDeviceResponse = z.object({
  user: AuthUser,
  device: Device,
  /** Bearer token for the new companion. Returned once; the server stores only a hash. */
  deviceToken: z.string().min(1),
});

export type LinkCodeString = z.infer<typeof LinkCodeString>;
export type CreateLinkCodeResponse = z.infer<typeof CreateLinkCodeResponse>;
export type LinkDeviceRequest = z.infer<typeof LinkDeviceRequest>;
export type LinkDeviceResponse = z.infer<typeof LinkDeviceResponse>;
export type PasskeyOptionsResponse = z.infer<typeof PasskeyOptionsResponse>;
export type PasskeyVerifyRequest = z.infer<typeof PasskeyVerifyRequest>;
export type PasskeyRegisterResponse = z.infer<typeof PasskeyRegisterResponse>;
export type PasskeyLoginResponse = z.infer<typeof PasskeyLoginResponse>;
export type ListCredentialsResponse = z.infer<typeof ListCredentialsResponse>;
export type AddEmailRequest = z.infer<typeof AddEmailRequest>;
export type EmailSentResponse = z.infer<typeof EmailSentResponse>;
export type ConsumeEmailTokenRequest = z.infer<typeof ConsumeEmailTokenRequest>;
export type ConsumeEmailTokenResponse = z.infer<typeof ConsumeEmailTokenResponse>;
export type CreateDeviceRequest = z.infer<typeof CreateDeviceRequest>;
export type CreateDeviceResponse = z.infer<typeof CreateDeviceResponse>;

export type Ed25519PublicKey = z.infer<typeof Ed25519PublicKey>;
export type Ed25519Signature = z.infer<typeof Ed25519Signature>;
export type TravellerName = z.infer<typeof TravellerName>;
export type AuthUser = z.infer<typeof AuthUser>;
export type Device = z.infer<typeof Device>;
export type PairingStatus = z.infer<typeof PairingStatus>;
export type PairingCode = z.infer<typeof PairingCode>;
export type CredentialType = z.infer<typeof CredentialType>;
export type Credential = z.infer<typeof Credential>;
export type AuthSession = z.infer<typeof AuthSession>;
export type DiscoveredCharacter = z.infer<typeof DiscoveredCharacter>;
export type CreateAccountDeviceRequest = z.infer<typeof CreateAccountDeviceRequest>;
export type CreateAccountDeviceResponse = z.infer<typeof CreateAccountDeviceResponse>;
export type CreatePairingResponse = z.infer<typeof CreatePairingResponse>;
export type PairingStatusResponse = z.infer<typeof PairingStatusResponse>;
export type ApprovePairingRequest = z.infer<typeof ApprovePairingRequest>;
export type ApprovePairingResponse = z.infer<typeof ApprovePairingResponse>;
export type MeResponse = z.infer<typeof MeResponse>;
export type ListDevicesResponse = z.infer<typeof ListDevicesResponse>;
export type RevokeDeviceResponse = z.infer<typeof RevokeDeviceResponse>;
