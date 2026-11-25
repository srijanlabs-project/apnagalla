CREATE TABLE "store_exports" (
	"business_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"email" text,
	"hour" integer DEFAULT 21 NOT NULL,
	"provider" text,
	"token_enc" text,
	"account_label" text,
	"folder_id" text,
	"last_sent_date" text,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_exports" ADD CONSTRAINT "store_exports_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;