ALTER TABLE "claims" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "rejected_at" timestamp with time zone;
-- Claims consumed before approval existed are already owned: treat them as approved.
UPDATE "claims" SET "approved_at" = "consumed_at" WHERE "consumed_at" IS NOT NULL;
