ALTER TABLE "agents" DROP CONSTRAINT "agents_llm_profile_id_llm_profiles_id_fk";
--> statement-breakpoint
-- The LLM profiles that predate provider_profiles become its `llm` kind, keeping
-- their ids, so an agent's existing binding needs no rewrite. The encrypted key
-- travels unchanged: both tables are opened with the same key.
INSERT INTO "provider_profiles" ("id", "user_id", "kind", "name", "base_url", "encrypted_key", "model", "temperature", "builtin", "created_at")
SELECT "id", "user_id", 'llm', "name", "base_url", "encrypted_key", "model", "temperature", false, "created_at"
FROM "llm_profiles";
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_llm_profile_id_provider_profiles_id_fk" FOREIGN KEY ("llm_profile_id") REFERENCES "public"."provider_profiles"("id") ON DELETE set null ON UPDATE no action;