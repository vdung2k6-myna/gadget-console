CREATE TABLE "adapter_egress_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"adapter_id" uuid,
	"kind" text NOT NULL,
	"region" text,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "adapter_egress_events" ADD CONSTRAINT "adapter_egress_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adapter_egress_events" ADD CONSTRAINT "adapter_egress_events_adapter_id_provider_adapters_id_fk" FOREIGN KEY ("adapter_id") REFERENCES "public"."provider_adapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adapter_egress_tenant_at_idx" ON "adapter_egress_events" USING btree ("tenant_id","at");--> statement-breakpoint
CREATE INDEX "adapter_egress_adapter_idx" ON "adapter_egress_events" USING btree ("adapter_id");