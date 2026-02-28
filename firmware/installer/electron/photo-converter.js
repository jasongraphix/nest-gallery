const sharp = require('sharp');

const PHOTO_WIDTH = 320;
const PHOTO_HEIGHT = 320;
const PHOTO_RAW_SIZE = PHOTO_WIDTH * PHOTO_HEIGHT * 4; // 409600 bytes BGRA

/**
 * Convert an image file to 320x320 BGRA raw format for the Nest display.
 * Crops to center square, resizes to 320x320, outputs as BGRA (XRGB8888).
 * @param {string} inputPath - Path to input image (jpg, png, webp, etc.)
 * @returns {Promise<Buffer>} 409600-byte BGRA buffer
 */
async function convertPhoto(inputPath) {
  // Read and resize to 320x320, center crop for non-square images
  const rgbaBuffer = await sharp(inputPath)
    .resize(PHOTO_WIDTH, PHOTO_HEIGHT, {
      fit: 'cover',
      position: 'centre',
    })
    .removeAlpha()
    .ensureAlpha()
    .raw()
    .toBuffer();

  // Sharp outputs RGBA, Nest framebuffer expects BGRA — swap R and B channels
  const bgraBuffer = Buffer.alloc(PHOTO_RAW_SIZE);
  for (let i = 0; i < rgbaBuffer.length; i += 4) {
    bgraBuffer[i] = rgbaBuffer[i + 2];     // B <- R
    bgraBuffer[i + 1] = rgbaBuffer[i + 1]; // G <- G
    bgraBuffer[i + 2] = rgbaBuffer[i];     // R <- B
    bgraBuffer[i + 3] = rgbaBuffer[i + 3]; // A <- A
  }

  if (bgraBuffer.length !== PHOTO_RAW_SIZE) {
    throw new Error(`Converted photo is ${bgraBuffer.length} bytes, expected ${PHOTO_RAW_SIZE}`);
  }

  return bgraBuffer;
}

/**
 * Generate a thumbnail data URI for the React UI.
 * @param {string} inputPath - Path to input image
 * @returns {Promise<string>} PNG data URI (data:image/png;base64,...)
 */
async function generateThumbnail(inputPath) {
  const pngBuffer = await sharp(inputPath)
    .resize(160, 160, {
      fit: 'cover',
      position: 'centre',
    })
    .png()
    .toBuffer();

  return `data:image/png;base64,${pngBuffer.toString('base64')}`;
}

module.exports = { convertPhoto, generateThumbnail, PHOTO_RAW_SIZE };
