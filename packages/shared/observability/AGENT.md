# observability — Agent Reference

## How to add logging to a use case

```ts
// application/createCampaignUseCase.ts
import { log } from '@/packages/shared/observability'

const useCaseLog = log.child({ source: 'campaigns.createUseCase' })

export const makeCreateCampaignUseCase = (campaignRepo: ICampaignRepository) => {
  return async (data: CreateCampaignInput): Promise<Result<Campaign, CampaignError>> => {
    useCaseLog.debug('campaign.create_started', { name: data.name })

    const result = await campaignRepo.save(campaign)

    useCaseLog.info('campaign.created', { campaignId: campaign.id })
    return { success: true, value: campaign }
  }
}
```

## Logging errors

Pass the Error as the second argument:

```ts
useCaseLog.error('campaign.save_failed', err, { campaignId: campaign.id })
```

The record will include `error.message`, `error.stack_trace`, `error.type` (ECS names).

## Event naming convention

`namespace.event_name` — e.g. `campaign.created`, `auth.login_failed`, `iam.permission_denied`.
Convention only; not lint-enforced.

## Lazy callback for expensive payloads

```ts
log.debug('db.query_plan', () => ({ plan: db.explainSync(query) }))
// The callback is NOT called when debug is disabled — zero cost
```

## Public API

| Export | Purpose |
|--------|---------|
| `log` | Singleton logger — use this everywhere |
| `log.child(bindings)` | Child logger with bound fields |
| `log.withContext(fields, fn)` | Thread context without param changes |
| `log.setLevel(pattern, level)` | Runtime level override |
| `log.getLevel(source?)` | Query effective level |
| `log.addTransport(t)` | Register additional transport |
| `makeFileTransport(opts)` | Create rotating file transport |
| `makeConsoleTransport()` | Create console transport (already default) |

## Import path

```ts
import { log } from '@/packages/shared/observability'
import { makeFileTransport } from '@/packages/shared/observability'
import type { Logger, LogRecord, LogLevel } from '@/packages/shared/observability'
```
