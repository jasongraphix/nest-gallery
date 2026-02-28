/**
 * firmware-repack.js — Repack uImage with custom photos and gallery config.
 *
 * Actual uImage layout (Nest Gen 2):
 *   uImage header (64 bytes, big-endian)
 *   └─ zImage payload (ARM decompressor stub + LZMA-compressed vmlinux + footer)
 *       └─ vmlinux (raw kernel binary, ~28 MB)
 *           └─ initramfs: uncompressed CPIO newc archive embedded at fixed offset
 *               └─ /tmp/nleapi/01.raw .. 10.raw (gallery photos, 409600 bytes each)
 *               └─ /tmp/nleapi/nle-gallery.conf (gallery URL config)
 *
 * Repack pipeline:
 *   1. Parse uImage header, extract zImage payload
 *   2. Find LZMA-compressed kernel in zImage (starts after ARM stub)
 *   3. Decompress LZMA → vmlinux
 *   4. Find raw CPIO initramfs in vmlinux, parse entries
 *   5. Replace photo entries + update config
 *   6. Serialize CPIO padded to original size, replace in vmlinux
 *   7. Recompress vmlinux with LZMA (same settings), rebuild zImage
 *   8. Build new uImage header with updated CRCs
 */

const fs = require('fs');
const path = require('path');
const lzma = require('lzma-native');

// ─── CRC32 ─────────────────────────────────────────────────────────────────

const crc32Table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crc32Table[i] = c;
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = crc32Table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ─── uImage Header ─────────────────────────────────────────────────────────

const UIMAGE_MAGIC = 0x27051956;
const UIMAGE_HEADER_SIZE = 64;

function parseUImageHeader(buf) {
  const magic = buf.readUInt32BE(0);
  if (magic !== UIMAGE_MAGIC) {
    throw new Error(`Not a uImage: bad magic 0x${magic.toString(16)}`);
  }
  return {
    magic,
    headerCrc: buf.readUInt32BE(4),
    timestamp: buf.readUInt32BE(8),
    dataSize: buf.readUInt32BE(12),
    loadAddr: buf.readUInt32BE(16),
    entryPoint: buf.readUInt32BE(20),
    dataCrc: buf.readUInt32BE(24),
    os: buf.readUInt8(28),
    arch: buf.readUInt8(29),
    type: buf.readUInt8(30),
    comp: buf.readUInt8(31),
    name: buf.slice(32, 64).toString('ascii').replace(/\0+$/, ''),
  };
}

function buildUImageHeader(header, dataPayload) {
  const buf = Buffer.alloc(UIMAGE_HEADER_SIZE);
  buf.writeUInt32BE(UIMAGE_MAGIC, 0);
  buf.writeUInt32BE(0, 4); // headerCrc placeholder
  buf.writeUInt32BE(header.timestamp, 8);
  buf.writeUInt32BE(dataPayload.length, 12);
  buf.writeUInt32BE(header.loadAddr, 16);
  buf.writeUInt32BE(header.entryPoint, 20);
  buf.writeUInt32BE(crc32(dataPayload), 24);
  buf.writeUInt8(header.os, 28);
  buf.writeUInt8(header.arch, 29);
  buf.writeUInt8(header.type, 30);
  buf.writeUInt8(header.comp, 31);
  const nameBytes = Buffer.from(header.name, 'ascii');
  nameBytes.copy(buf, 32, 0, Math.min(nameBytes.length, 32));
  buf.writeUInt32BE(crc32(buf), 4);
  return buf;
}

// ─── CPIO newc Format ───────────────────────────────────────────────────────

const CPIO_MAGIC = '070701';
const CPIO_HEADER_SIZE = 110;

function align4(n) {
  return (n + 3) & ~3;
}

function parseCpio(buf) {
  const entries = [];
  let offset = 0;

  while (offset + CPIO_HEADER_SIZE <= buf.length) {
    const magic = buf.slice(offset, offset + 6).toString('ascii');
    if (magic !== CPIO_MAGIC) break;

    const nameSize = parseInt(buf.slice(offset + 94, offset + 102).toString('ascii'), 16);
    const fileSize = parseInt(buf.slice(offset + 54, offset + 62).toString('ascii'), 16);
    const ino      = parseInt(buf.slice(offset + 6,  offset + 14).toString('ascii'), 16);
    const mode     = parseInt(buf.slice(offset + 14, offset + 22).toString('ascii'), 16);
    const uid      = parseInt(buf.slice(offset + 22, offset + 30).toString('ascii'), 16);
    const gid      = parseInt(buf.slice(offset + 30, offset + 38).toString('ascii'), 16);
    const nlink    = parseInt(buf.slice(offset + 38, offset + 46).toString('ascii'), 16);
    const mtime    = parseInt(buf.slice(offset + 46, offset + 54).toString('ascii'), 16);
    const devmajor = parseInt(buf.slice(offset + 62, offset + 70).toString('ascii'), 16);
    const devminor = parseInt(buf.slice(offset + 70, offset + 78).toString('ascii'), 16);
    const rdevmajor= parseInt(buf.slice(offset + 78, offset + 86).toString('ascii'), 16);
    const rdevminor= parseInt(buf.slice(offset + 86, offset + 94).toString('ascii'), 16);
    const check    = parseInt(buf.slice(offset + 102, offset + 110).toString('ascii'), 16);

    const nameStart = offset + CPIO_HEADER_SIZE;
    const name = buf.slice(nameStart, nameStart + nameSize - 1).toString('ascii');
    const dataStart = align4(nameStart + nameSize);
    const data = buf.slice(dataStart, dataStart + fileSize);

    entries.push({
      ino, mode, uid, gid, nlink, mtime,
      devmajor, devminor, rdevmajor, rdevminor,
      checkField: check, name, data,
    });

    if (name === 'TRAILER!!!') break;
    offset = align4(dataStart + fileSize);
  }

  return entries;
}

function serializeCpio(entries) {
  const chunks = [];
  let nextIno = 1;

  const trailer = entries.find(e => e.name === 'TRAILER!!!');
  const nonTrailer = entries.filter(e => e.name !== 'TRAILER!!!');

  for (const entry of nonTrailer) {
    chunks.push(serializeCpioEntry(entry, nextIno++));
  }

  chunks.push(serializeCpioEntry(trailer || {
    ino: 0, mode: 0, uid: 0, gid: 0, nlink: 1, mtime: 0,
    devmajor: 0, devminor: 0, rdevmajor: 0, rdevminor: 0,
    checkField: 0, name: 'TRAILER!!!', data: Buffer.alloc(0),
  }, 0));

  const result = Buffer.concat(chunks);
  const padded = align4(result.length);
  if (padded > result.length) {
    return Buffer.concat([result, Buffer.alloc(padded - result.length)]);
  }
  return result;
}

function serializeCpioEntry(entry, ino) {
  const nameWithNull = entry.name + '\0';
  const nameSize = nameWithNull.length;
  const fileSize = entry.data.length;

  const headerStr = [
    CPIO_MAGIC,
    hex8(ino || entry.ino), hex8(entry.mode),
    hex8(entry.uid), hex8(entry.gid), hex8(entry.nlink), hex8(entry.mtime),
    hex8(fileSize),
    hex8(entry.devmajor), hex8(entry.devminor),
    hex8(entry.rdevmajor), hex8(entry.rdevminor),
    hex8(nameSize), hex8(entry.checkField || 0),
  ].join('');

  const header = Buffer.from(headerStr, 'ascii');
  const nameBuf = Buffer.from(nameWithNull, 'ascii');
  const headerPlusName = Buffer.concat([header, nameBuf]);
  const namePad = Buffer.alloc(align4(headerPlusName.length) - headerPlusName.length);
  const dataPad = Buffer.alloc(align4(fileSize) - fileSize);

  return Buffer.concat([headerPlusName, namePad, entry.data, dataPad]);
}

function hex8(n) {
  return n.toString(16).toUpperCase().padStart(8, '0');
}

// ─── zImage / LZMA Helpers ──────────────────────────────────────────────────

const ZIMAGE_MAGIC = 0x016f2818;
const LZMA_MAGIC = Buffer.from([0x5d, 0x00, 0x00, 0x00, 0x04]); // props=0x5d, dict=64MB LE

/**
 * Find the LZMA-compressed kernel data inside a zImage payload.
 * Scans for the LZMA header signature (props byte 0x5d + 64MB dict).
 * Returns { offset, footer } where footer is the data after the LZMA stream.
 */
function findLzmaInZimage(zimage) {
  // Scan for LZMA magic in the first 64KB (the ARM stub is small)
  for (let i = 0; i < Math.min(zimage.length, 65536) - LZMA_MAGIC.length; i++) {
    if (zimage[i] === LZMA_MAGIC[0] && zimage.compare(LZMA_MAGIC, 0, LZMA_MAGIC.length, i, i + LZMA_MAGIC.length) === 0) {
      return { offset: i };
    }
  }
  throw new Error('Could not find LZMA data in zImage');
}

/**
 * Find the raw (uncompressed) CPIO initramfs in vmlinux.
 * Returns { offset, size } or throws.
 */
function findCpioInVmlinux(vmlinux) {
  const magic = Buffer.from(CPIO_MAGIC, 'ascii');

  for (let i = 0; i < vmlinux.length - CPIO_HEADER_SIZE; i++) {
    if (vmlinux[i] === magic[0] && vmlinux.compare(magic, 0, 6, i, i + 6) === 0) {
      // Verify it looks like a real CPIO header (valid namesize)
      const nameSize = parseInt(vmlinux.slice(i + 94, i + 102).toString('ascii'), 16);
      if (nameSize > 0 && nameSize < 256) {
        const name = vmlinux.slice(i + 110, i + 110 + Math.min(nameSize - 1, 20)).toString('ascii');
        if (name === '.' || name === 'dev' || name === 'bin' || name === 'etc' ||
            name === 'lib' || name === 'tmp' || name === 'usr' || name === 'sbin' ||
            name.match(/^[a-z]/)) {
          // Found the start — now find the end (TRAILER!!! followed by zeros)
          const size = findCpioEnd(vmlinux, i);
          return { offset: i, size };
        }
      }
    }
  }
  throw new Error('Could not find CPIO initramfs in vmlinux');
}

/**
 * Find the total size of the CPIO region starting at offset.
 * Walks entries to TRAILER!!!, then measures any trailing zero padding.
 */
function findCpioEnd(vmlinux, cpioStart) {
  let offset = cpioStart;

  // Walk CPIO entries to find TRAILER!!!
  while (offset + CPIO_HEADER_SIZE <= vmlinux.length) {
    const magic = vmlinux.slice(offset, offset + 6).toString('ascii');
    if (magic !== CPIO_MAGIC) break;

    const nameSize = parseInt(vmlinux.slice(offset + 94, offset + 102).toString('ascii'), 16);
    const fileSize = parseInt(vmlinux.slice(offset + 54, offset + 62).toString('ascii'), 16);
    const nameStart = offset + CPIO_HEADER_SIZE;
    const name = vmlinux.slice(nameStart, nameStart + Math.min(nameSize - 1, 20)).toString('ascii');
    const dataStart = align4(nameStart + nameSize);

    if (name === 'TRAILER!!!') {
      // Found trailer — include it plus any zero padding after
      const trailerEnd = align4(dataStart + fileSize);
      let end = trailerEnd;
      // Include contiguous zeros (section padding to alignment boundary)
      while (end < vmlinux.length && vmlinux[end] === 0) end++;
      // Back up to a page-aligned boundary if we went too far
      // The initramfs section is typically page-aligned (4096)
      const pageEnd = (trailerEnd + 4095) & ~4095;
      if (pageEnd <= end) {
        return pageEnd - cpioStart;
      }
      return trailerEnd - cpioStart;
    }

    offset = align4(dataStart + fileSize);
  }

  // If we didn't find TRAILER, return distance walked
  return offset - cpioStart;
}

/** Decompress LZMA (alone format). Returns a Promise<Buffer>. */
function lzmaDecompress(data) {
  return new Promise((resolve, reject) => {
    lzma.decompress(data, undefined, (result, err) => {
      if (err) return reject(new Error('LZMA decompress failed: ' + err));
      resolve(Buffer.from(result));
    });
  });
}

/** Compress with LZMA (alone format, matching kernel settings). Returns a Promise<Buffer>. */
function lzmaCompress(data) {
  return new Promise((resolve, reject) => {
    // preset 9 gives lc=3, lp=0, pb=2, dict=64MB — matching the kernel's LZMA settings.
    // Note: lzma-native's filters API doesn't propagate dictSize correctly for aloneEncoder,
    // so we use preset instead.
    const encoder = lzma.createStream('aloneEncoder', { preset: 9 });

    const chunks = [];
    encoder.on('data', (chunk) => chunks.push(chunk));
    encoder.on('end', () => resolve(Buffer.concat(chunks)));
    encoder.on('error', (err) => reject(new Error('LZMA compress failed: ' + err)));

    encoder.write(data);
    encoder.end();
  });
}

// ─── Repack Pipeline ────────────────────────────────────────────────────────

/**
 * Repack a uImage with custom photos and/or gallery URL.
 *
 * @param {string} uimagePath - Path to the stock uImage file
 * @param {Object} options
 * @param {Buffer[]} [options.photos] - Array of 409600-byte BGRA buffers
 * @param {string}   [options.galleryUrl] - Gallery URL (empty string = offline)
 * @param {string}   [options.metaPath] - Optional uImage.meta.json path
 * @returns {Promise<Buffer>} The repacked uImage buffer
 */
async function repackUImage(uimagePath, options = {}) {
  const { photos, galleryUrl, metaPath } = options;

  // 1. Parse uImage
  const uimageData = fs.readFileSync(uimagePath);
  const header = parseUImageHeader(uimageData);
  const zimage = uimageData.slice(UIMAGE_HEADER_SIZE, UIMAGE_HEADER_SIZE + header.dataSize);

  // 2. Find LZMA data in zImage
  const lzmaInfo = findLzmaInZimage(zimage);
  const lzmaOffset = lzmaInfo.offset;

  // The zImage = stub (before LZMA) + LZMA data + footer (after LZMA)
  const stub = zimage.slice(0, lzmaOffset);

  // 3. Decompress LZMA → vmlinux
  // We pass everything from lzmaOffset to the end; lzma-native handles the stream end
  const lzmaPayload = zimage.slice(lzmaOffset);
  const vmlinux = await lzmaDecompress(lzmaPayload);

  // 4. Find raw CPIO initramfs in vmlinux
  let cpioInfo;
  if (metaPath && fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      if (typeof meta.cpioOffset === 'number' && typeof meta.cpioSize === 'number') {
        cpioInfo = { offset: meta.cpioOffset, size: meta.cpioSize };
      }
    } catch (e) { /* fall through to scanning */ }
  }
  if (!cpioInfo) {
    cpioInfo = findCpioInVmlinux(vmlinux);
  }

  const originalCpioSize = cpioInfo.size;
  const entries = parseCpio(vmlinux.slice(cpioInfo.offset));

  // 5. Modify CPIO entries

  // Replace photos if provided
  if (photos && photos.length > 0) {
    const photoPattern = /^tmp\/nleapi\/\d{2}\.raw$/;
    const refEntry = entries.find(e => photoPattern.test(e.name));
    const base = refEntry || {
      mode: 0o100644, uid: 0, gid: 0, nlink: 1,
      mtime: Math.floor(Date.now() / 1000),
      devmajor: 0, devminor: 0, rdevmajor: 0, rdevminor: 0, checkField: 0,
    };

    // Remove old photos
    const kept = entries.filter(e => !photoPattern.test(e.name));
    // Add new ones
    for (let i = 0; i < photos.length && i < 10; i++) {
      const num = String(i + 1).padStart(2, '0');
      kept.push({ ...base, name: `tmp/nleapi/${num}.raw`, data: photos[i], ino: 0 });
    }
    entries.length = 0;
    entries.push(...kept);
  }

  // Update gallery config
  if (galleryUrl !== undefined) {
    const configName = 'tmp/nleapi/nle-gallery.conf';
    const configBuf = Buffer.from(`GALLERY_URL="${galleryUrl}"\n`, 'utf-8');
    const idx = entries.findIndex(e => e.name === configName);
    if (idx >= 0) {
      entries[idx].data = configBuf;
    } else {
      const ref = entries.find(e => e.name.startsWith('tmp/nleapi/') && !e.name.endsWith('/'));
      entries.push({
        mode: ref ? ref.mode : 0o100644,
        uid: 0, gid: 0, nlink: 1, mtime: Math.floor(Date.now() / 1000),
        devmajor: 0, devminor: 0, rdevmajor: 0, rdevminor: 0,
        checkField: 0, name: configName, data: configBuf, ino: 0,
      });
    }
  }

  // Update manifest if present
  const mIdx = entries.findIndex(e => e.name === 'tmp/nleapi/.nle-manifest.json');
  if (mIdx >= 0) {
    try {
      const m = JSON.parse(entries[mIdx].data.toString('utf-8'));
      if (photos) m.photoCount = photos.length;
      if (galleryUrl !== undefined) m.galleryUrl = galleryUrl;
      entries[mIdx].data = Buffer.from(JSON.stringify(m, null, 2) + '\n', 'utf-8');
    } catch (e) { /* skip */ }
  }

  // 6. Serialize CPIO, shrink .padding if needed, pad to original region size
  let newCpio = serializeCpio(entries);

  // If the CPIO grew (e.g. longer gallery URL), shrink the .padding file to compensate
  if (newCpio.length > originalCpioSize) {
    const overflow = newCpio.length - originalCpioSize;
    const padIdx = entries.findIndex(e => e.name === 'tmp/nleapi/.padding');
    if (padIdx >= 0 && entries[padIdx].data.length > overflow) {
      const newPadSize = entries[padIdx].data.length - overflow - 256; // extra margin
      entries[padIdx].data = Buffer.alloc(Math.max(0, newPadSize));
      newCpio = serializeCpio(entries);
    }
  }

  let cpioRegionSize = originalCpioSize;

  if (newCpio.length > cpioRegionSize) {
    // The new CPIO is larger — check if vmlinux has zeros we can safely extend into.
    // The initramfs region is followed by zero padding (section alignment).
    const extraNeeded = newCpio.length - cpioRegionSize;
    const regionEnd = cpioInfo.offset + cpioRegionSize;
    let canExtend = regionEnd + extraNeeded <= vmlinux.length;
    for (let i = 0; canExtend && i < extraNeeded; i++) {
      if (vmlinux[regionEnd + i] !== 0) canExtend = false;
    }
    if (canExtend) {
      cpioRegionSize = newCpio.length;
    } else {
      throw new Error(
        `Repacked CPIO is ${newCpio.length} bytes but original region is ${originalCpioSize} bytes. ` +
        `Overflow of ${newCpio.length - originalCpioSize} bytes with no room to extend.`
      );
    }
  }

  // Pad to exact region size (zero-fill remainder)
  const paddedCpio = Buffer.alloc(cpioRegionSize);
  newCpio.copy(paddedCpio);

  const newVmlinux = Buffer.from(vmlinux);
  paddedCpio.copy(newVmlinux, cpioInfo.offset);

  // 7. Recompress vmlinux with LZMA, rebuild zImage
  const newLzma = await lzmaCompress(newVmlinux);

  // Reconstruct zImage: stub + new LZMA data
  // The footer after the LZMA stream contains size/offset references.
  // We need to figure out what was after the original LZMA stream.
  // lzma-native's decompress tells us the unused data via the stream,
  // but we already consumed everything. Instead, we know the original
  // zImage structure: the footer is at the very end and is small (~56 bytes).
  // We find the footer by looking for the LZMA start offset (0x1cb4)
  // stored as a LE uint32 near the end of the zImage.
  const footerInfo = findZimageFooter(zimage, lzmaOffset);

  const newZimage = Buffer.concat([stub, newLzma, footerInfo.data]);

  // Fix up absolute addresses in the footer for the new zImage size.
  // The footer contains LE uint32 pointers that reference positions within the footer
  // itself and nearby areas. When the LZMA size changes, these shift.
  const sizeDelta = newZimage.length - zimage.length;
  if (sizeDelta !== 0) {
    const newFooterStart = stub.length + newLzma.length;
    for (let i = newFooterStart; i + 4 <= newZimage.length; i += 4) {
      const val = newZimage.readUInt32LE(i);
      // Adjust values that are absolute offsets near the original footer area
      if (val >= footerInfo.offset - 64 && val <= zimage.length) {
        newZimage.writeUInt32LE(val + sizeDelta, i);
      }
    }
  }

  // Update zImage end address in ARM header (offset 0x2c, LE uint32)
  if (newZimage.readUInt32LE(0x24) === ZIMAGE_MAGIC) {
    newZimage.writeUInt32LE(newZimage.length, 0x2c);
  }

  // 8. Build new uImage
  const newUimageHeader = buildUImageHeader(header, newZimage);
  return Buffer.concat([newUimageHeader, newZimage]);
}

/**
 * Extract the footer from the end of a zImage.
 * The footer contains size/offset metadata stored as LE uint32 values.
 * We identify it by finding the LZMA start offset value stored near the end.
 */
function findZimageFooter(zimage, lzmaOffset) {
  // Scan backwards from the end for the lzmaOffset value (stored as LE uint32)
  for (let i = zimage.length - 4; i > zimage.length - 256; i -= 4) {
    if (zimage.readUInt32LE(i) === lzmaOffset) {
      // The footer starts a few entries before this reference.
      // Typically the table has ~9 entries and the offset reference
      // is the 3rd entry. Walk back to find the start.
      let footerStart = i;
      for (let j = i - 40; j < i; j += 4) {
        const val = zimage.readUInt32LE(j);
        if (val > zimage.length - 256 && val <= zimage.length) {
          footerStart = j;
          break;
        }
      }
      return { data: zimage.slice(footerStart), offset: footerStart };
    }
  }

  // Fallback: no footer found
  return { data: Buffer.alloc(0), offset: zimage.length };
}

module.exports = {
  repackUImage,
  parseUImageHeader,
  parseCpio,
  serializeCpio,
  crc32,
  UIMAGE_HEADER_SIZE,
};
