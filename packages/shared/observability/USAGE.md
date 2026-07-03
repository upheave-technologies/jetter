# Usage — observability

## Install

```sh
nucleus add observability
```

This copies the package source to `packages/shared/observability/` in your project and adds
`pino@^9.x` to your `package.json`. For human-readable dev output:

```sh
pnpm add -D pino-pretty
```

## Basic logging

```ts
import { log } from '@/packages/shared/observability'

// Event name convention: namespace.event_name
log.info('campaign.created', { campaignId: '123', brandId: 'b1' })
log.warn('auth.rate_limit_exceeded', { userId: 'u1', attempts: 5 })
log.error('payment.charge_failed', new Error('card declined'), { orderId: 'o1' })
```

Event names follow the `namespace.event_name` pattern — e.g. `campaign.created`,
`auth.login_failed`, `iam.permission_denied`. This is a convention, not enforced by lint.

## Child loggers

Bind fields to a child logger so they appear in every record it emits:

```ts
const campaignLog = log.child({ source: 'campaigns.createUseCase' })
campaignLog.info('campaign.created', { campaignId: id })
// Attributes will include: source, campaignId
```

## Lazy debug (zero-cost dormant logs)

The lazy callback form is NEVER invoked when the level is disabled:

```ts
log.debug('cache.miss', () => ({
  key: cacheKey,
  size: expensiveComputation(),  // only evaluated when debug is enabled
}))
```

## Context propagation (AsyncLocalStorage)

Thread fields automatically without changing every function signature:

```ts
// In middleware / request handler:
await log.withContext({ requestId: req.id, userId: session.userId, traceId }, async () => {
  // Every log call inside here (and any awaited function it calls) gets these fields
  await processOrder(orderId)
})

// In processOrder — no extra parameters needed:
log.info('order.processing_started', { orderId })
// Record includes: requestId, userId, traceId, orderId
```

Nested `withContext` calls: inner fields override outer fields per key.

## Runtime level control

```ts
// Set global level
log.setLevel('*', 'debug')

// Set per-namespace level
log.setLevel('campaigns.*', 'debug')
log.setLevel('iam', 'warn')

// Query effective level
log.getLevel('campaigns.createUseCase')  // 'debug'
```

## Environment variables

| Var | Effect | Example |
|-----|--------|---------|
| `LOG_LEVEL` | Global default level | `LOG_LEVEL=debug` |
| `LOG_LEVELS` | Per-namespace overrides | `LOG_LEVELS=*=info,campaigns=debug,iam=trace` |
| `LOG_FORMAT` | Output format: `pretty` or `json` | `LOG_FORMAT=pretty` |
| `NODE_ENV` | Drives default level and format | `NODE_ENV=development` |
| `SERVICE_NAME` | Sets `Resource.service.name` | `SERVICE_NAME=my-api` |

**Default levels from `NODE_ENV`:**
- `development` or `dev` → `debug`
- `test` → `warn`
- anything else (including `production`) → `info`

**`LOG_FORMAT` precedence:** explicit `LOG_FORMAT` always wins. Without it, defaults to `pretty`
when `NODE_ENV=development` (if `pino-pretty` is installed), `json` otherwise.

## Transports

### Console transport (default)

Active by default. Writes line-delimited JSON to stdout.

### File transport

```ts
import { log, makeFileTransport } from '@/packages/shared/observability'

log.addTransport(makeFileTransport({
  filePath: '/var/log/myapp/app.log',
  maxSizeBytes: 10 * 1024 * 1024,  // 10 MB (default)
  maxFiles: 5,                       // retain 5 rotated files (default)
}))
```

Rotation: when the active file exceeds `maxSizeBytes`, it is renamed to `.1`, old `.1` to `.2`,
etc. Files beyond `maxFiles` are evicted. Zero record loss — writes are synchronous.

### Custom transport

```ts
import type { Transport } from '@/packages/shared/observability'

const myTransport: Transport = {
  write(record, json) {
    // record: typed LogRecord (OTel shape)
    // json: serialized string ready to send
    sendToMyBackend(json)
  }
}
log.addTransport(myTransport)
```

## Output format example

```json
{
  "Timestamp": "2026-05-07T12:34:56.789Z",
  "SeverityNumber": 9,
  "SeverityText": "INFO",
  "Body": "campaign.created",
  "Attributes": {
    "source": "campaigns.createUseCase",
    "campaignId": "c123",
    "http.request.id": "req-abc",
    "service.name": "my-api"
  },
  "TraceId": "trace-xyz",
  "Resource": { "service.name": "my-api" }
}
```
