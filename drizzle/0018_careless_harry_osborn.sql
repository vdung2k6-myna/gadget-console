DROP INDEX "firmware_board_version_unique";--> statement-breakpoint
DROP INDEX "firmware_board_target_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "firmware_board_version_unique" ON "firmware_releases" USING btree ("tenant_id","board_type","version");--> statement-breakpoint
CREATE UNIQUE INDEX "firmware_board_target_unique" ON "firmware_releases" USING btree ("tenant_id","board_type") WHERE "firmware_releases"."targeted";