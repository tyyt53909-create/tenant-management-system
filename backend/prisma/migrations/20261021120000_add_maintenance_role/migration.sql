-- T225：新增维修角色（MAINTENANCE）
-- 维修人员通过邀请码注册后只拥有维修工作台权限：
--   - 查看公共池与自己已接的报修工单；
--   - 接单（ASSIGNED -> IN_PROGRESS）与提交处理结果（IN_PROGRESS -> PENDING_CONFIRM）。
-- PostgreSQL 的 ALTER TYPE ... ADD VALUE 不能在事务块中与其他 DDL 合并执行，
-- Prisma 迁移按语句逐条执行，因此单独成文件。

ALTER TYPE "UserRole" ADD VALUE 'MAINTENANCE';
