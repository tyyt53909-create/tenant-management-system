/**
 * 把 tenant_registrations.idNumber 从明文改成 AES-256-GCM 密文，并写入 idNumberHash。
 *
 * 可重复执行：已经是 v1: 密文的行不会再次加密。
 * 发现同一证件号哈希对应多条记录时，不写任何数据并退出。
 *
 * 加密：
 *   cd backend && FIELD_ENCRYPTION_KEY='...' npx tsx scripts/encrypt-id-numbers.ts
 *
 * 回滚：把 v1 密文解回明文，并清空 idNumberHash。只在可信环境执行。
 *   cd backend && FIELD_ENCRYPTION_KEY='...' npx tsx scripts/encrypt-id-numbers.ts --rollback
 *
 * 回滚后数据库重新保存明文。确认不再需要密文之前，不要删除 FIELD_ENCRYPTION_KEY。
 */
import { PrismaClient } from '@prisma/client';
import { resolveFieldKey } from '../src/common/crypto/field-crypto.js';
import { buildIdNumberMigration } from '../src/common/crypto/id-number-migration.js';

const rollback = process.argv.includes('--rollback');
const key = resolveFieldKey(process.env.FIELD_ENCRYPTION_KEY);
const prisma = new PrismaClient();

const rows = await prisma.tenantRegistration.findMany({
  select: { id: true, idNumber: true, idNumberHash: true },
});
const plan = buildIdNumberMigration(rows, key, rollback ? 'rollback' : 'encrypt');

if (plan.duplicates.length > 0) {
  console.error('发现重复证件号，已停止，没有写入：');
  for (const dup of plan.duplicates) {
    console.error(`- ${dup.ids.join(', ')}`);
  }
  await prisma.$disconnect();
  process.exit(1);
}

await prisma.$transaction(
  plan.updates.map((update) =>
    prisma.tenantRegistration.update({
      where: { id: update.id },
      data: { idNumber: update.idNumber, idNumberHash: update.idNumberHash },
    }),
  ),
);

console.log(`${rollback ? '回滚' : '加密'}完成，更新 ${plan.updates.length} 行，跳过 ${rows.length - plan.updates.length} 行。`);
await prisma.$disconnect();
