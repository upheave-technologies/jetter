-- @scenario: 00-defaults
-- @purpose: ensure default rows exist (idempotent reconciler — safe in any env)
-- @idempotent: true
-- @produces: baseline projects, default policies, system principals
-- @verifies:
--   SELECT count(*) FROM projects;

-- For Demoapp, the canonical project list lives in infra/projects.{dev,prod}.yaml
-- and is reconciled by `pnpm db:seed:projects`. This seed is a thin wrapper
-- that calls that script if it's available, otherwise no-ops.
--
-- The convention every project should follow: 00-defaults.sql does whatever
-- "the world should look like before any scenario runs" — and is safe to run
-- in any environment, at any time.

-- Stub: real projects live in infra/projects.dev.yaml. Run via:
--   pnpm --filter @demoapp/core db:seed:projects
-- The kit will eventually wrap that for you.
SELECT 1 AS defaults_noop;
