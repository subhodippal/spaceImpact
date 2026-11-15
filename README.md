# MONO STRIKE

A retro monochrome side-scrolling space shooter in the style of the classic black-and-white phone games, rebuilt in 3D with [three.js](https://threejs.org/).

- **LCD mode**: rendered at low resolution, quantized to 4 green-gray shades, with a pixel grid
- **NEON mode**: full-color voxel 3D (press `C` or use the menu to switch)
- 5 stages (Outer Rim, Rock Belt, Surface Run, Deep Cavern, The Core) with a boss at the end of each. After stage 5 the stages loop and get harder.
- Pick-ups: **P** gun power (up to 3-way), **M** homing missiles, **L** piercing laser, **B** orbiting barrier, **♥** extra life
- Chiptune sound effects and music made with WebAudio, plus vibration on mobile
- Installable PWA that works offline after the first load

## Controls

On phones and tablets, the screen becomes a handheld gamepad:

- **Portrait:** game screen on top, with the D-pad (left) and A/B buttons (right) below it
- **Landscape:** D-pad on the left, game screen in the middle, A/B buttons on the right

| | Desktop | Mobile gamepad |
|---|---|---|
| Move | Arrows / WASD | D-pad: press, or slide your thumb around it (8 directions). You can also drag on the game screen. |
| Fire | Space / J / Z (hold) | **A** (hold) |
| Special | X / K / Shift | **B**. Slide from A to B and back without lifting your thumb. |
| Pause | P / Esc | PAUSE |
| Color mode | C | MODE |
| Sound | M | menu |

Gamepads work too (stick or d-pad to move, A to fire, B/X to use the special, Start to pause).
Add `?pad` to the URL to preview the mobile gamepad layout on a desktop browser.

## Run locally (PC + phone)

You need Node 16 or newer. Nothing to install: `server.js` has no dependencies.

```bash
npm start                 # or: node server.js   (port 8080)
node server.js -p 8005    # choose a port (also --port 8005, --port=8005)
PORT=8005 node server.js  # or via environment variable
npm start -- -p 8005      # pass the port through npm
```

If the chosen port is already in use, the server automatically tries the next one (8006, 8007, …) and prints the address it actually used.

The server listens on every network interface and prints two kinds of address:

```
  On this computer:  http://localhost:8080
  On your phone (same Wi-Fi):
                     http://192.168.x.x:8080   (wlan0)
```

Open the second address in your phone's browser. The phone and the PC have to be on the same Wi-Fi network.

**If the phone can't connect:**
- Allow the port through the PC's firewall. On Ubuntu: `sudo ufw allow 8080/tcp`. On Windows, click "Allow" when the firewall asks.
- Some guest and public Wi-Fi networks block devices from talking to each other ("client isolation"). Try a home network or your phone's hotspot.
- The game loads three.js from a CDN, so the phone needs internet access on its first visit.

**Install / offline on the LAN address:** browsers only enable service workers, and therefore PWA install, on HTTPS or `localhost`. Over `http://192.168.x.x` the game plays normally, but there's no "Install" option and no offline mode. To test install on a phone:
- Deploy to GitHub Pages, which uses HTTPS (recommended), or
- On Android Chrome, open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, add `http://192.168.x.x:8080`, enable it, and relaunch Chrome.

You can use any other static server instead (for example `python3 -m http.server 8080 --bind 0.0.0.0`). ES modules don't load from `file://`, so opening the HTML file directly won't work.

Debug: `?stage=3` starts on stage 3, and `?stage=3&boss` skips straight to that stage's boss.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repository.
2. In the repo, go to **Settings → Pages → Build and deployment**, set the source to **Deploy from a branch**, and pick `main` / `/ (root)`.
3. Open `https://<user>.github.io/<repo>/`. Every path is relative, so it works from a sub-path.

There's no build step. three.js loads from the unpkg CDN, pinned to version 0.160.0, and the service worker caches it for offline play.

## Updating

When you change files, bump `CACHE` in `sw.js` (for example `mono-strike-v2`) so installed copies pick up the new version.
