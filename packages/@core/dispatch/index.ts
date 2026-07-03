// =============================================================================
// Dispatch Module — Public API (Barrel Export)
// =============================================================================
// This is the single entry point for consuming applications to import from
// the Dispatch module. It exports only the public API, hiding internal
// implementation details such as repository interfaces, domain validation
// functions, and internal mapping utilities.
//
// NOTE: Table definitions (dispatchMessages, dispatchThreads, enums, relations)
// are available via the direct subpath: '@core/dispatch/schema'
// They cannot be re-exported from this file — see implementation report at
// system/docs/dispatch-public-api-report.md for details.
//
// Usage in consuming application:
//   import {
//     type DispatchDatabase,
//     makeMessageRepository,
//     makeThreadRepository,
//     makeEnqueueOutboundUseCase,
//     makeReceiveInboundUseCase,
//     type Message,
//     type Thread,
//     type ChannelAdapter,
//     createDispatchEngine,
//     createRouter,
//     DispatchError,
//   } from '@core/dispatch';
// =============================================================================

// -----------------------------------------------------------------------------
// Database Type (for typing the db instance)
// Note: DispatchDatabase is defined in DrizzleMessageRepository (no separate database.ts)
// -----------------------------------------------------------------------------
export type { DispatchDatabase } from './infrastructure/repositories/DrizzleMessageRepository';

// -----------------------------------------------------------------------------
// Repository Factories (for creating repository instances)
// -----------------------------------------------------------------------------
export { makeMessageRepository } from './infrastructure/repositories/DrizzleMessageRepository';
export { makeThreadRepository } from './infrastructure/repositories/DrizzleThreadRepository';

// -----------------------------------------------------------------------------
// Use Case Factories (for creating use case instances)
// -----------------------------------------------------------------------------
export { makeEnqueueOutboundUseCase } from './application/enqueueOutboundUseCase';
export { makeProcessOutboundBatchUseCase } from './application/processOutboundBatchUseCase';
export { makeSendReplyUseCase } from './application/sendReplyUseCase';
export { makeReceiveInboundUseCase } from './application/receiveInboundUseCase';
export { makeProcessInboundUseCase } from './application/processInboundUseCase';
export { makeProcessInboundBatchUseCase } from './application/processInboundBatchUseCase';
export { makeGetThreadUseCase } from './application/getThreadUseCase';
export { makeCloseThreadUseCase } from './application/closeThreadUseCase';
export { makeRetryFailedMessageUseCase } from './application/retryFailedMessageUseCase';
export { makeGetMessageStatusUseCase } from './application/getMessageStatusUseCase';

// -----------------------------------------------------------------------------
// Use Case Input/Output Types (for consuming apps to type their call sites)
// -----------------------------------------------------------------------------
export type { EnqueueOutboundInput } from './application/enqueueOutboundUseCase';
export type { ProcessOutboundBatchInput, OutboundBatchReport } from './application/processOutboundBatchUseCase';
export type { SendReplyInput } from './application/sendReplyUseCase';
export type { ReceiveInboundInput, ReceiveInboundResult } from './application/receiveInboundUseCase';
export type { ProcessInboundInput, ProcessInboundResult } from './application/processInboundUseCase';
export type { ProcessInboundBatchInput, InboundBatchReport } from './application/processInboundBatchUseCase';
export type { GetThreadInput } from './application/getThreadUseCase';
export type { CloseThreadInput } from './application/closeThreadUseCase';
export type { RetryFailedMessageInput } from './application/retryFailedMessageUseCase';
export type { GetMessageStatusInput, MessageStatusSummary } from './application/getMessageStatusUseCase';

// -----------------------------------------------------------------------------
// Domain Types (for consuming apps to use in their type signatures)
// -----------------------------------------------------------------------------
export type { Message, MessageDirection, MessageStatus, MessagePayload } from './domain/message';
export type { Thread, ThreadStatus } from './domain/thread';
export type { ChannelAdapter, ChannelCapability, OutboundPayload, OutboundResult, NormalizedInbound } from './domain/channel';
export type { InboundHandler, HandlerPredicate, HandlerResult } from './domain/handler';
export type { Router } from './domain/router';
export type { DispatchEngine } from './domain/engine';

// -----------------------------------------------------------------------------
// Domain Factories (for creating engine/router instances)
// -----------------------------------------------------------------------------
export { createRouter } from './domain/router';
export { createDispatchEngine } from './domain/engine';

// -----------------------------------------------------------------------------
// Domain Utility Functions (useful for consuming apps)
// -----------------------------------------------------------------------------
export { canSend, canReceive } from './domain/channel';
export { canRetry } from './domain/message';
export { matchesPredicate } from './domain/handler';

// -----------------------------------------------------------------------------
// Error Types (for consuming apps to handle errors)
// -----------------------------------------------------------------------------
export { DispatchError } from './application/dispatchError';

// -----------------------------------------------------------------------------
// Default Adapters (for composition root registration)
// -----------------------------------------------------------------------------
export { createEmailAdapter } from './infrastructure/adapters/emailAdapter';
export { createWebhookAdapter } from './infrastructure/adapters/webhookAdapter';
export { createPushAdapter } from './infrastructure/adapters/pushAdapter';
export { createSlackAdapter } from './infrastructure/adapters/slackAdapter';

// -----------------------------------------------------------------------------
// Trigger Mechanisms (for composition root wiring)
// -----------------------------------------------------------------------------
export { createDispatchInngestFunctions } from './infrastructure/triggers/inngestFunctions';
export { createCronProcessor } from './infrastructure/triggers/cronProcessor';
