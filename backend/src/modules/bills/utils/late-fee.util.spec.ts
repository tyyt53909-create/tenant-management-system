import { LateFeeUtil } from './late-fee.util.js';

describe('LateFeeUtil', () => {
  describe('calculate（按日比例）', () => {
    it('应正确计算滞纳金（日比例方式）', () => {
      const rule = {
        graceDays: 3,
        dailyRate: 0.003, // 千分之三
        cap: 50000, // 封顶500元
      };
      const baseAmount = 200000; // 2000元
      const overdueDays = 10;

      // 前3天免费，后7天收费：2000 * 0.003 * 7 = 42元
      const result = LateFeeUtil.calculate(rule, baseAmount, overdueDays);

      expect(result.amount).toBe(4200); // 42元 = 4200分
      expect(result.rawAmount).toBe(4200);
      expect(result.effectiveDays).toBe(7);
      expect(result.overdueDays).toBe(10);
      expect(result.baseAmount).toBe(200000);
      expect(result.capped).toBe(false);
      expect(result.rule).toEqual({
        graceDays: 3,
        dailyRate: 0.003,
        fixedDaily: null,
        cap: 50000,
      });
    });

    it('应正确处理封顶逻辑', () => {
      const rule = {
        graceDays: 3,
        dailyRate: 0.01, // 百分之一
        cap: 10000, // 封顶100元
      };
      const baseAmount = 200000;
      const overdueDays = 20;

      // 2000 * 0.01 * 17 = 340元 > 100元封顶
      const result = LateFeeUtil.calculate(rule, baseAmount, overdueDays);

      expect(result.amount).toBe(10000);
      expect(result.rawAmount).toBe(34000);
      expect(result.capped).toBe(true);
    });

    it('应返回 0 当逾期天数在宽限期内', () => {
      const rule = {
        graceDays: 3,
        dailyRate: 0.003,
        cap: 50000,
      };

      const result = LateFeeUtil.calculate(rule, 200000, 2);

      expect(result.amount).toBe(0);
      expect(result.rawAmount).toBe(0);
      expect(result.effectiveDays).toBe(0);
      expect(result.capped).toBe(false);
    });

    it('恰好到宽限期（逾期天数 = 宽限天数）不计费', () => {
      const rule = { graceDays: 3, dailyRate: 0.003 };

      const result = LateFeeUtil.calculate(rule, 200000, 3);

      expect(result.amount).toBe(0);
      expect(result.effectiveDays).toBe(0);
    });

    it('金额取整到分（四舍五入）', () => {
      const rule = { graceDays: 0, dailyRate: 0.003 };

      // 33333 * 0.003 * 7 = 699.993 → 700
      const result = LateFeeUtil.calculate(rule, 33333, 7);

      expect(result.amount).toBe(700);
    });

    it('恰好等于封顶金额时不标记 capped', () => {
      const rule = { graceDays: 0, dailyRate: 0.001, cap: 5000 };

      // 500000 * 0.001 * 10 = 5000 = cap
      const result = LateFeeUtil.calculate(rule, 500000, 10);

      expect(result.amount).toBe(5000);
      expect(result.capped).toBe(false);
    });
  });

  describe('calculate（固定金额）', () => {
    it('应按固定金额计算（分/天）', () => {
      const rule = { graceDays: 1, fixedDaily: 500, cap: null };

      // (5 − 1) 天 × 500 分 = 2000 分
      const result = LateFeeUtil.calculate(rule, 200000, 5);

      expect(result.amount).toBe(2000);
      expect(result.effectiveDays).toBe(4);
      expect(result.capped).toBe(false);
    });

    it('同时配置时优先使用按日比例', () => {
      const rule = { graceDays: 0, dailyRate: 0.001, fixedDaily: 99999 };

      const result = LateFeeUtil.calculate(rule, 100000, 10);

      expect(result.amount).toBe(1000); // 100000 * 0.001 * 10
    });
  });

  describe('calculate（边界）', () => {
    it('未逾期（overdueDays = 0）金额为 0', () => {
      const result = LateFeeUtil.calculate({ dailyRate: 0.003 }, 200000, 0);

      expect(result.amount).toBe(0);
      expect(result.effectiveDays).toBe(0);
    });

    it('无规则（空对象）不加收', () => {
      const result = LateFeeUtil.calculate({}, 200000, 30);

      expect(result.amount).toBe(0);
      expect(result.rawAmount).toBe(0);
    });

    it('规则为 null/undefined 不加收', () => {
      expect(LateFeeUtil.calculate(null, 200000, 30).amount).toBe(0);
      expect(LateFeeUtil.calculate(undefined, 200000, 30).amount).toBe(0);
    });

    it('基数为 0（已缴清）金额为 0', () => {
      const result = LateFeeUtil.calculate({ dailyRate: 0.003 }, 0, 10);

      expect(result.amount).toBe(0);
    });
  });

  describe('overdueDays（自然日）', () => {
    const now = new Date('2026-10-13T09:30:00+08:00'); // UTC 2026-10-13 01:30

    it('到期日为今天：0（当天不算逾期）', () => {
      expect(LateFeeUtil.overdueDays(new Date('2026-10-13T00:00:00.000Z'), now)).toBe(0);
    });

    it('到期日为昨天：1', () => {
      expect(LateFeeUtil.overdueDays(new Date('2026-10-12T00:00:00.000Z'), now)).toBe(1);
    });

    it('到期日为 10 天前：10', () => {
      expect(LateFeeUtil.overdueDays(new Date('2026-10-03T00:00:00.000Z'), now)).toBe(10);
    });

    it('到期日在未来：0', () => {
      expect(LateFeeUtil.overdueDays(new Date('2026-11-01T00:00:00.000Z'), now)).toBe(0);
    });
  });
});
