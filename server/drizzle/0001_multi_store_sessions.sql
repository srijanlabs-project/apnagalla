DROP INDEX "memberships_one_active_per_user";--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "client" text DEFAULT 'mobile' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "revoked_reason" text;--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_one_per_business_user" ON "memberships" USING btree ("business_id","user_id") WHERE "memberships"."removed_at" is null;