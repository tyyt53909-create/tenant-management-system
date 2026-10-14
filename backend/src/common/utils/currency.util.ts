/**
 * 分转换为中文大写人民币金额
 * e.g. 125000 分 (= 1250 元) -> 壹仟贰佰伍拾元整
 * e.g. 10050 分 (= 100.5 元) -> 壹佰元零伍角整
 * e.g. 10005 分 (= 100.05 元) -> 壹佰元零伍分
 */
export function centsToChineseRMB(cents: number): string {
  if (!cents || isNaN(cents) || cents === 0) {
    return '零元整';
  }

  const isNegative = cents < 0;
  const absCents = Math.abs(cents);
  const yuan = Math.floor(absCents / 100);
  const jiao = Math.floor((absCents % 100) / 10);
  const fen = Math.floor(absCents % 10);

  const digits = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
  const units = ['', '拾', '佰', '仟'];
  const bigUnits = ['', '万', '亿', '兆'];

  let result = '';

  // 转换元整数部分
  if (yuan > 0) {
    let yuanStr = '';
    const s = String(yuan);
    const len = s.length;
    let zeroCount = 0;

    for (let i = 0; i < len; i++) {
      const num = Number(s[i]);
      const pos = len - i - 1;
      const unitIndex = pos % 4;
      const bigUnitIndex = Math.floor(pos / 4);

      if (num === 0) {
        zeroCount++;
      } else {
        if (zeroCount > 0) {
          yuanStr += '零';
          zeroCount = 0;
        }
        yuanStr += digits[num] + units[unitIndex];
      }

      if (unitIndex === 0 && zeroCount < 4) {
        yuanStr += bigUnits[bigUnitIndex];
        zeroCount = 0;
      }
    }
    result += yuanStr + '元';
  }

  // 转换角分
  if (jiao === 0 && fen === 0) {
    result += '整';
  } else {
    if (yuan > 0 && jiao === 0 && fen > 0) {
      result += '零';
    }
    if (jiao > 0) {
      result += digits[jiao] + '角';
    }
    if (fen > 0) {
      result += digits[fen] + '分';
    } else if (jiao > 0) {
      result += '整';
    }
  }

  return (isNegative ? '负' : '') + result;
}

export function centsToYuanString(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || isNaN(cents)) return '0.00';
  return (cents / 100).toFixed(2);
}
