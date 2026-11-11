ALTER TABLE "provider_profiles" ALTER COLUMN "base_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_profiles" ALTER COLUMN "model" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_profiles" ADD COLUMN "adapter_id" uuid;--> statement-breakpoint
ALTER TABLE "provider_profiles" ADD COLUMN "config" jsonb;--> statement-breakpoint
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_adapter_id_provider_adapters_id_fk" FOREIGN KEY ("adapter_id") REFERENCES "public"."provider_adapters"("id") ON DELETE restrict ON UPDATE no action;