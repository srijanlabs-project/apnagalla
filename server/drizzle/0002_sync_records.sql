CREATE SEQUENCE "public"."sync_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "number_counters" (
	"business_id" uuid NOT NULL,
	"series" text NOT NULL,
	"next" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "number_counters_business_id_series_pk" PRIMARY KEY("business_id","series")
);
--> statement-breakpoint
CREATE TABLE "sync_records" (
	"business_id" uuid NOT NULL,
	"table_name" text NOT NULL,
	"id" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" uuid,
	"deleted" boolean DEFAULT false NOT NULL,
	"seq" bigint NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_records_business_id_table_name_id_pk" PRIMARY KEY("business_id","table_name","id")
);
--> statement-breakpoint
ALTER TABLE "number_counters" ADD CONSTRAINT "number_counters_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_records" ADD CONSTRAINT "sync_records_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_records_business_seq_idx" ON "sync_records" USING btree ("business_id","seq");