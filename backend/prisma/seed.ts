import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// 获取当前文件目录（ES 模块）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载 .env 文件
dotenv.config({ path: resolve(__dirname, '../.env') });

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 开始种子数据初始化...');

  // 1. 创建默认楼栋
  const DEFAULT_BUILDING_ID = process.env.DEFAULT_BUILDING_ID || 'building-001';
  
  const building = await prisma.building.upsert({
    where: { id: DEFAULT_BUILDING_ID },
    update: {},
    create: {
      id: DEFAULT_BUILDING_ID,
      name: '默认楼栋',
      floors: 7,
      metadata: {
        landlordName: '管理员',
        description: '系统默认楼栋',
      },
      isActive: true,
    },
  });
  
  console.log('✅ 默认楼栋已创建:', building.name);

  // 2. 创建管理员账号
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123';
  
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      passwordHash,
      role: 'ADMIN',
      isActive: true,
    },
  });
  
  console.log('✅ 管理员账号已创建:', { email: adminEmail });
  console.log('⚠️  请记住密码:', adminPassword);

  // 2.1 创建保洁账号（T143：保洁登录小程序使用）
  const cleanerEmail = process.env.CLEANER_EMAIL || 'cleaner@example.com';
  const cleanerPassword = process.env.CLEANER_PASSWORD || 'Cleaner@123';
  const cleanerPasswordHash = await bcrypt.hash(cleanerPassword, 10);

  await prisma.user.upsert({
    where: { email: cleanerEmail },
    update: {},
    create: {
      email: cleanerEmail,
      passwordHash: cleanerPasswordHash,
      role: 'CLEANER',
      isActive: true,
    },
  });

  console.log('✅ 保洁账号已创建:', { email: cleanerEmail });
  console.log('⚠️  请记住密码:', cleanerPassword);

  // 3. 生成测试用邀请码
  const testInviteCode = `INVITE-${Date.now()}`;
  const inviteExpiredAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1年后过期
  
  await prisma.user.update({
    where: { id: admin.id },
    data: {
      inviteCode: testInviteCode,
      inviteExpiredAt,
    },
  });
  
  console.log('✅ 测试邀请码已生成:', testInviteCode);
  console.log('   有效期至:', inviteExpiredAt.toLocaleDateString());

  console.log('🎉 种子数据初始化完成！');
  console.log('');
  console.log('📝 初始化摘要:');
  console.log('   - 楼栋ID:', DEFAULT_BUILDING_ID);
  console.log('   - 管理员邮箱:', adminEmail);
  console.log('   - 管理员密码:', adminPassword);
  console.log('   - 保洁邮箱:', cleanerEmail);
  console.log('   - 保洁密码:', cleanerPassword);
  console.log('   - 邀请码:', testInviteCode);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('❌ 种子数据初始化失败:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
