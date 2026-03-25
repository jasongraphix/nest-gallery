# No Longer Evil — Nest Photo Gallery

Turn your retired Nest Learning Thermostat (Gen 1 or Gen 2) into a tiny digital photo frame.

> **Warning: Experimental Software** — This firmware replaces the stock Nest software. Only use on thermostats you no longer need for heating/cooling. Flashing may brick your device.

## What It Does

Flashes custom firmware that replaces the Nest UI with a photo gallery:

- **Up to 100 photos** transferred wirelessly over WiFi after first flash
- **Auto-advance** every 10 seconds, manual browsing via the ring
- **Display sleep** after 5 minutes, wakes on ring touch
- **Update photos anytime** — no reflashing needed, just WiFi
- **Optional web gallery** — sync photos from an HTTP server automatically

## Requirements

- Nest Learning Thermostat Gen 1 or Gen 2
- USB-A to USB-A cable (Gen 2) or USB-A to Mini-USB (Gen 1)
- Device charged to at least 50%
- Device connected to your WiFi network

## Quick Start

1. **Download** the installer from [Releases](https://github.com/codykociemba/NoLongerEvil-Thermostat/releases)
2. **Run the installer** and choose **Install firmware + photos**
3. **Connect** your Nest via USB and follow the prompts to enter DFU mode
4. **Wait 3-5 minutes** for the Nest to reboot and join your WiFi network
5. **Enter the device's IP address** — find it in your router's device list
6. **Choose your photos** — use the 10 included samples or pick your own
7. **Transfer** — photos are sent over WiFi via SSH
8. **Save your device password** — displayed on the success screen, needed for future transfers from other computers

To update photos later, just run the installer and choose **Update photos**.

## Custom Photos

The installer lets you select up to 100 of your own photos (JPG, PNG, or WebP). They're automatically resized and cropped to fit the 320x320 round display. No ImageMagick or command-line tools needed.

## Web Gallery (Advanced)

For automatic photo sync from a server, enter a URL in the installer's Advanced settings. The device will check for updates each time the display wakes from sleep.

To host your own gallery:

1. Convert photos to 320x320 BGRA raw format (409,600 bytes each):
   ```bash
   magick photo.jpg -resize 320x320^ -gravity center -extent 320x320 -depth 8 BGRA:01.raw
   ```
2. Name them `01.raw`, `02.raw`, etc.
3. Create a `gallery.txt` manifest listing each filename, one per line
4. Serve over HTTP (not HTTPS — the Nest's lightweight HTTP client doesn't support TLS)
5. Enter the URL in the installer's Advanced settings during photo transfer

## Security

Each device gets a unique SSH password generated at install time. The installer displays it on the success screen — save it somewhere safe. It's also stored on your current computer and pre-filled automatically for future transfers.

SSH is only reachable on your local network. WiFi sleeps when the display is off, so the device is unreachable most of the time.

## Building From Source

The firmware build requires Docker and runs on Linux (or Docker Desktop on macOS/Windows).

```bash
# Build the firmware
cd firmware/builder
./docker-build.sh --minimal --yes

# Run the installer in development mode
cd firmware/installer
npm install
npm run electron:dev

# Package the installer for distribution
npm run package:mac     # macOS
npm run package:linux   # Linux
```

### Build Options

| Flag | Description |
|------|-------------|
| `--generation gen1\|gen2\|both` | Target device generation (default: gen2) |
| `--minimal` | SSH + root access only, skip NLE API/gallery files |
| `--enable-root-access` | Enable SSH with a unique generated password |
| `--force-build` | Force kernel rebuild even if cached |
| `--debug-pause` | Pause after initramfs extraction for manual editing |

## Project Structure

```
firmware/
  builder/          # Docker-based firmware build system
    deps/           # Gallery binary, boot logo, scripts, tools
    scripts/        # Build scripts
  installer/        # Electron app (installer UI)
    electron/       # Main process (IPC, DFU flash, SSH transfer)
    src/            # React UI components
    resources/      # Bundled firmware files and binaries
sample-photos/      # 10 sample .raw photos (320x320 BGRA)
```

## How It Works

The installer flashes three components via USB DFU (one-time):

1. **x-loader** — first-stage bootloader
2. **u-boot** — second-stage bootloader
3. **uImage** — Linux kernel with embedded initramfs

The initramfs runs an init script (`rootme`) that installs the gallery binary and scripts to the Nest's persistent NAND storage, then reboots into the stock kernel. After boot, photos are transferred over SSH via WiFi — no reflashing needed to update them.

## Credits & Acknowledgments

- **[grant-h](https://github.com/grant-h) / [ajb142](https://github.com/ajb142)** — [omap_loader](https://github.com/ajb142/omap_loader), the USB bootloader tool for OMAP devices
- **[exploiteers (GTVHacker)](https://github.com/exploiteers)** — Original [Nest DFU attack](https://github.com/exploiteers/NestDFUAttack) research
- **[FULU](https://bounties.fulu.org/)** — Funding the [Nest Learning Thermostat bounty](https://bounties.fulu.org/bounties/nest-learning-thermostat-gen-1-2) and supporting right-to-repair
- **[z3ugma](https://sett.homes)** — MQTT/Home Assistant integration

## License

MIT
