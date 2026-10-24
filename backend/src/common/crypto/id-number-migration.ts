import { decryptField, decryptFieldWithKeys, encryptField, hashIdNumber, isEncryptedField } from './field-crypto.js';

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

export type IdNumberMigrationMode = 'encrypt' | 'rollback' | 'rotate';

export function buildIdNumberMigration(
  rows: StoredIdNumber[],
  key: Buffer,
  mode: IdNumberMigrationMode,
  previousKeys: Buffer[] = [],
): IdNumberMigrationPlan {
  if (mode === 'rollback') {
    const updates: IdNumberUpdate[] = [];
    const decryptionKeys = [key, ...previousKeys];
    for (const row of rows) {
      if (!isEncryptedField(row.idNumber)) {
        continue;
      }
      updates.push({
        id: row.id,
        idNumber: decryptFieldWithKeys(row.idNumber, decryptionKeys),
        idNumberHash: null,
      });
    }
    return { updates, duplicates: [] };
  }

  // encrypt / rotate 都需要先解密（rotate 用旧钥），再用当前钥重算 hash 与密文
  const decryptionKeys = [key, ...previousKeys];
  const seen = new Map<string, string[]>();
  const updates: IdNumberUpdate[] = [];
  for (const row of rows) {
    const plain = isEncryptedField(row.idNumber)
      ? decryptFieldWithKeys(row.idNumber, decryptionKeys)
      : row.idNumber;
    const hash = hashIdNumber(plain, key);
    const ids = seen.get(hash) ?? [];
    ids.push(row.id);
    seen.set(hash, ids);

    const encrypted =
      mode === 'rotate' || !isEncryptedField(row.idNumber) ? encryptField(plain, key) : row.idNumber;
    if (encrypted !== row.idNumber || row.idNumberHash !== hash) {
      updates.push({ id: row.id, idNumber: encrypted, idNumberHash: hash });
    }
  }

  const duplicates = [...seen.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([hash, ids]) => ({ hash, ids }));

  return { updates, duplicates };
}
