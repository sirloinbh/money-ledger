import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// #311 Tokens are stored encrypted at rest with AES-256-GCM. The key is KAKAO_TOKEN_KEY: 32 bytes as 64 hex
// characters or base64. A stored value is `v1.<iv>.<tag>.<data>` (base64url).

const keyFrom = (text: string) => {
  const key = /^[0-9a-f]{64}$/i.test(text) ? Buffer.from(text, 'hex') : Buffer.from(text, 'base64');
  if (key.length !== 32)
    throw new Error('KAKAO_TOKEN_KEY must be 32 bytes (64 hex characters or base64)');
  return key;
};

export function encrypt(plain: string, keyText: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(keyText), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), data]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

export function decrypt(stored: string, keyText: string) {
  const [version, iv, tag, data] = stored.split('.');
  if (version !== 'v1' || !iv || !tag || data === undefined)
    throw new Error('Unknown token format');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(keyText), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
