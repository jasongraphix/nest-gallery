import React, { useState, useEffect } from 'react';

const MAX_PHOTOS = 10;

function GallerySetup({ onNext, onBack }) {
  const [photoSource, setPhotoSource] = useState('sample'); // 'sample' or 'custom'
  const [samplePhotos, setSamplePhotos] = useState([]);
  const [customPhotos, setCustomPhotos] = useState([]); // { path, thumbnail, rawBuffer (base64), converting }
  const [galleryUrl, setGalleryUrl] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [repacking, setRepacking] = useState(false);
  const [error, setError] = useState(null);

  // Load sample photo thumbnails on mount
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.getSamplePhotos) {
      window.electronAPI.getSamplePhotos().then(result => {
        if (result.success) {
          setSamplePhotos(result.photos);
        }
      });
    }
  }, []);

  const handleSelectPhotos = async () => {
    if (!window.electronAPI) return;

    const result = await window.electronAPI.selectPhotos();
    if (!result.success || result.canceled) return;

    const remaining = MAX_PHOTOS - customPhotos.length;
    const newPaths = result.filePaths.slice(0, remaining);

    // Add placeholders immediately (with converting state)
    const placeholders = newPaths.map(p => ({
      path: p,
      name: p.split('/').pop().split('\\').pop(),
      thumbnail: null,
      rawBuffer: null,
      converting: true,
    }));
    setCustomPhotos(prev => [...prev, ...placeholders]);

    // Convert each photo
    for (const filePath of newPaths) {
      try {
        const convResult = await window.electronAPI.convertPhoto(filePath);
        if (convResult.success) {
          setCustomPhotos(prev => prev.map(p =>
            p.path === filePath
              ? { ...p, thumbnail: convResult.thumbnail, rawBuffer: convResult.rawBuffer, converting: false }
              : p
          ));
        } else {
          setCustomPhotos(prev => prev.map(p =>
            p.path === filePath
              ? { ...p, converting: false, error: convResult.error }
              : p
          ));
        }
      } catch (err) {
        setCustomPhotos(prev => prev.map(p =>
          p.path === filePath
            ? { ...p, converting: false, error: err.message }
            : p
        ));
      }
    }
  };

  const handleRemovePhoto = (index) => {
    setCustomPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const handleContinue = async () => {
    setError(null);

    const hasCustomPhotos = photoSource === 'custom' && customPhotos.length > 0;
    const hasGalleryUrl = galleryUrl.trim().length > 0;
    const needsRepack = hasCustomPhotos || hasGalleryUrl;

    if (!needsRepack) {
      // Use stock uImage unchanged
      onNext({ photoSource, customUImagePath: null, galleryUrl: '' });
      return;
    }

    // Need to repack firmware
    setRepacking(true);
    try {
      const photoBuffers = hasCustomPhotos
        ? customPhotos.filter(p => p.rawBuffer).map(p => p.rawBuffer)
        : null;

      const result = await window.electronAPI.repackFirmware({
        photoBuffers,
        galleryUrl: galleryUrl.trim(),
      });

      if (result.success) {
        onNext({
          photoSource,
          customUImagePath: result.uimagePath,
          galleryUrl: galleryUrl.trim(),
        });
      } else {
        setError(result.error || 'Failed to prepare firmware');
      }
    } catch (err) {
      setError(err.message || 'Failed to prepare firmware');
    } finally {
      setRepacking(false);
    }
  };

  const convertedCount = customPhotos.filter(p => p.rawBuffer && !p.converting).length;
  const convertingCount = customPhotos.filter(p => p.converting).length;
  const canContinue = photoSource === 'sample' || (photoSource === 'custom' && convertedCount > 0 && convertingCount === 0);

  return (
    <div className="flex items-center justify-center min-h-full p-8">
      <div className="max-w-3xl w-full space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-white">Photo Gallery Setup</h1>
          <p className="text-slate-400">
            Your Nest thermostat will display a rotating photo gallery.
          </p>
        </div>

        {/* Photo Source Selection */}
        <div className="space-y-4">
          <button
            onClick={() => setPhotoSource('sample')}
            className={`w-full card p-4 text-left transition-all ${
              photoSource === 'sample'
                ? 'ring-2 ring-primary-500 bg-slate-700/50'
                : 'hover:bg-slate-700/30'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                photoSource === 'sample' ? 'border-primary-500' : 'border-slate-500'
              }`}>
                {photoSource === 'sample' && (
                  <div className="w-2.5 h-2.5 rounded-full bg-primary-500" />
                )}
              </div>
              <div>
                <h3 className="font-semibold text-white">Use sample photos</h3>
                <p className="text-sm text-slate-400">{MAX_PHOTOS} included photos</p>
              </div>
            </div>
          </button>

          <button
            onClick={() => setPhotoSource('custom')}
            className={`w-full card p-4 text-left transition-all ${
              photoSource === 'custom'
                ? 'ring-2 ring-primary-500 bg-slate-700/50'
                : 'hover:bg-slate-700/30'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                photoSource === 'custom' ? 'border-primary-500' : 'border-slate-500'
              }`}>
                {photoSource === 'custom' && (
                  <div className="w-2.5 h-2.5 rounded-full bg-primary-500" />
                )}
              </div>
              <div>
                <h3 className="font-semibold text-white">Choose my own photos</h3>
                <p className="text-sm text-slate-400">Up to {MAX_PHOTOS} photos (JPG, PNG, WebP)</p>
              </div>
            </div>
          </button>
        </div>

        {/* Sample Photo Grid */}
        {photoSource === 'sample' && samplePhotos.length > 0 && (
          <div className="card p-4">
            <div className="grid grid-cols-5 gap-2">
              {samplePhotos.map((photo, i) => (
                <div key={i} className="aspect-square rounded-lg overflow-hidden bg-slate-700">
                  <img
                    src={photo.thumbnail}
                    alt={photo.name}
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Custom Photo Selection */}
        {photoSource === 'custom' && (
          <div className="card p-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">
                {customPhotos.length} of {MAX_PHOTOS} photos
              </span>
              {customPhotos.length < MAX_PHOTOS && (
                <button
                  onClick={handleSelectPhotos}
                  className="btn-primary text-sm px-4 py-2"
                >
                  Select Photos
                </button>
              )}
            </div>

            {customPhotos.length > 0 && (
              <div className="grid grid-cols-5 gap-2">
                {customPhotos.map((photo, i) => (
                  <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-slate-700 group">
                    {photo.converting ? (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg className="w-6 h-6 text-slate-400 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      </div>
                    ) : photo.error ? (
                      <div className="w-full h-full flex items-center justify-center p-1">
                        <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                    ) : (
                      <img
                        src={photo.thumbnail}
                        alt={photo.name}
                        className="w-full h-full object-cover"
                      />
                    )}
                    <button
                      onClick={() => handleRemovePhoto(i)}
                      className="absolute top-1 right-1 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {customPhotos.length === 0 && (
              <div className="text-center py-8 text-slate-500">
                <p>No photos selected yet</p>
              </div>
            )}

            {customPhotos.length >= MAX_PHOTOS && (
              <p className="text-xs text-yellow-400">Maximum of {MAX_PHOTOS} photos reached</p>
            )}
          </div>
        )}

        {/* Advanced: Gallery URL */}
        <div className="card overflow-hidden">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full p-4 flex items-center justify-between text-left hover:bg-slate-700/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <svg
                className={`w-4 h-4 text-slate-400 transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span className="text-sm font-medium text-slate-300">Advanced: Web Gallery URL</span>
            </div>
          </button>

          {showAdvanced && (
            <div className="px-4 pb-4 space-y-2">
              <input
                type="url"
                value={galleryUrl}
                onChange={(e) => setGalleryUrl(e.target.value)}
                placeholder="http://your-server.com/gallery"
                className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
              <p className="text-xs text-slate-500">
                Optional. The thermostat can fetch additional photos from an HTTP server after connecting to WiFi. Must serve a gallery.txt manifest.
              </p>
            </div>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
            <div className="flex gap-3">
              <svg className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-red-300">{error}</p>
            </div>
          </div>
        )}

        {/* Repacking Spinner */}
        {repacking && (
          <div className="flex items-center justify-center gap-3 py-2">
            <svg className="w-5 h-5 text-primary-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-slate-300 text-sm">Preparing firmware...</span>
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between">
          <button onClick={onBack} className="btn-secondary px-6">
            Back
          </button>
          <button
            onClick={handleContinue}
            disabled={!canContinue || repacking}
            className="btn-primary px-8 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

export default GallerySetup;
