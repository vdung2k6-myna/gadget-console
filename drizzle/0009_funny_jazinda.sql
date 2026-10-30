ALTER TABLE "turns" ALTER COLUMN "engine" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "turns" ADD COLUMN "stt_profile" text;--> statement-breakpoint
ALTER TABLE "turns" ADD COLUMN "tts_profile" text;--> statement-breakpoint
ALTER TABLE "turns" ADD COLUMN "llm_profile" text;