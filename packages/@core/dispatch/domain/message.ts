// =============================================================================
// Domain — Message Entity
// =============================================================================
// A Message is the fundamental communication unit in the dispatch system.
// It represents any payload flowing through a channel in either direction:
// outbound (system → external) or inbound (external → system).
//
// MessageDirection determines which path the message travels:
//   - outbound: system-initiated, delivered to an external address via a channel
//   - inbound:  externally initiated, received and routed to application handlers
//
// MessageStatus governs the lifecycle of a message:
//   Outbound lifecycle: pending → processing → sent (terminal success)
//                                            → failed  (retriable)
//                                            → bounced (terminal failure, no retry)
//   Inbound lifecycle:  received → processing → processed (terminal success)
//                                             → failed    (retriable)
//
// Design decisions:
//   - retryCount and maxRetries are tracked on the entity to allow the domain
//     to own the "canRetry" decision without querying infrastructure.
//   - providerResponse is a flexible bag for channel-specific delivery metadata
//     (e.g. provider message IDs, HTTP status codes from the sending provider).
//   - threadId links a message to a conversation thread; optional for fire-and-
//     forget outbound messages, expected for conversational exchanges.
//   - All factory functions return Result<T, Error> — never throw.
//   - State transition functions return a new message object (immutable update).
// =============================================================================

import { Result } from '../../../shared/lib/result';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type MessageDirection = 'inbound' | 'outbound';

export type MessageStatus =
  | 'pending'
  | 'processing'
  | 'sent'
  | 'failed'
  | 'bounced'
  | 'received'
  | 'processed';

export type MessagePayload = {
  /** Optional subject / title — used by email, notification channels */
  title?: string;
  /** Primary message body — required, max 10,000 characters */
  body: string;
  /** Deep-link or action URL to accompany the message */
  actionUrl?: string;
  /** Structured context for the handler or channel adapter */
  context?: Record<string, unknown>;
  /** Raw provider payload preserved verbatim for inbound messages */
  rawPayload?: Record<string, unknown>;
};

export type Message = {
  id: string;
  direction: MessageDirection;
  /** Registered channel name (e.g. "email", "sms", "push") */
  channel: string;
  /** ID of the Principal this message is associated with, if known */
  principalId?: string;
  /** The external address on the channel (email address, phone number, device token, etc.) */
  externalAddress: string;
  /** Optional thread this message belongs to */
  threadId?: string;
  /** For threaded replies: the ID of the message being replied to */
  replyToMessageId?: string;
  /** Source system type that originated this message (e.g. "campaign", "workflow") */
  sourceType?: string;
  /** Source system record ID that originated this message */
  sourceId?: string;
  payload: MessagePayload;
  status: MessageStatus;
  retryCount: number;
  maxRetries: number;
  /** Timestamp of the most recent delivery attempt */
  lastAttemptAt?: Date;
  /** Timestamp when the message was successfully delivered (outbound) */
  deliveredAt?: Date;
  /** Raw response from the channel provider (e.g. SMTP accept, push token error) */
  providerResponse?: Record<string, unknown>;
  /** Timestamp when an inbound message was received from the external system */
  receivedAt?: Date;
  /** Timestamp when an inbound message was fully processed by a handler */
  processedAt?: Date;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

// =============================================================================
// SECTION 2: VALIDATION FUNCTIONS
// =============================================================================

/**
 * Validates a MessagePayload.
 * Business rules:
 *   - body is required, must be non-empty after trimming, max 10,000 characters
 *   - title is optional; if present, must be non-empty and max 200 characters
 *
 * Returns the validated payload (body trimmed, title trimmed if present).
 */
export const validatePayload = (payload: MessagePayload): Result<MessagePayload, Error> => {
  if (!payload.body || payload.body.trim().length === 0) {
    return {
      success: false,
      error: new Error('Message payload body cannot be empty'),
    };
  }

  const trimmedBody = payload.body.trim();

  if (trimmedBody.length > 10000) {
    return {
      success: false,
      error: new Error('Message payload body must not exceed 10,000 characters'),
    };
  }

  let validatedTitle: string | undefined;
  if (payload.title !== undefined) {
    if (payload.title.trim().length === 0) {
      return {
        success: false,
        error: new Error('Message payload title cannot be empty when provided'),
      };
    }
    const trimmedTitle = payload.title.trim();
    if (trimmedTitle.length > 200) {
      return {
        success: false,
        error: new Error('Message payload title must not exceed 200 characters'),
      };
    }
    validatedTitle = trimmedTitle;
  }

  return {
    success: true,
    value: {
      ...payload,
      body: trimmedBody,
      ...(validatedTitle !== undefined && { title: validatedTitle }),
    },
  };
};

/**
 * Validates a channel name.
 * Business rules:
 *   - Must be a non-empty string after trimming
 *   - Returns the trimmed channel name on success
 */
export const validateChannel = (channel: string): Result<string, Error> => {
  if (!channel || channel.trim().length === 0) {
    return {
      success: false,
      error: new Error('Message channel cannot be empty'),
    };
  }

  return { success: true, value: channel.trim() };
};

/**
 * Validates an external address on a channel.
 * Business rules:
 *   - Must be a non-empty string after trimming
 *   - Returns the trimmed address on success
 *
 * Note: Channel-specific format validation (e.g. email syntax, E.164 phone)
 * is the responsibility of the channel adapter in the infrastructure layer.
 */
export const validateExternalAddress = (address: string): Result<string, Error> => {
  if (!address || address.trim().length === 0) {
    return {
      success: false,
      error: new Error('Message external address cannot be empty'),
    };
  }

  return { success: true, value: address.trim() };
};

// =============================================================================
// SECTION 3: FACTORY FUNCTIONS
// =============================================================================

/**
 * Validates and assembles the core fields for a new outbound Message.
 * The calling use case is responsible for appending id, createdAt, and updatedAt.
 *
 * Business rules applied:
 *   1. channel must be a non-empty string
 *   2. externalAddress must be a non-empty string
 *   3. payload must pass validatePayload rules
 *   4. direction is forced to 'outbound'
 *   5. status is initialized to 'pending'
 *   6. retryCount is initialized to 0
 *   7. maxRetries defaults to 3 if not provided
 */
export const createOutboundMessage = (input: {
  channel: string;
  externalAddress: string;
  payload: MessagePayload;
  principalId?: string;
  threadId?: string;
  replyToMessageId?: string;
  sourceType?: string;
  sourceId?: string;
  maxRetries?: number;
  metadata?: Record<string, unknown>;
}): Result<
  Omit<Message, 'id' | 'createdAt' | 'updatedAt'>,
  Error
> => {
  const channelResult = validateChannel(input.channel);
  if (!channelResult.success) return channelResult;

  const addressResult = validateExternalAddress(input.externalAddress);
  if (!addressResult.success) return addressResult;

  const payloadResult = validatePayload(input.payload);
  if (!payloadResult.success) return payloadResult;

  return {
    success: true,
    value: {
      direction: 'outbound',
      channel: channelResult.value,
      externalAddress: addressResult.value,
      payload: payloadResult.value,
      status: 'pending',
      retryCount: 0,
      maxRetries: input.maxRetries !== undefined ? input.maxRetries : 3,
      ...(input.principalId !== undefined && { principalId: input.principalId }),
      ...(input.threadId !== undefined && { threadId: input.threadId }),
      ...(input.replyToMessageId !== undefined && { replyToMessageId: input.replyToMessageId }),
      ...(input.sourceType !== undefined && { sourceType: input.sourceType }),
      ...(input.sourceId !== undefined && { sourceId: input.sourceId }),
      ...(input.metadata !== undefined && { metadata: input.metadata }),
    },
  };
};

/**
 * Validates and assembles the core fields for a new inbound Message.
 * The calling use case is responsible for appending id, receivedAt, createdAt, and updatedAt.
 *
 * Business rules applied:
 *   1. channel must be a non-empty string
 *   2. externalAddress must be a non-empty string
 *   3. payload must pass validatePayload rules
 *   4. direction is forced to 'inbound'
 *   5. status is initialized to 'received'
 *   6. retryCount is initialized to 0
 *   7. maxRetries is set to 0 — inbound messages track processing retries separately
 */
export const createInboundMessage = (input: {
  channel: string;
  externalAddress: string;
  payload: MessagePayload;
  principalId?: string;
  threadId?: string;
  sourceType?: string;
  sourceId?: string;
  metadata?: Record<string, unknown>;
}): Result<
  Omit<Message, 'id' | 'createdAt' | 'updatedAt'>,
  Error
> => {
  const channelResult = validateChannel(input.channel);
  if (!channelResult.success) return channelResult;

  const addressResult = validateExternalAddress(input.externalAddress);
  if (!addressResult.success) return addressResult;

  const payloadResult = validatePayload(input.payload);
  if (!payloadResult.success) return payloadResult;

  return {
    success: true,
    value: {
      direction: 'inbound',
      channel: channelResult.value,
      externalAddress: addressResult.value,
      payload: payloadResult.value,
      status: 'received',
      retryCount: 0,
      maxRetries: 0,
      ...(input.principalId !== undefined && { principalId: input.principalId }),
      ...(input.threadId !== undefined && { threadId: input.threadId }),
      ...(input.sourceType !== undefined && { sourceType: input.sourceType }),
      ...(input.sourceId !== undefined && { sourceId: input.sourceId }),
      ...(input.metadata !== undefined && { metadata: input.metadata }),
    },
  };
};

// =============================================================================
// SECTION 4: STATE TRANSITION FUNCTIONS
// =============================================================================

/**
 * Returns true if the message is eligible for a retry attempt.
 * Business rules:
 *   - Must be in 'failed' status (not 'bounced' — bounced is a terminal state)
 *   - retryCount must be strictly less than maxRetries
 */
export const canRetry = (message: Message): boolean => {
  return message.status === 'failed' && message.retryCount < message.maxRetries;
};

/**
 * Transitions a message to 'processing' status.
 * Returns a new message object — does not mutate the input.
 */
export const markAsProcessing = (message: Message): Message => {
  return { ...message, status: 'processing' };
};

/**
 * Transitions an outbound message to 'sent' status with a delivery timestamp.
 * Returns a new message object — does not mutate the input.
 */
export const markAsSent = (message: Message, timestamp: Date): Message => {
  return { ...message, status: 'sent', deliveredAt: timestamp };
};

/**
 * Transitions a message to 'failed' status.
 * Increments the retry counter and records the attempt timestamp.
 * Returns a new message object — does not mutate the input.
 */
export const markAsFailed = (message: Message, timestamp: Date): Message => {
  return {
    ...message,
    status: 'failed',
    retryCount: message.retryCount + 1,
    lastAttemptAt: timestamp,
  };
};

/**
 * Transitions a message to 'bounced' status.
 * Bounced is a terminal state — the address is permanently unreachable.
 * Returns a new message object — does not mutate the input.
 */
export const markAsBounced = (message: Message): Message => {
  return { ...message, status: 'bounced' };
};

/**
 * Transitions an inbound message to 'processed' status with a completion timestamp.
 * Returns a new message object — does not mutate the input.
 */
export const markAsProcessed = (message: Message, timestamp: Date): Message => {
  return { ...message, status: 'processed', processedAt: timestamp };
};

/**
 * Validates a status transition for an outbound Message.
 * Allowed transitions:
 *   - pending    → processing  (dispatch worker picks it up)
 *   - processing → sent        (channel confirms delivery)
 *   - processing → failed      (channel reports transient failure)
 *   - processing → bounced     (channel reports permanent failure)
 *   - failed     → processing  (retry: worker picks it up again)
 *
 * Returns the target status on success, a descriptive error on failure.
 */
export const validateOutboundStatusTransition = (
  current: MessageStatus,
  target: MessageStatus
): Result<MessageStatus, Error> => {
  const allowed: Partial<Record<MessageStatus, MessageStatus[]>> = {
    pending: ['processing'],
    processing: ['sent', 'failed', 'bounced'],
    failed: ['processing'],
  };

  const validTargets = allowed[current];
  if (!validTargets || !validTargets.includes(target)) {
    return {
      success: false,
      error: new Error(
        `Invalid outbound status transition: ${current} → ${target}`
      ),
    };
  }

  return { success: true, value: target };
};

/**
 * Validates a status transition for an inbound Message.
 * Allowed transitions:
 *   - received   → processing  (router picks it up)
 *   - processing → processed   (handler completes successfully)
 *   - processing → failed      (handler reports failure)
 *   - failed     → processing  (retry: router picks it up again)
 *
 * Returns the target status on success, a descriptive error on failure.
 */
export const validateInboundStatusTransition = (
  current: MessageStatus,
  target: MessageStatus
): Result<MessageStatus, Error> => {
  const allowed: Partial<Record<MessageStatus, MessageStatus[]>> = {
    received: ['processing'],
    processing: ['processed', 'failed'],
    failed: ['processing'],
  };

  const validTargets = allowed[current];
  if (!validTargets || !validTargets.includes(target)) {
    return {
      success: false,
      error: new Error(
        `Invalid inbound status transition: ${current} → ${target}`
      ),
    };
  }

  return { success: true, value: target };
};
