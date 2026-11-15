-- F-05: append-only ticket assignment history. The current assignee remains
-- on tickets; this table records each move, including unassignment (NULL to).
CREATE TABLE "ticket_assignments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "from_membership_id" UUID,
    "to_membership_id" UUID,
    "actor_id" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ticket_assignments_tenant_id_ticket_id_created_at_idx"
    ON "ticket_assignments"("tenant_id", "ticket_id", "created_at");

ALTER TABLE "ticket_assignments"
    ADD CONSTRAINT "ticket_assignments_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ticket_assignments"
    ADD CONSTRAINT "ticket_assignments_ticket_id_fkey"
    FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
