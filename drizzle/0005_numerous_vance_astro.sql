ALTER TABLE "devices" ADD COLUMN "hardware" jsonb;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "hardware_reported_at" timestamp with time zone;