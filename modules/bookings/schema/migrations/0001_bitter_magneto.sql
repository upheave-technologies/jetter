ALTER TABLE "bookings" DROP CONSTRAINT "bookings_quantity_range";--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_quantity_range" CHECK ("bookings"."quantity" BETWEEN 1 AND 6);