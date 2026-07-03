// =============================================================================
// Infrastructure — Push Notification Channel Adapter (stub)
// =============================================================================
// Implements the ChannelAdapter interface for one-way push notification delivery.
// This file lives in the infrastructure layer because it:
//   - Is the only layer permitted to integrate with push providers (FCM, APNs)
//   - Will own device token validation and provider-specific payload shaping
//
// Capability: send
//   - Outbound only: push is inherently one-way (device → server replies travel
//     on a separate channel, usually an inbound webhook or API call)
//   - No normalize or verifySignature methods — not applicable for send-only channels
//
// Design decisions:
//   - No config accepted in this stub because device tokens are per-message
//     (payload.to), not per-adapter. Provider credentials (FCM server key, APNs
//     private key) would be injected via config in the production implementation.
//   - The send implementation is intentionally stubbed with TODO comments for
//     both FCM (firebase-admin) and APNs (node-apn) to guide the implementor.
//   - Bounced tokens (FCM: UNREGISTERED, APNs: 410 Gone) should set
//     permanent: true in the OutboundResult so the engine marks them 'bounced'.
// =============================================================================

import type { ChannelAdapter, OutboundPayload, OutboundResult } from '../../domain/channel';

// =============================================================================
// SECTION 1: ADAPTER FACTORY
// =============================================================================

/**
 * Creates a push notification channel adapter.
 * Currently a stub — replace the send body with a real FCM or APNs integration.
 */
export const createPushAdapter = (): ChannelAdapter => ({
  channel: 'push',
  capability: 'send',

  // ---------------------------------------------------------------------------
  // Send: deliver a push notification to the device token (payload.to)
  // ---------------------------------------------------------------------------
  async send(payload: OutboundPayload): Promise<OutboundResult> {
    // Placeholder for push notification provider integration.
    // payload.to = device token (FCM registration token or APNs device token)
    console.log(`[dispatch:push] Sending push to ${payload.to}:`, payload.payload.title ?? '(no title)');

    // TODO (FCM): Add firebase-admin to package.json, then replace with:
    // import * as admin from 'firebase-admin';
    // const result = await admin.messaging().send({
    //   token: payload.to,
    //   notification: {
    //     title: payload.payload.title,
    //     body: payload.payload.body,
    //   },
    //   data: payload.payload.context ? mapToStringRecord(payload.payload.context) : undefined,
    // });
    // Handle UNREGISTERED error → permanent: true (bounced token)

    // TODO (APNs): Add @parse/node-apn to package.json, then replace with:
    // const notification = new apn.Notification();
    // notification.alert = { title: payload.payload.title, body: payload.payload.body };
    // const result = await provider.send(notification, payload.to);
    // Handle 410 status → permanent: true (device unregistered)

    return {
      success: true,
      providerResponse: { provider: 'push', stub: true },
    };
  },

  // normalize and verifySignature are intentionally absent:
  // Push is a send-only channel. Inbound events from FCM/APNs arrive via
  // a separate data API, not as replies on the push channel.
});
