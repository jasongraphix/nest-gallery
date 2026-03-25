const { Client } = require('ssh2');

const SSH_USER = 'root';
const SSH_BOOTSTRAP_PASSWORD = 'nolongerevil';
const SSH_PORT = 22;
const PHOTO_DIR = '/media/scratch/nle-photos';
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sshConnect(host, password = SSH_BOOTSTRAP_PASSWORD) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => resolve(conn));
    conn.on('error', (err) => reject(err));
    conn.connect({
      host,
      port: SSH_PORT,
      username: SSH_USER,
      password,
      readyTimeout: 20000,
      keepaliveInterval: 5000,
      keepaliveCountMax: 6,
      algorithms: {
        kex: [
          'ecdh-sha2-nistp256',
          'ecdh-sha2-nistp384',
          'ecdh-sha2-nistp521',
          'diffie-hellman-group14-sha256',
          'diffie-hellman-group14-sha1',
          'diffie-hellman-group1-sha1',
        ],
        serverHostKey: [
          'ecdsa-sha2-nistp521',
          'ecdsa-sha2-nistp384',
          'ecdsa-sha2-nistp256',
          'ssh-rsa',
          'ssh-dss',
        ],
        cipher: [
          'aes128-ctr',
          'aes256-ctr',
          'aes128-cbc',
          'aes256-cbc',
          '3des-cbc',
        ],
        hmac: [
          'hmac-sha1',
          'hmac-sha2-256',
        ],
      },
    });
  });
}

function sshExec(conn, command) {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      let resolved = false;
      const done = (code) => {
        if (resolved) return;
        resolved = true;
        resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
      };
      stream.on('data', (data) => { stdout += data.toString(); });
      stream.stderr.on('data', (data) => { stderr += data.toString(); });
      stream.on('close', (code) => done(code));
      stream.on('exit', (code) => done(code));
    });
  });
}

/**
 * Write a file to the device via exec channel: cat > path
 * Uses chunked writes with backpressure. Resolves on exit event.
 */
function sshWriteFile(conn, remotePath, buffer) {
  return new Promise((resolve, reject) => {
    conn.exec(`cat > "${remotePath}"`, (err, stream) => {
      if (err) return reject(err);

      let done = false;
      const finish = (error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };

      // Safety timeout — 30s is plenty for 400KB over WiFi
      const timer = setTimeout(() => finish(), 30000);

      stream.on('exit', (code) => {
        finish(code !== 0 ? new Error(`Write to ${remotePath} exited with code ${code}`) : null);
      });
      stream.on('close', () => finish());
      stream.on('error', (e) => finish(e));

      // Write in chunks with backpressure handling
      const CHUNK_SIZE = 32768;
      let offset = 0;

      function writeChunk() {
        while (offset < buffer.length) {
          const end = Math.min(offset + CHUNK_SIZE, buffer.length);
          const chunk = buffer.slice(offset, end);
          offset = end;

          if (offset >= buffer.length) {
            stream.end(chunk);
            return;
          }

          const canContinue = stream.write(chunk);
          if (!canContinue) {
            stream.once('drain', writeChunk);
            return;
          }
        }
      }

      writeChunk();
    });
  });
}

/**
 * Transfer photos to device over SSH.
 * Freezes nlclient to keep WiFi alive during transfer.
 */
async function transferPhotosSSH({ host, photos, transferMode, galleryUrl, password, onProgress }) {
  const progress = (stage, percent, message) => {
    if (onProgress) onProgress({ stage, percent, message });
  };

  // Connect with retries
  progress('ssh-connecting', 0, 'Connecting to device...');
  let conn;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      conn = await sshConnect(host, password);
      break;
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        throw new Error(`Could not connect to ${host}: ${err.message}`);
      }
      progress('ssh-connecting', 0, `Connection attempt ${attempt} failed, retrying in ${RETRY_DELAY_MS / 1000}s...`);
      await sleep(RETRY_DELAY_MS);
    }
  }

  const total = photos.length;

  try {
    // Freeze nlclient + heartbeat to keep WiFi alive during transfer.
    // Without this, nlscpm puts WiFi into WoWLAN within seconds of display sleep.
    progress('ssh-preparing', 3, 'Holding WiFi connection...');
    await sshExec(conn, 'kill -STOP $(pidof nlheartbeatd) 2>/dev/null; kill -STOP $(pidof nlclient) 2>/dev/null; echo 0 > /sys/class/graphics/fb0/blank; echo 120 > /sys/class/backlight/3-0036/brightness');

    // Ensure photo directory exists
    progress('ssh-preparing', 5, 'Preparing device storage...');
    await sshExec(conn, `mkdir -p ${PHOTO_DIR}`);

    // Write gallery URL config — always write so clearing the URL takes effect
    if (galleryUrl !== null && galleryUrl !== undefined) {
      const configContent = `GALLERY_URL="${galleryUrl}"\n`;
      await sshWriteFile(conn, '/etc/nle-gallery.conf', Buffer.from(configContent, 'utf-8'));
    }

    // In add mode, find the next available number. In replace mode, write to a
    // staging dir first so existing photos are preserved if transfer fails.
    let startIndex = 0;
    const isReplace = transferMode !== 'add';
    const targetDir = isReplace ? `${PHOTO_DIR}/.new` : PHOTO_DIR;

    if (transferMode === 'add') {
      const existing = await sshExec(conn, `ls ${PHOTO_DIR}/*.raw 2>/dev/null | wc -l`);
      startIndex = parseInt(existing.stdout, 10) || 0;
    } else {
      // Stage new photos in a temp dir, swap after verification
      await sshExec(conn, `rm -rf ${targetDir} && mkdir -p ${targetDir}`);
    }

    // Transfer each photo via individual exec channels
    for (let i = 0; i < total; i++) {
      const photo = photos[i];
      const fileNum = String(startIndex + i + 1).padStart(2, '0');
      const remotePath = `${targetDir}/${fileNum}.raw`;
      const buffer = Buffer.from(photo.data, 'base64');

      const percent = 10 + Math.floor((i / total) * 80);
      progress('ssh-transferring', percent, `Transferring photo ${i + 1} of ${total}...`);

      await sshWriteFile(conn, remotePath, buffer);

      // Flush JFFS2 write cache to NAND every 5 photos to prevent
      // memory pressure from triggering monit reboot (41 MB limit)
      if ((i + 1) % 5 === 0) {
        await sshExec(conn, 'sync');
      }
    }

    // Final sync before verification
    await sshExec(conn, 'sync');

    // Verify
    progress('ssh-verifying', 92, 'Verifying transfer...');
    const result = await sshExec(conn, `ls ${targetDir}/*.raw 2>/dev/null | wc -l`);
    const count = parseInt(result.stdout, 10) || 0;

    if (count < total) {
      if (isReplace) await sshExec(conn, `rm -rf ${targetDir}`);
      throw new Error(`Verification failed: expected ${total} photos, found ${count}`);
    }

    // In replace mode, swap staging dir into place
    if (isReplace) {
      await sshExec(conn, `rm -f ${PHOTO_DIR}/*.raw && mv ${targetDir}/*.raw ${PHOTO_DIR}/ && rm -rf ${targetDir}`);
    }

    // Restart gallery so it picks up new photos.
    // Kill any existing gallery/start-script processes, remove the singleton lock,
    // then launch the gallery binary directly (nle-gallery-start has a 30s boot
    // delay we don't need here). nlclient is already frozen from our transfer setup.
    progress('ssh-verifying', 95, 'Restarting gallery...');
    await sshExec(conn, 'killall nle-gallery nle-gallery-sta 2>/dev/null; rm -f /tmp/nle-gallery.lock; sleep 1; /usr/bin/nle-gallery --takeover /media/scratch/nle-photos /dev/input/event1 &');

    progress('ssh-complete', 100, `Successfully transferred ${total} photos!`);
    return { success: true, count };
  } finally {
    // Don't release nlclient here — nle-gallery-start handles the
    // freeze/release cycle. The gallery needs nlclient frozen to display.
    try { conn.end(); } catch (_) {}
  }
}

/**
 * Test SSH connection to device.
 */
async function changePassword(host, oldPassword, newPassword) {
  try {
    const conn = await sshConnect(host, oldPassword);
    await sshExec(conn, `printf '%s\n%s\n' '${newPassword}' '${newPassword}' | passwd root`);
    conn.end();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function testSSHConnection(host, password) {
  try {
    const conn = await sshConnect(host, password);
    const result = await sshExec(conn, 'echo ok');
    if (result.stdout !== 'ok') {
      conn.end();
      return { success: false, error: 'Unexpected response from device' };
    }
    // Count existing photos on device
    const countResult = await sshExec(conn, 'ls /media/scratch/nle-photos/*.raw 2>/dev/null | wc -l');
    const photoCount = parseInt(countResult.stdout, 10) || 0;
    conn.end();
    return { success: true, photoCount };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { transferPhotosSSH, testSSHConnection, changePassword };
