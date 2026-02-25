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

# Copy first 10 pre-converted gallery images (320x320, BGRA, 32bpp, 409600 bytes each)
# Full set is fetched from web on first wake via nle-gallery-update
# Source images should be in /work/nest-photos/ as 01.raw, 02.raw, etc.
echo "Copying gallery images (first 10)..."
PHOTO_COUNT=0
MAX_EMBED=10
for img in $WORK_DIR/nest-photos/[0-9][0-9].raw; do
  [ -f "$img" ] || continue
  [ $PHOTO_COUNT -ge $MAX_EMBED ] && break
  cp "$img" ${NLEAPIINSTALLDIR}/$(basename "$img")
  PHOTO_COUNT=$((PHOTO_COUNT + 1))
done
echo "Copied $PHOTO_COUNT gallery images"
