#!/bin/sh
set -e

# Xcode Cloud clones the repo but doesn't run npm install.
# @capacitor/share and @capacitor/filesystem are referenced as local Swift
# Package Manager path dependencies inside node_modules — they must exist
# before xcodebuild -resolvePackageDependencies runs.

echo "→ Installing npm dependencies"
cd "$CI_PRIMARY_REPOSITORY_PATH"
npm install

echo "→ npm install complete"
