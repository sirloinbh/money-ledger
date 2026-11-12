import { inflateRawSync } from 'node:zlib';

// Reads the first file of a ZIP archive (stored or deflated). Enough for Tiingo's supported_tickers.zip,
// which holds a single CSV, without adding a ZIP package.

const maxBytes = 64 * 1024 * 1024;

export function firstZipEntry(archive: Buffer): Buffer {
  // The end-of-central-directory record is in the last 22 + 65535 bytes (the comment can be that long).
  const floor = Math.max(0, archive.length - 22 - 0xffff);
  let end = -1;
  for (let at = archive.length - 22; at >= floor; at -= 1) {
    if (archive.readUInt32LE(at) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error('Not a ZIP file');
  const central = archive.readUInt32LE(end + 16);
  if (central + 46 > archive.length || archive.readUInt32LE(central) !== 0x02014b50) {
    throw new Error('Could not read the ZIP list');
  }
  // Sizes come from the central directory: the local header may leave them 0 (data descriptor).
  const method = archive.readUInt16LE(central + 10);
  const compressedSize = archive.readUInt32LE(central + 20);
  const size = archive.readUInt32LE(central + 24);
  const local = archive.readUInt32LE(central + 42);
  if (size > maxBytes) throw new Error('A file inside the ZIP is too large');
  if (local + 30 > archive.length || archive.readUInt32LE(local) !== 0x04034b50) {
    throw new Error('Could not read the ZIP file header');
  }
  const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
  const data = archive.subarray(start, start + compressedSize);
  if (method === 0) return Buffer.from(data);
  if (method === 8) return inflateRawSync(data, { maxOutputLength: maxBytes });
  throw new Error('Unsupported ZIP compression method');
}
