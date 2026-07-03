# observability

Structured logging SDK for Nucleus consumers. One import, production-ready logs.

## Owns
- `log` singleton — six severity levels (`trace | debug | info | warn | error | fatal`)
- Child loggers with bound fields: `log.child({ source: 'campaigns.createUseCase' })`
- AsyncLocalStorage context propagation: `log.withContext({ requestId, traceId, userId, tenantId }, fn)`
- Runtime level control: `log.setLevel(pattern, level)`, `LOG_LEVEL` / `LOG_LEVELS` env vars
- Two transports v1: console (JSON to stdout) and file (size-based rotation, in-package)
- OpenTelemetry Logs Data Model on the wire + Elastic Common Schema field names where natural

## Does Not Own
- Metrics or traces/spans — deferred to a future version of this package
- HTTP / OTel collector transports — deferred to v2
- Sentry-style error tracking, source maps, breadcrumbs — out of scope

## Output Shape
Every record on the wire conforms to the OpenTelemetry Logs Data Model:
`Timestamp`, `SeverityNumber`, `SeverityText`, `Body`, `Attributes`, `TraceId`, `SpanId`, `Resource`.
Fields inside `Attributes` use ECS names where natural: `error.message`, `error.stack_trace`,
`error.type`, `http.request.id`, `service.name`.

## Engine
Pino v9. Fully wrapped — consumers never import pino directly. Pino is an `npmDependency` on
this registry block and is propagated to consuming repos automatically by `nucleus add observability`.

## Optional
`pino-pretty` can be added as a `devDependency` in the consuming repo for human-readable terminal
output. The SDK detects it at runtime and falls back silently to JSON when absent.

## Status
Stable. Ships with console + file transports. OTel-shape output is forward-compatible with metrics
and traces being added later without breaking the logger surface.
