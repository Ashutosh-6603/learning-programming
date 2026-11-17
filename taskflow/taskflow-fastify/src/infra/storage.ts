import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from '../config.js';

type StorageConfig = Pick<
  Config,
  | 'S3_ENDPOINT'
  | 'S3_PUBLIC_ENDPOINT'
  | 'S3_REGION'
  | 'S3_BUCKET'
  | 'S3_ACCESS_KEY'
  | 'S3_SECRET_KEY'
>;

export class Storage {
  private readonly internal: S3Client;
  // Signatures cover the host, so URLs for the browser must be signed with the public endpoint.
  private readonly presigner: S3Client;
  private readonly bucket: string;

  constructor(config: StorageConfig) {
    const base = {
      region: config.S3_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
    };
    this.internal = new S3Client({ ...base, endpoint: config.S3_ENDPOINT });
    this.presigner = new S3Client({ ...base, endpoint: config.S3_PUBLIC_ENDPOINT });
    this.bucket = config.S3_BUCKET;
  }

  presignUpload(key: string, contentType: string, sizeBytes: number, expiresIn: number) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: sizeBytes,
    });
    return getSignedUrl(this.presigner, command, { expiresIn });
  }

  presignDownload(key: string, fileName: string, expiresIn: number) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });
    return getSignedUrl(this.presigner, command, { expiresIn });
  }

  /** The stored object's size, or null if it doesn't exist. */
  async sizeOf(key: string): Promise<number | null> {
    try {
      const head = await this.internal.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return head.ContentLength ?? null;
    } catch (err) {
      if (err instanceof NotFound) return null;
      throw err;
    }
  }

  /** Deletes every object under a prefix, 1000 keys per request (the S3 maximum). */
  async deletePrefix(prefix: string): Promise<number> {
    let deleted = 0;
    let token: string | undefined;
    do {
      const page = await this.internal.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      const objects = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
      if (objects.length > 0) {
        await this.internal.send(
          new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: objects } }),
        );
        deleted += objects.length;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return deleted;
  }
}
