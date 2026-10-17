import { decryptField, encryptField, hashIdNumber, isEncryptedField } from './field-crypto.js';

export interface StoredIdNumber {
  id: string;
  idNumber: string;
  idNumberHash?: string | null;
}

export interface IdNumberUpdate {
  id: string;
  idNumber: string;
  idNumberHash: string | null;
}

export interface IdNumberMigrationPlan {
  updates: IdNumberUpdate[];
  duplicates: Array<{ hash: string; ids: string[] }>;
}

export function buildIdNumberMigration(
  rows: StoredIdNumber[],
  key: Buffer,
  mode: 'encrypt' | 'rollback',
): IdNumberMigrationPlan {
  if (mode === 'rollback') {
    const updates: IdNumberUpdate[] = [];
    for (const row of rows) {
      if (!isEncryptedField(row.idNumber)) {
        continue;
      }
      updates.push({
        id: row.id,
        idNumber: decryptField(row.idNumber, key),
        idNumberHash: null,
      });
    }
    return { updates, duplicates: [] };
  }

  const seen = new Map<string, string[]>();
  const updates: IdNumberUpdate[] = [];
  for (const row of rows) {
    const plain = isEncryptedField(row.idNumber) ? decryptField(row.idNumber, key) : row.idNumber;
    const hash = hashIdNumber(plain, key);
    const ids = seen.get(hash) ?? [];
    ids.push(row.id);
    seen.set(hash, ids);

    const encrypted = isEncryptedField(row.idNumber) ? row.idNumber : encryptField(plain, key);
    if (encrypted !== row.idNumber || row.idNumberHash !== hash) {
      updates.push({ id: row.id, idNumber: encrypted, idNumberHash: hash });
    }
  }

  const duplicates = [...seen.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([hash, ids]) => ({ hash, ids }));

  return { updates, duplicates };
}
