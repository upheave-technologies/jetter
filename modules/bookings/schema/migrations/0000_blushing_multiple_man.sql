DO $$ BEGIN
 CREATE TYPE "public"."booking_kind" AS ENUM('reservation', 'maintenance');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."booking_status" AS ENUM('reserved', 'cancelled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bookings" (
	"id" text PRIMARY KEY NOT NULL,
	"quantity" integer NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"duration_min" integer NOT NULL,
	"renter_name" text,
	"notes" text,
	"status" "booking_status" NOT NULL,
	"kind" "booking_kind" DEFAULT 'reservation' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_quantity_range" CHECK ("bookings"."quantity" BETWEEN 1 AND 8),
	CONSTRAINT "bookings_window_order" CHECK ("bookings"."end_time" > "bookings"."start_time")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bookings_start_time" ON "bookings" USING btree ("start_time");