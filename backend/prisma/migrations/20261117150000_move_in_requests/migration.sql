CREATE TABLE IF NOT EXISTS "move_in_requests" (
  "requestId" TEXT PRIMARY KEY,
  "contractId" TEXT NOT NULL UNIQUE REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "payloadHash" TEXT NOT NULL,
  "occupiedAt" TIMESTAMP(3) NOT NULL,
  "operatorId" TEXT NOT NULL,
  "result" JSONB NOT NULL
);
