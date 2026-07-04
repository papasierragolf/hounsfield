# Hounsfield 🩻

**On-device radiology assistant.** Interpret X-ray and CT images with MedGemma 1.5 4B running
entirely on your own device — as a **native iOS app** (Capacitor), an installable PWA, or in the
browser. No server, no accounts, no data leaving the device. After the one-time model download,
the app works with **zero network connectivity**.

**Design:** Warm ivory/off-white paper surfaces with a terracotta
accent by default; Light / Dark / System selectable in Settings (the film viewer stays black in
both, as a reading room should).

> ⚠️ **Not a medical device.** Output is preliminary and educational only. Always have imaging
> reviewed by a qualified radiologist.

## Architecture

```
┌─────────────────────────────── Device ───────────────────────────────┐
│                                                                      │
│  React UI (src/App.jsx, src/components/)                             │
│    │            │                          │                         │
│    │            ▼                          ▼                         │
│    │   Storage layer (src/db.js)   Backup layer (src/lib/backup.js)  │
│    │   IndexedDB: studies,         single .hounsfield bundle via     │
│    │   images, settings            share sheet / download →          │
│    │                               iCloud Drive, Google Drive, …     │
│    ▼                                                                 │
│  Inference engine (src/inference/)                                   │
│    engine.js — main-thread client (EventTarget, streaming)           │
│    worker.js — Web Worker running MedGemma via transformers.js       │
│                ONNX Runtime · WebGPU → WASM fallback                 │
│                weights cached in browser Cache API after first DL    │
└──────────────────────────────────────────────────────────────────────┘
```

**Layers**

| Layer | Files | Notes |
|---|---|---|
| UI | `src/App.jsx`, `src/components/` | Tab shell: Studies / New Study / Settings; film viewer with window-level style controls; streamed report rendering |
| Inference | `src/inference/` | MedGemma in a Web Worker; model id configurable; token streaming to the UI |
| Prompting | `src/inference/prompts.js` | Radiologist persona + structured report (Technique / Findings / Impression / Recommendations) |
| Storage | `src/db.js` | IndexedDB via `idb`; blobs stored natively, nothing serialized to remote |
| Imaging | `src/lib/image.js` | Camera/library ingestion, HEIC→JPEG re-encode, downscale, thumbnails |
| Backup | `src/lib/backup.js` | Export/import a portable JSON bundle; destination is user's choice |
| PWA | `public/sw.js`, `public/manifest.webmanifest` | Offline app shell; installable on iOS via Add to Home Screen |

## Privacy model

- Images, context, and reports are stored **only** in IndexedDB on the device.
- The only network traffic the app generates is the **one-time model download** from the
  Hugging Face Hub (cached afterwards; the app then works fully offline).
- Backups are explicit, user-initiated exports. On iOS the share sheet lets you save to
  **iCloud Drive** (Files) or the **Google Drive** app; on desktop it downloads a
  `hounsfield-backup-YYYY-MM-DD.hounsfield` file you can place in any synced folder.
  Restore from Settings → Restore backup.

## Inference backends

The engine facade (`src/inference/engine.js`) picks the backend per platform:

| Platform | Runtime | Default model | Conversion needed? |
|---|---|---|---|
| **Native iOS app** | **MLX** (Apple GPU, via the `MedGemmaMLX` Capacitor plugin in `ios/App/App/MedGemmaMLXPlugin.swift`) | `mlx-community/medgemma-1.5-4b-it-4bit` — the official Google weights, prequantized, **public, no token, no gate** | **No** — download in-app and run |
| Browser / PWA | ONNX (transformers.js, WebGPU/WASM) | `onnx-community/gemma-3-4b-it-ONNX` | MedGemma needs a one-time ONNX conversion (see below) |

The native path is the "it just works" path: install the app, tap **Download & load
model** in Settings (~3 GB, once), and everything — capture, inference, reports,
backup — runs with zero connectivity, airplane mode included. The Swift plugin uses
[mlx-swift-lm](https://github.com/ml-explore/mlx-swift-lm) (`ChatSession` streaming API)
and requires iOS 17+; the app carries the increased-memory-limit entitlement that large
models need on iPhone.

**Bundled model:** the app ships with MedGemma 1.5 4B inside the package
(`ios/App/App/BundledModels/medgemma-1.5-4b-it-4bit/`, ~3 GB, gitignored). The plugin
loads it straight from the bundle — no download, no network, instant availability on
first launch. Re-fetch the weights after a fresh clone with:

```bash
pip install "huggingface_hub[cli]"
hf download mlx-community/medgemma-1.5-4b-it-4bit \
  --local-dir ios/App/App/BundledModels/medgemma-1.5-4b-it-4bit
```

Any other MLX model id entered in Settings still downloads from the Hub at runtime.
Note for App Store distribution: the 3 GB payload is within Apple's 4 GB app limit,
but users will need Wi-Fi to install.

Native build notes:
- First build in Xcode prompts to **Trust & Enable** the mlx-swift build plugin and
  macros — accept both. (CLI builds: pass `-skipPackagePluginValidation
  -skipMacroValidation` to `xcodebuild`.)
- MLX needs a real Apple-silicon GPU: **run on a physical iPhone**, not the simulator.
- `ios/App/App/MLXHubBridge.swift` contains hand-expanded versions of the
  MLXHuggingFace loader macros (the macro forms hit a Swift compiler diagnostic bug
  inside the plugin class).

## The model

Default: `onnx-community/medgemma-1.5-4b-it-ONNX` (MedGemma 1.5 4B instruction-tuned,
multimodal, quantized ~2.5 GB). The model id is configurable in **Settings**, including any
custom transformers.js-compatible Gemma-3-family checkpoint.

**Important caveat:** ONNX conversions of MedGemma are community-published and availability
changes. If the default id 404s, pick another preset in Settings or convert the checkpoint
yourself with [🤗 Optimum](https://huggingface.co/docs/optimum) /
`transformers.js` conversion scripts and host it under your own HF account, then paste the id
into Settings. MedGemma is gated on the Hub — accept the license with your HF account first.

### Hardware reality check

- **Desktop Chrome/Edge/Safari with WebGPU** (Apple Silicon, decent dGPU): good experience.
- **iPhone (iOS 18+ Safari, WebGPU)**: a 4B model at q4 is at the edge of Safari's per-tab
  memory budget. Expect it to work on recent Pro-class devices and fail on older ones. For a
  guaranteed native iOS experience the same React codebase can be wrapped with Capacitor and
  the inference layer swapped for MLX/llama.cpp via a small native plugin — the
  `engine.js` abstraction was designed so only `worker.js` needs replacing.
- **No WebGPU**: automatic WASM fallback (slow — minutes per report).

## Develop & run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production bundle in dist/
npm run preview
```

Deploy `dist/` to any static host (HTTPS required for camera, share, and service worker).
The dev/preview servers already send the COOP/COEP headers needed for multithreaded WASM;
mirror them on your host if you expect WASM fallback users.

### Native iOS app (downloadable, no browser)

The repo contains a ready Capacitor iOS project in `ios/` (already verified to compile). The
same React bundle runs inside the app shell; the Share/Filesystem plugins provide the native
share sheet for backups and reports.

```bash
npm run build && npx cap sync ios   # refresh the bundle into the native shell
npx cap open ios                    # opens Xcode
```

In Xcode: select your team under Signing & Capabilities → run on your iPhone (or Archive →
distribute via TestFlight/App Store). Camera and photo-library usage descriptions are already
set in `ios/App/App/Info.plist`.

**Offline behavior:** launch the app once on any network and load the model in Settings; the
weights are cached inside the app's WKWebView storage. From then on capture, inference,
reports, history, and backup-to-Files all work with airplane mode on. (To guarantee the cache
is never evicted by iOS under storage pressure, a future step is bundling the weights in the
app or downloading them to the app's Documents directory via the Filesystem plugin.)

### PWA install (no App Store needed)

Open the deployed URL in Safari → Share → **Add to Home Screen**. The app runs standalone,
offline after the first model load.

## Report flow

1. **New Study** → Camera (opens the iOS camera directly) or Library.
2. Pick modality (X-ray / CT), body region, optional clinical context and question.
3. **Create study** → auto-runs on-device inference when the model is loaded; tokens stream
   into the report view live.
4. Report is saved with the study: Technique, Findings, Impression, Recommendations, plus
   model id and inference time. Share/copy from the study screen.

## License

The Hounsfield app source code is licensed under the **GNU Affero General Public License
v3.0 (AGPL-3.0)** — see [LICENSE](LICENSE). In short: you can use, modify, and self-host this
app freely, but if you run a modified version as a network service, you must publish your
modified source to the users of that service.

**This covers the app's code only.** The bundled/downloaded **MedGemma model weights** are
distributed by Google under their own **Health AI Developer Foundations** usage terms
(see the [model card](https://huggingface.co/mlx-community/medgemma-1.5-4b-it-4bit)) —
those terms govern the model itself and apply independently of this repository's license.
