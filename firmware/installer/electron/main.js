const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { checkSystem, installFirmware, detectDevice } = require('./usb-handler');
const { installWinUSBDriver } = require('./windows-driver');
const { convertPhoto, generateThumbnail } = require('./photo-converter');
const { transferPhotosSSH, testSSHConnection, changePassword } = require('./ssh-transfer');

let mainWindow;

function createWindow() {
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  const windowConfig = {
    width: Math.min(1000, width),
    height: Math.min(900, height - 100),
    minWidth: 800,
    minHeight: 700,
    center: true,
    title: 'Nest Photo Gallery Installer',
    icon: path.join(__dirname, '../build/appicon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    backgroundColor: '#0f172a',
  };

  if (process.platform === 'darwin') {
    windowConfig.titleBarStyle = 'hidden';
    windowConfig.trafficLightPosition = { x: 15, y: 15 };
  }

  mainWindow = new BrowserWindow(windowConfig);

  mainWindow.setMenuBarVisibility(false);

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

ipcMain.handle('check-system', async () => {
  try {
    return await checkSystem();
  } catch (error) {
    console.error('System check error:', error);
    return {
      success: false,
      error: error.message,
      platform: process.platform,
      arch: process.arch
    };
  }
});

ipcMain.handle('detect-device', async () => {
  try {
    return await detectDevice();
  } catch (error) {
    console.error('Device detection error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('install-firmware', async (event, options) => {
  try {
    const generation = options?.generation || 'gen2';
    const customFiles = options?.customFiles || null;
    const result = await installFirmware((progress) => {
      mainWindow.webContents.send('installation-progress', progress);
    }, generation, customFiles);
    return result;
  } catch (error) {
    console.error('Installation error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('install-libusb', async () => {
  const { exec } = require('child_process');
  const util = require('util');
  const fs = require('fs');
  const execPromise = util.promisify(exec);

  try {
    if (process.platform !== 'darwin') {
      return { success: false, error: 'Only supported on macOS' };
    }

    // Find Homebrew installation
    const possibleBrewPaths = [
      '/opt/homebrew/bin/brew', // Apple Silicon
      '/usr/local/bin/brew',    // Intel
    ];

    let brewPath = null;
    for (const path of possibleBrewPaths) {
      if (fs.existsSync(path)) {
        brewPath = path;
        break;
      }
    }

    // If not found in standard locations, try to find via which
    if (!brewPath) {
      try {
        const { stdout } = await execPromise('which brew');
        brewPath = stdout.trim();
      } catch (e) {
        // which brew failed, brew not found
      }
    }

    // If Homebrew not found, install it
    if (!brewPath) {
      try {
        // Install Homebrew using official install script
        await execPromise('/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');

        // Check standard locations again
        for (const path of possibleBrewPaths) {
          if (fs.existsSync(path)) {
            brewPath = path;
            break;
          }
        }

        if (!brewPath) {
          return {
            success: false,
            error: 'Homebrew installation completed but could not locate brew executable. Please restart the application.'
          };
        }
      } catch (installError) {
        return {
          success: false,
          error: `Failed to install Homebrew: ${installError.message}. Please install manually from https://brew.sh`
        };
      }
    }

    // Install libusb and pkg-config using found brew path
    await execPromise(`${brewPath} install libusb pkg-config`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-platform-info', () => {
  return {
    platform: process.platform,
    arch: process.arch,
    version: process.getSystemVersion(),
  };
});

ipcMain.handle('request-sudo', async () => {
  if (process.platform === 'win32') {
    return { success: true };
  }

  return { success: true };
});

ipcMain.handle('open-external', async (event, url) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('install-windows-driver', async () => {
  try {
    if (process.platform !== 'win32') {
      return { success: true, message: 'Not on Windows, driver installation not needed' };
    }

    const { checkIsAdmin } = require('./usb-handler');
    const isAdmin = await checkIsAdmin();
    if (!isAdmin) {
      return {
        success: false,
        error: 'Administrator privileges are required to install the USB driver. Please run this application as Administrator.'
      };
    }

    const result = await installWinUSBDriver();
    return result;
  } catch (error) {
    console.error('Windows driver installation error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('select-firmware-file', async (event, fileType) => {
  try {
    const filters = [
      { name: 'Binary Files', extensions: ['bin'] }
    ];

    // For uImage, also allow files without extension
    if (fileType === 'uimage') {
      filters.unshift({ name: 'uImage', extensions: ['*'] });
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      title: `Select ${fileType} firmware file`,
      properties: ['openFile'],
      filters: filters
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    return { success: true, filePath: result.filePaths[0] };
  } catch (error) {
    console.error('File selection error:', error);
    return { success: false, error: error.message };
  }
});

// ─── Gallery Photo IPC Handlers ─────────────────────────────────────────────

ipcMain.handle('select-photos', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Photos for Gallery',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'tiff', 'bmp'] }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    return { success: true, filePaths: result.filePaths };
  } catch (error) {
    console.error('Photo selection error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('convert-photo', async (event, filePath) => {
  try {
    const [rawBuffer, thumbnail] = await Promise.all([
      convertPhoto(filePath),
      generateThumbnail(filePath),
    ]);
    return { success: true, rawBuffer: rawBuffer.toString('base64'), thumbnail };
  } catch (error) {
    console.error('Photo conversion error:', error);
    return { success: false, error: error.message };
  }
});

// ─── SSH Photo Transfer ─────────────────────────────────────────────────────

ipcMain.handle('transfer-photos-ssh', async (event, { host, photos, transferMode, galleryUrl, password }) => {
  try {
    const result = await transferPhotosSSH({
      host,
      photos,
      transferMode: transferMode || 'replace',
      galleryUrl: galleryUrl !== undefined ? galleryUrl : null,
      password: password || undefined,
      onProgress: (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('installation-progress', progress);
        }
      },
    });
    return result;
  } catch (error) {
    console.error('SSH photo transfer error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('test-ssh-connection', async (event, { host, password }) => {
  try {
    return await testSSHConnection(host, password);
  } catch (error) {
    console.error('SSH connection test error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('change-password', async (event, { host, oldPassword, newPassword }) => {
  try {
    return await changePassword(host, oldPassword, newPassword);
  } catch (error) {
    console.error('Password change error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-sample-photos', async () => {
  try {
    // Look for sample-photos in resources or relative paths
    let sampleDir;
    const appModule = require('electron').app;

    if (appModule.isPackaged) {
      sampleDir = path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'sample-photos');
    } else {
      // Development: look relative to project root
      sampleDir = path.join(__dirname, '..', '..', '..', 'sample-photos');
    }

    if (!fs.existsSync(sampleDir)) {
      return { success: false, error: 'Sample photos directory not found' };
    }

    const files = fs.readdirSync(sampleDir)
      .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
      .sort()
      .slice(0, 10);

    const thumbnails = [];
    for (const file of files) {
      const filePath = path.join(sampleDir, file);
      const thumbnail = await generateThumbnail(filePath);
      thumbnails.push({ name: file, thumbnail, path: filePath });
    }

    return { success: true, photos: thumbnails };
  } catch (error) {
    console.error('Sample photos error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('check-gallery-url', async (event, url) => {
  try {
    const http = require('http');
    const manifestUrl = url.replace(/\/$/, '') + '/gallery.txt';
    const text = await new Promise((resolve, reject) => {
      http.get(manifestUrl, { timeout: 5000 }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });
    const hasRaw = /\.raw/i.test(text);
    return { success: true, hasRaw };
  } catch {
    return { success: false };
  }
});
