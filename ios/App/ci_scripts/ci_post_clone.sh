#!/bin/sh
set -e

# Xcode Cloud clones the repo but doesn't run npm install, and its build image
# ships without Node/npm on the PATH. @capacitor/share and @capacitor/filesystem
# are referenced as local Swift Package Manager path dependencies inside
# node_modules — they must exist before xcodebuild -resolvePackageDependencies.

# Homebrew is preinstalled on Xcode Cloud images. Install Node via brew; the
# unversioned formula symlinks node/npm onto the default PATH.
echo "→ Installing Node via Homebrew"
export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALL_CLEANUP=1
brew install node

echo "→ Node $(node --version), npm $(npm --version)"

echo "→ Installing npm dependencies"
cd "$CI_PRIMARY_REPOSITORY_PATH"
npm install

echo "→ npm install complete"
