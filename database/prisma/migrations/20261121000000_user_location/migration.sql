-- Ward chosen at signup/profile (TEST_CMT feature). Nullable so existing users
-- keep working; the API requires it on signup and on profile save.
ALTER TABLE "USERS" ADD COLUMN IF NOT EXISTS "location" TEXT;
