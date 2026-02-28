const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { checkSystem, installFirmware, detectDevice } = require('./usb-handler');
const { installWinUSBDriver } = require('./windows-driver');
const { convertPhoto, generateThumbnail } = require('./photo-converter');
const { repackUImage } = require('./firmware-repack');

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
    title: 'No Longer Evil Thermostat Setup',
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

    return { success: true, filePaths: result.filePaths.slice(0, 10) };
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

ipcMain.handle('repack-firmware', async (event, options) => {
  try {
    const { photoBuffers, galleryUrl } = options;

    // Resolve uImage path
    let uimagePath;
    if (app.isPackaged) {
      uimagePath = path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'firmware', 'uImage');
    } else {
      uimagePath = path.join(__dirname, '..', 'resources', 'firmware', 'uImage');
    }

    // Also check for metadata file
    const metaPath = uimagePath + '.meta.json';

    // Convert base64 photo strings back to Buffers
    let photos = null;
    if (photoBuffers && photoBuffers.length > 0) {
      photos = photoBuffers.map(b64 => Buffer.from(b64, 'base64'));
    }

    const repackedBuffer = await repackUImage(uimagePath, {
      photos,
      galleryUrl: galleryUrl !== undefined ? galleryUrl : undefined,
      metaPath: fs.existsSync(metaPath) ? metaPath : undefined,
    });

    // Write to temp file
    const tmpDir = os.tmpdir();
    const tmpPath = path.join(tmpDir, `nle-uImage-${Date.now()}`);
    fs.writeFileSync(tmpPath, repackedBuffer);

    return { success: true, uimagePath: tmpPath };
  } catch (error) {
    console.error('Firmware repack error:', error);
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
