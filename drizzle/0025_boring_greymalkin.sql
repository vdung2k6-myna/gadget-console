ALTER TABLE "provider_adapters" ADD COLUMN "previous_token_encrypted" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_adapters" ADD COLUMN "previous_token_hint" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_adapters" ADD COLUMN "previous_token_expires_at" timestamp with time zone;