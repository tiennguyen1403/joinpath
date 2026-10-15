-- CreateEnum
CREATE TYPE "decision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "approval_decisions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "approval_task_id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "decision" "decision" NOT NULL,
    "reason" TEXT,
    "decided_by" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "approval_decisions_approval_task_id_submission_id_key" ON "approval_decisions"("approval_task_id", "submission_id");

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_approval_task_id_fkey" FOREIGN KEY ("approval_task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "document_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prisma schema can't express CHECK constraints (PLAN §6.2). A rejection says why (BR-R04).
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_reason_check" CHECK ("decision" = 'APPROVED' OR "reason" IS NOT NULL);
