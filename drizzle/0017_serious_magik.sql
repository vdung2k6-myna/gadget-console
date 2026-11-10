ALTER TABLE "tenants" ADD COLUMN "speech_allowance_seconds" integer;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "source" text DEFAULT 'platform' NOT NULL;