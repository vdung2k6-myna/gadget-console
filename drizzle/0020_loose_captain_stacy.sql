CREATE TABLE "provider_adapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"name" text NOT NULL,
	"endpoint" text NOT NULL,
	"kinds" text[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"health" text DEFAULT 'unknown' NOT NULL,
	"privacy" jsonb,
	"capabilities" jsonb,
	"quality" jsonb,
	"manifest_version" text,
	"token_encrypted" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "adapter_policy" jsonb;--> statement-breakpoint
ALTER TABLE "provider_adapters" ADD CONSTRAINT "provider_adapters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_adapters_tenant_idx" ON "provider_adapters" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "provider_adapters_status_idx" ON "provider_adapters" USING btree ("status");