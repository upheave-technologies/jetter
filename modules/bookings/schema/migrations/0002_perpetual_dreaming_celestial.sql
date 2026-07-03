CREATE TYPE "public"."audit_action" AS ENUM('create', 'edit', 'cancel', 'apply', 'login_success', 'login_failure');--> statement-breakpoint
CREATE TYPE "public"."audit_entity_type" AS ENUM('reservation', 'maintenance', 'reconciliation', 'auth', 'system');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entity_type" "audit_entity_type" NOT NULL,
	"action" "audit_action" NOT NULL,
	"entity_id" text,
	"actor" text DEFAULT 'operator' NOT NULL,
	"summary" text,
	"before" jsonb,
	"after" jsonb,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_events_occurred_at" ON "audit_events" USING btree ("occurred_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_events_entity_id" ON "audit_events" USING btree ("entity_id");