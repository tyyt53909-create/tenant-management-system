-- FIN-01 / T263：续签需要「旧合同 ACTIVE + 新合同 DRAFT」共存。
-- 旧的「每房间只能有一份未结束合同」部分唯一索引会让 renew() 直接撞唯一约束。
-- 改为：每房间最多一份 ACTIVE；DRAFT 由应用层与激活流程校验。
DROP INDEX IF EXISTS "idx_contracts_room_id_unfinished";

CREATE UNIQUE INDEX "idx_contracts_room_id_active"
  ON "contracts" ("roomId")
  WHERE "status" = 'ACTIVE';
