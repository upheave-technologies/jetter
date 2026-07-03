# shared

Foundational types and utilities used across all Nucleus core packages. Not a business domain — a utility foundation.

## Owns
- `Result<T, E>` — discriminated union for success/failure without exceptions
- `defineCapability()` — annotation helper for use case capability sidecars
- Prover constants: `EFFECTS`, `CAPABILITIES`, `CONTEXTS`

## Does Not Own
- Business logic of any kind
- Database schemas or repositories
- Use cases

## Status
Stable. Required by all core packages.
