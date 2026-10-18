export interface RentBillRow {
  id: string;
  contractId: string;
  billType: string;
  period: string;
}

export interface NotificationRow {
  id: string;
  userId: string;
  title: string;
  data: unknown;
}

export interface DuplicateGroup {
  key: string;
  ids: string[];
}

export function rentBillDedupKey(contractId: string, period: string): string {
  return `RENT:${contractId}:${period}`;
}

export function findDuplicateRentBills(rows: RentBillRow[]): DuplicateGroup[] {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    if (row.billType !== 'RENT') continue;
    const key = rentBillDedupKey(row.contractId, row.period);
    const ids = groups.get(key) ?? [];
    ids.push(row.id);
    groups.set(key, ids);
  }
  return [...groups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ key, ids }));
}

/** 同一用户、同一标题、同一关联对象。没有关联对象的通知允许重复。 */
export function notificationDedupIdentity(row: NotificationRow): string | null {
  const relatedId = readRelatedId(row.data);
  if (!relatedId) return null;
  return `${row.userId}:${row.title}:${relatedId}`;
}

export function findDuplicateNotifications(rows: NotificationRow[]): DuplicateGroup[] {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const key = notificationDedupIdentity(row);
    if (!key) continue;
    const ids = groups.get(key) ?? [];
    ids.push(row.id);
    groups.set(key, ids);
  }
  return [...groups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ key, ids }));
}

function readRelatedId(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  for (const field of ['billId', 'roomId', 'contractId', 'prepayAccountId']) {
    const value = record[field];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

export interface ContractRow {
  id: string;
  roomId: string;
  status: string;
}

/**
 * 同一房源上「未结束」的合同（DRAFT/ACTIVE）最多只能有一份。
 *
 * 上线部分唯一索引（`idx_contracts_room_id_unfinished`）前的重复检查：
 * 两份未结束合同会让同一房间重复出账（月账单幂等键是 contractId+period，不含 roomId）。
 */
export function findDuplicateUnfinishedContracts(rows: ContractRow[]): DuplicateGroup[] {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    if (row.status !== 'DRAFT' && row.status !== 'ACTIVE') continue;
    const ids = groups.get(row.roomId) ?? [];
    ids.push(row.id);
    groups.set(row.roomId, ids);
  }
  return [...groups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ key, ids }));
}
