-- Profile avatar upload and custom role permission profiles.
--
-- avatar_data_url stores a small browser-compressed image as a data URL. The
-- API validates the MIME type and magic bytes before writing. An empty string
-- records an explicit removal, so the provider photo does not reappear; NULL
-- means the caller never changed the photo.
--
-- base_role_code lets a tenant-owned role inherit the permissions of one of
-- the tenant-assignable system roles. The role resolver maps a custom role to
-- this canonical profile, so authorization never trusts a client role name.
ALTER TABLE "users" ADD COLUMN "avatar_data_url" TEXT;

ALTER TABLE "roles" ADD COLUMN "base_role_code" TEXT;

UPDATE "roles"
SET "base_role_code" = "code"
WHERE "tenant_id" IS NULL;
