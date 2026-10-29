CREATE TABLE IF NOT EXISTS "operating_expenses" (
  "id" TEXT PRIMARY KEY, "buildingId" TEXT NOT NULL REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "category" TEXT NOT NULL, "description" TEXT NOT NULL, "amount" INTEGER NOT NULL CHECK ("amount" > 0),
  "sourceReference" TEXT, "publicUtilityBillId" TEXT UNIQUE REFERENCES "public_utility_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "requestKey" TEXT NOT NULL UNIQUE, "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "operating_expenses_buildingId_createdAt_idx" ON "operating_expenses"("buildingId", "createdAt");
CREATE TABLE IF NOT EXISTS "expense_payments" (
  "id" TEXT PRIMARY KEY, "expenseId" TEXT NOT NULL UNIQUE REFERENCES "operating_expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "amount" INTEGER NOT NULL CHECK ("amount" > 0), "paidDate" DATE NOT NULL, "evidence" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL UNIQUE, "recordedById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "expense_payments_paidDate_idx" ON "expense_payments"("paidDate");
