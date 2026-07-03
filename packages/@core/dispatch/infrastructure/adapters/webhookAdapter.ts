// =============================================================================
// Infrastructure — Webhook Channel Adapter
// =============================================================================
// Implements the ChannelAdapter interface for bidirectional webhook messaging.
// This file lives in the infrastructure layer because it:
//   - Is the only layer permitted to make outbound HTTP requests (fetch)
//   - Owns HMAC signature generation and constant-time signature verification
//
// Capability: send_and_receive
//   - Outbound: POSTs a JSON envelope to the recipient URL with optional HMAC
//               signature in the X-Dispatch-Signature header
//   - Inbound:  normalizes an incoming webhook payload into NormalizedInbound,
//               extracting sender and body from common field names
//   - Verification: HMAC-SHA256 constant-time comparison using Node crypto
//
// Design decisions:
//   - The send implementation uses the native fetch API (Node 18+) — no
//     additional HTTP library dependency.
//   - HTTP 4xx responses (except 429) are treated as permanent failures so the
//     engine will mark the message as 'bounced' and skip further retries.
//   - If no signingSecret is configured, verifySignature returns true
//     (skip verification) — allows unsigned webhook integrations.
//   - The constant-time comparison loop prevents timing attacks on the
//     signature check. A length mismatch short-circuits before the loop because
//     XOR on different-length strings leaks length information.
//   - normalize tries common sender field names in order: source → sender → from
//     to be compatible with a wide variety of inbound webhook formats.
// =============================================================================

import type { ChannelAdapter, OutboundPayload, OutboundResult, NormalizedInbound } from '../../domain/channel';
import { createHmac } from 'crypto';

// =============================================================================
// SECTION 1: ADAPTER FACTORY
// =============================================================================

/**
 * Creates a webhook channel adapter with optional HMAC request signing.
 * Pass config.signingSecret to enable signature generation and verification.
 */
export const createWebhookAdapter = (config?: {
  signingSecret?: string;
}): ChannelAdapter => ({
  channel: 'webhook',
  capability: 'send_and_receive',

  // ---------------------------------------------------------------------------
  // Send: POST a JSON envelope to the external URL, optionally signed
  // ---------------------------------------------------------------------------
  async send(payload: OutboundPayload): Promise<OutboundResult> {
    try {
      const body = JSON.stringify({
        to: payload.to,
        payload: payload.payload,
        metadata: payload.metadata,
        timestamp: new Date().toISOString(),
      });

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Sign the payload if a signing secret is configured
      if (config?.signingSecret) {
        const hmac = createHmac('sha256', config.signingSecret);
        hmac.update(body);
        headers['X-Dispatch-Signature'] = hmac.digest('hex');
      }

      const response = await fetch(payload.to, {
        method: 'POST',
        headers,
        body,
      });

      if (!response.ok) {
        // 4xx (except 429 Too Many Requests) are permanent — the address is invalid
        const permanent =
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 429;

        return {
          success: false,
          permanent,
          providerResponse: {
            status: response.status,
            statusText: response.statusText,
          },
        };
      }

      return {
        success: true,
        providerResponse: {
          status: response.status,
          statusText: response.statusText,
        },
      };
    } catch (error) {
      return {
        success: false,
        providerResponse: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },

  // ---------------------------------------------------------------------------
  // Normalize: parse an incoming webhook payload into NormalizedInbound
  // Tries common sender field names in priority order: source → sender → from
  // ---------------------------------------------------------------------------
  async normalize(rawPayload: Record<string, unknown>): Promise<NormalizedInbound> {
    const source =
      (rawPayload.source as string) ??
      (rawPayload.sender as string) ??
      (rawPayload.from as string) ??
      'unknown';

    const body =
      (rawPayload.body as string) ??
      (rawPayload.message as string) ??
      JSON.stringify(rawPayload);

    return {
      externalAddress: source,
      payload: {
        body,
        rawPayload,
      },
    };
  },

  // ---------------------------------------------------------------------------
  // VerifySignature: constant-time HMAC-SHA256 verification
  // Returns true immediately when no signingSecret is configured.
  // ---------------------------------------------------------------------------
  async verifySignature(input: { rawPayload: Record<string, unknown>; signature: string; rawBody?: string; headers?: Record<string, string> }): Promise<boolean> {
    const { rawPayload, signature } = input;
    if (!config?.signingSecret) return true; // No secret configured — skip verification

    const body = JSON.stringify(rawPayload);
    const hmac = createHmac('sha256', config.signingSecret);
    hmac.update(body);
    const expected = hmac.digest('hex');

    // Constant-time comparison prevents timing attacks
    if (signature.length !== expected.length) return false;
    let mismatch = 0;
    for (let i = 0; i < signature.length; i++) {
      mismatch |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    return mismatch === 0;
  },
});
