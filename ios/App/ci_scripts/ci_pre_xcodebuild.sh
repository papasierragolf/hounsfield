#!/bin/sh
set -e

# mlx-swift ships a build-tool plugin (CudaBuild) and swift-syntax (via
# swift-transformers) ships macros. Both normally require an interactive
# "Trust & Enable" approval the first time Xcode encounters them. Xcode Cloud
# is non-interactive, so that approval never happens and the archive fails at
# "Validate plug-in ... ** ARCHIVE FAILED **".
#
# Disable package-plugin and macro fingerprint validation so xcodebuild runs
# them without the trust prompt. (The "Validatation" typo is Apple's actual
# defaults key — do not "fix" it.)
echo "→ Disabling package plugin / macro fingerprint validation"
defaults write com.apple.dt.Xcode IDESkipPackagePluginFingerprintValidatation -bool YES
defaults write com.apple.dt.Xcode IDESkipMacroFingerprintValidation -bool YES

echo "→ Pre-xcodebuild setup complete"
