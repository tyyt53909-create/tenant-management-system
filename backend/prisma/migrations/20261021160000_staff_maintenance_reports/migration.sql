-- T225：保洁/维修人员上报问题
-- 1) 工单可以不属于某个租客（空置房、公共区域、保洁/维修巡查发现的问题）。
-- 2) 记录发起人账号，便于管理处追溯与联系。

ALTER TABLE "maintenance_requests" ALTER COLUMN "tenantId" DROP NOT NULL;

ALTER TABLE "maintenance_requests" ADD COLUMN "createdById" TEXT;

CREATE INDEX "maintenance_requests_createdById_idx" ON "maintenance_requests"("createdById");

ALTER TABLE "maintenance_requests"
  ADD CONSTRAINT "maintenance_requests_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
