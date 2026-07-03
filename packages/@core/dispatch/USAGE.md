# Usage — @core/dispatch

## Setup

Wire repositories, engine, and adapters in your composition root:

```ts
import {
  makeMessageRepository,
  makeThreadRepository,
  makeEnqueueOutboundUseCase,
  makeProcessOutboundBatchUseCase,
  makeReceiveInboundUseCase,
  createDispatchEngine,
  createEmailAdapter,
} from '@core/dispatch'

const messageRepo = makeMessageRepository(db)
const threadRepo = makeThreadRepository(db)
const engine = createDispatchEngine()

// Register a channel adapter before enqueueing or processing
engine.registerAdapter('email', createEmailAdapter({ /* provider config */ }))

// enqueueOutbound receives messageRepo, threadRepo, and the engine
const enqueue = makeEnqueueOutboundUseCase(messageRepo, threadRepo, engine)

// processOutboundBatch only needs messageRepo and engine — no threadRepo
const processBatch = makeProcessOutboundBatchUseCase(messageRepo, engine)
```

## I need to send an email or push notification

> Nucleus calls this **outbound dispatch**. Messages are queued and delivered through pluggable **channel adapters** (email, Slack, webhook, push). Sending a message enqueues it; a background worker processes the queue.

```ts
const result = await enqueue({
  channels: ['email'],
  payload: { body: 'Your order has shipped!' },
  // Map each channel to the delivery address
  externalAddresses: { email: 'user@example.com' },
  principalId: principal.id,  // the Principal sending or triggering the message
  createThread: true,         // create a new conversation thread automatically
})

if (result.success) {
  // result.value — array of Message (one per channel)
}

// Process the pending queue (call from a cron job or background worker)
const report = await processBatch({ batchSize: 50 })
// report.value — { processed, delivered, failed, bounced, skipped, failures[] }
```

## I need to receive and process incoming webhooks or emails

> **Inbound messages** are received via channel adapters, auto-threaded, and routed to **handlers** based on configurable predicates.

```ts
import { makeReceiveInboundUseCase, makeProcessInboundUseCase, createRouter } from '@core/dispatch'

// Register a receive-capable adapter
engine.registerAdapter('email', createEmailAdapter({ /* provider config */ }))

const receiveInbound = makeReceiveInboundUseCase(messageRepo, threadRepo, engine)
const router = createRouter()

// Register a handler for matching inbound messages
router.register({
  predicate: { channels: ['email'] },
  handler: {
    handle: async (msg) => {
      // process the inbound message
      return { processed: true }
    },
  },
})

const processInbound = makeProcessInboundUseCase(messageRepo, router)

// Webhook entry point (e.g. POST /webhooks/email)
const received = await receiveInbound({
  channel: 'email',
  rawPayload: webhookBody,
  signature: req.headers['x-webhook-signature'],  // optional — verified if adapter supports it
})

if (received.success) {
  await processInbound({ messageId: received.value.message.id })
}
```

## I need to send messages to Slack

> Register the Slack adapter with your bot token and signing secret. The adapter handles `chat.postMessage` delivery; `providerResponse` on the saved message contains the Slack message timestamp.

```ts
import {
  makeMessageRepository,
  makeThreadRepository,
  makeEnqueueOutboundUseCase,
  makeProcessOutboundBatchUseCase,
  createDispatchEngine,
  createSlackAdapter,
} from '@core/dispatch'

const messageRepo = makeMessageRepository(db)
const threadRepo = makeThreadRepository(db)
const engine = createDispatchEngine()

// Register the Slack adapter with your bot token and signing secret
engine.registerAdapter(createSlackAdapter({
  botToken: process.env.SLACK_BOT_TOKEN!,
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
}))

const enqueue = makeEnqueueOutboundUseCase(messageRepo, threadRepo, engine)
const processBatch = makeProcessOutboundBatchUseCase(messageRepo, engine)

// Send a message to a Slack channel
const result = await enqueue({
  channels: ['slack'],
  payload: { body: 'Your report is ready.' },
  externalAddresses: { slack: '#general' },
  sourceType: 'report',
  sourceId: reportId,
  createThread: true,
})

// Process the queue — the adapter POSTs to chat.postMessage
await processBatch({ batchSize: 50 })
```

## I need to send a threaded reply in Slack

> When the adapter delivers a message, it returns `providerResponse.ts` — the Slack message timestamp that serves as the thread anchor. Use `findSentBySource` to retrieve it, then pass it as `metadata.threadTs` on the reply.

```ts
import { makeSendReplyUseCase } from '@core/dispatch'

const sendReply = makeSendReplyUseCase(messageRepo, threadRepo, engine)

// Find the original message to get the thread anchor
const original = await messageRepo.findSentBySource('report', reportId)
const threadTs = (original?.providerResponse as Record<string, unknown>)?.ts as string

// Reply in the same Slack thread
const reply = await sendReply({
  threadId: original!.threadId!,
  payload: { body: 'Updated: 3 new items added.' },
  metadata: { threadTs },
})
```

## I need to send rich Slack messages with Block Kit

> Pass Block Kit blocks via `payload.context.blocks`. Slack renders blocks as rich formatting; the `body` field is used as the text fallback.

```ts
const result = await enqueue({
  channels: ['slack'],
  payload: {
    body: 'New campaign created',  // fallback text
    context: {
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: 'New Campaign' } },
        { type: 'section', text: { type: 'mrkdwn', text: '*Spring Sale* is live' } },
      ],
    },
  },
  externalAddresses: { slack: '#marketing' },
})
```

## I need to receive and verify inbound Slack messages

> Slack's signature verification requires the raw request body and headers. Pass them via `rawBody` and `headers` on the receive input.

```ts
const receiveInbound = makeReceiveInboundUseCase(messageRepo, threadRepo, engine)

// In your Slack Events API webhook handler (e.g. POST /webhooks/slack)
const rawBody = await request.text()
const payload = JSON.parse(rawBody)

const received = await receiveInbound({
  channel: 'slack',
  rawPayload: payload,
  signature: request.headers.get('x-slack-signature') ?? '',
  rawBody,                                          // raw body for HMAC verification
  headers: Object.fromEntries(request.headers),     // headers for timestamp check
})

if (received.success) {
  // received.value.message — the normalized inbound Message
  // received.value.thread — the auto-resolved Thread
  // Inbound context includes:
  //   payload.context.slackChannel — channel ID
  //   payload.context.slackTimestamp — message timestamp
  //   payload.context.slackThreadTs — parent thread timestamp (for replies)
}
```

## I need to correlate an inbound Slack reply to the original message

> When someone replies in a Slack thread, the inbound message carries `slackThreadTs` — which matches the original outbound message's `providerResponse.ts`. Use `findByProviderRef` to find the original.

```ts
// Inside your inbound handler:
const handler = {
  name: 'report-reply-handler',
  predicate: { channels: ['slack'] },
  priority: 10,
  async handle(message, thread) {
    const threadTs = (message.payload.context as Record<string, unknown>)?.slackThreadTs as string

    if (!threadTs) return { processed: false }

    // Find the original outbound message that started this thread
    const original = await messageRepo.findByProviderRef('ts', threadTs, {
      channel: 'slack',
      direction: 'outbound',
      status: 'sent',
    })

    if (!original) return { processed: false }

    // original.sourceType and original.sourceId tell you which business entity
    // this reply is about — route to your business logic
    await handleReportReply(original.sourceType!, original.sourceId!, message)

    return { processed: true }
  },
}

engine.registerHandler(handler)
```
