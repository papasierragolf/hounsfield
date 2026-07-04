#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# convert-medgemma.sh — one-shot conversion of the official google/medgemma
# weights into an ONNX build the Hounsfield app can load.
#
# You only run this ONCE per model, on any Mac/Linux box with Python 3.10+.
# The output can be uploaded to your own private Hugging Face repo and used
# from the app (paste "your-hf-user/medgemma-1.5-4b-it-ONNX" into Settings).
#
# Usage:
#   ./scripts/convert-medgemma.sh                                      # 1.5-4b-it, q4f16
#   ./scripts/convert-medgemma.sh google/medgemma-4b-it                # 1.0
#   MODEL=google/medgemma-1.5-4b-it OUT=./onnx-out DTYPE=q4 ./scripts/convert-medgemma.sh
#
# Requirements:
#   1. You have accepted the MedGemma license at:
#        https://huggingface.co/google/medgemma-1.5-4b-it
#   2. You have a Read HF token (`huggingface-cli login`) or exported
#        HF_TOKEN=hf_xxx  before running.
# ---------------------------------------------------------------------------
set -euo pipefail

MODEL="${MODEL:-${1:-google/medgemma-1.5-4b-it}}"
OUT="${OUT:-./onnx-$(basename "$MODEL")}"
DTYPE="${DTYPE:-q4f16}"   # q4f16 = 4-bit weights + fp16 activations (best for WebGPU)

echo "→ Converting  $MODEL"
echo "→ Output      $OUT"
echo "→ Dtype       $DTYPE"

# Ephemeral venv so this doesn't touch the user's Python setup.
if [ ! -d ".venv-convert" ]; then
  python3 -m venv .venv-convert
fi
# shellcheck disable=SC1091
source .venv-convert/bin/activate
pip install --quiet --upgrade pip
pip install --quiet "optimum[onnxruntime]>=1.24" "transformers>=4.50" onnx onnxruntime "huggingface_hub[cli]"

# The multimodal (image-text-to-text) task is what transformers.js needs.
optimum-cli export onnx \
  --model "$MODEL" \
  --task image-text-to-text \
  --dtype "$DTYPE" \
  --trust-remote-code \
  "$OUT"

echo
echo "✓ Done. ONNX build is in: $OUT"
echo
echo "Next step — publish it so the app can pull it:"
echo "  huggingface-cli login              # if you haven't already"
echo "  huggingface-cli upload YOUR-USER/medgemma-1.5-4b-it-ONNX \"$OUT\" ."
echo
echo "Then in the Hounsfield app, Settings → Custom Hugging Face model ID:"
echo "  YOUR-USER/medgemma-1.5-4b-it-ONNX"
echo "and paste your HF Read token in the token field."
