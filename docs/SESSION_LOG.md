# Hounsfield — Development Session Log

_On-device radiology assistant (MedGemma 1.5 4B). This log documents the work done
in the current working session, in order, with the rationale and exact code touchpoints
for each change so the next session can pick up without re-deriving context._

---

## Snapshot of the app

- **What it is:** React app that interprets X-ray / CT images fully on-device.
- **Two inference backends**, chosen per platform in `src/inference/engine.js`:
  - **Native iOS (Capacitor):** MLX on the Apple GPU via the `MedGemmaMLX` Swift plugin
    (`ios/App/App/MedGemmaMLXPlugin.swift`). Model: `mlx-community/medgemma-1.5-4b-it-4bit`.
  - **Browser / PWA:** ONNX via transformers.js in a Web Worker (`src/inference/worker.js`),
    WebGPU → WASM fallback. Default model: `onnx-community/gemma-3-4b-it-ONNX`.
- **Bundled model:** the native app ships MedGemma weights inside the package at
  `ios/App/App/BundledModels/medgemma-1.5-4b-it-4bit/` (gitignored, ~3 GB). The plugin
  loads straight from the bundle — no download, works in airplane mode.
- **Storage:** all studies/images/settings in IndexedDB (`src/db.js`); backups are explicit
  user-initiated exports.

### Important build/run reminder

The iOS app serves a **pre-built** React bundle — it does **not** read from the Vite dev
server. After any JS/CSS change you must rebuild and sync before running in Xcode:

```bash
cd /Users/partha/Hounsfield
npm run build && npx cap sync ios
```

Then hit **Run** in Xcode. Swift-only changes just need the Xcode rebuild; JS changes need
`cap sync`. Xcode project lives at `ios/App/App.xcodeproj` (open via `npx cap open ios`).

---

## Changes made this session

### 1. App icon — CT scanner

Set the blue CT-scanner PNG as the app icon.

- Copied the user's image to
  `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`.
- Resized to the required **1024×1024** with `sips` (source was 1254×1254).
- `Contents.json` already referenced that exact filename, so no asset-catalog edits were
  needed — just rebuild in Xcode.

### 2. Offload / reload model from memory

**Problem:** No way to clear model state; long sessions produced degraded answers.

- **`ios/App/App/MedGemmaMLXPlugin.swift`** — added `unload` method: nils the
  `ModelContainer`, clears the Metal GPU buffer cache (`MLX.GPU.set(cacheLimit: 0)`) so the
  ~3 GB is returned to the OS.
- **`src/inference/engine.js`** — added:
  - `unload()` — native plugin unload, or terminates the ONNX worker on web; resets state to `idle`.
  - `reload(modelId, opts)` — `unload()` then `load()` for a guaranteed clean slate (no KV cache).
- **`src/components/SettingsView.jsx`** — when the model is `ready`, two buttons appear:
  **Reload (fresh context)** and **Unload**.
- **`src/inference/worker.js`** — `unload` message handler as a fallback.

### 3. Re-analyze with editable context

**Problem:** "Re-analyze" reran immediately with no chance to fix the prompt / patient context.

- **`src/components/StudyDetail.jsx`** — "Re-analyze" now opens an inline editor pre-filled
  with the study's existing `context`, `question`, `modality`, `region`. User edits, taps
  **Run analysis** (saves new context to the study, replacing the old, then reruns) or
  **Cancel**. First-time "Analyze" (no prior report) still runs directly.

### 4. X-ray refusal fix ("I am not a medical AI / cannot read this image")

Three root causes fixed:

1. **Silent image-drop bug (the main culprit)** — in `MedGemmaMLXPlugin.swift` the base64
   decode used strict `Data(base64Encoded:)`, which returns `nil` on any stray character and
   the `continue` **silently discarded the image**. The model then ran text-only and
   correctly said it had no image. Fixed with `.ignoreUnknownCharacters`, and a guard that
   **rejects loudly** if images were sent but none decoded.
2. **Prompt framing** — `src/inference/prompts.js`: the old system prompt told the model to
   *be "an expert radiologist"* (a human role), which triggers "I'm not a doctor" safety
   refusals. Rewrote it so the model knows it **is MedGemma, a medical-image-analysis model**,
   that describing findings is its intended function, and to **not decline**. The user prompt
   now leads with a direct MedGemma-style directive: _"Here is an X-ray of the chest.
   Interpret it and describe the findings."_ (article handled: an X-ray / a CT image / a
   medical image).
3. **Sticky refusals** — temperature was `0.0` (deterministic), so re-analyzing gave the
   identical refusal forever. Bumped to `0.3` so retries can escape.

### 5. Stop button during inference

**Problem:** No way to cancel an in-progress analysis.

- **`src/components/StudyDetail.jsx`** — red **Stop** button under the streaming text while
  analyzing. A stopped run is **discarded** (partial/truncated report is not saved — a
  half-finished radiology read is misleading); the previous report, if any, is kept. Uses a
  `stopRequested` ref.
- **`src/inference/engine.js`** — `stop()` routes to native plugin or worker.
- **`ios/App/App/MedGemmaMLXPlugin.swift`** — generation runs in a stored cancellable
  `Task` (`genTask`); `stop()` cancels it; the stream loop checks `Task.isCancelled` between
  tokens and resolves gracefully with partial text + `stopped: true`. Also catches
  `CancellationError`.
- **`src/inference/worker.js`** — uses transformers.js `InterruptableStoppingCriteria`
  (verified present in the installed version); a `stop` message calls `.interrupt()`.
- **Caveat:** MLX streams token-by-token, so Stop takes effect at the next token boundary
  (near-instant during decode). Aborting *during* the initial image-encode phase would need a
  deeper mlx-swift-lm change — not yet done.

---

## Investigated but NOT integrated

### Tuberculosis ViT model — `sukhmani1303/tuberculosis-vit-model`

Studied on request. Findings:

- **Task:** binary chest-X-ray classification — Normal vs. Tuberculosis.
- **Architecture:** custom ViT (patch 16, 196 patches, 512-dim, 8 heads, 6 encoder blocks),
  224×224 RGB input, custom preprocessing (grayscale → CLAHE → Gaussian blur → z-score).
- **Weights:** PyTorch only (`model.pt`, `pytorch_model.bin`, ~78 MB) + custom `handler.py`.
  282-byte `config.json` ⇒ **not** a standard `transformers` ViT class.
- **License:** Apache 2.0. Educational/research only.

**Verdict:** cannot be dropped in as-is. The app runs ONNX (browser) and MLX (native); this
ships only PyTorch with a custom architecture + custom preprocessing. Making it run on-device
is a real mini-project: convert `.pt` → ONNX + CoreML, reimplement CLAHE/z-score preprocessing,
add a second inference path that outputs a TB probability alongside the MedGemma report.

**Status:** user was asked whether to (a) add a reference link, (b) fully integrate, or
(c) link now / integrate later — the question was dismissed. **No changes made.** Open item.

---

## Files touched this session

| File | What changed |
|---|---|
| `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` | New CT-scanner icon (1024×1024) |
| `ios/App/App/MedGemmaMLXPlugin.swift` | `unload`, `stop`, cancellable `genTask`, robust base64 decode, temp 0.3 |
| `src/inference/engine.js` | `unload()`, `reload()`, `stop()` |
| `src/inference/worker.js` | `unload` + `stop` handlers, `InterruptableStoppingCriteria` |
| `src/inference/prompts.js` | MedGemma-native, anti-refusal system + user prompts |
| `src/components/SettingsView.jsx` | Reload / Unload buttons |
| `src/components/StudyDetail.jsx` | Editable re-analyze, Stop button, discard-on-stop |

---

## Open items / next steps

- **Deploy pending changes to device:** `npm run build && npx cap sync ios`, then rebuild in
  Xcode (needed for the Swift changes in items 2, 4, 5).
- **TB ViT model:** decide link vs. full integration (see above).
- **(Optional)** abort MLX generation during the image-encode phase, not just at token
  boundaries.
