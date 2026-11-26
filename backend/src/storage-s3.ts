import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import type { ObjectStorage } from './storage.js';

// #300 The private bucket. The bucket name comes from PHOTO_BUCKET; credentials and region come from the standard AWS
// environment (the task role in production). Nothing here makes the bucket or changes its access.

function s3Storage(bucket: string, client: S3Client = new S3Client({})): ObjectStorage {
  return {
    async put(key, bytes, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
          ServerSideEncryption: 'AES256',
        }),
      );
    },
    async get(key) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!out.Body) return null;
        return {
          bytes: Buffer.from(await out.Body.transformToByteArray()),
          contentType: out.ContentType ?? 'application/octet-stream',
        };
      } catch (error) {
        if ((error as { name?: string }).name === 'NoSuchKey') return null;
        throw error;
      }
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

/** The storage from the environment, or undefined when PHOTO_BUCKET is not set (photos are then off). */
export function storageFromEnv(env: NodeJS.ProcessEnv = process.env): ObjectStorage | undefined {
  const bucket = env.PHOTO_BUCKET?.trim();
  return bucket ? s3Storage(bucket) : undefined;
}
