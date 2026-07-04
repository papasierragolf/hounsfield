import { useEffect, useState } from 'react';

const BIOMETRY_LABEL = {
  faceID: 'Face ID',
  touchID: 'Touch ID',
  platform: 'biometric unlock',
  none: 'biometric unlock',
};

export default function LockScreen({ vault }) {
  const [busy, setBusy] = useState(false);

  async function tryUnlock() {
    setBusy(true);
    await vault.unlock();
    setBusy(false);
  }

  // Prompt automatically on first render so the user isn't stuck tapping —
  // but only when biometry is actually available; in the 'unsupported'
  // state (enabled previously, no longer available) it would just fail
  // immediately in a loop.
  useEffect(() => {
    if (vault.state === 'locked') tryUnlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const label = BIOMETRY_LABEL[vault.biometryType] || 'biometric unlock';

  return (
    <div className="gate">
      <div className="gate-inner">
        <div className="logo">🔒</div>
        <h1>
          Hounsfield <span className="hu">HU</span>
        </h1>
        <p className="tagline">Your studies and reports are encrypted on this device.</p>
        {vault.error && <div className="error-box">{vault.error}</div>}
        <button className="btn btn-primary" disabled={busy} onClick={tryUnlock}>
          {busy ? 'Waiting…' : vault.state === 'unsupported' ? 'Try again' : `Unlock with ${label}`}
        </button>
      </div>
    </div>
  );
}
