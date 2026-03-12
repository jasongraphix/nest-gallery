import { useState, useEffect } from 'react';
import WelcomeScreen from './components/WelcomeScreen';
import ModeSelect from './components/ModeSelect';
import SystemCheck from './components/SystemCheck';
import GenerationSelect from './components/GenerationSelect';
import GallerySetup from './components/GallerySetup';
import InstallScreen from './components/InstallScreen';
import DeviceConnect from './components/DeviceConnect';
import PhotoTransfer from './components/PhotoTransfer';
import SuccessScreen from './components/SuccessScreen';
import ErrorScreen from './components/ErrorScreen';

const SCREENS = {
  WELCOME: 'welcome',
  MODE_SELECT: 'mode_select',
  SYSTEM_CHECK: 'system_check',
  GENERATION_SELECT: 'generation_select',
  GALLERY_SETUP: 'gallery_setup',
  INSTALL: 'install',
  DEVICE_CONNECT: 'device_connect',
  PHOTO_TRANSFER: 'photo_transfer',
  SUCCESS: 'success',
  ERROR: 'error',
};

function App() {
  const [currentScreen, setCurrentScreen] = useState(SCREENS.WELCOME);
  const [mode, setMode] = useState(null); // 'install' | 'update-photos'
  const [systemInfo, setSystemInfo] = useState(null);
  const [generation, setGeneration] = useState(null);
  const [customFiles, setCustomFiles] = useState(null);
  const [galleryConfig, setGalleryConfig] = useState(null);
  const [deviceIP, setDeviceIP] = useState('');
  const [devicePhotoCount, setDevicePhotoCount] = useState(0);
  const [error, setError] = useState(null);
  const [platform, setPlatform] = useState(null);

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getPlatformInfo().then(info => {
        console.log('Platform info:', info);
        setPlatform(info.platform);
      });
    }
  }, []);

  const handleNext = (screen, data) => {
    if (data) {
      if (data.error) {
        setError(data.error);
        setCurrentScreen(SCREENS.ERROR);
        return;
      }
      if (screen === SCREENS.SYSTEM_CHECK) {
        setSystemInfo(data);
      }
    }
    setCurrentScreen(screen);
  };

  const handleError = (errorMessage) => {
    setError(errorMessage);
    setCurrentScreen(SCREENS.ERROR);
  };

  const handleRetry = () => {
    setError(null);
    // Go back to the appropriate screen based on mode
    if (mode === 'install') {
      setCurrentScreen(SCREENS.INSTALL);
    } else if (mode === 'update-photos') {
      setCurrentScreen(SCREENS.DEVICE_CONNECT);
    } else {
      setCurrentScreen(SCREENS.WELCOME);
    }
  };

  const handleModeSelect = (selectedMode) => {
    setMode(selectedMode);
    if (selectedMode === 'install') {
      setCurrentScreen(SCREENS.SYSTEM_CHECK);
    } else {
      // update-photos: connect to device first so we know photo count
      setCurrentScreen(SCREENS.DEVICE_CONNECT);
    }
  };

  // Both flows go through DeviceConnect → GallerySetup → PhotoTransfer
  const gallerySetupBack = SCREENS.DEVICE_CONNECT;
  const deviceConnectBack = mode === 'install'
    ? SCREENS.INSTALL
    : SCREENS.MODE_SELECT;

  return (
    <div className="w-full h-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      {/* Only show custom title bar on macOS (Windows has native title bar) */}
      {platform === 'darwin' && (
        <div className="app-drag w-full h-12 bg-slate-900/50 backdrop-blur-sm border-b border-slate-700/50 flex items-center justify-center px-4">
          <h1 className="text-sm font-semibold text-slate-300">Nest Photo Gallery Installer</h1>
        </div>
      )}

      <div className={platform === 'darwin' ? 'h-[calc(100%-3rem)] overflow-auto' : 'h-full overflow-auto'}>
        {currentScreen === SCREENS.WELCOME && (
          <WelcomeScreen onNext={() => handleNext(SCREENS.MODE_SELECT)} />
        )}

        {currentScreen === SCREENS.MODE_SELECT && (
          <ModeSelect onSelectMode={handleModeSelect} onBack={() => setCurrentScreen(SCREENS.WELCOME)} />
        )}

        {currentScreen === SCREENS.SYSTEM_CHECK && (
          <SystemCheck
            onNext={(data) => handleNext(SCREENS.GENERATION_SELECT, data)}
            onError={handleError}
            onBack={() => setCurrentScreen(SCREENS.MODE_SELECT)}
          />
        )}

        {currentScreen === SCREENS.GENERATION_SELECT && (
          <GenerationSelect
            onNext={(config) => {
              setGeneration(config.generation);
              setCustomFiles(config.customFiles);
              handleNext(SCREENS.INSTALL);
            }}
            onBack={() => setCurrentScreen(SCREENS.SYSTEM_CHECK)}
          />
        )}

        {currentScreen === SCREENS.GALLERY_SETUP && (
          <GallerySetup
            isUpdateMode={mode === 'update-photos'}
            devicePhotoCount={devicePhotoCount}
            onNext={(config) => {
              setGalleryConfig(config);
              handleNext(SCREENS.PHOTO_TRANSFER);
            }}
            onBack={() => setCurrentScreen(gallerySetupBack)}
          />
        )}

        {currentScreen === SCREENS.INSTALL && (
          <InstallScreen
            systemInfo={systemInfo}
            generation={generation}
            customFiles={customFiles}
            onSuccess={() => handleNext(SCREENS.DEVICE_CONNECT)}
            onError={handleError}
            onBack={() => setCurrentScreen(SCREENS.GENERATION_SELECT)}
          />
        )}

        {currentScreen === SCREENS.DEVICE_CONNECT && (
          <DeviceConnect
            onNext={(ip, photoCount) => {
              setDeviceIP(ip);
              if (photoCount !== undefined) setDevicePhotoCount(photoCount);
              handleNext(SCREENS.GALLERY_SETUP);
            }}
            onBack={() => setCurrentScreen(deviceConnectBack)}
          />
        )}

        {currentScreen === SCREENS.PHOTO_TRANSFER && (
          <PhotoTransfer
            deviceIP={deviceIP}
            galleryConfig={galleryConfig}
            onSuccess={() => handleNext(SCREENS.SUCCESS)}
            onError={handleError}
            onBack={() => setCurrentScreen(SCREENS.DEVICE_CONNECT)}
          />
        )}

        {currentScreen === SCREENS.SUCCESS && (
          <SuccessScreen
            onUpdatePhotos={() => {
              setMode('update-photos');
              setCurrentScreen(SCREENS.GALLERY_SETUP);
            }}
          />
        )}

        {currentScreen === SCREENS.ERROR && (
          <ErrorScreen error={error} onRetry={handleRetry} />
        )}
      </div>
    </div>
  );
}

export default App;
