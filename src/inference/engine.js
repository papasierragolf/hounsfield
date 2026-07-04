/**
 * Inference engine facade. Single instance for the app; same interface on
 * every platform, two backends:
 *
 *  - Native iOS app  → MLX via the MedGemmaMLX Capacitor plugin. Runs the
 *    ready-made `mlx-community/medgemma-*` builds of the official Google
 *    weights directly on the Apple GPU. No conversion, no token, no gate.
 *  - Browser / PWA   → ONNX via transformers.js in a Web Worker (WebGPU or
 *    WASM). Needs ONNX-format repos; MedGemma ONNX availability is spotty.
 */
import { registerPlugin } from '@capacitor/core';
import { isNative } from '../lib/platform.js';

const MedGemmaMLX = registerPlugin('MedGemmaMLX');

/**
 * Normalize whatever the user pasted into a valid Hugging Face model id.
 * Accepts:
 *   - `org/repo`                                  → unchanged
 *   - `https://huggingface.co/org/repo`           → `org/repo`
 *   - `https://huggingface.co/org/repo/tree/main` → `org/repo`
 *   - `.../resolve/main/some-weight.gguf`         → `org/repo`
 * Returns { id, warning } where warning is non-null if the pasted string
 * points at a format the ONNX runtime cannot load.
 */
export function normalizeModelId(input) {
  let s = (input || '').trim();
  if (!s) return { id: '', warning: null };

  // Detect unsupported weight formats before stripping the file part.
  let warning = null;
  if (/\.gguf(\?|$)/i.test(s)) {
    warning = isNative()
      ? 'GGUF is a llama.cpp format. On this device the app runs MLX — use an "mlx-community/…" repo instead.'
      : 'GGUF is a llama.cpp format and cannot be loaded by this app. Use an ONNX build of the same model (repos ending in "-ONNX" or "-onnx").';
  } else if (/\.(safetensors|bin)(\?|$)/i.test(s) && !isNative()) {
    warning = 'The browser build loads ONNX weights only. Point to a repo that publishes ONNX files.';
  }

  s = s.replace(/^https?:\/\/huggingface\.co\//i, '');
  s = s.replace(/\/(tree|blob|resolve)\/[^?#]*$/i, '');
  s = s.replace(/^\/+|\/+$/g, '');

  return { id: s, warning };
}

// Native iOS runs MLX: the mlx-community builds of the actual Google weights
// are public (no gate, no token) and load directly — no conversion step.
const NATIVE_PRESETS = [
  {
    id: 'mlx-community/medgemma-1.5-4b-it-4bit',
    label: 'MedGemma 1.5 4B (ships with the app)',
    note: 'Official Google weights, MLX 4-bit build, included in the app package. Loads instantly — no download, no network, ever.',
    gated: false,
  },
  {
    id: 'mlx-community/medgemma-4b-it-4bit',
    label: 'MedGemma 1.0 4B',
    note: 'Previous MedGemma release, MLX 4-bit. ~3 GB.',
    gated: false,
  },
  {
    id: 'mlx-community/gemma-3-4b-it-4bit',
    label: 'Gemma 3 4B (general, non-medical)',
    note: 'Base model without medical fine-tuning. Smoke-test option.',
    gated: false,
  },
];

// Browser/PWA runs ONNX via transformers.js. The Gemma-3 ONNX build is fully
// public; MedGemma ONNX conversions are community-published and gated.
const WEB_PRESETS = [
  {
    id: 'onnx-community/gemma-3-4b-it-ONNX',
    label: 'Gemma 3 4B (default, public)',
    note: 'Fully open, no token needed. Not medically fine-tuned.',
    gated: false,
  },
  {
    id: 'Prince-1/Medgemma-4b-pt-Onnx',
    label: 'MedGemma 4B (pretrained, community ONNX)',
    note: 'Community conversion of google/medgemma-4b-pt. Requires an HF token — accept the license on the model page first.',
    gated: true,
  },
  {
    id: 'Shubadecka/medgemma-onnx',
    label: 'MedGemma (community ONNX #2)',
    note: 'Alternate community ONNX conversion. Availability changes — check the repo page.',
    gated: true,
  },
  {
    id: 'google/medgemma-1.5-4b-it',
    label: 'MedGemma 1.5 4B — official (needs one-time conversion)',
    note: 'The real Google weights are published as PyTorch, which browsers cannot load directly. Run scripts/convert-medgemma.sh to produce an ONNX build, upload to your own HF repo, and paste that id here.',
    gated: true,
    needsConversion: true,
  },
];

export const MODEL_PRESETS = isNative() ? NATIVE_PRESETS : WEB_PRESETS;
export const DEFAULT_MODEL_ID = MODEL_PRESETS[0].id;

/**
 * Saved model ids can predate a platform switch (e.g. an ONNX id restored
 * from a backup made in the browser, now running in the native app). Map
 * anything that can't run on this platform back to the platform default.
 */
export function resolveModelIdForPlatform(savedId) {
  if (!savedId) return DEFAULT_MODEL_ID;
  if (isNative() && /-ONNX$/i.test(savedId)) return DEFAULT_MODEL_ID;
  if (!isNative() && /^mlx-community\//i.test(savedId)) return DEFAULT_MODEL_ID;
  return savedId;
}

class InferenceEngine extends EventTarget {
  constructor() {
    super();
    this.worker = null;
    this.state = 'idle'; // idle | loading | ready | error
    this.device = null;
    this.modelId = null;
    this.error = null;
    this.progress = {}; // file -> {loaded, total}
    this.native = isNative();
    this._nativeListenersAttached = false;
  }

  async _ensureNativeListeners() {
    if (this._nativeListenersAttached) return;
    this._nativeListenersAttached = true;
    await MedGemmaMLX.addListener('mlxProgress', ({ fraction, totalBytes }) => {
      // fraction is smooth (0..1); totalBytes lets the UI show real sizes.
      const total = totalBytes > 1 ? totalBytes : 1;
      this.progress.model = { loaded: Math.round((fraction || 0) * total), total };
      this._emit('progress');
    });
    await MedGemmaMLX.addListener('mlxToken', ({ requestId, text }) => {
      this._emit(`token:${requestId}`, { requestId, text });
    });
  }

  _ensureWorker() {
    if (this.worker) return;
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this._onMessage(e.data);
    this.worker.onerror = (e) => {
      this.state = 'error';
      this.error = e.message || 'Worker crashed';
      this._emit('state');
    };
  }

  _onMessage(msg) {
    switch (msg.type) {
      case 'progress':
        this.progress[msg.file] = { loaded: msg.loaded, total: msg.total };
        this._emit('progress');
        break;
      case 'status':
        this._emit('status', msg);
        break;
      case 'ready':
        this.state = 'ready';
        this.device = msg.device;
        this.modelId = msg.modelId;
        this.error = null;
        this._emit('state');
        break;
      case 'token':
        this._emit(`token:${msg.requestId}`, msg);
        break;
      case 'done':
        this._emit(`done:${msg.requestId}`, msg);
        break;
      case 'error':
        if (msg.phase === 'load') {
          this.state = 'error';
          this.error = msg.message;
          this._emit('state');
        }
        if (msg.requestId) this._emit(`error:${msg.requestId}`, msg);
        break;
    }
  }

  _emit(name, detail = {}) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  /** Aggregate download progress across all model files, 0..1 */
  overallProgress() {
    const files = Object.values(this.progress);
    if (!files.length) return 0;
    const loaded = files.reduce((a, f) => a + f.loaded, 0);
    const total = files.reduce((a, f) => a + f.total, 0);
    return total ? loaded / total : 0;
  }

  load(modelId, { device = 'auto', hfToken = null } = {}) {
    this.state = 'loading';
    this.progress = {};
    this.error = null;
    this._emit('state');

    if (this.native) {
      this._loadNative(modelId);
      return;
    }
    this._ensureWorker();
    this.worker.postMessage({ type: 'load', modelId, device, hfToken });
  }

  /** Free the model from GPU/RAM entirely — guaranteed clean slate. */
  async unload() {
    if (this.native) {
      try { await MedGemmaMLX.unload(); } catch { /* already unloaded */ }
    } else if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.state = 'idle';
    this.modelId = null;
    this.device = null;
    this.error = null;
    this.progress = {};
    this._emit('state');
  }

  /** Unload then immediately reload — clears all model state including KV cache. */
  async reload(modelId, opts = {}) {
    await this.unload();
    this.load(modelId, opts);
  }

  /**
   * Interrupt an in-flight generation. The pending generate() promise still
   * resolves (with whatever text streamed so far) so callers can clean up.
   */
  async stop() {
    if (this.native) {
      try { await MedGemmaMLX.stop(); } catch { /* nothing running */ }
    } else if (this.worker) {
      this.worker.postMessage({ type: 'stop' });
    }
  }

  async _loadNative(modelId) {
    try {
      await this._ensureNativeListeners();
      const result = await MedGemmaMLX.load({ modelId });
      this.state = 'ready';
      this.device = result.device || 'mlx';
      this.modelId = result.modelId || modelId;
      this.error = null;
      this._emit('state');
    } catch (err) {
      this.state = 'error';
      this.error = String(err?.message || err);
      this._emit('state');
    }
  }

  /**
   * Generate a report. Returns a promise resolving to the full text;
   * onToken receives incremental text for streaming UI.
   */
  generate({ imageDataUrls, systemPrompt, userPrompt, maxNewTokens }, onToken) {
    if (this.native) {
      return this._generateNative({ imageDataUrls, systemPrompt, userPrompt, maxNewTokens }, onToken);
    }
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const onTok = (e) => onToken?.(e.detail.text);
      const cleanup = () => {
        this.removeEventListener(`token:${requestId}`, onTok);
        this.removeEventListener(`done:${requestId}`, onDone);
        this.removeEventListener(`error:${requestId}`, onErr);
      };
      const onDone = (e) => {
        cleanup();
        resolve(e.detail);
      };
      const onErr = (e) => {
        cleanup();
        reject(new Error(e.detail.message));
      };
      this.addEventListener(`token:${requestId}`, onTok);
      this.addEventListener(`done:${requestId}`, onDone);
      this.addEventListener(`error:${requestId}`, onErr);
      this.worker.postMessage({
        type: 'generate',
        requestId,
        imageDataUrls,
        systemPrompt,
        userPrompt,
        maxNewTokens,
      });
    });
  }

  async _generateNative({ imageDataUrls, systemPrompt, userPrompt, maxNewTokens }, onToken) {
    await this._ensureNativeListeners();
    const requestId = crypto.randomUUID();
    const onTok = (e) => onToken?.(e.detail.text);
    this.addEventListener(`token:${requestId}`, onTok);
    try {
      // The plugin accepts data-URLs; it strips the "data:image/…;base64," head.
      const result = await MedGemmaMLX.generate({
        requestId,
        images: imageDataUrls,
        systemPrompt,
        userPrompt,
        maxNewTokens: maxNewTokens || 1024,
      });
      return { requestId, text: result.text, elapsedMs: result.elapsedMs };
    } finally {
      this.removeEventListener(`token:${requestId}`, onTok);
    }
  }
}

export const engine = new InferenceEngine();
