CREATE TABLE "provider_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"encrypted_key" text DEFAULT '' NOT NULL,
	"model" text NOT NULL,
	"voice" text,
	"temperature" double precision,
	"builtin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "engine" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "stt_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "tts_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_profiles_user_kind_idx" ON "provider_profiles" USING btree ("user_id","kind");--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_stt_profile_id_provider_profiles_id_fk" FOREIGN KEY ("stt_profile_id") REFERENCES "public"."provider_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_tts_profile_id_provider_profiles_id_fk" FOREIGN KEY ("tts_profile_id") REFERENCES "public"."provider_profiles"("id") ON DELETE set null ON UPDATE no action;