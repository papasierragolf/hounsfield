/**
 * Inference worker — owns the MedGemma model so the UI thread never blocks.
 *
 * Runs entirely on-device via transformers.js (ONNX Runtime):
 *   - WebGPU when available (Apple Silicon Macs, iOS 18+ Safari, Chrome/Edge)
 *   - WASM fallback otherwise (slow but functional)
 *
 * Weights are downloaded once from the Hugging Face Hub and cached in the
 * browser Cache API; after that the app is fully offline. No image or prompt
 * ever leaves the device.
 */
import {
  AutoProcessor,
  AutoModelForImageTextToText,
  RawImage,
  TextStreamer,
  InterruptableStoppingCriteria,
  env,
} from '@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;

let processor = null;
let model = null;
let loadedModelId = null;
let loadedDevice = null;
let generating = false;
let stopper = null; // InterruptableStoppingCriteria for the active generation

function post(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

async function detectDevice(preferred) {
  if (preferred === 'wasm') return 'wasm';
  if (typeof navigator !== 'undefined' && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) return 'webgpu';
    } catch {
      /* fall through to wasm */
    }
  }
  return 'wasm';
}

async function load({ modelId, device: preferredDevice, dtype, hfToken }) {
  if (model && loadedModelId === modelId) {
    post('ready', { modelId, device: loadedDevice });
    return;
  }
  const device = await detectDevice(preferredDevice);
  post('status', { message: `Loading ${modelId} on ${device}…` });

  // Transformers.js reads env.HF_TOKEN for gated repos.
  env.HF_TOKEN = hfToken || undefined;

  const progress_callback = (p) => {
    if (p.status === 'progress' && p.total) {
      post('progress', { file: p.file, loaded: p.loaded, total: p.total });
    } else if (p.status === 'done') {
      post('file-done', { file: p.file });
    }
  };

  try {
    processor = await AutoProcessor.from_pretrained(modelId, { progress_callback });
    model = await AutoModelForImageTextToText.from_pretrained(modelId, {
      dtype: dtype || (device === 'webgpu' ? 'q4f16' : 'q4'),
      device,
      progress_callback,
    });
    loadedModelId = modelId;
    loadedDevice = device;
    post('ready', { modelId, device });
  } catch (err) {
    processor = null;
    model = null;
    loadedModelId = null;
    const raw = String(err?.message || err);
    // Surface the most common failure modes in plain English.
    let message = raw;
    if (/\.gguf/i.test(modelId) || /\.gguf/i.test(raw)) {
      message =
        `"${modelId}" looks like a GGUF file. GGUF is a llama.cpp format and does not ` +
        `work with this app's ONNX runtime. Use an ONNX build of the same model — ` +
        `repos are usually named with an "-ONNX" suffix.`;
    } else if (/invalid model id|malformed/i.test(raw) || /https?:\/\//i.test(modelId)) {
      message =
        `"${modelId}" is not a valid Hugging Face model id. Paste just the "org/repo" ` +
        `portion — e.g. "onnx-community/gemma-3-4b-it-ONNX" — not the full URL or a ` +
        `path to a specific weight file.`;
    } else if (/401|unauthor/i.test(raw)) {
      message =
        `Access denied. "${modelId}" is a gated model. Open its page on Hugging Face, ` +
        `accept the license, generate a Read access token in your HF account settings, ` +
        `and paste it into the HF Access Token field below.`;
    } else if (/404|not.?found/i.test(raw)) {
      message =
        `The model "${modelId}" was not found on Hugging Face. Pick another preset ` +
        `or paste a valid ONNX model id.`;
    }
    post('error', { message, phase: 'load' });
  }
}

async function generate({ requestId, imageDataUrls, systemPrompt, userPrompt, maxNewTokens }) {
  if (!model || !processor) {
    post('error', { requestId, message: 'Model not loaded yet.', phase: 'generate' });
    return;
  }
  if (generating) {
    post('error', { requestId, message: 'A generation is already in progress.', phase: 'generate' });
    return;
  }
  generating = true;
  try {
    const images = await Promise.all(imageDataUrls.map((u) => RawImage.fromURL(u)));

    const messages = [
      { role: 'system', content: [{ type: 'text', text: systemPrompt }] },
      {
        role: 'user',
        content: [
          ...images.map(() => ({ type: 'image' })),
          { type: 'text', text: userPrompt },
        ],
      },
    ];

    const prompt = processor.apply_chat_template(messages, { add_generation_prompt: true });
    const inputs = await processor(prompt, images, { add_special_tokens: false });

    const streamer = new TextStreamer(processor.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text) => post('token', { requestId, text }),
    });

    stopper = new InterruptableStoppingCriteria();
    const started = performance.now();
    const output = await model.generate({
      ...inputs,
      max_new_tokens: maxNewTokens || 1024,
      do_sample: false,
      streamer,
      stopping_criteria: stopper,
    });

    const decoded = processor.batch_decode(
      output.slice(null, [inputs.input_ids.dims.at(-1), null]),
      { skip_special_tokens: true }
    );
    post('done', {
      requestId,
      text: decoded[0],
      elapsedMs: Math.round(performance.now() - started),
    });
  } catch (err) {
    post('error', { requestId, message: String(err?.message || err), phase: 'generate' });
  } finally {
    generating = false;
    stopper = null;
  }
}

self.onmessage = async (e) => {
  const { type, ...payload } = e.data;
  if (type === 'load') await load(payload);
  else if (type === 'generate') await generate(payload);
  else if (type === 'stop') stopper?.interrupt();
  else if (type === 'ping') post('pong');
  else if (type === 'unload') {
    // engine.js terminates the worker directly; this handler is a belt-and-suspenders
    // fallback if someone calls unload while a generate is still in flight.
    model = null;
    processor = null;
    loadedModelId = null;
    post('unloaded');
  }
};
