import React, { useState } from 'react';

function DeviceConnect({ onNext, onBack, mode, generatedPassword }) {
  const [ip, setIp] = useState(() => localStorage.getItem('nle-last-ip') || '');
  const [status, setStatus] = useState('idle'); // idle | testing | changing-password | connected | failed
  const [errorMsg, setErrorMsg] = useState('');
  const [photoCount, setPhotoCount] = useState(0);
  const [resolvedPassword, setResolvedPassword] = useState(null);

  const getStoredPassword = (ipAddr) => {
    try {
      const stored = JSON.parse(localStorage.getItem('nle-device-passwords') || '{}');
      return stored[ipAddr] || null;
    } catch { return null; }
  };

  const storePassword = (ipAddr, password) => {
    try {
      const stored = JSON.parse(localStorage.getItem('nle-device-passwords') || '{}');
      stored[ipAddr] = password;
      localStorage.setItem('nle-device-passwords', JSON.stringify(stored));
    } catch {}
  };

  const handleTest = async () => {
    const trimmed = ip.trim();
    if (!trimmed) return;

    setStatus('testing');
    setErrorMsg('');

    // Try stored password first, then fall back to bootstrap default
    const storedPassword = getStoredPassword(trimmed);
    const passwordToTry = storedPassword || 'nolongerevil';

    try {
      const result = await window.electronAPI.testSSHConnection(trimmed, passwordToTry);
      if (result.success) {
        localStorage.setItem('nle-last-ip', trimmed);

        if (mode === 'install' && generatedPassword) {
          // Change from bootstrap password to the generated unique one
          setStatus('changing-password');
          const changeResult = await window.electronAPI.changePassword(trimmed, passwordToTry, generatedPassword);
          if (changeResult.success) {
            storePassword(trimmed, generatedPassword);
            setResolvedPassword(generatedPassword);
          } else {
            // Password change failed — still let them proceed with bootstrap password
            console.warn('Password change failed:', changeResult.error);
            setResolvedPassword(passwordToTry);
          }
        } else {
          setResolvedPassword(passwordToTry);
        }

        setStatus('connected');
        setPhotoCount(result.photoCount || 0);
      } else {
        setStatus('failed');
        setErrorMsg(result.error || 'Connection failed');
      }
    } catch (err) {
      setStatus('failed');
      setErrorMsg(err.message || 'Connection failed');
    }
  };

  const handleContinue = () => {
    onNext(ip.trim(), photoCount, resolvedPassword);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      if (status === 'connected') {
        handleContinue();
      } else {
        handleTest();
      }
    }
  };

  return (
    <div className="flex items-center justify-center min-h-full p-8">
      <div className="max-w-2xl w-full space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-white">Connect to Device</h1>
          <p className="text-slate-400">
            Enter the IP address of your Nest thermostat on your WiFi network.
          </p>
        </div>

        <div className="card space-y-6">
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-300">Device IP Address</span>
              <div className="flex gap-3 mt-2">
                <input
                  type="text"
                  value={ip}
                  onChange={(e) => {
                    setIp(e.target.value);
                    if (status !== 'idle') setStatus('idle');
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="e.g. 10.0.0.1"
                  className="flex-1 px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  autoFocus
                />
                <button
                  onClick={handleTest}
                  disabled={!ip.trim() || status === 'testing' || status === 'changing-password'}
                  className={`${status === 'connected' ? 'btn-secondary' : 'btn-primary'} px-6 disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {(status === 'testing' || status === 'changing-password') ? (
                    <span className="flex items-center gap-2">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      {status === 'changing-password' ? 'Securing...' : 'Testing...'}
                    </span>
                  ) : 'Test Connection'}
                </button>
              </div>
            </label>

            {status === 'connected' && (
              <div className="flex items-center gap-2 text-green-400 text-sm">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Connected successfully!{photoCount > 0 && ` (${photoCount} photo${photoCount !== 1 ? 's' : ''} on device)`}
              </div>
            )}

            {status === 'failed' && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                <div className="flex gap-2 text-sm">
                  <svg className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-red-300">{errorMsg}</span>
                </div>
              </div>
            )}
          </div>

          <div className="bg-slate-700/30 rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-medium text-slate-300">How to find your device's IP address:</h3>
            <ul className="space-y-2 text-sm text-slate-400">
              <li className="flex gap-2">
                <span className="text-slate-500">1.</span>
                You can find it in Settings &gt; Technical Info &gt; Network on your Nest, or check your router's admin page for connected devices (look for "Nest")
              </li>
              <li className="flex gap-2">
                <span className="text-slate-500">2.</span>
                If you just flashed firmware, wait 1-2 minutes for the device to boot and join WiFi
              </li>
              <li className="flex gap-2">
                <span className="text-slate-500">3.</span>
                If the display is off, press the button or turn the ring to wake it first (WiFi sleeps when display is off)
              </li>
            </ul>
          </div>
        </div>

        <div className="flex justify-between">
          <button onClick={onBack} className="btn-secondary px-6">
            Back
          </button>
          <button
            onClick={handleContinue}
            disabled={status !== 'connected'}
            className="btn-primary px-8 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

export default DeviceConnect;
