// =============================================================================
// Infrastructure — Email Channel Adapter (Resend stub)
// =============================================================================
// Implements the ChannelAdapter interface for bidirectional email messaging.
// This file lives in the infrastructure layer because it:
//   - Is the only layer permitted to integrate with external providers (Resend)
//   - Owns provider-specific payload mapping and signature verification logic
//
// Capability: send_and_receive
//   - Outbound: delivers email via Resend SDK (stubbed — logs and returns success)
//   - Inbound:  normalizes Resend inbound webhook payloads into NormalizedInbound
//   - Verification: placeholder for HMAC-SHA256 webhook signature verification
//
// Design decisions:
//   - Factory function (createEmailAdapter) accepts optional config so the
//     composition root can inject API keys and from-address without this file
//     knowing about environment variables directly.
//   - The send implementation is intentionally stubbed with a TODO comment
//     showing the exact Resend SDK call to drop in once the package is added.
//   - verifySignature accepts all signatures in the stub to avoid blocking
//     development; production integration must replace this with HMAC verification.
//   - normalize maps from Resend's inbound webhook shape (from, subject, text/html)
//     onto the canonical MessagePayload — the rest of the system never sees
//     provider-specific field names.
// =============================================================================

import type { ChannelAdapter, OutboundPayload, OutboundResult, NormalizedInbound } from '../../domain/channel';

// =============================================================================
// SECTION 1: ADAPTER FACTORY
// =============================================================================

/**
 * Creates an email channel adapter backed by Resend.
 * Pass config to inject API credentials at composition time.
 */
export const createEmailAdapter = (_config?: {
  apiKey?: string;
  fromAddress?: string;
}): ChannelAdapter => ({
  channel: 'email',
  capability: 'send_and_receive',

  // ---------------------------------------------------------------------------
  // Send: deliver an outbound email to the recipient address
  // ---------------------------------------------------------------------------
  async send(payload: OutboundPayload): Promise<OutboundResult> {
    // Placeholder for Resend integration.
    // In production: add "resend" to package.json dependencies and replace
    // this stub with the Resend SDK call below.
    console.log(`[dispatch:email] Sending to ${payload.to}:`, payload.payload.title ?? '(no subject)');

    // TODO: Replace with actual Resend API call:
    // import { Resend } from 'resend';
    // const resend = new Resend(config?.apiKey);
    // const result = await resend.emails.send({
    //   from: config?.fromAddress ?? 'noreply@example.com',
    //   to: payload.to,
    //   subject: payload.payload.title ?? '',
    //   text: payload.payload.body,
    // });
    // if (result.error) {
    //   const permanent = result.error.statusCode >= 400 && result.error.statusCode < 500;
    //   return { success: false, permanent, providerResponse: { error: result.error } };
    // }
    // return { success: true, providerResponse: { id: result.data?.id } };

    return {
      success: true,
      providerResponse: { provider: 'resend', stub: true },
    };
  },

  // ---------------------------------------------------------------------------
  // Normalize: parse a Resend inbound webhook payload into NormalizedInbound
  // Resend inbound webhook shape: { from, to, subject, text, html, ... }
  // ---------------------------------------------------------------------------
  async normalize(rawPayload: Record<string, unknown>): Promise<NormalizedInbound> {
    const from = (rawPayload.from as string) ?? '';
    const subject = (rawPayload.subject as string) ?? undefined;
    const text = (rawPayload.text as string) ?? (rawPayload.html as string) ?? '';

    return {
      externalAddress: from,
      payload: {
        ...(subject !== undefined && { title: subject }),
        body: text,
        rawPayload,
      },
    };
  },

  // ---------------------------------------------------------------------------
  // VerifySignature: validate the Resend inbound webhook signature
  // In production: verify HMAC-SHA256 using the webhook signing secret from
  // the Resend dashboard. Stub accepts any non-empty signature.
  // ---------------------------------------------------------------------------
  async verifySignature(input: { rawPayload: Record<string, unknown>; signature: string; rawBody?: string; headers?: Record<string, string> }): Promise<boolean> {
    const { signature } = input;
    // TODO: Replace with actual Resend webhook signature verification:
    // const webhookSecret = config?.apiKey ?? '';
    // const hmac = createHmac('sha256', webhookSecret);
    // hmac.update(JSON.stringify(input.rawPayload));
    // const expected = hmac.digest('hex');
    // return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    console.log('[dispatch:email] Signature verification stub — accepting all non-empty signatures');
    return signature.length > 0;
  },
});
