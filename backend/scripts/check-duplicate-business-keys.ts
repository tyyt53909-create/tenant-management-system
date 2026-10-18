/**
 * 上线唯一约束前的重复数据检查。只读取，不更新、不删除。
 *
 *   cd backend && npx tsx scripts/check-duplicate-business-keys.ts
 *
 * 退出码 0：无重复。退出码 1：列出冲突，需要人工处理后再迁移。
 *
 * 检查三类：
 *   1. 重复租金账单（同一合同 + 同一账期）→ bills.dedupKey 唯一索引
 *   2. 重复通知（同一用户 + 标题 + 关联对象）→ notifications.dedupKey 唯一索引
 *   3. 同一房源多份未结束合同（DRAFT/ACTIVE）→ idx_contracts_room_id_unfinished（T211）
 */
import { PrismaClient } from '@prisma/client';

// 直接用 tsx 跑不会自动读 .env（Prisma CLI 会，客户端不会），显式加载一次，
// 免得「照文档跑却报 DATABASE_URL 未设置」。
try {
  process.loadEnvFile?.();
} catch {
  // 没有 .env（例如 CI 已注入环境变量）时忽略
}
import {
  findDuplicateNotifications,
  findDuplicateRentBills,
  findDuplicateUnfinishedContracts,
} from '../src/common/utils/duplicate-keys.js';

const prisma = new PrismaClient();
const bills = await prisma.bill.findMany({
  select: { id: true, contractId: true, billType: true, period: true },
});
const notifications = await prisma.notification.findMany({
  select: { id: true, userId: true, title: true, data: true },
});
// 同一房源只能有一份未结束合同（T211 的部分唯一索引）；两份会让同房间重复出账
const contracts = await prisma.contract.findMany({
  select: { id: true, roomId: true, status: true },
});
await prisma.$disconnect();

const rentDuplicates = findDuplicateRentBills(bills);
const notificationDuplicates = findDuplicateNotifications(notifications);
const contractDuplicates = findDuplicateUnfinishedContracts(contracts);

if (
  rentDuplicates.length === 0 &&
  notificationDuplicates.length === 0 &&
  contractDuplicates.length === 0
) {
  console.log('无重复');
  process.exit(0);
}

if (rentDuplicates.length > 0) {
  console.log('重复租金账单（合同 + 账期）：');
  for (const group of rentDuplicates) {
    console.log(`- ${group.key}: ${group.ids.join(', ')}`);
  }
}
if (notificationDuplicates.length > 0) {
  console.log('重复通知（用户 + 标题 + 关联对象）：');
  for (const group of notificationDuplicates) {
    console.log(`- ${group.key}: ${group.ids.join(', ')}`);
  }
}
if (contractDuplicates.length > 0) {
  console.log('同一房源存在多份未结束合同（DRAFT/ACTIVE）：');
  for (const group of contractDuplicates) {
    console.log(`- 房源 ${group.key}: ${group.ids.join(', ')}`);
  }
  console.log('  处理建议：保留实际生效的一份，把多余的草稿删除（docs/04-状态机.md §2.2 允许删除 DRAFT）。');
}
console.log('未删除任何数据。这些重复行不会被自动合并；新写入会用 dedupKey 避免再增加。请人工决定保留哪一条。');
process.exit(1);
