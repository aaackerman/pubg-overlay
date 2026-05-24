# PUBG Stream Overlay — Agent Context Document

This document is written for an AI agent picking up this project. It captures design direction, technical decisions, file responsibilities, and key constants. Read this before touching anything.

---

## Project Overview

A custom Three.js stream overlay system for PUBG streamers. Two separate browser scenes served by a Node.js/Express backend on `http://localhost:3001`.

| Scene | URL | When used |
|---|---|---|
| Intro | `http://localhost:3001/intro.html` | Pre-stream countdown. Runs 5 minutes before going live. |
| Overlay | `http://localhost:3001/overlay.html` | Transparent HUD on top of PUBG game capture. |

Everything in `public/` is served as static files. `overlay.html` lives at the project root (not in `public/`) and is served by a second `express.static` on the root directory.

The streamer's in-game name is centralized in `PLAYER_NAME` in `.env`. The server exposes it via two endpoints:
- `/latest` includes `playerName` — the overlay uses it for the "isYou" squad-row highlight.
- `/config` returns `{ playerName }` — the intro scene fetches it on load to populate the seeping title letters.

For both scenes, `?name=NAME` (intro) and `?player=NAME` (overlay) URL params override the env default. The overlay's `?player=` switches the watched player entirely; the intro's `?name=` only changes the title text.

---

## Tech Stack

- **Three.js r160** — loaded via CDN UMD build (`https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js`). **NOT ES modules.** All Three.js is accessed via `window.THREE`. Do not use import/export syntax in these files.
- **Node.js / Express** — `server.js` at project root. Polls PUBG API, serves scenes, exposes `/latest` and `/status` endpoints.
- **PUBG API** — official REST API at `https://api.pubg.com/shards/steam`. Key in `.env`.
- Namespace pattern: `window.Intro = {}` — scene objects, materials, and lights are attached to this global so `animation.js` / `main.js` can drive them per-frame.

---

## Design Direction

**Aesthetic:** Dark, cinematic, military. Deep ink-black ocean surface, cold blue rim lighting, fog. Feels like a PUBG loading screen crossed with a film title sequence. Not RGB gamer, not neon — restrained and moody.

**Palette:**
- Ocean: near-black ink (`#000003` background, ocean surface `abyss: 0.002,0.004,0.016`)
- Weapons: dark polymer (`0x0b0b0e`) and cold steel (`0x0d0d14`)
- Accent light: electric blue rim (`0x1144ff`)
- Text: `#ddeeff` with blue glow, font Orbitron 900
- HUD: `rgba(8,10,16,0.58)` frosted glass panels, `#4fc3f7` blue accent

**Feel:** Slow, heavy, cinematic. Nothing snaps. Everything lerps. Weapons seep from the ocean like they have weight. Particles drift. Camera orbits slowly. The explosion is slow-motion fire and smoke, not an instant pop.

**Design preferences (refinements that came out of real streaming use):**
- No random light flicker on weapons — smooth sine variation only
- Weapon brightness should be good when the name text appears (they were too dark before)
- Pan interior shows "PUBG" stamped text, not a crosshatch grid
- Magazine on M416 curves **forward** (positive X, toward muzzle), not backward toward stock
- Grip and magazine must be two distinct visible shapes at the bottom of the M416
- Explosion should be orange-red fire with slow-motion feel — not yellow, not instant
- Name text stays **centered vertically** on screen
- Weapons should float to the sides (pan left, rifle right) so they're visible flanking the text — not buried behind it

---

## File Structure

```
pubg-overlay/
├── server.js               # Express server, PUBG API polling, /latest endpoint
├── overlay.html            # In-game transparent HUD (at ROOT, not in public/)
├── .env                    # PUBG_API_KEY, PLAYER_NAME (gitignored)
├── .env.example            # Template for .env
└── public/
    ├── AGENTS.md           # This file
    ├── intro.html          # Intro scene HTML + CSS
    └── intro/
        └── js/
            ├── scene.js    # Three.js scene setup: renderer, lights, ocean, all geometry
            ├── animation.js # Per-frame update logic: all movement, phases, HUD
            ├── timer.js    # Countdown timer (5 min), phase detection
            └── main.js     # RAF loop, resize, letter injection
```

---

## Intro Scene — Deep Dive

### Phase Timeline

The intro runs for exactly 5 minutes (300s). `timer.js` divides this into 4 phases.

| Phase | Duration | Elapsed | What happens |
|---|---|---|---|
| 1 | 90s | 0–90s | Cold open. Pan seeps from ocean. Rifle starts seeping at 35s. Letters begin at 50s. |
| 2 | 120s | 90–210s | All objects hover. Camera orbits slowly. Full particle atmosphere. |
| 3 | 60s | 210–270s | "Starting Soon" text fades in. Camera tightens zoom. |
| 4 | 30s | 270–300s | "Starting Soon" swaps to "Starting Now" with slide animation. Everything fades to black. |

### Key Constants in `animation.js`

```js
const _PAN_SURFACE   = -2.3;   // Y position of ocean surface (must match mesh in scene.js)
const GRENADE_APPEAR  = 65;     // seconds when grenade starts rising
const GRENADE_EXPLODE = 100;    // seconds when grenade detonates
const RIFLE_APPEAR    = 58;     // seconds when M416 starts seeping up
const RIFLE_RISE      = 30;     // seconds it takes M416 to fully surface
```

### Object Positions & Hover Behavior

**Pan (`Intro.panGroup`):**
- Seeps from y=-5.8, reaches ocean surface at t=45s, hovers at y≈-0.35
- During hover: `x = -1.4 + sin(elapsed * 0.08) * 0.40` — lives on LEFT side of frame
- Z drift: `z = 0.6 + cos(elapsed * 0.07) * 0.30`
- Y float: `y = -0.35 + sin(elapsed * 0.28) * 0.22`
- Slow drift periods (~70–80s full cycle) give gentle, weighty feel

**M416 (`Intro.rifleGroup`):**
- Seeps from y=-7.0, starts at t=58s, surfaces over 30s
- During hover: `x = 2.2 + sin(elapsed * 0.09) * 0.42` — lives on RIGHT side of frame
- Z drift: `z = -0.5 + cos(elapsed * 0.07) * 0.30`
- Y float: `y = 0.65 + sin(elapsed * 0.31) * 0.24`

Both weapons are intentionally offset to flanking positions so they're visible alongside the centered name text, not buried behind it.

**Grenade (`Intro.grenadeGroup`):**
- Rises from y=-6.5 at t=65s, hovers, detonates at t=100s
- Explosion: three-layer particle system — fire (orange-red, AdditiveBlending, 10s), smoke (dark, NormalBlending, 20s), embers (tiny orange, AdditiveBlending, 10s)
- Light flash on detonation: warm `0xff2200` rim, `0xff5500` key — restores to blue after 420ms

### Lights in Intro (`setupLights` in `scene.js`)

| Name | Color | Purpose |
|---|---|---|
| `Intro.dirLight` | `0xddeeff` | Key light from upper-right. Driven by smooth sine in `updateLights()` — no random flicker. |
| `Intro.rimLight` | `0x1144ff` | Blue rim from behind-left. Pops silhouettes. |
| `Intro.moonLight` | `0xaabbdd` | Soft wide fill from above. |
| `Intro.bottomLight` | `0x0022cc` | Under-ocean depth glow. Builds up through phases. |
| `Intro.objFillLight` | `0x3355aa` | Ramps from t=20s so weapons are lit when name appears at t=50s. Peaks at 2.2. |

**Critical:** `dirLight` uses `THREE.MathUtils.lerp` toward a sine target. Do NOT add random jumps or `setTimeout`-based flicker — it caused visible twitching on weapons.

### Ocean Shader

`setupLiquid()` in `intro/js/scene.js`. A `PlaneGeometry(42, 42, 160, 160)` with a custom `ShaderMaterial`.

Key details:
- 7-wave superposition: 2 slow base swells + 2 medium chop + 1 fine ripple + 2 more
- Analytical normals computed in vertex shader
- Screen-space micro-normals via `dFdx`/`dFdy` in fragment shader for specular glints
- Fresnel, anisotropic moonlight streak, moonlight path band, depth fog
- **`polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2`** — essential. Prevents z-fighting as weapons poke through the ocean surface during their seep animation.

### M416 Geometry (`buildM4` in `intro/js/scene.js`)

Materials defined at top of `buildM4`:
- `polymer` — dark matte polymer body
- `steel` — cold bright metal for barrel, rail, hardware
- `handMat` — darker than polymer, used for handguard and stock details
- `scopeM` — scope/optic housing

Key geometry layout (X axis = forward toward muzzle):
- **Barrel**: CylinderGeometry, extends to x=1.43 (long, thin)
- **Receiver**: BoxGeometry at x≈0, y≈0
- **Handguard**: quad-rail box at x=0.65, 8 rail teeth loop + 5 side teeth loop
- **Magazine**: inserts at x=+0.07 (forward of grip), banana curves **forward** to x≈+0.15 at tip. Rotation is **negative Z** on each segment. 4 segments + base plate.
- **Pistol grip**: at x=-0.165 (clearly behind the magazine). Trigger guard spans between them.
- **Stock**: solid collapsible body (Magpul CTR style) at x≈-0.73. Solid BoxGeometry body, cheek riser, adjustment slots, butt plate with rubber pad. NOT thin struts.
- **Red dot**: Aimpoint CompM4 style tube at x=0.04, y=0.128. Cylindrical tube, two dark lenses, elevation/windage turrets.

Group: `position.set(1.8, -7.0, -0.3)`, `rotation.set(0.14, -0.30, 0.06)`, `scale.setScalar(1.22)`

### Pan Geometry (`buildLodgePan` in `intro/js/scene.js`)

Lodge cast iron pan. The inner cooking surface uses a **canvas texture** with "PUBG" stamped on it (CanvasTexture, 512×512). Not a crosshatch grid — the old grid was removed.

Group: `position.set(-0.6, -5.8, 0.4)`, `rotation.set(0.25, 0.45, 0.08)`, `scale.setScalar(1.35)`

### Name Text

CSS overlay, centered vertically and horizontally via flexbox (`justify-content: center`). Font: Orbitron 900, `clamp(30px, 4.8vw, 66px)`. Blue glow text-shadow.

Letters are injected as individual `<span class="letter">` elements by `main.js`. The name source order is: `?name=` URL param → `fetch('/config').playerName` → literal `PLAYER` fallback. Each letter has its own `startTime`, `duration`, `startY`, `startRot` state in `Intro.letterStates`. They seep upward with blur clearing as they surface — `updateLetters()` in `animation.js`.

Letters begin appearing at t=50s. By this time `Intro.objFillLight` has been ramping since t=20s, so weapons are sufficiently lit. The `/config` fetch happens during page load so `Intro.letterStates` is always populated well before t=50s — but `updateLetters()` defensively bails on `!Intro.letterStates`.

### "Starting Now" Word Swap (Phase 4)

When phase 4 starts, `_startingNowAt = elapsed` is recorded. Then:
1. 0–0.32s: "Starting Soon" slides right and fades (`translateX` + opacity)
2. 0.32–0.37s: invisible gap, text content swapped to "Starting Now", positioned at `translateX(-18px)`
3. 0.37–0.73s: "Starting Now" slides in from left
4. After: fades with the rest of phase 4

All frame-accurate via `elapsed` — no `setTimeout` for visual effects.

---

## Overlay Scene — Deep Dive

`overlay.html` at project root. Transparent 1920×1080 HUD.

### Fetch Pattern

```js
const watchUser = params.get('player') || params.get('user');
const latestUrl = watchUser
  ? `http://localhost:3001/latest?player=${encodeURIComponent(watchUser)}`
  : 'http://localhost:3001/latest';
```

Polls `/latest` every 60s. `?player=Name` fetches friend stats. The server returns the most recent match immediately, then builds full-day totals in the background (6.5s per match to stay under API rate limit). The overlay picks up the full totals on the next 60s poll.

### Session Strip

5 cells: KILLS / TOP10 / WINS(%) / cycling stat / BEST GUN TODAY. The cycling stat rotates every 7s through: HS% → AVG K/MATCH → LONGEST → LAST MATCH. The squad panel cycles KILLS/DAMAGE on the same 7s clock.

### "isYou" Highlighting

The squad panel highlights one row as "you" — matched case-insensitively against `state.playerName`, which is set from the server's `/latest` payload (or hardcoded to `"You"` in demo modes).

---

## Server — Key Notes

`server.js` at project root.

- Serves `public/` AND the root directory (two `express.static` calls — needed because `overlay.html` is at root)
- On startup: backfills all of today's matches for `PLAYER_NAME` before starting live polling
- Rate limiting: 6.5s sleep between API calls during backfill; 60s poll interval during live session
- `/latest?player=NAME` → `fetchLatestForPlayer()` → immediate single-match result + background `buildDayTotalsForPlayer()`
- Player ID and payloads cached in `playerCache` (60s TTL)
- `/latest` includes `playerName: PLAYER_NAME` so the overlay can do "isYou" matching without hardcoding

---

## Things NOT To Do

- **Don't add random `Math.random()` jumps to light intensity** — causes visible weapon flicker. Use `THREE.MathUtils.lerp` toward a sine target only.
- **Don't use ES module syntax** (`import`/`export`) in any file served to the browser — Three.js is loaded as UMD.
- **Don't reference materials from `buildLodgePan` inside `buildM4`** — they're separate function scopes. `ironDk` does not exist in `buildM4`; use `handMat`.
- **Don't move the name text** — it should stay vertically centered on screen.
- **Don't make the magazine curve backward** (toward the stock, negative X). It must curve forward (positive X, toward muzzle).
- **Don't hardcode player names anywhere** — the only literal name string allowed in code is the demo-mode `"You"` placeholder. Real names flow in from `PLAYER_NAME` env / `?name=` URL params.
