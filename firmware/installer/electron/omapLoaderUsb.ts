// omapLoaderUsb.ts
// Pure Node/Electron port of omap_loader using the "usb" package.
// GPLv2 derived work: see original omap_loader.c for license.
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License
// as published by the Free Software Foundation; either version 2
// of the License, or (at your option) any later version.

import fs from "fs";
import path from "path";

// Native modules in Electron must use require() in main process
const usb = require("usb");
import type {
  Device,
  Interface as UsbInterface,
  InEndpoint,
  OutEndpoint,
} from "usb";

// OMAP Device Constants
const OMAP_VENDOR_ID = 0x0451;
const OMAP_PRODUCT_ID = 0xd00e;
const OMAP_BASE_ADDRESS = 0x40200000;
const OMAP_PERIPH_BOOT = 0xf0030002;
const OMAP_ASIC_ID_LEN = 69;

// USB Transfer Settings
const USB_TIMEOUT = 5000; // milliseconds (increased for reliable NAND writes)
const MAX_CHUNK_SIZE = 512; // bytes per write
const DEVICE_TIMEOUT = 60000; // 60 seconds
// Use setImmediate for maximum speed polling (next event loop tick, ~0ms)
const USE_IMMEDIATE_POLLING = true;

// Utility: PACK4('U','S','B','x') - creates 4-byte command codes
const PACK4 = (a: string, b: string, c: string, d: string): number =>
  (d.charCodeAt(0) << 24) | (c.charCodeAt(0) << 16) | (b.charCodeAt(0) << 8) | a.charCodeAt(0);

// X-Loader USB Protocol Commands
const USBLOAD_CMD_FILE = PACK4("U", "S", "B", "s"); // File size request
const USBLOAD_CMD_FILE_REQ = PACK4("U", "S", "B", "f"); // File size response
const USBLOAD_CMD_JUMP = PACK4("U", "S", "B", "j"); // Execute code
const USBLOAD_CMD_ECHO_SZ = PACK4("U", "S", "B", "n"); // Size confirmation
const USBLOAD_CMD_REPORT_SZ = PACK4("U", "S", "B", "o"); // Full file confirmation
const USBLOAD_CMD_MESSAGE = PACK4("U", "S", "B", "m"); // Debug message

// Types
export type FileInput = {
  path: string;
  addr?: number; // Optional for non-first files
};

type FileUpload = {
  path: string;
  basename: string;
  addr: number;
  data: Buffer;
};

export type ProgressCallback = (stage: string, message: string) => void;

export type FlashOptions = {
  vendor?: number;
  product?: number;
  jumpTarget?: number;
  verbose?: boolean;
  onProgress?: ProgressCallback;
};

/**
 * Logging utilities
 */
function logInfo(msg: string, opts?: FlashOptions): void {
  if (opts?.verbose) {
    console.log(`[+] ${msg}`);
  }
  opts?.onProgress?.("info", msg);
}

function logError(msg: string, opts?: FlashOptions): void {
  console.error(`[-] ${msg}`);
  opts?.onProgress?.("error", msg);
}

/**
 * Single-shot device lookup by VID/PID
 */
function findOmapDeviceOnce(vendor: number, product: number): Device | undefined {
  return usb.getDeviceList().find(
    (d: Device) =>
      d.deviceDescriptor.idVendor === vendor &&
      d.deviceDescriptor.idProduct === product
  );
}

/**
 * Tight polling loop for device detection
 * Uses setImmediate for maximum speed (processes on next event loop tick)
 * This is as fast as possible while remaining non-blocking
 */
async function waitForOmapDevice(
  vendor: number,
  product: number,
  opts?: FlashOptions
): Promise<Device> {
  const endTime = Date.now() + DEVICE_TIMEOUT;

  logInfo(
    `Scanning for USB device ${vendor.toString(16).padStart(4, "0")}:${product.toString(16).padStart(4, "0")} ` +
    `(maximum speed polling, timeout: ${DEVICE_TIMEOUT}ms)`,
    opts
  );

  while (Date.now() < endTime) {
    const dev = findOmapDeviceOnce(vendor, product);
    if (dev) {
      logInfo(
        `Successfully found device ${vendor.toString(16).padStart(4, "0")}:${product.toString(16).padStart(4, "0")}`,
        opts
      );
      return dev;
    }

    // Use setImmediate for fastest possible polling (next event loop tick)
    // This is orders of magnitude faster than setTimeout and won't block the event loop
    if (USE_IMMEDIATE_POLLING) {
      await new Promise((resolve) => setImmediate(resolve));
    } else {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  throw new Error(
    `Timeout waiting for OMAP device ${vendor.toString(16)}:${product.toString(16)} after ${DEVICE_TIMEOUT}ms`
  );
}

/**
 * Open device, claim interface, and get bulk endpoints
 */
async function openAndClaim(dev: Device): Promise<{
  iface: UsbInterface;
  inEp: InEndpoint;
  outEp: OutEndpoint;
}> {

  // Open without auto-config since configDescriptor doesn't populate properly
  dev.open(false);


  const anyDev = dev as any;

  // Check allConfigDescriptors - this should have the interface info
  if (!anyDev.allConfigDescriptors || anyDev.allConfigDescriptors.length === 0) {
    throw new Error("No configuration descriptors available in allConfigDescriptors");
  }

  const configDesc = anyDev.allConfigDescriptors[0];

  // Extract interface number from the descriptor
  const interfaceDesc = configDesc.interfaces[0][0]; // First interface, first alt setting
  const ifaceNum = interfaceDesc.bInterfaceNumber;


  // Claim the interface using low-level API (bypassing setConfiguration which fails)
  try {
    anyDev.__claimInterface(ifaceNum);
  } catch (err) {
    throw new Error(`Failed to claim interface ${ifaceNum}: ${err}`);
  }

  // Check if dev.interfaces is now populated after claiming

  // dev.interfaces is still empty - the node-usb high-level API is broken for this device
  // We need to create our own endpoint wrappers using the low-level __bulkTransfer API
  // We have the endpoint addresses from the descriptor: 0x81 (IN) and 0x01 (OUT)

  const inEndpointAddr = 0x81; // From descriptor
  const outEndpointAddr = 0x01; // From descriptor


  // Create a mock interface object for cleanup
  const mockIface = {
    interfaceNumber: ifaceNum,
    release: (releaseKernelDriver: boolean, callback?: () => void) => {
      try {
        anyDev.__releaseInterface(ifaceNum, () => {
          if (callback) callback();
        });
      } catch {
        if (callback) callback();
      }
    },
  } as UsbInterface;

  // Use the Transfer class from the usb bindings for low-level bulk transfers
  const Transfer = usb.usb.Transfer;
  const LIBUSB_TRANSFER_TYPE_BULK = 2;

  // Create IN endpoint wrapper using the Transfer API
  const inEp = {
    direction: "in",
    transferType: LIBUSB_TRANSFER_TYPE_BULK,
    timeout: USB_TIMEOUT,
    transfer: (length: number, callback: (err: any, data?: Buffer) => void) => {
      try {
        const buffer = Buffer.alloc(length);
        const transfer = new Transfer(dev, inEndpointAddr, LIBUSB_TRANSFER_TYPE_BULK, USB_TIMEOUT,
          (error: any, buf: Buffer, actual: number) => {
            if (error) {
              callback(error);
            } else {
              // Return only the actual bytes received
              callback(null, buf.subarray(0, actual));
            }
          }
        );
        transfer.submit(buffer);
      } catch (err) {
        callback(err);
      }
    },
  } as InEndpoint;

  // Create OUT endpoint wrapper using the Transfer API
  const outEp = {
    direction: "out",
    transferType: LIBUSB_TRANSFER_TYPE_BULK,
    timeout: USB_TIMEOUT,
    transfer: (buffer: Buffer, callback: (err: any) => void) => {
      try {
        const transfer = new Transfer(dev, outEndpointAddr, LIBUSB_TRANSFER_TYPE_BULK, USB_TIMEOUT,
          (error: any) => {
            callback(error);
          }
        );
        transfer.submit(buffer);
      } catch (err) {
        callback(err);
      }
    },
  } as OutEndpoint;


  return { iface: mockIface, inEp, outEp };
}

/**
 * Bulk read wrapper with timeout
 */
function bulkRead(
  ep: InEndpoint,
  length: number,
  timeoutMs = USB_TIMEOUT
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    ep.timeout = timeoutMs;
    ep.transfer(length, (err, data) => {
      if (err) {
        return reject(new Error(`Bulk read error: ${err.message || String(err)}`));
      }
      if (!data) {
        return reject(new Error("Bulk read returned no data"));
      }
      resolve(data);
    });
  });
}

/**
 * Bulk write wrapper with chunking (512 bytes max per transfer for reliability)
 */
async function bulkWrite(
  ep: OutEndpoint,
  data: Buffer,
  timeoutMs = USB_TIMEOUT
): Promise<void> {
  ep.timeout = timeoutMs;

  let offset = 0;
  while (offset < data.length) {
    const chunkSize = Math.min(MAX_CHUNK_SIZE, data.length - offset);
    const chunk = data.subarray(offset, offset + chunkSize);

    await new Promise<void>((resolve, reject) => {
      ep.transfer(chunk, (err) => {
        if (err) {
          return reject(new Error(`Bulk write error: ${err.message || String(err)}`));
        }
        resolve();
      });
    });

    offset += chunkSize;

    // Small delay between chunks for reliability
    if (offset < data.length) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }
}

/**
 * Load file from disk
 */
function loadFile(pathStr: string, addr: number): FileUpload {
  if (!fs.existsSync(pathStr)) {
    throw new Error(`File not found: ${pathStr}`);
  }

  const data = fs.readFileSync(pathStr);
  return {
    path: pathStr,
    basename: path.basename(pathStr),
    addr,
    data,
  };
}

/**
 * Transfer first-stage file via BootROM protocol
 */
async function transferFirstStage(
  dev: Device,
  files: FileUpload[],
  opts?: FlashOptions
): Promise<void> {
  const { iface, inEp, outEp } = await openAndClaim(dev);

  try {
    const first = files[0];

    logInfo(`Starting BootROM communication for first-stage transfer`, opts);

    // Step 1: Read ASIC ID from BootROM
    logInfo(`Reading ASIC ID from BootROM...`, opts);
    const asicBuf = await bulkRead(inEp, 0x200, USB_TIMEOUT);

    if (asicBuf.length < OMAP_ASIC_ID_LEN) {
      throw new Error(
        `ASIC ID too short: got ${asicBuf.length} bytes, expected at least ${OMAP_ASIC_ID_LEN}`
      );
    }

    const asicId = asicBuf.subarray(0, OMAP_ASIC_ID_LEN).toString("hex");
    logInfo(`Got ASIC ID: ${asicId.substring(0, 32)}...`, opts);

    // Step 2: Send PERIPH_BOOT command (little-endian)
    logInfo(`Sending PERIPH_BOOT command (0x${OMAP_PERIPH_BOOT.toString(16)})...`, opts);
    const cmdBuf = Buffer.alloc(4);
    cmdBuf.writeUInt32LE(OMAP_PERIPH_BOOT, 0);
    await bulkWrite(outEp, cmdBuf, USB_TIMEOUT);

    // Step 3: Send first-stage file length (little-endian)
    logInfo(`Sending first-stage length: ${first.data.length} bytes`, opts);
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(first.data.length, 0);
    await bulkWrite(outEp, lenBuf, USB_TIMEOUT);

    // Step 4: Send first-stage file data
    logInfo(`Uploading first-stage file '${first.basename}' (${first.data.length} bytes)...`, opts);
    await bulkWrite(outEp, first.data, USB_TIMEOUT);
    logInfo(`First-stage file '${first.basename}' transferred successfully`, opts);

  } finally {
    // Release interface and close device
    iface.release(true, () => {
      try {
        dev.close();
      } catch {
        // Ignore close errors
      }
    });
  }
}

/**
 * Transfer additional files via X-Loader state machine and send JUMP command
 */
async function transferOtherFiles(
  dev: Device,
  files: FileUpload[],
  jumpTarget: number,
  opts?: FlashOptions
): Promise<void> {
  const { iface, inEp, outEp } = await openAndClaim(dev);

  const bufSize = 128 * 4; // 128 uint32's = 512 bytes
  let curFileIndex = 1; // Skip first-stage file
  let numFailures = 0;
  const maxFailures = 10;

  try {
    logInfo(`Starting X-Loader communication for ${files.length - 1} additional file(s)`, opts);

    // X-Loader state machine loop
    while (curFileIndex < files.length) {
      let buf: Buffer;

      try {
        buf = await bulkRead(inEp, bufSize, USB_TIMEOUT);
      } catch (err) {
        numFailures++;
        logError(
          `Read error from X-Loader (attempt ${numFailures}/${maxFailures}): ${String(err)}`,
          opts
        );

        if (numFailures >= maxFailures) {
          throw new Error(
            `Failed to read opcode from X-Loader after ${maxFailures} attempts`
          );
        }

        // Wait before retry (mimicking C code's 2s delay)
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }

      if (buf.length < 8) {
        throw new Error(
          `X-Loader opcode buffer too short: got ${buf.length} bytes, need >= 8`
        );
      }

      const opcode = buf.readUInt32LE(0);
      const file = files[curFileIndex];

      // Handle X-Loader opcodes
      switch (opcode) {
        case USBLOAD_CMD_FILE_REQ: {
          // X-Loader is requesting file metadata
          logInfo(`X-Loader requesting file metadata for '${file.basename}'`, opts);

          const out = Buffer.alloc(12);
          out.writeUInt32LE(USBLOAD_CMD_FILE, 0);
          out.writeUInt32LE(file.data.length, 4);
          out.writeUInt32LE(file.addr >>> 0, 8);

          await bulkWrite(outEp, out, USB_TIMEOUT);
          logInfo(
            `Sent FILE command: '${file.basename}' size=${file.data.length} addr=0x${file.addr.toString(16).padStart(8, "0")}`,
            opts
          );
          break;
        }

        case USBLOAD_CMD_ECHO_SZ: {
          // X-Loader confirms the size it expects to receive
          const sizeEcho = buf.readUInt32LE(4);
          if (sizeEcho !== file.data.length) {
            throw new Error(
              `X-Loader ECHO_SZ mismatch for '${file.basename}': got ${sizeEcho}, expected ${file.data.length}`
            );
          }

          logInfo(`X-Loader confirmed size, uploading '${file.basename}' (${file.data.length} bytes)...`, opts);
          await bulkWrite(outEp, file.data, USB_TIMEOUT);
          logInfo(`File '${file.basename}' data transferred`, opts);
          break;
        }

        case USBLOAD_CMD_REPORT_SZ: {
          // X-Loader confirms it received the full file
          const sizeRep = buf.readUInt32LE(4);
          if (sizeRep !== file.data.length) {
            throw new Error(
              `X-Loader REPORT_SZ mismatch for '${file.basename}': got ${sizeRep}, expected ${file.data.length}`
            );
          }

          logInfo(`X-Loader confirmed receipt of '${file.basename}', moving to next file`, opts);
          curFileIndex++;
          break;
        }

        case USBLOAD_CMD_MESSAGE: {
          // X-Loader debug message (null-terminated string after opcode)
          const extra = buf.subarray(4);
          const nulIndex = extra.indexOf(0);
          const msg = (nulIndex >= 0 ? extra.subarray(0, nulIndex) : extra).toString("ascii");
          logInfo(`X-Loader Debug: ${msg}`, opts);
          break;
        }

        default: {
          // Unknown opcode
          const tag = buf.subarray(4, 8);
          const tagStr = tag.toString("ascii");
          throw new Error(
            `Unknown X-Loader opcode 0x${opcode.toString(16).padStart(8, "0")} (${tagStr})`
          );
        }
      }
    }

    // All files transferred successfully, send JUMP command
    logInfo(`All files transferred, sending JUMP command to 0x${jumpTarget.toString(16).padStart(8, "0")}`, opts);

    const jumpBuf = Buffer.alloc(12);
    jumpBuf.writeUInt32LE(USBLOAD_CMD_JUMP, 0);
    jumpBuf.writeUInt32LE(jumpTarget >>> 0, 4);
    jumpBuf.writeUInt32LE(0, 8); // Padding

    await bulkWrite(outEp, jumpBuf, USB_TIMEOUT);
    logInfo(`Jump command sent, execution should continue at 0x${jumpTarget.toString(16).padStart(8, "0")}`, opts);

  } finally {
    // Release interface and close device
    iface.release(true, () => {
      try {
        dev.close();
      } catch {
        // Ignore close errors
      }
    });
  }
}

/**
 * Main entry point: Flash OMAP device with firmware files
 *
 * @param filesInput - Array of files to upload (first file is always at OMAP_BASE_ADDRESS)
 * @param options - Flash options including progress callbacks
 * @returns Promise that resolves when flashing completes successfully
 */
export async function flashOmap(
  filesInput: FileInput[],
  options?: FlashOptions
): Promise<void> {
  if (!filesInput.length) {
    throw new Error("At least one file is required to flash");
  }

  const vendor = options?.vendor ?? OMAP_VENDOR_ID;
  const product = options?.product ?? OMAP_PRODUCT_ID;

  // Normalize and load file data into memory
  const files: FileUpload[] = filesInput.map((f, idx) => {
    const addr =
      idx === 0
        ? OMAP_BASE_ADDRESS
        : f.addr ??
          (() => {
            throw new Error(`Missing addr for file index ${idx} ('${f.path}')`);
          })();
    return loadFile(f.path, addr);
  });

  logInfo(
    `Prepared ${files.length} file(s) for upload. First: '${files[0].basename}' @ 0x${files[0].addr.toString(16).padStart(8, "0")}`,
    options
  );

  // STAGE 1: BootROM communication (first-stage upload)
  logInfo(`Waiting for device in DFU/BootROM mode...`, options);
  const dev1 = await waitForOmapDevice(vendor, product, options);
  await transferFirstStage(dev1, files, options);

  // If only one file, we're done (no X-Loader stage needed)
  if (files.length === 1) {
    logInfo(
      `Transferred single first-stage file '${files[0].basename}', no X-Loader stage required`,
      options
    );
    return;
  }

  // Wait briefly for device to reboot as X-Loader (C code used 20ms)
  logInfo(`Waiting for device to reboot as X-Loader...`, options);
  await new Promise((resolve) => setTimeout(resolve, 20));

  // STAGE 2: X-Loader communication (additional files + jump)
  const jumpTarget =
    options?.jumpTarget ??
    // Default to second file's address if no jump target specified
    files[1].addr;

  logInfo(
    `Jump target: 0x${jumpTarget.toString(16).padStart(8, "0")} (${options?.jumpTarget ? "specified" : "default to second file"})`,
    options
  );

  const dev2 = await waitForOmapDevice(vendor, product, options);
  await transferOtherFiles(dev2, files, jumpTarget, options);

  logInfo(
    `Successfully transferred ${files.length} file(s) and issued jump command`,
    options
  );
}
