CREATE TABLE "returned_numbers" (
	"business_id" uuid NOT NULL,
	"series" text NOT NULL,
	"seq" integer NOT NULL,
	CONSTRAINT "returned_numbers_business_id_series_seq_pk" PRIMARY KEY("business_id","series","seq")
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "series_code" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "returned_numbers" ADD CONSTRAINT "returned_numbers_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_records_number_idx" ON "sync_records" USING btree ("business_id","table_name",("data"->>'number'));--> statement-breakpoint
-- Staff who joined before per-person series get letters B, C, D… in the order they joined.
UPDATE "memberships" m SET "series_code" = c.code
FROM (
  SELECT "id",
    CASE WHEN rn <= 25 THEN chr(65 + rn::int) ELSE chr(65 + ((rn - 26) / 26)::int) || chr(65 + ((rn - 26) % 26)::int) END AS code
  FROM (SELECT "id", row_number() OVER (PARTITION BY "business_id" ORDER BY "created_at", "id") AS rn FROM "memberships" WHERE "role" = 'staff') s
) c
WHERE m."id" = c."id";
