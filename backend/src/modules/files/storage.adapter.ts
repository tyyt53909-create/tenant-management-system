import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export interface StorageAdapter {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  signedUrl(key: string, expiresInSeconds: number): Promise<string>;
}

export interface StorageEnv {
  STORAGE_DRIVER?: string;
  UPLOAD_DIR?: string;
  S3_ENDPOINT?: string;
  S3_REGION?: string;
  OSS_REGION?: string;
  S3_BUCKET?: string;
  OSS_BUCKET?: string;
  S3_ACCESS_KEY_ID?: string;
  OSS_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  OSS_ACCESS_KEY_SECRET?: string;
  S3_FORCE_PATH_STYLE?: string;
}

export class LocalStorage implements StorageAdapter {
  constructor(private readonly directory: string) {}

  path(key: string): string {
    return join(this.directory, key);
  }

  async put(key: string, body: Buffer, _contentType?: string): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true });
    await fs.writeFile(this.path(key), body);
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.path(key));
  }

  async delete(key: string): Promise<void> {
    await fs.unlink(this.path(key));
  }

  async signedUrl(key: string, _expiresInSeconds?: number): Promise<string> {
    return `/api/files/${key}`;
  }
}

type ObjectBody = { transformToByteArray?: () => Promise<Uint8Array> };
type ObjectClient = {
  send(command: unknown): Promise<{ Body?: ObjectBody }>;
};

export class S3CompatibleStorage implements StorageAdapter {
  private readonly presign: (key: string, expiresInSeconds: number) => Promise<string>;

  constructor(
    private readonly bucket: string,
    private readonly client: ObjectClient,
    presign?: (key: string, expiresInSeconds: number) => Promise<string>,
  ) {
    this.presign = presign ?? ((key, expiresInSeconds) =>
      getSignedUrl(
        this.client as S3Client,
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        { expiresIn: expiresInSeconds },
      ));
  }

  static fromEnv(env: StorageEnv): S3CompatibleStorage {
    const bucket = env.S3_BUCKET || env.OSS_BUCKET;
    const accessKeyId = env.S3_ACCESS_KEY_ID || env.OSS_ACCESS_KEY_ID;
    const secretAccessKey = env.S3_SECRET_ACCESS_KEY || env.OSS_ACCESS_KEY_SECRET;
    if (!bucket || !accessKeyId || !secretAccessKey) {
      throw new Error('S3 存储缺少 bucket 或访问密钥');
    }
    const region = env.S3_REGION || env.OSS_REGION || 'oss-cn-hangzhou';
    const endpoint = env.S3_ENDPOINT || `https://${region}.aliyuncs.com`;
    const client = new S3Client({
      region,
      endpoint,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
      credentials: { accessKeyId, secretAccessKey },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
    return new S3CompatibleStorage(bucket, client);
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }));
  }

  async get(key: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body?.transformToByteArray) throw new Error('对象内容为空');
    return Buffer.from(await result.Body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  signedUrl(key: string, expiresInSeconds: number): Promise<string> {
    return this.presign(key, expiresInSeconds);
  }
}

export function createStorageAdapter(env: StorageEnv, cwd = process.cwd()): StorageAdapter {
  const driver = (env.STORAGE_DRIVER || 'local').trim().toLowerCase();
  if (driver === 'local') return new LocalStorage(env.UPLOAD_DIR?.trim() || join(cwd, 'uploads'));
  if (driver === 's3') return S3CompatibleStorage.fromEnv(env);
  throw new Error(`未知的 STORAGE_DRIVER：${env.STORAGE_DRIVER}`);
}
