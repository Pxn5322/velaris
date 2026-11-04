/**
 * Webhook signature verification (T5.05; F-13; AC-F13-3, TH-08).
 *
 * A webhook carries no user credential, so the signature is the authentication:
 * HMAC-SHA256 over `<timestamp>.<raw body>` with the endpoint secret. The
 * verifier answers a verdict instead of a boolean, so a caller can log why a
 * delivery was refused without telling the sender which secret is wrong.
 * - `missing`: a header is absent or malformed.
 * - `stale`: the timestamp is outside the tolerance window, which keeps one
 *   captured delivery from being replayed later.
 * - `mismatch`: the digest differs from the computed one.
 */

import { describe, expect, it } from 'vitest';
import {
  computeSignature,
  SIGNATURE_TOLERANCE_SECONDS,
  verifyWebhookSignature,
} from './webhook-signature.js';

const SECRET = 'whsec_test_secret_value';
const BODY = JSON.stringify({ id: 'evt_1', type: 'ticket.updated' });
const NOW_SECONDS = 1_800_000_000;
const TIMESTAMP = String(NOW_SECONDS);

function sign(body: string, timestamp: string, secret = SECRET): string {
  return computeSignature(secret, timestamp, body);
}

describe('verifyWebhookSignature', () => {
  it('accepts a fresh signature over the exact body', () => {
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        timestamp: TIMESTAMP,
        signature: sign(BODY, TIMESTAMP),
        rawBody: BODY,
        nowSeconds: NOW_SECONDS,
      }),
    ).toBe('ok');
  });

  it('accepts an uppercase hex digest and the sha256= prefix', () => {
    const digest = sign(BODY, TIMESTAMP);

    expect(digest.startsWith('sha256=')).toBe(true);
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        timestamp: TIMESTAMP,
        signature: `sha256=${digest.slice('sha256='.length).toUpperCase()}`,
        rawBody: BODY,
        nowSeconds: NOW_SECONDS,
      }),
    ).toBe('ok');
  });

  it('refuses a body that changed after signing (TH-08)', () => {
    const signature = sign(BODY, TIMESTAMP);
    const tampered = JSON.stringify({ id: 'evt_1', type: 'ticket.deleted' });

    expect(
      verifyWebhookSignature({
        secret: SECRET,
        timestamp: TIMESTAMP,
        signature,
        rawBody: tampered,
        nowSeconds: NOW_SECONDS,
      }),
    ).toBe('mismatch');
  });

  it('refuses a signature made with another secret (AC-F13-3)', () => {
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        timestamp: TIMESTAMP,
        signature: sign(BODY, TIMESTAMP, 'whsec_other'),
        rawBody: BODY,
        nowSeconds: NOW_SECONDS,
      }),
    ).toBe('mismatch');
  });

  it('refuses a timestamp outside the tolerance window', () => {
    const old = String(NOW_SECONDS - SIGNATURE_TOLERANCE_SECONDS - 1);

    expect(
      verifyWebhookSignature({
        secret: SECRET,
        timestamp: old,
        signature: sign(BODY, old),
        rawBody: BODY,
        nowSeconds: NOW_SECONDS,
      }),
    ).toBe('stale');
  });

  it('refuses a timestamp too far in the future', () => {
    const ahead = String(NOW_SECONDS + SIGNATURE_TOLERANCE_SECONDS + 1);

    expect(
      verifyWebhookSignature({
        secret: SECRET,
        timestamp: ahead,
        signature: sign(BODY, ahead),
        rawBody: BODY,
        nowSeconds: NOW_SECONDS,
      }),
    ).toBe('stale');
  });

  it('refuses absent headers and a malformed digest', () => {
    const base = { secret: SECRET, rawBody: BODY, nowSeconds: NOW_SECONDS };

    expect(
      verifyWebhookSignature({
        ...base,
        timestamp: undefined,
        signature: sign(BODY, TIMESTAMP),
      }),
    ).toBe('missing');
    expect(
      verifyWebhookSignature({
        ...base,
        timestamp: TIMESTAMP,
        signature: undefined,
      }),
    ).toBe('missing');
    expect(
      verifyWebhookSignature({
        ...base,
        timestamp: 'not-a-number',
        signature: sign(BODY, TIMESTAMP),
      }),
    ).toBe('missing');
    expect(
      verifyWebhookSignature({
        ...base,
        timestamp: TIMESTAMP,
        signature: 'sha256=zzzz',
      }),
    ).toBe('missing');
    expect(
      verifyWebhookSignature({
        ...base,
        timestamp: TIMESTAMP,
        signature: 'deadbeef',
      }),
    ).toBe('missing');
  });
});
