-- T317 / R02：租客邀请绑定指定预建档案。可空列，旧邀请码保持不动。
ALTER TABLE "invite_codes" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;

CREATE INDEX IF NOT EXISTS "invite_codes_tenantId_idx" ON "invite_codes"("tenantId");

DO $$ BEGIN
  ALTER TABLE "invite_codes"
    ADD CONSTRAINT "invite_codes_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
