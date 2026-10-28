CREATE TABLE "firmware_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_type" text NOT NULL,
	"version" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"targeted" boolean DEFAULT false NOT NULL,
	"forced" boolean DEFAULT false NOT NULL,
	"uploaded_by" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "firmware_releases" ADD CONSTRAINT "firmware_releases_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "firmware_board_version_unique" ON "firmware_releases" USING btree ("board_type","version");--> statement-breakpoint
CREATE UNIQUE INDEX "firmware_board_target_unique" ON "firmware_releases" USING btree ("board_type") WHERE "firmware_releases"."targeted";--> statement-breakpoint
CREATE INDEX "firmware_board_idx" ON "firmware_releases" USING btree ("board_type");