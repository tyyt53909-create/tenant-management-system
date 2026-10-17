-- AlterTable
ALTER TABLE "tenant_registrations" ADD COLUMN "idNumberHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "tenant_registrations_idNumberHash_key" ON "tenant_registrations"("idNumberHash");
