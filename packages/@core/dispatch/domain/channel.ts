// =============================================================================
// Domain — Channel Adapter Interface
// =============================================================================
// A ChannelAdapter is the pluggable bridge between the dispatch engine and an
// external communication provider. The domain defines the interface (WHAT the
// adapter must do); the infrastructure layer provides concrete implementations
// (HOW it does it for a specific provider, e.g. SendGrid, Twilio, Firebase FCM).
//
// ChannelCapability expresses what the channel supports:
//   - send:             one-way outbound only (e.g. a webhook sink)
//   - receive:          one-way inbound only (e.g. a pure listener)
//   - send_and_receive: full bidirectional (e.g. email, SMS, WhatsApp)
//
// The three optional methods on ChannelAdapter correspond to the three operations
// a channel may support:
//   - send:            deliver an outbound payload to an external address
//   - normalize:       parse a raw inbound payload (e.g. provider webhook JSON)
//                      into a uniform NormalizedInbound structure
//   - verifySignature: validate that an inbound webhook came from the legitimate
//                      provider (e.g. HMAC signature check)
//
// Design decisions:
//   - Methods are optional on the interface. Callers MUST check canSend /
//     canReceive before invoking send / normalize to avoid runtime errors.
//   - OutboundResult carries a "permanent" flag so the engine can distinguish
//     bounced addresses (no further retry) from transient failures (will retry).
//   - NormalizedInbound uses MessagePayload to keep the type surface minimal —
//     the infrastructure adapter is responsible for mapping provider-specific
//     fields onto the canonical payload shape.
//   - This file has zero external imports — it only references MessagePayload
//     from the message domain file.
// =============================================================================

import type { MessagePayload } from './message';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

/** Describes which communication directions the channel adapter supports */
export type ChannelCapability = 'send' | 'receive' | 'send_and_receive';

/** Payload passed to a channel adapter's send method */
export type OutboundPayload = {
  /** The external address to deliver the message to */
  to: string;
  payload: MessagePayload;
  metadata?: Record<string, unknown>;
};

/** Result returned by a channel adapter after a send attempt */
export type OutboundResult = {
  success: boolean;
  /** Raw provider response (e.g. message ID, HTTP status, error detail) */
  providerResponse?: Record<string, unknown>;
  /**
   * When true and success is false, the failure is permanent (address bounced).
   * The engine should mark the message as 'bounced' and skip further retries.
   * When false or absent, the failure is transient — the engine may retry.
   */
  permanent?: boolean;
};

/** Normalized representation of a message received from an external system */
export type NormalizedInbound = {
  /** The external address that sent this message */
  externalAddress: string;
  payload: MessagePayload;
  metadata?: Record<string, unknown>;
};

/** The contract every channel adapter must satisfy */
export type ChannelAdapter = {
  /** Unique registered name for this channel (e.g. "email", "sms", "push") */
  readonly channel: string;
  readonly capability: ChannelCapability;

  /**
   * Deliver a payload to an external address.
   * Required for channels with 'send' or 'send_and_receive' capability.
   */
  send?: (payload: OutboundPayload) => Promise<OutboundResult>;

  /**
   * Parse a raw inbound provider payload into a NormalizedInbound structure.
   * Required for channels with 'receive' or 'send_and_receive' capability.
   */
  normalize?: (rawPayload: Record<string, unknown>) => Promise<NormalizedInbound>;

  /**
   * Verify that an inbound webhook payload was signed by the legitimate provider.
   * Optional; omit for channels that do not use signature-based verification.
   */
  verifySignature?: (input: {
    rawPayload: Record<string, unknown>;
    signature: string;
    rawBody?: string;
    headers?: Record<string, string>;
  }) => Promise<boolean>;
};

// =============================================================================
// SECTION 2: UTILITY FUNCTIONS
// =============================================================================

/**
 * Returns true if the adapter is capable of sending outbound messages.
 * Callers must check this before invoking adapter.send.
 */
export const canSend = (adapter: ChannelAdapter): boolean => {
  return adapter.capability === 'send' || adapter.capability === 'send_and_receive';
};

/**
 * Returns true if the adapter is capable of receiving inbound messages.
 * Callers must check this before invoking adapter.normalize.
 */
export const canReceive = (adapter: ChannelAdapter): boolean => {
  return adapter.capability === 'receive' || adapter.capability === 'send_and_receive';
};
