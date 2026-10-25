import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 依赖注入卫生（QLT-02 / T288）。
 *
 * AGENTS 14.4 反模式：「`@Optional()` 或 `?? new X()` 静默降级关键依赖」。
 * 这类代码不会报错，只会在运行时悄悄换成一个「没有 Redis / 没有时钟 / 没有支付通道」的实例，
 * 让多实例、时区、金流问题变成难以复现的偶发故障。
 *
 * 本测试静态扫描 `src/**\/*.ts`（排除 spec / 测试助手），对每一处
 * `@Optional()` 与 `?? new ...` 的**允许清单**做双白名单校验：
 * - 新增一处未登记的降级 → 失败；
 * - 清单里已经修掉的旧条目 → 也要删掉，避免清单腐烂。
 */

const SRC_ROOT = fileURLToPath(new URL('../', import.meta.url));

/**
 * 允许保留 `@Optional()` 的位置及原因。
 * 只允许「缺少它仍然功能正确」的依赖：可观测性出口、WebSocket 推送、进程角色开关。
 */
const ALLOWED_OPTIONAL: Record<string, string> = {
  'common/guards/capability.guard.ts': '仅租客端使用；ADMIN/CLEANER 不需要能力服务',
  'modules/scheduler/scheduler.service.ts':
    '指标/告警/队列开关：未配置时定时任务仍同步执行，属于可选观测与部署模式',
  'modules/notifications/notifications.service.ts': 'WebSocket 网关：Worker 进程没有 WS server',
  'modules/notifications/notifications.gateway.ts': 'PrismaService 供握手与连线核验，单测直接构造时允许缺省',
  'modules/tenant-capabilities/tenant-capability.service.ts': 'JwtAuthService 仅用于主动吊销会话，缺省不影响能力判定',
  'modules/auth/jwt.service.ts': 'REFRESH_STORE 由 AuthModule 工厂注入，单测可直接构造内存实现',
  'modules/meters/meters-simulator.service.ts': '异常模拟 runner 为可选调试入口，仅在模拟器开启时使用',
};

/**
 * 允许保留 `?? new ...` 的位置及原因。
 * 只允许「用默认实现替代可选注入」且默认实现不含外部依赖的场景。
 */
const ALLOWED_FALLBACK_NEW: Record<string, string> = {
  'modules/scheduler/scheduler.service.ts': '未注入子服务时构造默认实现（内部只用 prisma）',
  'modules/meters/meters-simulator.service.ts': '异常模拟 runner 为可选调试入口，仅在模拟器开启时使用',
};

function listTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...listTsFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      files.push(full);
    }
  }
  return files;
}

const sources = listTsFiles(SRC_ROOT).map((file) => ({
  path: relative(SRC_ROOT, file).split('\\').join('/'),
  code: readFileSync(file, 'utf8'),
}));

/** 去掉注释，避免文档里提到 `?? new` 造成误判。 */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * `?? new Date()` / `?? new Set()` / `?? new Map()` 是值构造，不是依赖降级，
 * 扫描时排除，避免误报。
 */
const FALLBACK_PATTERN = /\?\?\s*new\s+(?!Date\b|Set\b|Map\b|URL\b|Error\b)[A-Z]/;

function offenders(pattern: RegExp): string[] {
  return sources
    .filter(({ code }) => pattern.test(stripComments(code)))
    .map(({ path }) => path)
    .sort();
}

describe('依赖注入卫生（QLT-02）', () => {
  it('@Optional() 只出现在允许清单里', () => {
    const found = offenders(/@Optional\(\)/);
    expect(found).toEqual(Object.keys(ALLOWED_OPTIONAL).sort());
  });

  it('`?? new X()` 静默降级只出现在允许清单里', () => {
    const found = offenders(FALLBACK_PATTERN);
    expect(found).toEqual(Object.keys(ALLOWED_FALLBACK_NEW).sort());
  });

  it('允许清单里的每条都写明了原因', () => {
    for (const [path, reason] of Object.entries({ ...ALLOWED_OPTIONAL, ...ALLOWED_FALLBACK_NEW })) {
      expect(reason.trim().length, `${path} 缺少豁免原因`).toBeGreaterThan(8);
    }
  });

  it('关键财务与身份模块不再有可选依赖', () => {
    // 金流、登录、计价：这些模块缺依赖必须启动失败，不能静默降级
    const critical = [
      'modules/bills/bill-payment.service.ts',
      'modules/bills/bills.service.ts',
      'modules/auth/auth.service.ts',
      'modules/auth/email-otp.service.ts',
      'modules/meters/meter-billing.service.ts',
      'modules/meters/meter-price.service.ts',
      'modules/meters/meter-reading.service.ts',
      'modules/meters/meters.service.ts',
      'modules/public-utilities/public-utilities.service.ts',
      'modules/announcements/announcements.service.ts',
    ];
    for (const path of critical) {
      const source = sources.find((item) => item.path === path);
      expect(source, `缺少文件 ${path}`).toBeDefined();
      const code = stripComments(source!.code);
      expect(code, `${path} 仍有 @Optional()`).not.toMatch(/@Optional\(\)/);
      expect(code, `${path} 仍有 ?? new 降级`).not.toMatch(FALLBACK_PATTERN);
    }
  });
});
