import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sniffPhotoType, stripPhotoMetadata } from '../src/ledger/photo-strip.js';
import { memoryStorage } from '../src/storage.js';

// #300 Metadata removal and the storage fake. No database needed.

const segment = (marker: number, data: Buffer) => {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([head, data]);
};

/** A little-endian EXIF block with the orientation and a GPS-like text that must not survive. */
const exif = (orientation: number) => {
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(0x2a, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0112, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(orientation, 18);
  return Buffer.concat([Buffer.from('Exif\0\0'), tiff, Buffer.from('GPSLatitude=37.5665N')]);
};

const scan = Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56]);
const jpeg = (orientation: number) =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')),
    segment(0xe1, exif(orientation)),
    segment(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>owner</x:xmpmeta>')),
    segment(0xfe, Buffer.from('secret comment')),
    segment(0xdb, Buffer.from([1, 2, 3, 4])),
    segment(0xda, Buffer.from([0, 1])),
    scan,
    Buffer.from([0xff, 0xd9]),
  ]);

test('a JPEG loses its EXIF, XMP and comment but keeps its image data and orientation', () => {
  const out = stripPhotoMetadata(jpeg(6));
  assert.equal(out.contentType, 'image/jpeg');
  const text = out.bytes.toString('latin1');
  for (const gone of ['GPSLatitude', 'xmpmeta', 'secret comment', 'owner'])
    assert.ok(!text.includes(gone), `${gone} must be removed`);
  assert.ok(text.includes('JFIF'));
  assert.ok(out.bytes.includes(Buffer.from([0xff, 0xdb, 0, 6, 1, 2, 3, 4])));
  assert.ok(out.bytes.includes(scan));
  // Orientation survives, alone, in a tiny EXIF segment.
  const kept = out.bytes.indexOf(Buffer.from('Exif\0\0'));
  assert.ok(kept > 0);
  assert.equal(out.bytes.readUInt16BE(kept + 6 + 8 + 2 + 8), 6);
  assert.equal(
    stripPhotoMetadata(out.bytes).bytes.length,
    out.bytes.length,
    'stripping is idempotent',
  );
});

test('an upright JPEG gets no EXIF segment at all', () => {
  const out = stripPhotoMetadata(jpeg(1));
  assert.ok(!out.bytes.includes(Buffer.from('Exif')));
});

const chunk = (name: string, data: Buffer) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(name, 4, 'latin1');
  return Buffer.concat([head, data, Buffer.alloc(4)]);
};
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', Buffer.alloc(13)),
  chunk('tEXt', Buffer.from('Location\0Seoul')),
  chunk('eXIf', Buffer.from('GPSLatitude')),
  chunk('tIME', Buffer.alloc(7)),
  chunk('IDAT', Buffer.from([1, 2, 3])),
  chunk('IEND', Buffer.alloc(0)),
]);

test('a PNG loses its text, EXIF and time chunks', () => {
  const out = stripPhotoMetadata(png);
  assert.equal(out.contentType, 'image/png');
  const text = out.bytes.toString('latin1');
  for (const gone of ['tEXt', 'Seoul', 'eXIf', 'GPSLatitude', 'tIME'])
    assert.ok(!text.includes(gone), `${gone} must be removed`);
  for (const stays of ['IHDR', 'IDAT', 'IEND']) assert.ok(text.includes(stays));
});

test('anything that is not a whole JPEG or PNG is refused', () => {
  assert.equal(sniffPhotoType(Buffer.from('GIF89a......')), null);
  assert.throws(
    () => stripPhotoMetadata(Buffer.from('<svg onload=alert(1)></svg>')),
    /JPEG or PNG/,
  );
  assert.throws(() => stripPhotoMetadata(jpeg(1).subarray(0, 30)), /damaged/);
  assert.throws(() => stripPhotoMetadata(png.subarray(0, png.length - 5)), /damaged/);
});

test('the in-memory storage puts, gets and deletes', async () => {
  const storage = memoryStorage();
  await storage.put('a/1.jpg', Buffer.from('x'), 'image/jpeg');
  assert.equal((await storage.get('a/1.jpg'))?.contentType, 'image/jpeg');
  assert.deepEqual(storage.keys(), ['a/1.jpg']);
  await storage.delete('a/1.jpg');
  await storage.delete('a/1.jpg');
  assert.equal(await storage.get('a/1.jpg'), null);
});
