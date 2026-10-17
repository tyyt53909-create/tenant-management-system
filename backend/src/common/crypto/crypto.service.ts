import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  decryptField,
  encryptField,
  hashIdNumber,
  maskStoredIdNumber,
  resolveFieldKey,
} from './field-crypto.js';

/**
 * 字段级加密（AES-256-GCM）。
 *
 * 密钥口径以仓库配置为准：`ENCRYPTION_KEY`（`backend/.env.example`、`docker-compose.prod.yml`、`docs/12 §1.1`）。
 * 旧名 `FIELD_ENCRYPTION_KEY` 仍作为兼容别名读取，避免已按旧名部署的环境直接失配。
 */
@Injectable()
export class CryptoService {
  constructor(private readonly configService: ConfigService) {}

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
    // ConfigService 本身会回退到 process.env；旧名仅作兼容别名
    const configured = this.configService.get<string>('ENCRYPTION_KEY');
    const raw =
      (typeof configured === 'string' && configured.trim() !== '' ? configured : undefined) ??
      this.configService.get<string>('FIELD_ENCRYPTION_KEY');
    return resolveFieldKey(raw);
  }
}
