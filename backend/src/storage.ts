// #300 Where uploaded files live. The app talks to this interface only; the real one is S3 (storage-s3.ts) and tests
// use the in-memory one. Keys are opaque strings the app makes itself.

type StoredObject = { bytes: Buffer; contentType: string };

export type ObjectStorage = {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  /** The object, or null when there is none under that key. */
  get(key: string): Promise<StoredObject | null>;
  /** Deleting a key that does not exist is not an error. */
  delete(key: string): Promise<void>;
};

/** Holds objects in memory. For tests and for running the app without a bucket configured in development. */
export function memoryStorage(): ObjectStorage & { keys(): string[] } {
  const objects = new Map<string, StoredObject>();
  return {
    put(key, bytes, contentType) {
      objects.set(key, { bytes: Buffer.from(bytes), contentType });
      return Promise.resolve();
    },
    get(key) {
      return Promise.resolve(objects.get(key) ?? null);
    },
    delete(key) {
      objects.delete(key);
      return Promise.resolve();
    },
    keys: () => [...objects.keys()].sort(),
  };
}
