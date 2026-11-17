import { attachmentsApi } from '@/lib/api/endpoints';
import type { Attachment } from '@/lib/api/types';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * The three-step presigned upload (README §12). The bytes go straight from the browser to S3;
 * the API only signs the URL and then checks the object landed with the declared size.
 */
export async function uploadAttachment(taskId: string, file: File): Promise<Attachment> {
  const { attachment, upload } = await attachmentsApi.create(taskId, {
    fileName: file.name,
    contentType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
  });
  // No credentials and no Authorization header: the signature in the URL IS the permission.
  const put = await fetch(upload.url, {
    method: upload.method,
    headers: upload.headers,
    body: file,
  });
  if (!put.ok) throw new Error(`Storage rejected the upload (${put.status})`);
  return attachmentsApi.complete(attachment.id);
}
