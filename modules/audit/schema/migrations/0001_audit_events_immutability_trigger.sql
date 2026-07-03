-- =============================================================================
-- Custom migration — DB-LEVEL IMMUTABILITY HARDENING for audit_events
-- =============================================================================
-- SPEC DEC-AU2 / AC-4: the audit log is APPEND-ONLY and IMMUTABLE. No row may
-- ever be UPDATEd or DELETEd through ANY code path. The human approved BOTH
-- layers of enforcement (2026-07-02):
--   * app-level append-only  → donnie's repository exposes only append + read
--                              (no update/delete method) — that is donnie's job,
--                              NOT encoded here.
--   * DB-level append-only   → THIS migration: a trigger that RAISEs on any
--                              UPDATE or DELETE, so even a stray SQL statement,
--                              a psql session, or a future buggy repository
--                              cannot rewrite history. Belt and suspenders.
--
-- WHY A TRIGGER (RAISE) rather than REVOKE UPDATE/DELETE:
--   REVOKE relies on the app connecting as a non-owning role; a superuser /
--   table-owner connection (which local dev and many single-instance deploys
--   use) bypasses REVOKE entirely. A BEFORE trigger fires regardless of role —
--   it is the stronger, role-independent guarantee for a favour-grade single-DB
--   deployment. INSERT is deliberately NOT guarded: appends are the only
--   permitted write. TRUNCATE is a statement-level DDL-ish operation; a
--   BEFORE TRUNCATE trigger is added too so a `TRUNCATE audit_events` cannot
--   silently wipe the trail either.
--
-- WHY A SEPARATE CUSTOM MIGRATION (archie-rules §5):
--   Triggers are not expressible in the Drizzle schema DSL, so drizzle-kit
--   `generate` cannot emit them and would never reproduce a hand-edit of the
--   generated 0000 table SQL. Hand-editing generated SQL is forbidden (§5) —
--   the next `generate` would not know about the edit. Instead this lives in its
--   own `--custom` migration slot (0001), registered in meta/_journal.json, so
--   `drizzle-kit migrate` applies it right after the 0000 CREATE TABLE and the
--   migration history stays regeneratable.
--
-- SEQUENCING: 0000 creates the table; 0001 (this file) attaches the guard. The
-- function/triggers are created idempotently (CREATE OR REPLACE / DROP IF EXISTS
-- then CREATE) so re-running the migration is safe (architecture.md §6).
--
-- CORRECTIONS ARE NOT UPDATES: a correction is itself a NEW appended event
-- (DEC-AU2). This guard therefore never obstructs the intended write path.
-- =============================================================================

-- Reject function: raises on any attempt to mutate or remove an audit row.
CREATE OR REPLACE FUNCTION audit_events_reject_mutation()
	RETURNS trigger
	LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION
		'audit_events is append-only and immutable: % is not permitted (SPEC DEC-AU2)',
		TG_OP
		USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint

-- Guard UPDATE. BEFORE, row-level: fires before any column is changed.
DROP TRIGGER IF EXISTS audit_events_no_update ON "audit_events";--> statement-breakpoint
CREATE TRIGGER audit_events_no_update
	BEFORE UPDATE ON "audit_events"
	FOR EACH ROW
	EXECUTE FUNCTION audit_events_reject_mutation();
--> statement-breakpoint

-- Guard DELETE. BEFORE, row-level: fires before any row is removed.
DROP TRIGGER IF EXISTS audit_events_no_delete ON "audit_events";--> statement-breakpoint
CREATE TRIGGER audit_events_no_delete
	BEFORE DELETE ON "audit_events"
	FOR EACH ROW
	EXECUTE FUNCTION audit_events_reject_mutation();
--> statement-breakpoint

-- Guard TRUNCATE. BEFORE, statement-level (TRUNCATE has no per-row context):
-- prevents a bulk wipe of the trail from bypassing the row-level guards above.
DROP TRIGGER IF EXISTS audit_events_no_truncate ON "audit_events";--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate
	BEFORE TRUNCATE ON "audit_events"
	FOR EACH STATEMENT
	EXECUTE FUNCTION audit_events_reject_mutation();
