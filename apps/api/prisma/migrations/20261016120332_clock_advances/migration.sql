-- CreateTable
CREATE TABLE "clock_advances" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "offset_days" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clock_advances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clock_advances_organization_id_created_at_idx" ON "clock_advances"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "clock_advances" ADD CONSTRAINT "clock_advances_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
