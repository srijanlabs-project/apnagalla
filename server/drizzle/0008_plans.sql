CREATE TABLE "coupons" (
	"code" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"value" integer NOT NULL,
	"partner" text,
	"max_uses" integer,
	"used" integer DEFAULT 0 NOT NULL,
	"valid_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"price_monthly" integer DEFAULT 0 NOT NULL,
	"price_yearly" integer DEFAULT 0 NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"plan_id" text NOT NULL,
	"period" text NOT NULL,
	"amount" integer NOT NULL,
	"gst" integer NOT NULL,
	"total" integer NOT NULL,
	"code" text,
	"link_id" text,
	"link_url" text,
	"status" text DEFAULT 'created' NOT NULL,
	"invoice_no" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"business_id" uuid PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"trial_end" timestamp with time zone,
	"period_end" timestamp with time zone,
	"referred_by" text,
	"partner_code" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_payments" ADD CONSTRAINT "platform_payments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_payments_business_idx" ON "platform_payments" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "platform_payments_link_idx" ON "platform_payments" USING btree ("link_id");