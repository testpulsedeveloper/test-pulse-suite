/**
 * @file mobileSecurity.js
 * @description Cryptographic HMAC-SHA256 signing, constant-time token verification,
 * rate-limit constants, and strict CORS origin validation for the Mobile Companion
 * WebTrigger in Test Pulse Suite.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const QR_SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
export const MAX_UPLOADS_PER_SESSION = 15;
const MOBILE_HMAC_SECRET = process.env.FORGE_MOBILE_HMAC_SECRET || 'tp-liverpool-forge-mobile-hmac-v470';

/**
 * Generates an HMAC-SHA256 hex signature binding sessionId and createdAt timestamp.
 */
export function signMobileSessionToken(sessionId, createdAt) {
  return createHmac('sha256', MOBILE_HMAC_SECRET)
    .update(`${String(sessionId || '')}:${String(createdAt || '')}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Constant-time verification of a mobile upload session HMAC token.
 */
export function verifyMobileSessionToken(sessionId, createdAt, providedToken) {
  if (!sessionId || !createdAt || !providedToken || typeof providedToken !== 'string') {
    return false;
  }
  const expected = signMobileSessionToken(sessionId, createdAt);
  if (expected.length !== providedToken.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(providedToken, 'utf8'));
  } catch (_) {
    return false;
  }
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
