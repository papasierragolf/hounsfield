#!/bin/sh
set -e

# Xcode Cloud clones a bare repo — everything gitignored/generated locally has
# to be recreated here before xcodebuild runs:
#   1. node_modules        → @capacitor/* are local SPM path dependencies
#   2. dist + ios/App/App/{public,capacitor.config.json,config.xml}
#                          → produced by `vite build` + `cap sync ios`
#   3. ios/App/App/BundledModels → 3.2 GB MedGemma weights from Hugging Face
#      (gitignored; see .gitignore for the same download command)

cd "$CI_PRIMARY_REPOSITORY_PATH"

# ── Node (not preinstalled on Xcode Cloud images; Homebrew is) ──
echo "→ Installing Node via Homebrew"
export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALL_CLEANUP=1
brew install node
echo "→ Node $(node --version), npm $(npm --version)"

# ── npm deps ──
echo "→ Installing npm dependencies"
npm install

# ── Web build + Capacitor sync (creates public/, capacitor.config.json, config.xml) ──
echo "→ Building web assets"
npm run build

echo "→ Syncing Capacitor iOS project"
npx cap sync ios

# ── Bundled MedGemma weights ──
echo "→ Downloading MedGemma weights from Hugging Face"
python3 -m pip install --quiet --user --break-system-packages -U huggingface_hub \
  || python3 -m pip install --quiet --user -U huggingface_hub
# HF_TOKEN can be set as an Xcode Cloud environment variable if the repo is gated.
python3 - <<'PY'
from huggingface_hub import snapshot_download
snapshot_download(
    "mlx-community/medgemma-1.5-4b-it-4bit",
    local_dir="ios/App/App/BundledModels/medgemma-1.5-4b-it-4bit",
)
PY

echo "→ Bundled model contents:"
ls -lh ios/App/App/BundledModels/medgemma-1.5-4b-it-4bit

echo "→ post-clone complete"
