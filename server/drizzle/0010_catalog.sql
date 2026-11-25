CREATE SEQUENCE "public"."catalog_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"id" text PRIMARY KEY NOT NULL,
	"section" text NOT NULL,
	"category" text NOT NULL,
	"item" text NOT NULL,
	"brand" text,
	"size" double precision,
	"size_unit" text,
	"sell_unit" text NOT NULL,
	"hsn" text,
	"gst_pct" double precision,
	"other_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"deleted" boolean DEFAULT false NOT NULL,
	"seq" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "catalog_items_section_seq" ON "catalog_items" USING btree ("section","seq");--> statement-breakpoint
CREATE TABLE "catalog_aliases" (
	"word" text PRIMARY KEY NOT NULL,
	"means" text NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"seq" bigint NOT NULL
);
