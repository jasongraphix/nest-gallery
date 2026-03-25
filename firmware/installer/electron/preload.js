const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  checkSystem: () => ipcRenderer.invoke('check-system'),
  detectDevice: () => ipcRenderer.invoke('detect-device'),
  installFirmware: (options) => ipcRenderer.invoke('install-firmware', options),
  installLibusb: () => ipcRenderer.invoke('install-libusb'),
  installWindowsDriver: () => ipcRenderer.invoke('install-windows-driver'),
  getPlatformInfo: () => ipcRenderer.invoke('get-platform-info'),
  requestSudo: () => ipcRenderer.invoke('request-sudo'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  selectFirmwareFile: (fileType) => ipcRenderer.invoke('select-firmware-file', fileType),
  selectPhotos: () => ipcRenderer.invoke('select-photos'),
  convertPhoto: (filePath) => ipcRenderer.invoke('convert-photo', filePath),
  getSamplePhotos: () => ipcRenderer.invoke('get-sample-photos'),
  checkGalleryUrl: (url) => ipcRenderer.invoke('check-gallery-url', url),
  transferPhotos: (host, photos, transferMode, galleryUrl, password) => ipcRenderer.invoke('transfer-photos-ssh', { host, photos, transferMode, galleryUrl, password }),
  testSSHConnection: (host, password) => ipcRenderer.invoke('test-ssh-connection', { host, password }),
  changePassword: (host, oldPassword, newPassword) => ipcRenderer.invoke('change-password', { host, oldPassword, newPassword }),
  onInstallationProgress: (callback) => {
    ipcRenderer.on('installation-progress', (event, progress) => callback(progress));
  },
  removeInstallationProgressListener: () => {
    ipcRenderer.removeAllListeners('installation-progress');
  },
});
