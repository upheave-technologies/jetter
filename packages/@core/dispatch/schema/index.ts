// =============================================================================
// Dispatch Module — Schema Barrel Export
// =============================================================================
// This is the public API of the Dispatch module's data model. Consuming
// applications import from here to compose their database schema.
//
// Usage in a consuming application's drizzle.config.ts:
//   schema: ['./packages/@core/dispatch/schema/index.ts']
//
// Usage in application code:
//   import { dispatchMessages, dispatchMessageDirection } from '@/packages/@core/dispatch/schema';
// =============================================================================

export { dispatchMessages } from './messages';
export { dispatchThreads } from './threads';
export {
  dispatchMessageDirection,
  dispatchMessageStatus,
  dispatchThreadStatus,
} from './enums';
export { dispatchMessagesRelations, dispatchThreadsRelations } from './relations';
