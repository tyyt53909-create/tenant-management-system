/**
 * 上线唯一约束前的重复数据检查。只读取，不更新、不删除。
 *
 *   cd backend && npx tsx scripts/check-duplicate-business-keys.ts
 *
 * 退出码 0：无重复。退出码 1：列出冲突，需要人工处理后再迁移。
 */
import { PrismaClient } from '@prisma/client';
import { findDuplicateNotifications, findDuplicateRentBills } from '../src/common/utils/duplicate-keys.js';

const prisma = new PrismaClient();
const bills = await prisma.bill.findMany({
  select: { id: true, contractId: true, billType: true, period: true },
});
const notifications = await prisma.notification.findMany({
  select: { id: true, userId: true, title: true, data: true },
});
await prisma.$disconnect();

const rentDuplicates = findDuplicateRentBills(bills);
const notificationDuplicates = findDuplicateNotifications(notifications);

if (rentDuplicates.length === 0 && notificationDuplicates.length === 0) {
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
console.log('未删除任何数据。这些重复行不会被自动合并；新写入会用 dedupKey 避免再增加。请人工决定保留哪一条。');
process.exit(1);
