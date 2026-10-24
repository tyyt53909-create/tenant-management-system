/**
 * tenant_registrations.idNumber 的加密 / 回滚 / 换钥。
 *
 * 加密（默认，可重复执行）：
 *   cd backend && ENCRYPTION_KEY='...' npx tsx scripts/encrypt-id-numbers.ts
 *
 * 回滚（只在可信环境）：
 *   cd backend && ENCRYPTION_KEY='...' npx tsx scripts/encrypt-id-numbers.ts --rollback
 *
 * 换钥（SEC-08 / T271）：
 *   1) 新钥写入 ENCRYPTION_KEY，旧钥写入 ENCRYPTION_KEY_PREVIOUS（逗号分隔可多把）；
 *   2) 先 dry-run 看影响行数：
 *        ENCRYPTION_KEY='新' ENCRYPTION_KEY_PREVIOUS='旧' npx tsx scripts/encrypt-id-numbers.ts --rotate
 *   3) 确认后加 --apply 真正写入：
 *        ENCRYPTION_KEY='新' ENCRYPTION_KEY_PREVIOUS='旧' npx tsx scripts/encrypt-id-numbers.ts --rotate --apply
 *   4) 验证应用可用新钥解密后，再从环境移除 ENCRYPTION_KEY_PREVIOUS。
 *
 * 任何模式发现同一证件号哈希对应多条记录时都不写数据并退出。
 * 回滚后数据库重新保存明文；确认不再需要密文之前，不要删除 ENCRYPTION_KEY。
 * 变量名与 backend/.env.example、docker-compose.prod.yml、docs/12 §1.1 一致；
 * 旧名 FIELD_ENCRYPTION_KEY 仍兼容。
 */
import { PrismaClient } from '@prisma/client';
import { resolveFieldKey, resolvePreviousFieldKeys } from '../src/common/crypto/field-crypto.js';
import { buildIdNumberMigration, type IdNumberMigrationMode } from '../src/common/crypto/id-number-migration.js';

const argv = process.argv.slice(2);
const rollback = argv.includes('--rollback');
const rotate = argv.includes('--rotate');
const apply = argv.includes('--apply');
const dryRun = argv.includes('--dry-run') || (rotate && !apply);

if (rollback && rotate) {
  console.error('--rollback 与 --rotate 不能同时使用');
  process.exit(1);
}

const mode: IdNumberMigrationMode = rollback ? 'rollback' : rotate ? 'rotate' : 'encrypt';
const key = resolveFieldKey(process.env.ENCRYPTION_KEY ?? process.env.FIELD_ENCRYPTION_KEY);
const previousKeys = resolvePreviousFieldKeys(process.env.ENCRYPTION_KEY_PREVIOUS);
const prisma = new PrismaClient();

const rows = await prisma.tenantRegistration.findMany({
  select: { id: true, idNumber: true, idNumberHash: true },
});
const plan = buildIdNumberMigration(rows, key, mode, previousKeys);

if (plan.duplicates.length > 0) {
  console.error('发现重复证件号，已停止，没有写入：');
  for (const dup of plan.duplicates) {
    console.error(`- ${dup.ids.join(', ')}`);
  }
  await prisma.$disconnect();
  process.exit(1);
}

if (dryRun) {
  console.log(`[dry-run] ${mode} 将更新 ${plan.updates.length} 行，跳过 ${rows.length - plan.updates.length} 行。`);
  console.log('确认后加 --apply 执行（rotate 模式默认 dry-run）。');
  await prisma.$disconnect();
  process.exit(0);
}

await prisma.$transaction(
  plan.updates.map((update) =>
    prisma.tenantRegistration.update({
      where: { id: update.id },
      data: { idNumber: update.idNumber, idNumberHash: update.idNumberHash },
    }),
  ),
);

console.log(`${mode === 'rollback' ? '回滚' : mode === 'rotate' ? '换钥' : '加密'}完成，更新 ${plan.updates.length} 行，跳过 ${rows.length - plan.updates.length} 行。`);
await prisma.$disconnect();
