import { Injectable } from '@nestjs/common';
import {
  decryptField,
  encryptField,
  hashIdNumber,
  maskStoredIdNumber,
  resolveFieldKey,
} from './field-crypto.js';

@Injectable()
export class CryptoService {
  encrypt(plain: string): string {
    return encryptField(plain, this.key());
  }

  decrypt(payload: string): string {
    return decryptField(payload, this.key());
  }

  hashIdNumber(plain: string): string {
    return hashIdNumber(plain, this.key());
  }

  maskStored(stored: string): string {
    let key: Buffer | null = null;
    try {
      key = this.key();
    } catch {
      key = null;
    }
    return maskStoredIdNumber(stored, key);
  }

  private key(): Buffer {
    return resolveFieldKey(process.env.FIELD_ENCRYPTION_KEY);
  }
}
