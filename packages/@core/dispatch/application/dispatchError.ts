// =============================================================================
// Application — Dispatch Error
// =============================================================================
// Custom error class for Dispatch module operations.
// Includes a structured error code for programmatic handling by consumers.
//
// Error codes:
//   MESSAGE_NOT_FOUND        — No message record with this ID
//   THREAD_NOT_FOUND         — No thread with this ID
//   NO_ADAPTER               — No adapter registered for the requested channel
//   CHANNEL_CANNOT_SEND      — Adapter registered but lacks send capability
//   CHANNEL_CANNOT_RECEIVE   — Adapter registered but lacks receive capability
//   SIGNATURE_INVALID        — Inbound webhook signature verification failed
//   NO_HANDLER               — No handler matched the inbound message
//   VALIDATION_ERROR         — Input failed domain validation
//   DELIVERY_FAILED          — Adapter returned failure
//   MAX_RETRIES_EXCEEDED     — Message has exhausted retry attempts
//   SERVICE_ERROR            — Unexpected infrastructure failure
// =============================================================================

export class DispatchError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'DispatchError';
  }
}
