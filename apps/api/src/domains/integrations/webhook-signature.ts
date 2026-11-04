/**
 * Webhook signature primitives (T5.05; F-13; AC-F13-3, TH-08).
 *
 * A webhook has no bearer token, so the signature is its authentication. The
 * digest is HMAC-SHA256 over `<timestamp>.<raw body>` with the endpoint secret,
 * sent as `sha256=<hex>`. Two properties matter:
 * - The timestamp is part of the signed text and a delivery outside the
 *   tolerance window is refused, so a captured request cannot be replayed
 *   later (TH-08).
 * - The comparison decodes both digests to bytes and uses `timingSafeEqual`,
 *   so a wrong secret cannot be discovered byte by byte from response timing.
 *
 * The raw body is signed, never a re-serialised object: JSON key order and
 * whitespace are part of what the sender signed.
 */

import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-velaris-signature';
export const TIMESTAMP_HEADER = 'x-velaris-timestamp';
export const DELIVERY_HEADER = 'x-velaris-delivery-id';
export const SIGNATURE_PREFIX = 'sha256=';
/** Accepted clock difference in seconds; 300 covers a slow retry queue. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

const HEX_DIGEST = /^[0-9a-fA-F]{64}$/;
const UNIX_SECONDS = /^\d{1,12}$/;

/** Stable content hash for a delivery body; used for duplicate detection. */
export function hashPayload(rawBody: string | Buffer): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

/** The header value a sender must produce for this exact body and timestamp. */
export function computeSignature(
  secret: string,
  timestamp: string,
  rawBody: string | Buffer,
): string {
  const digest = createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex');
  return `${SIGNATURE_PREFIX}${digest}`;
}

export type SignatureVerdict = 'ok' | 'missing' | 'stale' | 'mismatch';

export interface SignatureCheck {
  secret: string;
  timestamp: string | undefined;
  signature: string | undefined;
  rawBody: string | Buffer;
  /** Injected in tests; defaults to the wall clock. */
  nowSeconds?: number;
  toleranceSeconds?: number;
}

/**
 * Decide whether a delivery is authentic. The verdict names the reason so the
 * caller can log it; the HTTP response stays generic so a sender learns
 * nothing about the stored secret.
 */
export function verifyWebhookSignature(
  check: SignatureCheck,
): SignatureVerdict {
  const { timestamp, signature } = check;
  if (!timestamp || !signature) {
    return 'missing';
  }
  if (!UNIX_SECONDS.test(timestamp)) {
    return 'missing';
  }
  const hex = signature.startsWith(SIGNATURE_PREFIX)
    ? signature.slice(SIGNATURE_PREFIX.length)
    : signature;
  if (!HEX_DIGEST.test(hex)) {
    return 'missing';
  }

  const nowSeconds = check.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = check.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
  if (Math.abs(nowSeconds - Number(timestamp)) > tolerance) {
    return 'stale';
  }

  const expected = computeSignature(check.secret, timestamp, check.rawBody);
  const expectedBytes = Buffer.from(
    expected.slice(SIGNATURE_PREFIX.length),
    'hex',
  );
  const givenBytes = Buffer.from(hex.toLowerCase(), 'hex');
  if (expectedBytes.length !== givenBytes.length) {
    return 'mismatch';
  }
  return timingSafeEqual(expectedBytes, givenBytes) ? 'ok' : 'mismatch';
}
