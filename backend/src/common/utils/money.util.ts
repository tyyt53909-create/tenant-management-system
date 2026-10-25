/**
 * 金额换算（FIN-10 / T275）。
 *
 * 全库金额一律以「分」整数存储；算法本体在 `shared/src/money.ts`（QLT-04 / T289 三端共享），
 * 本文件 re-export 并保留后端命名兼容。禁止在业务代码里直接 `x / 100` 或 `x * 100`。
 */
export {
  yuanToCents,
  centsToYuan,
  centsToYuanString,
  formatCents,
  formatSignedCents,
  sumCents,
} from '../../../../shared/src/money.js';
