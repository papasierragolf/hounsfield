# Using the official `google/medgemma-*` weights

The Hounsfield app runs inference in the browser (or WKWebView, on iOS)
through **ONNX Runtime**. That means it can only load models that ship in
**ONNX format**. Google publishes MedGemma in **PyTorch/safetensors** — the
"normal" format — which is designed for the PyTorch runtime and does not run
in a browser.

You have three ways to use the *actual* `google/medgemma-*` weights with this
app. Pick the one that fits.

---

## Option 1 — Convert once, then use forever (recommended)

Do this on any Mac or Linux box with Python 3.10+. Takes ~10 minutes and ~15
GB of temporary disk space; you only do it once per model release.

```bash
# 1. Accept the license on Hugging Face (browser, one-click):
#    https://huggingface.co/google/medgemma-1.5-4b-it

# 2. Log in to HF from your terminal:
huggingface-cli login          # paste a Read token

# 3. Convert:
git clone <this-repo> && cd hounsfield
./scripts/convert-medgemma.sh  # produces ./onnx-medgemma-1.5-4b-it

# 4. Publish to your own HF repo (can be private):
huggingface-cli upload YOUR-USER/medgemma-1.5-4b-it-ONNX ./onnx-medgemma-1.5-4b-it .

# 5. In the app: Settings → Custom Hugging Face model ID →
#    paste "YOUR-USER/medgemma-1.5-4b-it-ONNX"
#    and put your HF Read token in the token field. Done.
```

The conversion script (`scripts/convert-medgemma.sh`) uses Hugging Face
Optimum's `optimum-cli export onnx --task image-text-to-text` to produce a
q4f16-quantized build sized for WebGPU. Environment variables let you change
the model (`MODEL=google/medgemma-4b-it`), the output directory (`OUT=…`),
or the quantization (`DTYPE=q4` for a bigger but wider-compatible build).

---

## Option 2 — Use a community ONNX conversion (if one is up)

Some community members publish their conversions. Availability changes; the
Settings screen shows the current known ones. If a repo is missing files or
gives a "Could not locate file: preprocessor_config.json" error, they didn't
include the transformers.js metadata — try another or fall back to Option 1.

---

## Option 3 — Use the fully-open Gemma 3 4B instead (fastest)

The `onnx-community/gemma-3-4b-it-ONNX` preset is the default. It's the base
model MedGemma is fine-tuned from, so it works but is not specialized on
medical imaging. Great for getting the app running while you sort out
Option 1.

---

## Why not GGUF, MLX, or Ollama?

- **GGUF** (llama.cpp format) — Wllama can run GGUF in the browser, but its
  multimodal (image+text) support is not production-ready yet, so it can't be
  used for radiology images. Text-only Q&A would work.
- **MLX** — beautiful native Apple Silicon runtime; requires a Swift plugin
  in the Capacitor iOS project. On the roadmap; not implemented today.
- **Ollama** — runs on a *server*, not in-browser or in-app. It would violate
  the on-device / no-network promise.

---

## What the app actually needs from an ONNX repo

If you're building a conversion by hand, the repo needs to contain:

- `onnx/model.onnx` (or per-component: `vision_encoder.onnx`,
  `text_embed.onnx`, `decoder_model_merged.onnx`, `embed_tokens.onnx`)
- `onnx/*.onnx_data` (external-weight sidecars for large tensors)
- `tokenizer.json`, `tokenizer_config.json`, `special_tokens_map.json`
- `preprocessor_config.json`, `processor_config.json`
- `config.json`, `generation_config.json`, `chat_template.jinja` (if present)

`optimum-cli export onnx --task image-text-to-text` produces all of these.
