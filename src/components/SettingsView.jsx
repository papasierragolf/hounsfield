import { useRef, useState } from 'react';
import { useEngine } from '../hooks/useEngine.js';
import { useVault } from '../hooks/useVault.js';
import { MODEL_PRESETS, normalizeModelId } from '../inference/engine.js';
import { exportBackup, restoreBackup } from '../lib/backup.js';
import { isNative } from '../lib/platform.js';

const BIOMETRY_LABEL = { faceID: 'Face ID', touchID: 'Touch ID', platform: 'biometric unlock' };

export default function SettingsView({ modelId, onModelIdChange, onRestored, theme, onThemeChange, hfToken, onHfTokenChange }) {
  const engine = useEngine();
  const vault = useVault();
  const restoreRef = useRef(null);
  const [customId, setCustomId] = useState('');
  const [customWarning, setCustomWarning] = useState(null);
  const [backupMsg, setBackupMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [vaultBusy, setVaultBusy] = useState(false);
  const [vaultMsg, setVaultMsg] = useState(null);

  const biometryLabel = BIOMETRY_LABEL[vault.biometryType] || 'biometric unlock';
  // Noun used in the "Enable … lock" button — avoids the awkward
  // "biometric unlock lock" reading when the generic label is in play.
  const lockNoun =
    vault.biometryType === 'faceID' ? 'Face ID' : vault.biometryType === 'touchID' ? 'Touch ID' : 'biometric';
  const vaultOn = vault.state === 'unlocked' || vault.state === 'locked' || vault.state === 'unsupported';

  async function handleVaultToggle() {
    setVaultBusy(true);
    setVaultMsg(null);
    try {
      if (vaultOn) {
        await vault.disable();
        setVaultMsg('Biometric lock disabled. Your data has been decrypted back to normal storage.');
      } else {
        await vault.enable();
        setVaultMsg(`Biometric lock enabled with ${biometryLabel}. Existing studies were encrypted.`);
      }
    } catch (err) {
      setVaultMsg(String(err.message || err));
    } finally {
      setVaultBusy(false);
    }
  }

  const pct = Math.round(engine.overallProgress() * 100);
  const files = Object.values(engine.progress);
  const totalBytes = files.reduce((a, f) => a + f.total, 0);
  const loadedBytes = files.reduce((a, f) => a + f.loaded, 0);
  const downloadedMB =
    totalBytes > 1e6
      ? `${Math.round(loadedBytes / 1e6).toLocaleString()} / ${Math.round(totalBytes / 1e6).toLocaleString()} MB`
      : null;
  const isPreset = MODEL_PRESETS.some((p) => p.id === modelId);
  const selectedPreset = MODEL_PRESETS.find((p) => p.id === modelId);
  const needsToken = selectedPreset?.gated && !hfToken;

  async function handleExport() {
    setBusy(true);
    setBackupMsg(null);
    try {
      const outcome = await exportBackup();
      if (outcome === 'shared') setBackupMsg('Backup handed to the share sheet — choose iCloud Drive, Google Drive, or Files.');
      else if (outcome === 'downloaded') setBackupMsg('Backup downloaded. Move it to iCloud Drive or Google Drive to keep it safe.');
    } catch (err) {
      setBackupMsg(`Export failed: ${err.message || err}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleRestore(file) {
    setBusy(true);
    setBackupMsg(null);
    try {
      const { studies, images } = await restoreBackup(file);
      setBackupMsg(`Restored ${studies} studies and ${images} images.`);
      onRestored();
    } catch (err) {
      setBackupMsg(`Restore failed: ${err.message || err}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>Appearance</h2>
        <div className="seg" style={{ marginBottom: 0 }}>
          {[
            ['light', 'Light'],
            ['dark', 'Dark'],
            ['system', 'System'],
          ].map(([val, label]) => (
            <button key={val} className={theme === val ? 'active' : ''} onClick={() => onThemeChange(val)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Security</h2>
        {vault.biometryType === 'none' && vault.state !== 'unsupported' ? (
          <p className="hint">No biometric authentication is available on this device.</p>
        ) : (
          <>
            <p className="hint" style={{ marginBottom: 12 }}>
              {vaultOn
                ? `Studies and reports are encrypted at rest and require ${biometryLabel} to open the app.`
                : `Require ${biometryLabel} to open the app, and encrypt all studies, images, and reports on this device.`}
            </p>
            {vault.state === 'unsupported' && (
              <div className="notice" style={{ marginBottom: 12 }}>
                Biometric lock was enabled, but {biometryLabel} is no longer available on this
                device. Your data stays encrypted until it's available again.
              </div>
            )}
            <button className="btn btn-primary" disabled={vaultBusy} onClick={handleVaultToggle}>
              {vaultBusy
                ? 'Working…'
                : vaultOn
                  ? `Disable ${lockNoun} lock`
                  : `Enable ${lockNoun} lock`}
            </button>
            {vault.state === 'unlocked' && (
              <button
                className="btn btn-secondary"
                style={{ marginLeft: 8 }}
                onClick={() => vault.lock()}
              >
                Lock now
              </button>
            )}
            {vaultMsg && <p className="hint" style={{ marginTop: 10 }}>{vaultMsg}</p>}
          </>
        )}
      </div>

      <div className="card">
        <h2>Inference model</h2>
        <p className="hint" style={{ marginBottom: 12 }}>
          {isNative()
            ? 'Runs natively on the Apple GPU via MLX. The model downloads once into the app, then everything works with zero connectivity — airplane mode included.'
            : 'Runs fully on this device via WebGPU (or WASM fallback). Weights are downloaded once and cached; afterwards the app works offline.'}
        </p>

        {MODEL_PRESETS.map((p) => (
          <label
            key={p.id}
            style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--line)', cursor: 'pointer' }}
          >
            <input
              type="radio"
              name="model"
              checked={modelId === p.id}
              onChange={() => onModelIdChange(p.id)}
            />
            <span>
              <strong style={{ fontSize: 14.5 }}>{p.label}</strong>
              {p.gated && (
                <span
                  style={{
                    display: 'inline-block',
                    marginLeft: 8,
                    fontSize: 10,
                    padding: '2px 7px',
                    borderRadius: 20,
                    background: 'var(--accent-dim)',
                    color: 'var(--accent)',
                    fontFamily: 'var(--mono)',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    verticalAlign: 'middle',
                  }}
                >
                  Gated
                </span>
              )}
              {p.needsConversion && (
                <span
                  style={{
                    display: 'inline-block',
                    marginLeft: 6,
                    fontSize: 10,
                    padding: '2px 7px',
                    borderRadius: 20,
                    background: 'color-mix(in srgb, var(--warn) 18%, transparent)',
                    color: 'var(--warn)',
                    fontFamily: 'var(--mono)',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    verticalAlign: 'middle',
                  }}
                >
                  Needs conversion
                </span>
              )}
              <br />
              <span className="hint">{p.note}</span>
              <br />
              <a
                href={`https://huggingface.co/${p.id}`}
                target="_blank"
                rel="noreferrer"
                className="hint"
                style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}
              >
                {p.id} ↗
              </a>
            </span>
          </label>
        ))}

        <label className="field" style={{ marginTop: 14 }}>
          <span>Custom Hugging Face model ID</span>
          <input
            type="text"
            placeholder="org/model-name-ONNX"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck="false"
            value={isPreset ? customId : customId || modelId}
            onChange={(e) => {
              setCustomId(e.target.value);
              setCustomWarning(null);
            }}
            onBlur={() => {
              if (!customId.trim()) return;
              const { id, warning } = normalizeModelId(customId);
              setCustomId(id);
              setCustomWarning(warning);
              if (id) onModelIdChange(id);
            }}
          />
          <span className="hint" style={{ display: 'block', marginTop: 6 }}>
            {isNative() ? (
              <>
                Format: <code style={{ fontFamily: 'var(--mono)' }}>org/repo</code>. This device
                runs MLX weights — look for{' '}
                <code style={{ fontFamily: 'var(--mono)' }}>mlx-community/…</code> repos.
              </>
            ) : (
              <>
                Format: <code style={{ fontFamily: 'var(--mono)' }}>org/repo</code>. The app runs
                ONNX weights only — GGUF/safetensors won’t load. Look for repos with an
                <code style={{ fontFamily: 'var(--mono)' }}>-ONNX</code> suffix.
              </>
            )}
          </span>
        </label>
        {customWarning && <div className="error-box" style={{ marginTop: -6, marginBottom: 14 }}>{customWarning}</div>}

        {!isNative() && (
          <label className="field">
            <span>HF Access Token (for gated models)</span>
            <input
              type="password"
              placeholder="hf_…"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck="false"
              value={hfToken}
              onChange={(e) => onHfTokenChange(e.target.value)}
            />
            <span className="hint" style={{ display: 'block', marginTop: 6 }}>
              MedGemma is gated by Google. To use it: 1) open the model page above and click
              “Agree and access repository”, 2) create a <em>Read</em> token at{' '}
              <a
                href="https://huggingface.co/settings/tokens"
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--accent)' }}
              >
                huggingface.co/settings/tokens
              </a>
              , 3) paste it here. The token is stored only on this device.
            </span>
          </label>
        )}

        {needsToken && (
          <div className="notice" style={{ marginTop: 6 }}>
            This model is gated — paste an HF access token above or pick the public Gemma 3
            preset.
          </div>
        )}

        {selectedPreset?.needsConversion && (
          <div className="notice" style={{ marginTop: 6 }}>
            <strong>Why this doesn’t Just Work:</strong> browsers can’t execute PyTorch
            weights. The official MedGemma repo publishes only PyTorch, so it must be
            converted to ONNX once (about 10 minutes on any Mac with Python). Run{' '}
            <code style={{ fontFamily: 'var(--mono)' }}>./scripts/convert-medgemma.sh</code>{' '}
            from the app source, upload the result to your own HF repo, and paste that id
            in the custom field. Full recipe:{' '}
            <a
              href="https://github.com/papasierragolf/hounsfield/blob/main/docs/USING_OFFICIAL_MEDGEMMA.md"
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--accent)' }}
            >
              docs/USING_OFFICIAL_MEDGEMMA.md
            </a>
            .
          </div>
        )}

        {engine.state === 'loading' && (
          <>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="progress-label">
              {pct > 0 ? `Downloading / loading… ${pct}%${downloadedMB ? ` · ${downloadedMB}` : ''}` : 'Preparing…'}
            </div>
          </>
        )}
        {engine.state === 'ready' && (
          <div className="kv" style={{ marginTop: 8 }}>
            <span className="k">Status</span>
            <span className="v" style={{ color: 'var(--accent)' }}>
              Ready · {engine.device}
            </span>
          </div>
        )}
        {engine.state === 'error' && <div className="error-box" style={{ marginTop: 10 }}>{engine.error}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            disabled={engine.state === 'loading'}
            onClick={() => engine.load(modelId, { hfToken })}
          >
            {engine.state === 'ready' && engine.modelId === modelId
              ? 'Model loaded'
              : engine.state === 'loading'
                ? 'Loading…'
                : isNative()
                  ? 'Load model'
                  : 'Download & load model'}
          </button>
          {engine.state === 'ready' && (
            <button
              className="btn btn-secondary"
              onClick={() => engine.reload(modelId, { hfToken })}
              title="Unloads model from GPU memory and reloads it fresh — clears all internal state"
            >
              Reload (fresh context)
            </button>
          )}
          {(engine.state === 'ready' || engine.state === 'error') && (
            <button
              className="btn btn-secondary"
              onClick={() => engine.unload()}
              title="Free model from GPU/RAM without reloading"
            >
              Unload
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Backup & restore</h2>
        <p className="hint" style={{ marginBottom: 12 }}>
          Your data never leaves this device automatically. Export a single backup file and store
          it wherever you choose — iCloud Drive, Google Drive, or local files.
        </p>
        {vaultOn && (
          <div className="notice" style={{ marginBottom: 12 }}>
            The exported backup file itself is <strong>not</strong> encrypted, even with
            biometric lock enabled — store it somewhere you trust.
          </div>
        )}
        <div className="btn-row">
          <button className="btn btn-secondary" disabled={busy} onClick={handleExport}>
            Export backup
          </button>
          <button className="btn btn-secondary" disabled={busy} onClick={() => restoreRef.current.click()}>
            Restore backup
          </button>
        </div>
        <input
          ref={restoreRef}
          type="file"
          accept=".hounsfield,application/json"
          hidden
          onChange={(e) => {
            if (e.target.files[0]) handleRestore(e.target.files[0]);
            e.target.value = '';
          }}
        />
        {backupMsg && (
          <p className="hint" style={{ marginTop: 10 }}>
            {backupMsg}
          </p>
        )}
      </div>

      <div className="card">
        <h2>Privacy</h2>
        <div className="kv">
          <span className="k">Image storage</span>
          <span className="v">On-device (IndexedDB)</span>
        </div>
        <div className="kv">
          <span className="k">Inference</span>
          <span className="v">On-device (WebGPU/WASM)</span>
        </div>
        <div className="kv">
          <span className="k">Network use</span>
          <span className="v">Model download only</span>
        </div>
        <div className="kv">
          <span className="k">Analytics / tracking</span>
          <span className="v">None</span>
        </div>
      </div>

      <p className="hint" style={{ textAlign: 'center', padding: '4px 0 20px' }}>
        Hounsfield v0.1 · Not a medical device · Educational use only
      </p>
    </div>
  );
}
