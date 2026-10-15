import { z } from 'zod';

// What a document may be (BR-P04). The API enforces it; the web checks a file before sending.
export const MAX_FILE_MB = 4;
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
export const MAX_FILES_PER_SUBMISSION = 5;

export const documentMimeTypeSchema = z.enum([
  'application/pdf',
  'image/png',
  'image/jpeg',
]);
export type DocumentMimeType = z.infer<typeof documentMimeTypeSchema>;

const SIGNATURES: [DocumentMimeType, number[]][] = [
  ['application/pdf', [0x25, 0x50, 0x44, 0x46]], // %PDF
  ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ['image/jpeg', [0xff, 0xd8, 0xff]],
];

/** A file's type by its first bytes, never by its name or the Content-Type sent (BR-P04). */
export function sniffMimeType(bytes: Uint8Array): DocumentMimeType | null {
  const match = SIGNATURES.find(([, signature]) =>
    signature.every((byte, i) => bytes[i] === byte),
  );
  return match ? match[0] : null;
}

// A file of a DOCUMENT task, shown only to those who may see it (BR-P03).
export const documentFileSchema = z.object({
  id: z.uuid(),
  fileName: z.string(),
  mimeType: documentMimeTypeSchema,
  sizeBytes: z.int(),
  uploadedAt: z.iso.datetime(),
});
export type DocumentFile = z.infer<typeof documentFileSchema>;

// GET /files/:id/download-url: a short-lived link straight to the bucket (PLAN §9).
export const downloadUrlSchema = z.object({
  url: z.url(),
  expiresAt: z.iso.datetime(),
});
export type DownloadUrl = z.infer<typeof downloadUrlSchema>;
