# RFC: Production Slack Adapter for @core/dispatch

**From:** Axiom team (consuming project)
**To:** Nucleus core package team
**Package:** `@core/dispatch`
**Scope:** Replace the Slack adapter stub with a production-grade, project-agnostic implementation
**Priority:** Blocking — we built a full adapter in our project that should live in core

---

## Why This Matters

We integrated `@core/dispatch` into Axiom for bidirectional Slack communication. The package's architecture is excellent — the engine, use cases, handler routing, and repository layer all work well. But the Slack adapter is a stub. We had to build a complete, production-grade Slack adapter in our project (`modules/dispatch/infrastructure/slackChannelAdapter.ts`, 142 lines) to make dispatch usable.

This adapter is **not project-specific**. It contains zero Axiom business logic. It's pure Slack Web API plumbing that any project using dispatch + Slack would need to write identically. It should live in the core package alongside the already-production-ready webhook adapter.

Beyond the adapter, we hit two additional gaps that forced us to build project-side workarounds:

1. **Signature verification can't work** — the `verifySignature` interface doesn't carry the raw request body, which Slack's HMAC scheme requires
2. **No way to query by provider reference** — we needed "find the message whose `providerResponse.ts` matches this Slack thread timestamp" and had to write custom JSONB queries

Fixing these three things in core would have saved us ~200 lines of infrastructure code and eliminated an entire use case file (`verifySlackWebhookUseCase.ts`) plus a custom repository file (`DrizzleDispatchCorrelationRepository.ts`).

---

## 1. The Slack Adapter

### Current State (stub)

The existing `infrastructure/adapters/slackAdapter.ts` logs to console and returns `{ success: true, stub: true }`. The `normalize()` is partially implemented. The `verifySignature()` accepts all non-empty strings.

### What We Built (and what core should provide)

Here's exactly what our adapter does. This is the contract we need from core:

### 1.1 `send()` — Deliver messages via Slack Web API

**Must support:**

| Feature | How | Why |
|---------|-----|-----|
| Post to channel | `chat.postMessage` with `channel: payload.to` | Basic delivery |
| Thread replies | Read `payload.metadata.threadTs` → pass as `thread_ts` | Every project doing conversational Slack will need threaded replies |
| Block Kit | Read `payload.payload.context.blocks` → pass as `blocks` | Rich formatting is standard Slack practice, not project-specific |
| Error classification | Map Slack API errors to permanent vs transient | `channel_not_found`, `is_archived`, `invalid_auth` → permanent (bounce). Everything else → transient (retry) |
| Provider response | Return `{ ts, channel }` from Slack API response | The `ts` is the Slack message ID. It's critical — downstream code uses `providerResponse.ts` to correlate inbound replies to the original outbound message |

**Implementation pattern** (this is what we wrote):

```typescript
async send(payload: OutboundPayload): Promise<OutboundResult> {
  try {
    const client = new WebClient(config.botToken);

    const threadTs = payload.metadata?.threadTs as string | undefined;
    const blocks = (
      payload.payload.context as Record<string, unknown> | undefined
    )?.blocks as object[] | undefined;

    const response = await client.chat.postMessage({
      channel: payload.to,
      text: payload.payload.body,
      ...(threadTs && { thread_ts: threadTs }),
      ...(blocks && { blocks: blocks as never }),
    });

    if (!response.ok) {
      const slackError = (response as { error?: string }).error;
      const permanent =
        slackError === "channel_not_found" ||
        slackError === "is_archived" ||
        slackError === "invalid_auth";
      return {
        success: false,
        permanent,
        providerResponse: { error: slackError },
      };
    }

    return {
      success: true,
      providerResponse: { ts: response.ts, channel: response.channel },
    };
  } catch (err) {
    return {
      success: false,
      permanent: false,
      providerResponse: {
        error: err instanceof Error ? err.message : "Unknown error",
      },
    };
  }
}
```

**Critical detail about `providerResponse`:** The `ts` field in `providerResponse` is not just metadata — it's the **Slack thread identifier**. When someone replies to a message, Slack sends `thread_ts` equal to the original message's `ts`. If `providerResponse.ts` isn't returned, inbound reply correlation breaks entirely. Every project will depend on this.

### 1.2 `normalize()` — Parse Slack Events API payloads

**Must extract:**

| Field | Source | Maps to |
|-------|--------|---------|
| User ID | `event.user` | `externalAddress` |
| Message text | `event.text` | `payload.body` |
| Channel ID | `event.channel` | `payload.context.slackChannel` |
| Message timestamp | `event.ts` | `payload.context.slackTimestamp` |
| Thread timestamp | `event.thread_ts` | `payload.context.slackThreadTs` |
| Raw payload | The entire input | `payload.rawPayload` |

**The current stub is missing `thread_ts` extraction.** This is the field that makes inbound reply handling work. Without it in context, no handler can correlate a reply back to the original thread.

**Implementation pattern:**

```typescript
async normalize(rawPayload: Record<string, unknown>): Promise<NormalizedInbound> {
  const event = (rawPayload.event as Record<string, unknown>) ?? rawPayload;

  const userId = (event.user as string) ?? "unknown";
  const text = (event.text as string) ?? "";
  const channel = event.channel as string | undefined;
  const ts = event.ts as string | undefined;
  const threadTs = event.thread_ts as string | undefined;

  return {
    externalAddress: userId,
    payload: {
      body: text,
      rawPayload,
      context: {
        slackChannel: channel,
        slackTimestamp: ts,
        slackThreadTs: threadTs,
      },
    },
  };
}
```

### 1.3 `verifySignature()` — HMAC-SHA256 Slack request verification

This is where we hit a **design limitation in the `ChannelAdapter` interface** that needs to be addressed. See Section 2 below.

### 1.4 Factory signature

```typescript
export const createSlackAdapter = (config: {
  botToken: string;
  signingSecret: string;
}): ChannelAdapter
```

Both fields should be **required** (not optional as in the current stub). A Slack adapter without a bot token can't send. A Slack adapter without a signing secret can't verify. If a project wants to skip either, they can pass an empty string — but the default should enforce that you've thought about it.

### 1.5 Dependency: `@slack/web-api`

The current stub avoids SDK dependencies and uses raw `fetch`. We recommend using `@slack/web-api` instead:

- **Type safety** — the SDK types Slack API responses, catching errors at compile time that raw fetch misses
- **Rate limiting** — the SDK handles Slack's rate limits (429 + Retry-After) automatically
- **Token rotation** — the SDK handles token refresh for workspace-level tokens
- **Maintenance** — Slack maintains the SDK; raw fetch calls break silently when the API changes

The webhook adapter uses raw `fetch` because webhooks are a generic HTTP concern. Slack has a specific, evolving API with its own SDK — use it.

---

## 2. Signature Verification Interface Gap

### The Problem

Slack's signature verification requires three inputs:
1. **Raw request body** (the original string bytes, not parsed JSON)
2. **X-Slack-Request-Timestamp** header
3. **X-Slack-Signature** header

The current `verifySignature` interface provides:
```typescript
verifySignature(rawPayload: Record<string, unknown>, signature: string): Promise<boolean>
```

This gives us parsed JSON (not raw bytes) and one string (not two headers). By the time `receiveInboundUseCase` calls `verifySignature`, the raw body is gone.

### What We Had to Do

We built a separate `verifySlackWebhookUseCase.ts` (53 lines) that runs **before** dispatch in the webhook route handler, with access to the raw `request.text()` and headers. The adapter's `verifySignature` is a pass-through that returns `true`.

This works but it means:
- Verification lives outside dispatch (leaky abstraction)
- Every project using Slack + dispatch will write the same workaround
- The `receiveInboundUseCase` thinks it's verifying but it's not

### Proposed Fix

Expand `ReceiveInboundInput` to carry raw request context:

```typescript
export type ReceiveInboundInput = {
  channel: string;
  rawPayload: Record<string, unknown>;
  signature?: string;
  // NEW: optional raw request context for adapters that need it
  rawBody?: string;
  headers?: Record<string, string>;
};
```

And expand the `verifySignature` interface to accept it:

```typescript
verifySignature?: (input: {
  rawPayload: Record<string, unknown>;
  signature: string;
  rawBody?: string;
  headers?: Record<string, string>;
}) => Promise<boolean>;
```

The Slack adapter's `verifySignature` would then:
1. Read `input.headers['x-slack-request-timestamp']`
2. Reject if timestamp is older than 5 minutes (replay protection)
3. Build basestring: `v0:${timestamp}:${input.rawBody}`
4. HMAC-SHA256 with signing secret
5. Constant-time compare with `input.signature`

This is **backward compatible** — existing adapters that only use `rawPayload` + `signature` keep working. The new fields are optional. But adapters that need raw bytes (Slack, and likely others in the future) can access them.

**If this interface change is too invasive**, an alternative is to document a convention: projects should pre-verify in their webhook route for adapters that need raw body access, and the adapter's `verifySignature` should return `true`. But that's a documented workaround, not a real solution.

---

## 3. Provider Reference Query on IMessageRepository

### The Problem

After sending a message, the Slack adapter returns `providerResponse: { ts, channel }`. This `ts` is the Slack message identifier. When an inbound reply arrives, it carries `thread_ts` — the same value. To correlate the reply back to the original message (and thus to the business entity that triggered it), you need:

```sql
SELECT source_id FROM dispatch_messages
WHERE provider_response->>'ts' = $providerTs
  AND source_type = $sourceType
  AND direction = 'outbound'
  AND status = 'sent'
LIMIT 1
```

The `IMessageRepository` interface doesn't support querying `providerResponse` fields. We had to write a custom Drizzle query with raw SQL for the JSONB operator.

### What We Had to Build

```typescript
// modules/dispatch/infrastructure/repositories/DrizzleDispatchCorrelationRepository.ts

export async function findTaskIdByProviderRef(providerTs: string): Promise<string | null> {
  const result = await dispatchDb
    .select({ sourceId: dispatchMessages.sourceId })
    .from(dispatchMessages)
    .where(
      and(
        sql`${dispatchMessages.providerResponse}->>'ts' = ${providerTs}`,
        eq(dispatchMessages.sourceType, "task"),
        eq(dispatchMessages.direction, "outbound"),
        eq(dispatchMessages.status, "sent")
      )
    )
    .limit(1);
  return result[0]?.sourceId ?? null;
}
```

### Proposed Addition to IMessageRepository

Two new methods that any project doing bidirectional messaging will need:

```typescript
// Find a sent outbound message by a field in its providerResponse
findByProviderRef: (
  field: string,
  value: string,
  channel?: string
) => Promise<Message | null>;

// Find the first sent outbound message for a source entity
findSentBySource: (
  sourceType: string,
  sourceId: string
) => Promise<Message | null>;
```

**`findByProviderRef`** solves inbound correlation: "this reply references provider message X — which dispatch message produced it?"

**`findSentBySource`** solves outbound reply routing: "I need to reply in the thread for business entity Y — what are the provider coordinates?"

The `dispatch_messages` table already has indexes on `source_id` (index #3). The `providerResponse` JSONB query would benefit from a GIN index, but even without one it hits the source_id index first for filtered queries.

---

## 4. Metadata Conventions (Document, Don't Enforce)

The adapter needs documented conventions for how channel-specific features map to the generic dispatch types. These should be in the adapter's JSDoc and the package documentation:

| Convention | Field | Purpose |
|-----------|-------|---------|
| Thread replies | `metadata.threadTs` | When present on an outbound message, the adapter posts as a reply in this Slack thread |
| Block Kit | `payload.context.blocks` | When present, passed as `blocks` parameter to Slack API for rich formatting |
| Inbound channel | `payload.context.slackChannel` | The Slack channel ID where the inbound message was received |
| Inbound timestamp | `payload.context.slackTimestamp` | The Slack message timestamp |
| Inbound thread | `payload.context.slackThreadTs` | The parent thread timestamp (present only for thread replies) |
| Provider thread ID | `providerResponse.ts` | The Slack message timestamp returned after delivery — used as the thread anchor for future replies |
| Provider channel | `providerResponse.channel` | The resolved Slack channel ID returned after delivery |

These are not arbitrary — they're the natural mapping between Slack's API and dispatch's generic types. Document them so every consuming project uses the same field names instead of inventing their own.

---

## 5. What This Unblocks For Us

With a production Slack adapter in core, we would delete from Axiom:

| File | Lines | What It Is |
|------|-------|-----------|
| `modules/dispatch/infrastructure/slackChannelAdapter.ts` | 142 | The adapter we built |
| `modules/slack/application/verifySlackWebhookUseCase.ts` | 53 | The verification workaround |
| `modules/slack/application/verifySlackWebhookUseCase.capability.ts` | 18 | Its capability sidecar |
| `modules/dispatch/infrastructure/repositories/DrizzleDispatchCorrelationRepository.ts` | 100 | Custom JSONB queries |

**~313 lines of infrastructure code** that is channel plumbing, not business logic.

Our Axiom-side dispatch footprint would shrink to:
- `nucleus.ts` — composition root (register core adapter with our config, register our handler)
- `taskReplyHandler.ts` — our business handler (what to do when someone replies)
- Notification use cases — our business logic (what to post to Slack and when)

That's the right split: **core owns the channel, projects own the business logic**.

---

## 6. Summary of Requested Changes

| # | Change | Where | Breaking? |
|---|--------|-------|-----------|
| 1 | Replace Slack adapter stub with production implementation using `@slack/web-api` | `infrastructure/adapters/slackAdapter.ts` | No — factory signature compatible, behavior changes from stub to real |
| 2 | Add `thread_ts` extraction to `normalize()` as `payload.context.slackThreadTs` | Same file | No — additive |
| 3 | Add `rawBody` and `headers` to `ReceiveInboundInput` type | `application/receiveInboundUseCase.ts` | No — new optional fields |
| 4 | Expand `verifySignature` to accept raw body + headers | `domain/channel.ts` | Soft breaking — existing adapters need signature update but can ignore new fields |
| 5 | Add `findByProviderRef(field, value, channel?)` to `IMessageRepository` | `domain/messageRepository.ts` + Drizzle impl | No — additive |
| 6 | Add `findSentBySource(sourceType, sourceId)` to `IMessageRepository` | Same | No — additive |
| 7 | Add `@slack/web-api` as a dependency | `package.json` | No |
| 8 | Document metadata conventions in adapter JSDoc | `slackAdapter.ts` | No |

Items 1-2 are the core ask. Items 3-6 are the interface improvements that eliminate project-side workarounds. Items 7-8 are supporting changes.
