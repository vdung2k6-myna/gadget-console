CREATE TABLE "calibration_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid,
	"threshold" double precision,
	"min_frames" integer,
	"previous_threshold" double precision,
	"previous_min_frames" integer,
	"actor" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calibration_default" (
	"id" text PRIMARY KEY NOT NULL,
	"threshold" double precision NOT NULL,
	"min_frames" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_calibration" (
	"device_id" uuid PRIMARY KEY NOT NULL,
	"threshold" double precision NOT NULL,
	"min_frames" integer NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calibration_audit" ADD CONSTRAINT "calibration_audit_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_calibration" ADD CONSTRAINT "device_calibration_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calibration_audit_device_idx" ON "calibration_audit" USING btree ("device_id","at");