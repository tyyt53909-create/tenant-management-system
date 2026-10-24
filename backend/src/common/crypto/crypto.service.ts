import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  decryptFieldWithKeys,
  encryptField,
  hashIdNumber,
  maskStoredIdNumberWithKeys,
  resolveFieldKey,
  resolvePreviousFieldKeys,
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
    return decryptFieldWithKeys(payload, this.decryptionKeys());
  }

  hashIdNumber(plain: string): string {
    return hashIdNumber(plain, this.key());
  }

  maskStored(stored: string): string {
    try {
      return maskStoredIdNumberWithKeys(stored, this.decryptionKeys());
    } catch {
      return '********';
    }
  }

  private key(): Buffer {
    // ConfigService 本身会回退到 process.env；旧名仅作兼容别名
    const configured = this.configService.get<string>('ENCRYPTION_KEY');
    const raw =
      (typeof configured === 'string' && configured.trim() !== '' ? configured : undefined) ??
      this.configService.get<string>('FIELD_ENCRYPTION_KEY');
    return resolveFieldKey(raw);
  }

  /**
   * 解密密钥链：当前钥优先，其后是 `ENCRYPTION_KEY_PREVIOUS` 的旧钥。
   * 加密始终只用当前钥；旧钥仅用于换钥过渡期读取历史密文。
   */
  private decryptionKeys(): Buffer[] {
    const previous = this.configService.get<string>('ENCRYPTION_KEY_PREVIOUS');
    return [this.key(), ...resolvePreviousFieldKeys(previous)];
  }
}
