-- @scenario: 20-example-scenario
-- @purpose: example scenario showing the conventions — replace with real fixtures
-- @idempotent: true
-- @requires: 00-defaults
-- @produces: a marker row in a hypothetical `seed_markers` table
-- @verifies:
--   SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname = 'public' LIMIT 1;

-- This file exists to demonstrate the seed contract for new operators.
-- Delete this file (or replace its body) once you have real scenarios.
--
-- The @verifies query above only checks "there is at least one table in the
-- public schema" — i.e., the DB is migrated. Replace it with a meaningful
-- post-state check for your real scenario.

SELECT 1 AS example_noop;
