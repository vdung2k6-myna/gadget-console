ALTER TABLE "devices" ADD COLUMN "tools" jsonb;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "tools_reported_at" timestamp with time zone;