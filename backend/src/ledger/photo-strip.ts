// #300 Removes location and other metadata from an uploaded photo before it is stored. Only JPEG and PNG are
// accepted. The pixels are never decoded or re-encoded: the file is rewritten without the segments or chunks that
// can carry metadata (EXIF with the GPS position, XMP, comments, text, timestamps).
//
// JPEG: only the image data and the colour-related segments stay. The one EXIF fact worth keeping is the
// orientation, so a phone photo taken sideways still shows upright; it is written back as a tiny EXIF segment that
// holds nothing else.

export type PhotoType = 'image/jpeg' | 'image/png';
export type CleanPhoto = { bytes: Buffer; contentType: PhotoType };

export class PhotoFormatError extends Error {}

const unsupported = 'Upload a JPEG or PNG photo';
const damaged = 'The photo file is damaged';

export function sniffPhotoType(bytes: Buffer): PhotoType | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg';
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(pngSignature)) return 'image/png';
  return null;
}

export function stripPhotoMetadata(bytes: Buffer): CleanPhoto {
  const type = sniffPhotoType(bytes);
  if (type === 'image/jpeg') return { bytes: stripJpeg(bytes), contentType: type };
  if (type === 'image/png') return { bytes: stripPng(bytes), contentType: type };
  throw new PhotoFormatError(unsupported);
}

// ---- JPEG ----

/** Segments that may stay: everything that decodes the image. APP1 (EXIF/XMP), APP3-15 and COM are dropped. */
function keepJpegSegment(marker: number, data: Buffer) {
  if (marker === 0xe0) return data.subarray(0, 5).toString('latin1') === 'JFIF\0';
  if (marker === 0xe2) return data.subarray(0, 12).toString('latin1') === 'ICC_PROFILE\0';
  if (marker === 0xee) return data.subarray(0, 5).toString('latin1') === 'Adobe'; // colour transform
  return !(marker >= 0xe1 && marker <= 0xef) && marker !== 0xfe;
}

/** The EXIF orientation (1-8) from an APP1 segment, or 1. */
function exifOrientation(data: Buffer) {
  if (data.subarray(0, 6).toString('latin1') !== 'Exif\0\0') return 1;
  const tiff = data.subarray(6);
  if (tiff.length < 8) return 1;
  const little = tiff.toString('latin1', 0, 2) === 'II';
  if (!little && tiff.toString('latin1', 0, 2) !== 'MM') return 1;
  const u16 = (at: number) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at: number) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  try {
    const ifd = u32(4);
    const count = u16(ifd);
    for (let index = 0; index < count; index += 1) {
      const at = ifd + 2 + index * 12;
      if (u16(at) === 0x0112) {
        const value = u16(at + 8);
        return value >= 1 && value <= 8 ? value : 1;
      }
    }
  } catch {
    return 1;
  }
  return 1;
}

function orientationSegment(orientation: number) {
  const tiff = Buffer.from([
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0x00,
    0x00,
    0x00,
    0x08, // big-endian header, IFD at 8
    0x00,
    0x01, // one entry
    0x01,
    0x12,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    orientation,
    0x00,
    0x00, // Orientation, SHORT
    0x00,
    0x00,
    0x00,
    0x00, // no next IFD
  ]);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
}

function stripJpeg(input: Buffer) {
  const kept: Buffer[] = [];
  let orientation = 1;
  let position = 2;
  let scan: Buffer | null = null;
  while (position < input.length) {
    if (input[position] !== 0xff) throw new PhotoFormatError(damaged);
    let marker = input[position + 1];
    // Fill bytes: any number of 0xff may come before a marker.
    while (marker === 0xff && position + 2 < input.length) {
      position += 1;
      marker = input[position + 1];
    }
    if (marker === undefined) throw new PhotoFormatError(damaged);
    if (marker === 0xd9) break; // EOI
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      position += 2; // standalone marker without a length
      continue;
    }
    if (position + 4 > input.length) throw new PhotoFormatError(damaged);
    const length = input.readUInt16BE(position + 2);
    const end = position + 2 + length;
    if (length < 2 || end > input.length) throw new PhotoFormatError(damaged);
    const data = input.subarray(position + 4, end);
    if (marker === 0xda) {
      // Start of scan: the entropy-coded data runs to the end of the file and is kept as it is (no metadata there).
      scan = input.subarray(position);
      break;
    }
    if (marker === 0xe1 && orientation === 1) orientation = exifOrientation(data);
    if (keepJpegSegment(marker, data)) kept.push(input.subarray(position, end));
    position = end;
  }
  if (!scan) throw new PhotoFormatError(damaged);
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  const first = kept[0];
  const hasJfif = first !== undefined && first[1] === 0xe0;
  if (hasJfif) parts.push(first);
  if (orientation !== 1) parts.push(orientationSegment(orientation));
  parts.push(...kept.slice(hasJfif ? 1 : 0), scan);
  return Buffer.concat(parts);
}

// ---- PNG ----

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Chunks that stay: the image itself and its colour handling. eXIf, tEXt, zTXt, iTXt, tIME and unknown ones go. */
const keepPngChunks = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'iCCP',
  'sBIT',
  'bKGD',
  'pHYs',
]);

function stripPng(input: Buffer) {
  const parts: Buffer[] = [pngSignature];
  let position = 8;
  let sawEnd = false;
  while (position + 12 <= input.length) {
    const length = input.readUInt32BE(position);
    const end = position + 12 + length;
    if (end > input.length) throw new PhotoFormatError(damaged);
    const name = input.toString('latin1', position + 4, position + 8);
    if (keepPngChunks.has(name)) parts.push(input.subarray(position, end));
    position = end;
    if (name === 'IEND') {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd) throw new PhotoFormatError(damaged);
  return Buffer.concat(parts);
}
