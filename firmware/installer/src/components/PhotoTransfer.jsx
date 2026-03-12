import { useState, useEffect, useRef } from 'react';

const STAGES = {
  CONVERTING: 'converting',
  SSH_CONNECTING: 'ssh-connecting',
  SSH_PREPARING: 'ssh-preparing',
  SSH_TRANSFERRING: 'ssh-transferring',
  SSH_VERIFYING: 'ssh-verifying',
  SSH_COMPLETE: 'ssh-complete',
};

function PhotoTransfer({ deviceIP, galleryConfig, onSuccess, onError, onBack }) {
  const [stage, setStage] = useState(STAGES.CONVERTING);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('Preparing photos...');
  const hasStarted = useRef(false);

  useEffect(() => {
    const handleProgress = (progressData) => {
      if (progressData.message) setMessage(progressData.message);
      if (progressData.percent !== undefined) setProgress(progressData.percent);
      if (progressData.stage && STAGES[progressData.stage.toUpperCase().replace(/-/g, '_')]) {
        setStage(progressData.stage);
      } else if (progressData.stage) {
        setStage(progressData.stage);
      }
    };

    window.electronAPI.onInstallationProgress(handleProgress);
    return () => {
      if (window.electronAPI.removeInstallationProgressListener) {
        window.electronAPI.removeInstallationProgressListener();
      }
    };
  }, []);

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;
    startTransfer();
  }, []);

  const startTransfer = async () => {
    try {
      let photos = galleryConfig.photosToTransfer || [];

      // Convert sample photos if needed
      if (galleryConfig.photoSource === 'sample') {
        setStage(STAGES.CONVERTING);
        setMessage('Converting photos...');
        const converted = [];
        for (let i = 0; i < photos.length; i++) {
          setProgress(Math.floor((i / photos.length) * 20));
          setMessage(`Converting photo ${i + 1} of ${photos.length}...`);
          const result = await window.electronAPI.convertPhoto(photos[i].path);
          if (result.success) {
            converted.push({
              name: photos[i].name,
              data: result.rawBuffer,
            });
          }
        }
        photos = converted;
      }

      if (photos.length === 0) {
        onError('No photos to transfer');
        return;
      }

      // Transfer via SSH
      const result = await window.electronAPI.transferPhotos(deviceIP, photos, galleryConfig.transferMode || 'replace');

      if (result.success) {
        setStage(STAGES.SSH_COMPLETE);
        setProgress(100);
        setMessage(`Successfully transferred ${photos.length} photos!`);
        setTimeout(() => onSuccess(), 2000);
      } else {
        onError(result.error || 'Photo transfer failed');
      }
    } catch (error) {
      onError(error.message || 'Photo transfer failed');
    }
  };

  const isComplete = stage === STAGES.SSH_COMPLETE || stage === 'ssh-complete';

  const getStageLabel = () => {
    switch (stage) {
      case STAGES.CONVERTING:
      case 'converting':
        return 'Converting photos...';
      case 'ssh-connecting':
        return 'Connecting to device...';
      case 'ssh-preparing':
        return 'Preparing device storage...';
      case 'ssh-transferring':
        return message || 'Transferring photos...';
      case 'ssh-verifying':
        return 'Verifying transfer...';
      case 'ssh-complete':
        return 'Transfer complete!';
      default:
        return message || 'Processing...';
    }
  };

  return (
    <div className="flex items-center justify-center min-h-full p-8">
      <div className="max-w-2xl w-full space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-white">Transferring Photos</h1>
          <p className="text-slate-400">
            Formatting and sending the selected photos to your device
          </p>
        </div>

        <div className="card space-y-6">
          <div className="flex items-center justify-center py-8">
            {isComplete ? (
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
              <h3 className="text-xl font-semibold text-white mb-2">{getStageLabel()}</h3>
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
                <div className={`w-2 h-2 rounded-full ${stage === 'ssh-connecting' ? 'bg-primary-500 animate-pulse' : progress >= 5 ? 'bg-green-500' : 'bg-slate-600'}`}></div>
                <span className={progress >= 5 ? 'text-white' : 'text-slate-500'}>Connect to device</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <div className={`w-2 h-2 rounded-full ${stage === 'ssh-preparing' ? 'bg-primary-500 animate-pulse' : progress >= 10 ? 'bg-green-500' : 'bg-slate-600'}`}></div>
                <span className={progress >= 10 ? 'text-white' : 'text-slate-500'}>Prepare storage</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <div className={`w-2 h-2 rounded-full ${stage === 'ssh-transferring' ? 'bg-primary-500 animate-pulse' : progress >= 90 ? 'bg-green-500' : 'bg-slate-600'}`}></div>
                <span className={progress >= 90 ? 'text-white' : 'text-slate-500'}>Transfer photos</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <div className={`w-2 h-2 rounded-full ${stage === 'ssh-verifying' ? 'bg-primary-500 animate-pulse' : progress >= 95 ? 'bg-green-500' : 'bg-slate-600'}`}></div>
                <span className={progress >= 95 ? 'text-white' : 'text-slate-500'}>Verify & restart gallery</span>
              </div>
            </div>
          </div>

          {!isComplete && (
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
              <div className="flex gap-3">
                <svg className="w-6 h-6 text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-slate-300">
                  <strong className="text-white">Keep your device awake.</strong> If the display turns off, press the button or turn the ring to wake it. WiFi is disabled when the display sleeps.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default PhotoTransfer;
