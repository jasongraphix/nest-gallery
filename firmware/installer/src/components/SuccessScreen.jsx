import React from 'react';

function SuccessScreen({ onUpdatePhotos }) {
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
            Installation Complete!
          </h1>
          <p className="text-xl text-slate-400">
            Your Nest Thermostat is not only No Longer Evil,<br /> it can also display photos now!
          </p>
        </div>

        <div className="card space-y-6">

          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-white">Next Steps</h2>

            <div className="space-y-3">
              <div className="flex gap-4 p-4 bg-slate-700/50 rounded-lg">
                <div className="flex-shrink-0 w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center font-bold">
                  1
                </div>
                <div>
                  <h3 className="font-semibold text-white mb-1">Wait for boot</h3>
                  <p className="text-sm text-slate-300">
                    Your thermostat will boot and start the photo gallery in 3-5 minutes. Do not disconnect power during this time. If it doesn't boot up after 5 minutes, hold the button down until the Nest logo displays.
                  </p>
                </div>
              </div>

              <div className="flex gap-4 p-4 bg-slate-700/50 rounded-lg">
                <div className="flex-shrink-0 w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center font-bold">
                  2
                </div>
                <div>
                  <h3 className="font-semibold text-white mb-1">Keep it powered</h3>
                  <p className="text-sm text-slate-300">
                    Once the gallery is showing on the display, you can keep it powered via the USB cable or re-attach the Nest to the base. If you use the base, you'll need a 24 VAC transformer plugged into the RC and C terminals to keep it charged.
                  </p>
                </div>
              </div>

              <div className="flex gap-4 p-4 bg-slate-700/50 rounded-lg">
                <div className="flex-shrink-0 w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center font-bold">
                  3
                </div>
                <div>
                  <h3 className="font-semibold text-white mb-1">Enjoy your photo frame</h3>
                  <p className="text-sm text-slate-300">
                    The gallery will auto-advance every 10 seconds. Use the ring to browse manually. The display sleeps after 5 minutes and wakes on touch.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center gap-4">
          {onUpdatePhotos && (
            <button
              onClick={onUpdatePhotos}
              className="btn-primary px-8"
            >
              Transfer More Photos
            </button>
          )}
          <p className="text-slate-400 text-sm">
            An open-source project &mdash;{' '}
            <button
              onClick={() => {
                if (window.electronAPI && window.electronAPI.openExternal) {
                  window.electronAPI.openExternal('https://github.com/codykociemba/NoLongerEvil-Thermostat');
                }
              }}
              className="text-primary-400 hover:text-primary-300 transition-colors underline"
            >
              View on GitHub
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

export default SuccessScreen;
