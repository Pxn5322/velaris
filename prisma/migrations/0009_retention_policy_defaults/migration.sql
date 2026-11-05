-- T6.06 retention policy defaults (F-14; AC-F14-2; D-38).
--
-- Provisioning now writes one TRACES row per new tenant. This backfill gives
-- every existing tenant the same row, so the trace writer reads a stored
-- window instead of silently falling back to the constant. The value is the
-- 30-day default the writer already applied, so behaviour does not change.
--
-- KNOWLEDGE and MEMORY get no row: their records carry their own expiry, and
-- their default windows are a commercial decision that is not approved yet.

INSERT INTO "retention_policies" (
    "id",
    "tenant_id",
    "category",
    "retention_days",
    "updated_by",
    "created_at",
    "updated_at"
)
SELECT
    gen_random_uuid(),
    t."id",
    'TRACES',
    30,
    NULL,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "tenants" t
WHERE NOT EXISTS (
    SELECT 1
    FROM "retention_policies" p
    WHERE p."tenant_id" = t."id"
      AND p."category" = 'TRACES'
);
