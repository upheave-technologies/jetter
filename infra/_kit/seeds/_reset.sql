-- @scenario: _reset
-- @purpose: truncate ephemeral + scenario tables for a clean re-seed
-- @idempotent: true
-- @verifies:
--   SELECT 1;

-- Project-specific. Edit this list to match the project's ephemeral tables.
-- For Demoapp: signals, sessions, dispatch_logs, notifications, messages are
-- typical ephemeral targets; projects is a fixture (kept).
--
-- IMPORTANT: do NOT include `projects` here — it's reconciled from
-- infra/projects.{dev,prod}.yaml and would re-seed itself, but you'd churn
-- foreign keys for no reason. Same for any other manifest-driven table.

-- TRUNCATE signals, sessions, dispatch_logs, notifications, messages, observations
--   RESTART IDENTITY CASCADE;

-- Stub until the project lists its ephemeral tables.
SELECT 1 AS reset_noop;
