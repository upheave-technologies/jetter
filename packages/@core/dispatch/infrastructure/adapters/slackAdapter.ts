// =============================================================================
// Infrastructure — Slack Channel Adapter (production)
// =============================================================================
// Implements the ChannelAdapter interface for bidirectional Slack messaging.
// This file lives in the infrastructure layer because it:
//   - Is the only layer permitted to call the Slack Web API (fetch)
//   - Owns Slack Events API payload normalization and request signature verification
//
// Capability: send_and_receive
//   - Outbound: posts a message to a Slack channel or user via chat.postMessage
//   - Inbound:  normalizes Slack Events API payloads into NormalizedInbound,
//               extracting the user ID and message text from the event envelope
//   - Verification: full Slack signing secret verification
//               (HMAC-SHA256 of "v0:" + timestamp + ":" + raw body, replay-protected)
//
// Design decisions:
//   - No dependency on any Slack SDK — the Web API is simple enough to call
//     with fetch directly, keeping the dependency footprint minimal.
//   - normalize handles both the wrapped event envelope ({ event: { ... } })
//     and flat payloads to be tolerant of variations across Slack API versions.
//   - context carries Slack-specific metadata (channel ID, timestamps) onto the
//     MessagePayload so handlers can use them without parsing rawPayload.
//   - When rawBody + headers are present, full timestamp-replay-protected HMAC
//     verification runs. Otherwise falls back to checking signature is non-empty
//     (legacy / development path).
//   - The constant-time comparison loop prevents timing attacks on the signature
//     check. A length mismatch short-circuits before the loop because XOR on
//     different-length strings leaks length information.
//   - Permanent error classification covers auth and channel errors that will
//     not resolve on retry; transient errors (rate limits, server errors) are
//     left as non-permanent for the retry worker.
// =============================================================================

import type { ChannelAdapter, OutboundPayload, OutboundResult, NormalizedInbound } from '../../domain/channel';
import { createHmac } from 'crypto';

// =============================================================================
// SECTION 1: PERMANENT ERROR CODES
// =============================================================================

const PERMANENT_ERRORS = new Set([
  'channel_not_found',
  'is_archived',
  'invalid_auth',
  'not_authed',
  'account_inactive',
  'token_revoked',
]);

// =============================================================================
// SECTION 2: ADAPTER FACTORY
// =============================================================================

/**
 * Creates a production Slack channel adapter for @core/dispatch.
 *
 * Metadata conventions:
 *   Outbound:
 *     - payload.body → Slack text (required fallback)
 *     - payload.context.blocks → Slack Block Kit blocks (optional)
 *     - metadata.threadTs → Slack thread_ts for threaded replies
 *   Outbound result:
 *     - providerResponse.ts → Slack message timestamp (thread anchor for replies)
 *     - providerResponse.channel → Resolved Slack channel ID
 *   Inbound (after normalize):
 *     - payload.body → Message text
 *     - payload.context.slackChannel → Source channel ID
 *     - payload.context.slackTimestamp → Message timestamp
 *     - payload.context.slackThreadTs → Parent thread timestamp (for reply correlation)
 *     - payload.rawPayload → Full Slack event payload
 *
 * Thread correlation: outbound providerResponse.ts === inbound slackThreadTs
 */
export const createSlackAdapter = (config: {
  botToken: string;
  signingSecret: string;
}): ChannelAdapter => ({
  channel: 'slack',
  capability: 'send_and_receive',

  // ---------------------------------------------------------------------------
  // Send: post a message to a Slack channel or user (payload.to = channel/user ID)
  // ---------------------------------------------------------------------------
  async send(payload: OutboundPayload): Promise<OutboundResult> {
    try {
      const body: Record<string, unknown> = {
        channel: payload.to,
        text: payload.payload.body,
      };

      if (payload.metadata?.threadTs !== undefined) {
        body.thread_ts = payload.metadata.threadTs;
      }

      const blocks = (payload.payload.context as Record<string, unknown> | undefined)?.blocks;
      if (blocks !== undefined) {
        body.blocks = blocks;
      }

      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.botToken}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(body),
      });

      const data = (await response.json()) as {
        ok: boolean;
        ts?: string;
        channel?: string;
        error?: string;
      };

      if (data.ok) {
        return {
          success: true,
          providerResponse: { ts: data.ts, channel: data.channel },
        };
      }

      const permanent = PERMANENT_ERRORS.has(data.error ?? '');
      return {
        success: false,
        permanent,
        providerResponse: { error: data.error },
      };
    } catch (error) {
      return {
        success: false,
        permanent: false,
        providerResponse: { error: error instanceof Error ? error.message : 'Unknown error' },
      };
    }
  },

  // ---------------------------------------------------------------------------
  // Normalize: parse a Slack Events API payload into NormalizedInbound
  // Slack event envelope shape: { event: { type, user, text, channel, ts, thread_ts } }
  // ---------------------------------------------------------------------------
  async normalize(rawPayload: Record<string, unknown>): Promise<NormalizedInbound> {
    const event = (rawPayload.event as Record<string, unknown>) ?? rawPayload;

    return {
      externalAddress: (event.user as string) ?? 'unknown',
      payload: {
        body: (event.text as string) ?? '',
        rawPayload,
        context: {
          slackChannel: event.channel,
          slackTimestamp: event.ts,
          slackThreadTs: event.thread_ts,
        },
      },
    };
  },

  // ---------------------------------------------------------------------------
  // VerifySignature: Slack signing secret verification
  // When rawBody + headers are present: full HMAC-SHA256 with replay protection.
  // Legacy fallback (no rawBody/headers): accept any non-empty signature.
  // ---------------------------------------------------------------------------
  async verifySignature(input: {
    rawPayload: Record<string, unknown>;
    signature: string;
    rawBody?: string;
    headers?: Record<string, string>;
  }): Promise<boolean> {
    if (input.rawBody === undefined || input.headers === undefined) {
      return input.signature.length > 0;
    }

    const timestamp = input.headers['x-slack-request-timestamp'];
    if (!timestamp) return false;

    // Reject requests older than 5 minutes (replay protection)
    if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) return false;

    const basestring = `v0:${timestamp}:${input.rawBody}`;
    const hmac = createHmac('sha256', config.signingSecret).update(basestring).digest('hex');
    const expected = `v0=${hmac}`;

    // Constant-time comparison prevents timing attacks
    if (input.signature.length !== expected.length) return false;
    let mismatch = 0;
    for (let i = 0; i < input.signature.length; i++) {
      mismatch |= input.signature.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    return mismatch === 0;
  },
});
