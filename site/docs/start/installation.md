# Installation

VOrchestra `0.1.0` is a pre-release desktop app. Use the GitHub release artifacts when you want to try the app as a user. Build from source when you want to contribute or validate changes locally.

## Download the release

Open the release page:

https://github.com/TI-com-Cafe/vorchestra/releases/tag/v0.1.0

Download the artifact for your operating system.

Linux:

- Use `.AppImage` when you want a portable executable.
- Use `.deb` on Debian, Ubuntu, Linux Mint, Pop!_OS, Zorin, and similar distributions.
- Use `.rpm` on Fedora, openSUSE, RHEL-compatible distributions, and similar systems.

Windows:

- Use `.msi` for a standard installer.
- Use `.exe` when available for a direct installer flow.

macOS:

- Use `.dmg`.
- If macOS blocks the app because it is unsigned or from an unidentified developer, open System Settings, review Privacy & Security, and allow the app manually.

## Linux AppImage

Make the AppImage executable and run it:

```bash
chmod +x VOrchestra*.AppImage
./VOrchestra*.AppImage
```

If the AppImage fails to launch because FUSE is missing, install your distribution's FUSE package or use the `.deb` / `.rpm` package instead.

## Linux package install

Debian/Ubuntu-like systems:

```bash
sudo apt install ./VOrchestra*.deb
vorchestra
```

Fedora/RHEL-like systems:

```bash
sudo dnf install ./VOrchestra*.rpm
vorchestra
```

## Windows install

Run the `.msi` installer. After installation, launch VOrchestra from the Start menu.

If Windows SmartScreen warns about an unknown publisher, review the release source and allow execution only if you trust the downloaded artifact.

## macOS install

Open the `.dmg`, drag VOrchestra to Applications, then launch it from Applications.

If Gatekeeper blocks the app, use the Privacy & Security panel to allow it. This is expected for early pre-release builds until signing and notarization are fully configured.

## Build from source

For contributors, use the source build path:

```bash
git clone https://github.com/TI-com-Cafe/vorchestra.git
cd vorchestra
npm install
npm run tauri dev
```

See [Build from source](./build-from-source.md) for development prerequisites and Linux WebKit dependencies.

## After installation

Continue with [Quick start](./quickstart.md).
