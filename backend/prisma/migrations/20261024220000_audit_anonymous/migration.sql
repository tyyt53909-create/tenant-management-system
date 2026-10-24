-- SEC-06 / T270：匿名请求审计允许 userId 为空。
ALTER TABLE "audit_logs" ALTER COLUMN "userId" DROP NOT NULL;
