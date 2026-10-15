/** 月历按当地日期显示；业务到期日使用服务端的 YYYY-MM-DD 日期部分。 */
export function calendarDays(year: number, month: number) {
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  return [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, i) => i + 1),
  ];
}

export function calendarKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
