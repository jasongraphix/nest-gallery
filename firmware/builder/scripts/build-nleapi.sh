#!/usr/bin/env bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORK_DIR="/work"
cd "$BUILD_DIR"

# This script is called from inside Docker - no platform checks needed
# Docker ensures we're always running on Linux

echo "═══════════════════════════════════════════════════════"
echo " Setting up NLEAPI"
echo "═══════════════════════════════════════════════════════"
echo

LINUXROOT="${BUILD_DIR}/deps/root"
NLEAPIINSTALLDIR="${LINUXROOT}/tmp/nleapi"
mkdir -p ${NLEAPIINSTALLDIR}
cp $WORK_DIR/deps/nleapi ${NLEAPIINSTALLDIR}
cp $WORK_DIR/deps/httpd.monitrc ${NLEAPIINSTALLDIR}
cp $WORK_DIR/deps/version ${NLEAPIINSTALLDIR}
cp $WORK_DIR/deps/update ${NLEAPIINSTALLDIR}
cp $WORK_DIR/deps/settings ${NLEAPIINSTALLDIR}
cp $WORK_DIR/deps/nle-gallery-arm ${NLEAPIINSTALLDIR}/nle-gallery
cp $WORK_DIR/deps/nle-fetch-arm ${NLEAPIINSTALLDIR}/nle-fetch
cp $WORK_DIR/deps/nle-gallery-update ${NLEAPIINSTALLDIR}/nle-gallery-update
cp $WORK_DIR/deps/nle-gallery-start ${NLEAPIINSTALLDIR}/nle-gallery-start
cp $WORK_DIR/deps/nle-status-arm ${NLEAPIINSTALLDIR}/nle-status

# Photos are transferred over SSH/WiFi after DFU flash — not embedded in initramfs

# Add gallery config file (empty gallery URL by default — offline mode)
GALLERY_URL="${GALLERY_URL:-}"
echo "GALLERY_URL=\"$GALLERY_URL\"" > ${NLEAPIINSTALLDIR}/nle-gallery.conf
echo "Created nle-gallery.conf (GALLERY_URL='$GALLERY_URL')"
