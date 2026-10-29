export function canCreateExpense(value: { buildingId: string; category: string; description: string; amount: number; sourceReference: string; publicUtilityBillId: string }): boolean {
  return Boolean(value.buildingId && value.category.trim() && value.description.trim() && (value.sourceReference.trim() || value.publicUtilityBillId.trim()) && Number.isInteger(value.amount) && value.amount > 0 && value.amount <= 2147483647);
}
export function canRecordPayment(value: { paidDate: string; evidence: string }): boolean {
  return Boolean(value.paidDate && value.evidence.trim());
}
