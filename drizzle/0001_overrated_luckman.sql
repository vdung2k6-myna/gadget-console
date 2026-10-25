CREATE TABLE "llm_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"model" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"temperature" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "llm_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "llm_profiles" ADD CONSTRAINT "llm_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "llm_profiles_user_idx" ON "llm_profiles" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_llm_profile_id_llm_profiles_id_fk" FOREIGN KEY ("llm_profile_id") REFERENCES "public"."llm_profiles"("id") ON DELETE set null ON UPDATE no action;