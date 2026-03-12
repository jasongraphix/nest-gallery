import { useState, useEffect, useRef } from 'react';

const INSTALL_STAGES = {
  WAITING: 'waiting',
  DETECTED: 'detected',
  FLASHING_XLOAD: 'xload',
  FLASHING_UBOOT: 'uboot',
  FLASHING_KERNEL: 'kernel',
  COMPLETE: 'complete',
};

function InstallScreen({ systemInfo, generation, customFiles, onSuccess, onError, onBack }) {
  const [stage, setStage] = useState(INSTALL_STAGES.WAITING);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [isInstalling, setIsInstalling] = useState(false);
  const [deviceDetected, setDeviceDetected] = useState(false);
  const hasStartedRef = useRef(false);

  useEffect(() => {
    const handleProgress = (progressData) => {
      console.log('Progress update:', progressData);

      if (progressData.message) {
        setMessage(progressData.message);
      }

      if (progressData.percent !== undefined) {
        setProgress(progressData.percent);
      }

      if (progressData.stage === 'waiting') {
        setStage(INSTALL_STAGES.WAITING);
      } else if (progressData.stage === 'detected') {
        setDeviceDetected(true);
        setStage(INSTALL_STAGES.DETECTED);
      } else if (progressData.stage === 'xload') {
        setDeviceDetected(true);
        setStage(INSTALL_STAGES.FLASHING_XLOAD);
      } else if (progressData.stage === 'uboot') {
        setDeviceDetected(true);
        setStage(INSTALL_STAGES.FLASHING_UBOOT);
      } else if (progressData.stage === 'kernel') {
        setDeviceDetected(true);
        setStage(INSTALL_STAGES.FLASHING_KERNEL);
      } else if (progressData.stage === 'complete') {
        setDeviceDetected(true);
        setStage(INSTALL_STAGES.COMPLETE);
      }
    };

    window.electronAPI.onInstallationProgress(handleProgress);

    return () => {
      if (window.electronAPI.removeInstallationProgressListener) {
        window.electronAPI.removeInstallationProgressListener(handleProgress);
      }
    };
  }, []);

  const handleReadyToFlash = () => {
    if (!hasStartedRef.current) {
      console.log('Starting installation - omap_loader will wait for device...');
      hasStartedRef.current = true;
      startInstallation();
    }
  };

  const startInstallation = async () => {
    setIsInstalling(true);
    setProgress(30);
    setStage(INSTALL_STAGES.WAITING);
    setMessage('Installation in progress...');

    console.log('Starting firmware installation...', 'Generation:', generation);

    try {
      const result = await window.electronAPI.installFirmware({
        generation,
        customFiles
      });

      console.log('Installation result:', result);

      if (result.stdout) {
        console.log('STDOUT:', result.stdout);
      }

      if (result.stderr) {
        console.log('STDERR:', result.stderr);
      }

      if (result.success) {
        setProgress(100);
        setStage(INSTALL_STAGES.COMPLETE);
        setMessage('Firmware flashed successfully!');
      } else {
        console.error('Installation failed:', result.error);
        onError(result.error || 'Installation failed');
      }
    } catch (error) {
      console.error('Installation error:', error);
      onError(error.message || 'Installation failed');
    }
  };

  const getStageMessage = () => {
    if (isInstalling && stage === INSTALL_STAGES.WAITING) {
      return 'Installing firmware - this may take a few minutes...';
    }

    switch (stage) {
      case INSTALL_STAGES.WAITING:
        return 'Waiting for device...';
      case INSTALL_STAGES.DETECTED:
        return 'Device detected!';
      case INSTALL_STAGES.FLASHING_XLOAD:
        return 'Flashing x-load bootloader...';
      case INSTALL_STAGES.FLASHING_UBOOT:
        return 'Flashing u-boot...';
      case INSTALL_STAGES.FLASHING_KERNEL:
        return 'Flashing Linux kernel...';
      case INSTALL_STAGES.COMPLETE:
        return 'Firmware flashed successfully!';
      default:
        return message || 'Processing...';
    }
  };

  return (
    <div className="flex items-center justify-center min-h-full p-8">
      <div className="max-w-2xl w-full space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-white">Installing Firmware</h1>
          <p className="text-slate-400">
            {stage === INSTALL_STAGES.WAITING
              ? 'Follow the instructions below to connect your device'
              : 'Do not disconnect your device during installation'}
          </p>
        </div>

        {!deviceDetected && (
          <div className="card space-y-6">
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-white">Follow instructions below to put Nest in DFU mode</h2>
              {isInstalling && (
                <p className="text-sm text-yellow-400">
                  Waiting for device to enter DFU mode...
                </p>
              )}
              {customFiles && (
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                  <div className="flex gap-2">
                    <svg className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="text-xs text-slate-300">
                      <p className="font-semibold text-blue-400 mb-1">Using Custom Firmware Files:</p>
                      <ul className="space-y-0.5 list-disc list-inside">
                        {customFiles.xload && <li>{customFiles.xload.split('/').pop()}</li>}
                        {customFiles.uboot && <li>{customFiles.uboot.split('/').pop()}</li>}
                        {customFiles.uimage && <li>{customFiles.uimage.split('/').pop()}</li>}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="flex gap-4 p-4 bg-slate-700/50 rounded-lg">
                <div className="flex-shrink-0 w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center font-bold">
                  1
                </div>
                <div>
                  <h3 className="font-semibold text-white mb-1">Remove from Wall</h3>
                  <p className="text-sm text-slate-300">
                    Carefully remove the Nest from its wall mount or back plate
                  </p>
                </div>
              </div>

              <div className="flex gap-4 p-4 bg-slate-700/50 rounded-lg">
                <div className="flex-shrink-0 w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center font-bold">
                  2
                </div>
                <div>
                  <h3 className="font-semibold text-white mb-1">Connect via USB</h3>
                  <p className="text-sm text-slate-300">
                    Plug the Nest into your computer using a micro USB cable
                  </p>
                </div>
              </div>

              <div className="flex gap-4 p-4 bg-primary-600/20 border-2 border-primary-600 rounded-lg">
                <div className="flex-shrink-0 w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center font-bold">
                  3
                </div>
                <div>
                  <h3 className="font-semibold text-white mb-1">Flash the Firmware</h3>
                  <p className="text-sm text-slate-300">
                    Click the Ready to Flash button below, then press and hold the display (or back of device) for 10-15 seconds until it reboots.
                  </p>
                </div>
              </div>
            </div>

            <div className="py-6 space-y-4">
              {isInstalling && (
                <div className="flex items-center justify-center gap-3">
                  <div className="w-3 h-3 bg-primary-500 rounded-full animate-pulse"></div>
                  <span className="text-slate-300">Waiting for device connection...</span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <button
                  onClick={onBack}
                  className="btn-secondary px-6"
                >
                  Back
                </button>
                {isInstalling ? (
                  <button
                    onClick={onBack}
                    className="btn-secondary px-6"
                  >
                    Cancel
                  </button>
                ) : (
                  <button
                    onClick={handleReadyToFlash}
                    className="btn-primary px-8"
                  >
                    Ready to Flash
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {deviceDetected && (
          <div className="card space-y-6">
            <div className="flex items-center justify-center py-8">
              {stage === INSTALL_STAGES.COMPLETE ? (
                <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center">
                  <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              ) : (
                <div className="w-20 h-20 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
              )}
            </div>

            <div className="space-y-4">
              <div className="text-center">
                <h3 className="text-xl font-semibold text-white mb-2">{getStageMessage()}</h3>
                <p className="text-slate-400">{progress}% complete</p>
              </div>

              <div className="w-full bg-slate-700 rounded-full h-3 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary-500 to-primary-600 transition-all duration-500 ease-out"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>

              <div className="space-y-2 pt-4">
                <div className="flex items-center gap-3 text-sm">
                  <div className={`w-2 h-2 rounded-full ${stage === INSTALL_STAGES.DETECTED ? 'bg-primary-500 animate-pulse' : progress >= 25 ? 'bg-green-500' : 'bg-slate-600'}`}></div>
                  <span className={progress >= 25 ? 'text-white' : 'text-slate-500'}>x-load bootloader</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <div className={`w-2 h-2 rounded-full ${stage === INSTALL_STAGES.FLASHING_UBOOT ? 'bg-primary-500 animate-pulse' : progress >= 50 ? 'bg-green-500' : 'bg-slate-600'}`}></div>
                  <span className={progress >= 50 ? 'text-white' : 'text-slate-500'}>u-boot</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <div className={`w-2 h-2 rounded-full ${stage === INSTALL_STAGES.FLASHING_KERNEL ? 'bg-primary-500 animate-pulse' : progress >= 60 ? 'bg-green-500' : 'bg-slate-600'}`}></div>
                  <span className={progress >= 60 ? 'text-white' : 'text-slate-500'}>Linux kernel (uImage)</span>
                </div>
              </div>
            </div>

            {stage !== INSTALL_STAGES.COMPLETE && (
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                <div className="flex gap-3">
                  <svg className="w-6 h-6 text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm text-slate-300">
                    <strong className="text-white">Important:</strong> Keep your device connected via USB. Do not disconnect or power off during installation.
                  </p>
                </div>
              </div>
            )}

            {stage === INSTALL_STAGES.COMPLETE && (
              <div className="space-y-4">
                <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                  <div className="flex gap-3">
                    <svg className="w-6 h-6 text-green-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <p className="text-sm text-slate-300">
                      The Nest should boot with a photo within a few seconds. After a few minutes, the device will reboot to the Nest logo. Wait until it's finished booting, then disconnect the USB cable and click the button below.
                    </p>
                  </div>
                </div>
                <div className="flex justify-center">
                  <button
                    onClick={onSuccess}
                    className="btn-primary px-8"
                  >
                    Reboot Complete
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

export default InstallScreen;
