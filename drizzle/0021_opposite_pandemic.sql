DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "agents" WHERE "tenant_id" IS NULL) THEN
    ALTER TABLE "agents" ALTER COLUMN "tenant_id" SET NOT NULL;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "claims" WHERE "tenant_id" IS NULL) THEN
    ALTER TABLE "claims" ALTER COLUMN "tenant_id" SET NOT NULL;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "conversations" WHERE "tenant_id" IS NULL) THEN
    ALTER TABLE "conversations" ALTER COLUMN "tenant_id" SET NOT NULL;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "device_calibration" WHERE "tenant_id" IS NULL) THEN
    ALTER TABLE "device_calibration" ALTER COLUMN "tenant_id" SET NOT NULL;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "devices" WHERE "tenant_id" IS NULL) THEN
    ALTER TABLE "devices" ALTER COLUMN "tenant_id" SET NOT NULL;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "turns" WHERE "tenant_id" IS NULL) THEN
    ALTER TABLE "turns" ALTER COLUMN "tenant_id" SET NOT NULL;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX "agents_tenant_idx" ON "agents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "calibration_audit_tenant_idx" ON "calibration_audit" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "calibration_default_tenant_idx" ON "calibration_default" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "claims_tenant_idx" ON "claims" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "conversations_tenant_idx" ON "conversations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "device_calibration_tenant_idx" ON "device_calibration" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "devices_tenant_idx" ON "devices" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "firmware_tenant_idx" ON "firmware_releases" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "provider_profiles_tenant_idx" ON "provider_profiles" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "runtimes_tenant_idx" ON "runtimes" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "turns_tenant_idx" ON "turns" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "users_tenant_idx" ON "users" USING btree ("tenant_id");