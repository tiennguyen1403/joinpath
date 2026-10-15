-- CreateEnum
CREATE TYPE "onboarding_status" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "task_type" AS ENUM ('CHECKLIST', 'DOCUMENT', 'APPROVAL');

-- CreateEnum
CREATE TYPE "task_status" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELED');

-- AlterTable
ALTER TABLE "audit_events" ADD COLUMN     "onboarding_id" UUID;

-- CreateTable
CREATE TABLE "onboardings" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "template_version_id" UUID,
    "status" "onboarding_status" NOT NULL DEFAULT 'DRAFT',
    "start_date" DATE NOT NULL,
    "activated_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "canceled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboardings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "onboarding_id" UUID NOT NULL,
    "definition_key" TEXT NOT NULL,
    "phase_key" TEXT NOT NULL,
    "phase_name" TEXT NOT NULL,
    "phase_order" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "task_type" NOT NULL,
    "assignee_employee_id" UUID NOT NULL,
    "reviews_task_id" UUID,
    "available_on" DATE NOT NULL,
    "due_on" DATE NOT NULL,
    "due_overridden" BOOLEAN NOT NULL DEFAULT false,
    "status" "task_status" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_dependencies" (
    "organization_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "depends_on_task_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("task_id","depends_on_task_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "onboardings_one_open" ON "onboardings"("employee_id") WHERE (status IN ('DRAFT', 'ACTIVE'));

-- CreateIndex
CREATE UNIQUE INDEX "tasks_onboarding_id_definition_key_key" ON "tasks"("onboarding_id", "definition_key");

-- CreateIndex
CREATE INDEX "audit_events_onboarding_id_idx" ON "audit_events"("onboarding_id");

-- AddForeignKey
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "template_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_onboarding_id_fkey" FOREIGN KEY ("onboarding_id") REFERENCES "onboardings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_employee_id_fkey" FOREIGN KEY ("assignee_employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reviews_task_id_fkey" FOREIGN KEY ("reviews_task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_depends_on_task_id_fkey" FOREIGN KEY ("depends_on_task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_onboarding_id_fkey" FOREIGN KEY ("onboarding_id") REFERENCES "onboardings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prisma schema can't express CHECK constraints (PLAN §6.2).
-- A task opens no later than it is due, so overdue never goes with LOCKED_BY_DATE (PLAN §4.4).
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_available_on_due_on_check" CHECK ("available_on" <= "due_on");

-- A task never waits for itself.
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_no_self_check" CHECK ("task_id" <> "depends_on_task_id");
