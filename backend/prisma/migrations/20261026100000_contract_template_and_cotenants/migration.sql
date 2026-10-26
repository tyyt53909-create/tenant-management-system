-- T299 / LSE-02: 合同模板、电子签约与共同承租人

-- CreateEnum ContractSignStatus
CREATE TYPE "ContractSignStatus" AS ENUM ('UNSIGNED', 'SIGNING', 'SIGNED', 'REJECTED');

-- CreateEnum ContractTemplateStatus
CREATE TYPE "ContractTemplateStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterTable contracts
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "templateId" TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "signStatus" "ContractSignStatus" NOT NULL DEFAULT 'UNSIGNED';
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "signFlowId" TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "signedAt" TIMESTAMP(3);
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "signDocUrl" TEXT;

-- CreateTable contract_templates
CREATE TABLE IF NOT EXISTS "contract_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "content" TEXT NOT NULL,
    "terms" JSONB,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" "ContractTemplateStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable contract_co_tenants
CREATE TABLE IF NOT EXISTS "contract_co_tenants" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "idType" "IdType" NOT NULL DEFAULT 'ID_CARD',
    "idNumber" TEXT,
    "relationship" TEXT,
    "isSigner" BOOLEAN NOT NULL DEFAULT false,
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_co_tenants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "contract_templates_code_key" ON "contract_templates"("code");
CREATE INDEX IF NOT EXISTS "contract_templates_status_isDefault_idx" ON "contract_templates"("status", "isDefault");

CREATE INDEX IF NOT EXISTS "contract_co_tenants_contractId_idx" ON "contract_co_tenants"("contractId");
CREATE INDEX IF NOT EXISTS "contract_co_tenants_phone_idx" ON "contract_co_tenants"("phone");

CREATE INDEX IF NOT EXISTS "contracts_signStatus_idx" ON "contracts"("signStatus");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "contract_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contract_co_tenants" ADD CONSTRAINT "contract_co_tenants_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
