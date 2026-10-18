-- 同一房源同时只能有一份「未结束」的合同（DRAFT/ACTIVE）。
--
-- 背景（T207/T211）：月账单的幂等键是 contractId+period（不含 roomId），所以同一房间若有两份
-- DRAFT 被定时任务一起置为 ACTIVE，就会产生两笔租金账单。应用层已在 create() 与「流转到 ACTIVE」
-- 时校验，这里补上并发下的最终保证（Prisma schema 不支持部分唯一索引，故用原生 SQL）。
--
-- ⚠️ 若库中已存在重复（同一 roomId 有多份 DRAFT/ACTIVE），本迁移会失败并报冲突。
--    先运行：cd backend && npx tsx scripts/check-duplicate-business-keys.ts
--    人工处理（保留实际生效的一份、删除多余草稿）后再迁移。
CREATE UNIQUE INDEX "idx_contracts_room_id_unfinished"
  ON "contracts" ("roomId")
  WHERE "status" IN ('DRAFT', 'ACTIVE');
