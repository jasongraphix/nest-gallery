# No Longer Evil — Nest Photo Gallery

Turn your Nest Learning Thermostat (Gen 1 or Gen 2) into a tiny digital photo frame.

> **Warning: Experimental Software** — This firmware replaces the stock Nest software. Only use on thermostats you no longer need for heating/cooling. Flashing may brick your device.

## What It Does

Flashes custom firmware that replaces the Nest UI with a photo gallery:

- **10 photos** embedded directly in the firmware (works offline)
- **Auto-advance** every 10 seconds, manual browsing via the ring
- **Display sleep** after 5 minutes, wakes on ring touch
- **Optional web gallery** — fetch additional photos from an HTTP server over WiFi

## Requirements

- Nest Learning Thermostat Gen 1 or Gen 2
- USB-A to USB-A cable (Gen 2) or USB-A to Mini-USB (Gen 1)
- Device charged to at least 50%

## Quick Start

1. **Download** the installer from [Releases](https://github.com/codykociemba/NoLongerEvil-Thermostat/releases)
2. **Connect** your Nest to your computer via USB
3. **Run the installer** — it walks you through putting the Nest into DFU mode
4. **Choose your photos** — use the 10 included samples or select your own
5. **Flash** — the installer handles everything
6. **Wait 3-5 minutes** for the Nest to boot and start the gallery

## Custom Photos

The installer lets you select up to 10 of your own photos (JPG, PNG, or WebP). They're automatically resized and cropped to fit the 320x320 round display. No ImageMagick or command-line tools needed.

## Web Gallery (Advanced)

For more than 10 photos, you can host them on an HTTP server:

1. Convert photos to 320x320 BGRA raw format (409,600 bytes each)
2. Name them `01.raw`, `02.raw`, etc.
3. Create a `gallery.txt` manifest listing each filename, one per line
4. Serve over HTTP (not HTTPS — the Nest's lightweight HTTP client doesn't support TLS)
5. Enter the URL in the installer's Advanced settings

The thermostat checks for new photos each time the display wakes from sleep.

## Building From Source

The firmware build requires Docker and runs on Linux (or Docker Desktop on macOS/Windows).

```bash
# Build the firmware
cd firmware/builder
./docker-build.sh --generation gen2 --enable-root-access --yes

# Build the installer
cd firmware/installer
npm install
npm run electron:dev    # development
npm run package:mac     # production build
```

### Build Options

| Flag | Description |
|------|-------------|
| `--generation gen1\|gen2\|both` | Target device generation |
| `--gallery-url <url>` | Set web gallery URL (empty = offline only) |
| `--enable-root-access` | Enable SSH access (password: `nolongerevil`) |
| `--api-url <url>` | Override the API server URL |
| `--force-build` | Force kernel rebuild |
| `--debug-pause` | Pause after initramfs extraction for manual editing |

## Project Structure

```
firmware/
  builder/          # Docker-based firmware build system
    deps/           # Gallery binary, scripts, tools
    scripts/        # Build scripts
  installer/        # Electron app (installer UI)
    electron/       # Main process (IPC, USB, firmware repack)
    src/            # React UI components
    resources/      # Bundled firmware files
sample-photos/      # 10 sample JPG photos
```

## How It Works

The installer flashes three components via USB DFU:

1. **x-loader** — first-stage bootloader
2. **u-boot** — second-stage bootloader
3. **uImage** — Linux kernel with embedded initramfs

The initramfs contains an init script (`rootme`) that copies the gallery binary, scripts, and photos to the Nest's persistent NAND storage. On subsequent boots, the gallery starts automatically.

## Security Considerations

- Only use on devices you own
- Root SSH access is optional and password-protected
- The firmware redirects the Nest's cloud connection — it will no longer contact Google/Nest servers
- Improper firmware can brick your device

## Credits & Acknowledgments

- **[grant-h](https://github.com/grant-h) / [ajb142](https://github.com/ajb142)** — [omap_loader](https://github.com/ajb142/omap_loader), the USB bootloader tool for OMAP devices
- **[exploiteers (GTVHacker)](https://github.com/exploiteers)** — Original [Nest DFU attack](https://github.com/exploiteers/NestDFUAttack) research
- **[FULU](https://bounties.fulu.org/)** — Funding the [Nest Learning Thermostat bounty](https://bounties.fulu.org/bounties/nest-learning-thermostat-gen-1-2) and supporting right-to-repair
- **[z3ugma](https://sett.homes)** — MQTT/Home Assistant integration

## License

MIT
