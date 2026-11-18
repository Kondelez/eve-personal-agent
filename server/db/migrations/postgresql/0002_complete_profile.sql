ALTER TABLE "user_profiles" ADD COLUMN "onboarding_completed_at" timestamp;--> statement-breakpoint
INSERT INTO "user_profiles" ("user_id", "onboarding_completed_at")
SELECT "user"."id", "phone_links"."sms_consent_at"
FROM "user"
JOIN "phone_links" ON "phone_links"."app_user_id" = "user"."id"
WHERE "user"."email_verified"
  AND lower("user"."email") NOT LIKE '%@phone.eve.invalid'
  AND char_length(trim("user"."name")) BETWEEN 1 AND 100
  AND lower(trim("user"."name")) <> 'eve user'
  AND "phone_links"."verified_at" IS NOT NULL
  AND "phone_links"."sms_consent_at" IS NOT NULL
ON CONFLICT ("user_id") DO UPDATE
SET "onboarding_completed_at" = excluded."onboarding_completed_at";
