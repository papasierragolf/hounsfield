import { useState } from 'react';

/**
 * Film-style image viewer with brightness/contrast sliders — the digital
 * cousin of window/level on a PACS workstation. Pure CSS filters; the stored
 * image is never modified.
 */
export default function Viewer({ src, modality, region }) {
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);

  return (
    <div>
      <div className="viewer">
        <span className="corner tl">{modality || 'IMG'}</span>
        <span className="corner br">{region || 'HOUNSFIELD'}</span>
        <img
          src={src}
          alt="Medical study"
          style={{ filter: `brightness(${brightness}%) contrast(${contrast}%)` }}
        />
      </div>
      <div className="wl-controls">
        <label>
          Level {brightness}%
          <input
            type="range"
            min="40"
            max="200"
            value={brightness}
            onChange={(e) => setBrightness(+e.target.value)}
          />
        </label>
        <label>
          Window {contrast}%
          <input
            type="range"
            min="40"
            max="220"
            value={contrast}
            onChange={(e) => setContrast(+e.target.value)}
          />
        </label>
      </div>
    </div>
  );
}
