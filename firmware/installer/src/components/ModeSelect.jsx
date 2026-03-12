import React from 'react';

function ModeSelect({ onSelectMode, onBack }) {
  return (
    <div className="flex items-center justify-center min-h-full p-8">
      <div className="max-w-2xl w-full space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-white">What would you like to do?</h1>
          <p className="text-slate-400">
            Choose whether to install firmware or update photos on an already-flashed device.
          </p>
        </div>

        <div className="space-y-4">
          <button
            onClick={() => onSelectMode('install')}
            className="w-full card p-6 text-left transition-all hover:ring-2 hover:ring-primary-500 hover:bg-slate-700/50"
          >
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-12 h-12 bg-primary-600 rounded-xl flex items-center justify-center">
                <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-white">Install firmware + photos</h3>
                <p className="text-sm text-slate-400 mt-1">
                  First-time setup. Flashes the gallery firmware via USB, then transfers photos over WiFi.
                </p>
              </div>
            </div>
          </button>

          <button
            onClick={() => onSelectMode('update-photos')}
            className="w-full card p-6 text-left transition-all hover:ring-2 hover:ring-primary-500 hover:bg-slate-700/50"
          >
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-12 h-12 bg-emerald-600 rounded-xl flex items-center justify-center">
                <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-white">Update photos</h3>
                <p className="text-sm text-slate-400 mt-1">
                  Transfer or replace photos on an already-flashed device over WiFi. No USB cable needed.
                </p>
              </div>
            </div>
          </button>
        </div>

        <div className="flex justify-start">
          <button onClick={onBack} className="btn-secondary px-6">
            Back
          </button>
        </div>
      </div>
    </div>
  );
}

export default ModeSelect;
