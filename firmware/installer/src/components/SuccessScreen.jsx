import React from 'react';

function SuccessScreen({ mode, devicePassword, onUpdatePhotos }) {
  const isPhotoUpdate = mode === 'update-photos';

  return (
    <div className="flex items-center justify-center min-h-full p-8">
      <div className="max-w-2xl w-full space-y-8">
        <div className="text-center space-y-4">
          <div className="flex justify-center mb-6">
            <div className="w-24 h-24 bg-green-500 rounded-full flex items-center justify-center shadow-2xl animate-pulse-slow">
              <svg className="w-14 h-14 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>

          <h1 className="text-4xl font-bold text-white">
            {isPhotoUpdate ? 'Photos Updated!' : 'Installation Complete!'}
          </h1>
          <p className="text-xl text-slate-400">
            {isPhotoUpdate
              ? 'Your new photos are on the device and the gallery has been refreshed.'
              : <>Your Nest Thermostat is not only No Longer Evil,<br /> it can also display photos now!</>}
          </p>
        </div>

        <div className="card space-y-6">
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-white">
              {isPhotoUpdate ? 'What happened' : 'Next Steps'}
            </h2>

            {isPhotoUpdate ? (
              <div className="space-y-3">
                <div className="flex gap-4 p-4 bg-slate-700/50 rounded-lg">
                  <div className="flex-shrink-0 w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center font-bold">1</div>
                  <div>
                    <h3 className="font-semibold text-white mb-1">Photos transferred</h3>
                    <p className="text-sm text-slate-300">
                      Your selected photos were converted and sent to the device over WiFi via SSH.
                    </p>
                  </div>
                </div>
                <div className="flex gap-4 p-4 bg-slate-700/50 rounded-lg">
                  <div className="flex-shrink-0 w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center font-bold">2</div>
                  <div>
                    <h3 className="font-semibold text-white mb-1">Gallery reloaded</h3>
                    <p className="text-sm text-slate-300">
                      The gallery on your Nest has been restarted and is now showing your new photos.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-4 p-4 bg-slate-700/50 rounded-lg">
                  <div className="flex-shrink-0 w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center font-bold">1</div>
                  <div>
                    <h3 className="font-semibold text-white mb-1">Wait for boot</h3>
                    <p className="text-sm text-slate-300">
                      Your thermostat will boot and start the photo gallery in 3-5 minutes. Do not disconnect power during this time. If it doesn't boot up after 5 minutes, hold the button down until the Nest logo displays.
                    </p>
                  </div>
                </div>
                <div className="flex gap-4 p-4 bg-slate-700/50 rounded-lg">
                  <div className="flex-shrink-0 w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center font-bold">2</div>
                  <div>
                    <h3 className="font-semibold text-white mb-1">Keep it powered</h3>
                    <p className="text-sm text-slate-300">
                      Once the gallery is showing on the display, you can keep it powered via the USB cable or re-attach the Nest to the base. If you use the base, you'll need a 24 VAC transformer plugged into the RC and C terminals to keep it charged.
                    </p>
                  </div>
                </div>
                <div className="flex gap-4 p-4 bg-slate-700/50 rounded-lg">
                  <div className="flex-shrink-0 w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center font-bold">3</div>
                  <div>
                    <h3 className="font-semibold text-white mb-1">Enjoy your photo frame</h3>
                    <p className="text-sm text-slate-300">
                      The gallery will auto-advance every 10 seconds. Use the ring to browse manually. The display sleeps after 5 minutes and wakes on touch.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {!isPhotoUpdate && devicePassword && (
          <div className="bg-amber-500/10 border border-amber-500/40 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Save your device password
            </div>
            <p className="text-sm text-slate-300">
              Your Nest has a unique SSH password. You'll need it to transfer photos from other computers.
            </p>
            <div className="flex items-center justify-between bg-slate-900 rounded px-4 py-2 mt-1">
              <code className="text-lg font-mono font-bold text-white tracking-widest">{devicePassword}</code>
            </div>
          </div>
        )}

        <div className="flex flex-col items-center gap-4">
          {onUpdatePhotos && (
            <button
              onClick={onUpdatePhotos}
              className="btn-primary px-8"
            >
              Transfer More Photos
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default SuccessScreen;
