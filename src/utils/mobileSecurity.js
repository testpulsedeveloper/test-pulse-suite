/**
 * @file mobileSecurity.js
 * @description Cryptographic HMAC-SHA256 signing, constant-time token verification,
 * upload limits, and strict CORS origin validation for the Mobile Companion
 * WebTrigger in Test Pulse Suite.
 *
 * SECURITY NOTE: this module never contains a hard-coded secret. The HMAC key is
 * supplied by the caller (see `getMobileHmacSecret` in mobileCompanionResolvers.js),
 * which reads it from an encrypted Forge variable or from the encrypted KVS secret store.
 */

import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

export const QR_SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
export const MAX_UPLOADS_PER_SESSION = 15;

// Maximum decoded size of a single evidence uploaded from the phone (10 MB).
export const MAX_MOBILE_UPLOAD_BYTES = 10 * 1024 * 1024;

// Only camera media types are accepted from the public WebTrigger. The value is the
// file extension used for the stored Jira attachment.
export const ALLOWED_MOBILE_MIME_TYPES = Object.freeze({
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'video/quicktime': 'mov',
  'video/webm': 'webm'
});

// Minimum length accepted for an HMAC key coming from a Forge environment variable.
export const MIN_HMAC_SECRET_LENGTH = 32;

/**
 * Generates an unguessable QR session identifier (122 bits of randomness from the
 * Node.js CSPRNG instead of `Math.random()`).
 *
 * @returns {string}
 */
export function generateMobileSessionId() {
  return 'qr_' + randomUUID().replace(/-/g, '');
}

/**
 * Generates an HMAC-SHA256 hex signature binding sessionId and createdAt timestamp.
 *
 * @param {string} sessionId - QR session identifier.
 * @param {number|string} createdAt - Session creation timestamp (ms).
 * @param {string} secret - HMAC key (required, never defaulted).
 * @returns {string} 64-char hex signature.
 */
export function signMobileSessionToken(sessionId, createdAt, secret) {
  if (!secret || typeof secret !== 'string') {
    throw new Error('Mobile HMAC secret is not configured');
  }
  return createHmac('sha256', secret)
    .update(`${String(sessionId || '')}:${String(createdAt || '')}`)
    .digest('hex');
}

/**
 * Constant-time verification of a mobile upload session HMAC token.
 * Returns `false` (never throws) for any missing or malformed input, so callers can
 * treat a missing signature exactly like an invalid one.
 *
 * @param {string} sessionId - QR session identifier.
 * @param {number|string} createdAt - Session creation timestamp (ms).
 * @param {string} providedToken - Signature received from the phone.
 * @param {string} secret - HMAC key.
 * @returns {boolean}
 */
export function verifyMobileSessionToken(sessionId, createdAt, providedToken, secret) {
  if (!sessionId || !createdAt || !providedToken || typeof providedToken !== 'string' || !secret) {
    return false;
  }
  let expected;
  try {
    expected = signMobileSessionToken(sessionId, createdAt, secret);
  } catch (_) {
    return false;
  }
  if (expected.length !== providedToken.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(providedToken, 'utf8'));
  } catch (_) {
    return false;
  }
}

/**
 * Normalizes a MIME type sent by the phone and returns the matching file extension,
 * or `null` when the type is not in the allowlist.
 *
 * @param {unknown} mimeType - Raw MIME type from the request body.
 * @returns {{ mime: string, ext: string }|null}
 */
export function resolveAllowedMobileMime(mimeType) {
  const mime = String(mimeType || '').split(';')[0].trim().toLowerCase();
  const ext = ALLOWED_MOBILE_MIME_TYPES[mime];
  return ext ? { mime, ext } : null;
}

/**
 * Resolves a safe CORS origin for mobile WebTrigger responses.
 * Restricts cross-origin requests to Atlassian / Forge domains instead of unconditional '*'.
 */
export function resolveSafeCorsOrigin(reqHeaders = {}) {
  const rawOrigin = reqHeaders?.origin || reqHeaders?.Origin || '';
  if (!rawOrigin) return 'https://forge.atlassian.com';
  try {
    const parsed = new URL(String(rawOrigin));
    if (
      parsed.protocol === 'https:' &&
      (
        parsed.hostname.endsWith('.atlassian.net') ||
        parsed.hostname.endsWith('.atlassian.com') ||
        parsed.hostname.endsWith('.atl-paas.net')
      )
    ) {
      return parsed.origin;
    }
  } catch (_) {}
  return 'https://forge.atlassian.com';
}
