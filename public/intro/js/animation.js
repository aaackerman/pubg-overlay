/**
 * animation.js — Per-frame update v3: pan-as-hero, cold open, Bezier assembly.
 *
 * Timeline:
 *   0–15 s   : complete silence, pan below ocean, nothing visible
 *   15–45 s  : pan slowly rises through ocean (particles whisper)
 *   25 s     : bullet and debris become visible
 *   35 s     : HK416 starts seeping from ocean
 *   ~45 s    : pan breaks surface → smoke rings fire
 *   ~57 s    : HK416 breaks surface, joins pan hover
 *   50 s+    : letters seep in one by one
 *   65 s     : grenade rises from ocean, detonates at 100 s
 *   90–210 s : Phase 2 — all objects hover, camera orbits
 *   210–270 s: Phase 3 — "Starting Soon" text, tighten zoom
 *   270–300 s: Phase 4 — everything fades to black
 */

// ── Easing ────────────────────────────────────────────────────────────────
const _c1 = 1.70158;
const _c3 = _c1 + 1;
Intro.ease = {
  inOut:   t => t < 0.5 ? 2*t*t : -1 + (4 - 2*t)*t,
  in:      t => t*t*t,
  out:     t => 1 - Math.pow(1-t, 3),
  outBack: t => 1 + _c3*Math.pow(t-1,3) + _c1*Math.pow(t-1,2),
};

// ── Letter animation state (populated by main.js) ─────────────────────
Intro.letterStates = null;

// ── Persistent state ──────────────────────────────────────────────────
let _smokeTriggered    = false;
let _rifleTriggered    = false;
let _grenadeExploded   = false;
let _startingNowAt     = -1;   // elapsed time when phase 4 began (for word swap)
const _PAN_SURFACE   = -2.3;
const GRENADE_APPEAR  = 65;
const GRENADE_EXPLODE = 100;
const RIFLE_APPEAR    = 58;  // starts seeping after pan has settled (~55 s)
const RIFLE_RISE      = 30;  // surfaces at t=88 s, right as phase 2 opens

// ── Main update ───────────────────────────────────────────────────────
Intro.update = function (dt) {
  const { phase, progress } = Intro.timer.getPhase();
  const elapsed = Intro.timer.elapsed;

  updateLiquid(elapsed);
  updateSmokeLayer(elapsed, phase, progress);
  updateAshLayer(elapsed, phase, progress);
  updateEmberLayer(elapsed, phase, progress);
  updatePan(elapsed, phase, progress);
  updateGrenade(elapsed, phase, progress);
  updateSmokeRings();
  updateRifle(elapsed, phase, progress);
  updateBullet(elapsed, phase, progress);
  updateAmbientBullets(elapsed, phase);
  updateDebris(elapsed, phase, progress);
  updateCamera(phase, progress, elapsed);
  updateLights(elapsed, phase, progress);
  updateLetters(elapsed, phase, progress);
  updateHUD(phase, progress, elapsed);
  updateFade(phase, progress);
};

// ── Liquid ────────────────────────────────────────────────────────────
function updateLiquid(elapsed) {
  Intro.liquidUniforms.uTime.value = elapsed;
  // Starts at 0.35 (visible from frame 1), slowly reaches full intensity
  const target = 0.35 + Math.min(0.65, elapsed / 30);
  Intro.liquidUniforms.uIntensity.value =
    THREE.MathUtils.lerp(Intro.liquidUniforms.uIntensity.value, target, 0.025);
}

// ── Smoke layer ───────────────────────────────────────────────────────
function updateSmokeLayer(elapsed, phase, progress) {
  const L = Intro.smokeLayer;
  if (!L) return;
  const { pts, pos, vel, seed, N } = L;

  // Cold open: whisper-faint; builds as pan rises, then follows phase
  const targetOp =
    elapsed < 25 ? (elapsed / 25) * 0.025 :
    phase === 1  ? 0.04 + Intro.ease.inOut(progress) * 0.10 :
    phase === 2  ? 0.14 + Intro.ease.inOut(progress) * 0.08 :
    phase === 3  ? 0.22 + progress * 0.12 :
                   0.34 - Intro.ease.in(progress) * 0.30;
  pts.material.opacity = THREE.MathUtils.lerp(pts.material.opacity, targetOp, 0.012);

  for (let i = 0; i < N; i++) {
    const i3 = i * 3;
    const t  = elapsed * 0.3 + seed[i];
    pos[i3]     += vel[i3]     + Math.sin(t * 0.4 + seed[i]) * 0.0006;
    pos[i3 + 1] += vel[i3 + 1];
    pos[i3 + 2] += vel[i3 + 2] + Math.cos(t * 0.35 + seed[i]) * 0.0006;
    if (pos[i3 + 1] > 8) {
      pos[i3 + 1] = -4 + Math.random() * -1;
      pos[i3]     = (Math.random() - 0.5) * 20;
      pos[i3 + 2] = (Math.random() - 0.5) * 16;
    }
  }
  pts.geometry.attributes.position.needsUpdate = true;
}

// ── Ash layer ─────────────────────────────────────────────────────────
function updateAshLayer(elapsed, phase, progress) {
  const L = Intro.ashLayer;
  if (!L) return;
  const { pts, pos, vel, seed, N } = L;

  const targetOp =
    elapsed < 25 ? (elapsed / 25) * 0.04 :
    phase === 1  ? 0.06 + Intro.ease.inOut(progress) * 0.20 :
    phase === 2  ? 0.26 + Intro.ease.inOut(progress) * 0.18 :
    phase === 3  ? 0.44 + progress * 0.22 :
                   0.66 - Intro.ease.in(progress) * 0.55;
  pts.material.opacity = THREE.MathUtils.lerp(pts.material.opacity, targetOp, 0.014);

  const speed = phase === 3 ? 1 + progress * 0.9 : phase === 4 ? 1.9 - progress * 0.9 : 1;

  for (let i = 0; i < N; i++) {
    const i3 = i * 3;
    const t  = elapsed * 0.7 + seed[i];
    pos[i3]     += vel[i3]     + Math.sin(t * 0.55 + seed[i]) * 0.0007;
    pos[i3 + 1] += vel[i3 + 1] * speed;
    pos[i3 + 2] += vel[i3 + 2] + Math.cos(t * 0.42 + seed[i]) * 0.0007;

    // Pan emergence: redirect ash to burst from the surface
    const pan = Intro.panGroup;
    if (pan && pan.position.y > -5.0 && pan.position.y < _PAN_SURFACE + 0.4 && Math.random() < 0.001) {
      const angle = Math.random() * Math.PI * 2;
      const r     = Math.random() * 0.9;
      pos[i3]     = pan.position.x + Math.sin(angle) * r;
      pos[i3 + 1] = _PAN_SURFACE;
      pos[i3 + 2] = pan.position.z + Math.cos(angle) * r;
      vel[i3 + 1] = 0.018 + Math.random() * 0.025;
    }
    // Rifle emergence: similar ash burst when it breaks the surface
    const rifle = Intro.rifleGroup;
    if (rifle && rifle.visible && rifle.position.y > -5.0 && rifle.position.y < _PAN_SURFACE + 0.6 && Math.random() < 0.0007) {
      const angle = Math.random() * Math.PI * 2;
      const r     = Math.random() * 0.7;
      pos[i3]     = rifle.position.x + Math.sin(angle) * r;
      pos[i3 + 1] = _PAN_SURFACE;
      pos[i3 + 2] = rifle.position.z + Math.cos(angle) * r;
      vel[i3 + 1] = 0.015 + Math.random() * 0.020;
    }

    if (pos[i3 + 1] > 10) {
      pos[i3 + 1] = -4 + Math.random() * -2;
      pos[i3]     = (Math.random() - 0.5) * 22;
      pos[i3 + 2] = (Math.random() - 0.5) * 18;
      vel[i3 + 1] = 0.002 + Math.random() * 0.007;
    }
  }
  pts.geometry.attributes.position.needsUpdate = true;
}

// ── Ember / spark layer ───────────────────────────────────────────────
function updateEmberLayer(elapsed, phase, progress) {
  const L = Intro.emberLayer;
  if (!L) return;
  const { pts, pos, vel, seed, N } = L;

  const targetOp =
    elapsed < 25 ? (elapsed / 25) * 0.03 :
    phase === 1  ? 0.0 + Intro.ease.inOut(progress) * 0.12 :
    phase === 2  ? 0.12 + Intro.ease.inOut(progress) * 0.18 :
    phase === 3  ? 0.30 + progress * 0.30 :
                   0.60 - Intro.ease.in(progress) * 0.55;
  pts.material.opacity = THREE.MathUtils.lerp(pts.material.opacity, targetOp, 0.016);

  const speed = phase >= 3 ? 1.6 + (phase === 3 ? progress * 0.8 : 0) : 1;

  for (let i = 0; i < N; i++) {
    const i3 = i * 3;
    const t  = elapsed * 1.1 + seed[i];
    pos[i3]     += vel[i3]     + Math.sin(t * 0.8 + seed[i]) * 0.001;
    pos[i3 + 1] += vel[i3 + 1] * speed;
    pos[i3 + 2] += vel[i3 + 2] + Math.cos(t * 0.65 + seed[i]) * 0.001;
    if (pos[i3 + 1] > 10) {
      pos[i3 + 1] = -3 + Math.random() * -1;
      pos[i3]     = (Math.random() - 0.5) * 18;
      pos[i3 + 2] = (Math.random() - 0.5) * 14;
    }
  }
  pts.geometry.attributes.position.needsUpdate = true;
}

// ── Lodge pan (HERO — rises from ocean) ───────────────────────────────
function updatePan(elapsed, phase, progress) {
  const g = Intro.panGroup;
  if (!g) return;

  if (elapsed < 15) {
    // Silent cold open — fully submerged, still
    g.position.set(-0.6, -5.8, 0.4);
    return;
  }

  if (elapsed < 45) {
    // Slow rise toward the surface (15 s → 45 s)
    const p = (elapsed - 15) / 30;
    g.position.y = THREE.MathUtils.lerp(-5.8, _PAN_SURFACE, Intro.ease.inOut(p));
    g.rotation.y = elapsed * 0.06;
  } else if (elapsed < 90) {
    // Broke surface — rise to hover, spinning faster as it clears the water
    const p = (elapsed - 45) / 45;
    g.position.y = THREE.MathUtils.lerp(_PAN_SURFACE, -0.35, Intro.ease.out(p));
    g.rotation.y = elapsed * 0.22;
    g.rotation.x = Math.sin(elapsed * 0.18) * 0.08;
  } else if (phase < 4) {
    // Hover: more active rotation early, settling over time
    const settleT   = Math.min(1, (elapsed - 90) / 80);
    const rotSpeed  = THREE.MathUtils.lerp(0.26, 0.18, settleT);
    const wobbleMag = THREE.MathUtils.lerp(0.32, 0.16, settleT);
    g.position.y = -0.35 + Math.sin(elapsed * 0.28) * 0.22;
    g.rotation.y = elapsed * rotSpeed + Math.sin(elapsed * 0.22) * wobbleMag;
    g.rotation.x = Math.sin(elapsed * 0.26) * THREE.MathUtils.lerp(0.09, 0.05, settleT);
  } else {
    // Phase 4 sink
    g.position.y = -0.35 + Math.sin(elapsed * 0.28) * 0.22 - Intro.ease.in(progress) * 5;
    g.rotation.y = elapsed * 0.24;
  }

  // Pan lives on the left — drifts further out to that side
  g.position.x = -1.4 + Math.sin(elapsed * 0.08) * 0.40;
  g.position.z =  0.6 + Math.cos(elapsed * 0.07) * 0.30;
}

// ── Grenade — emerges at t=65s, detonates at t=100s ──────────────────
function updateGrenade(elapsed, phase, progress) {
  const g = Intro.grenadeGroup;
  if (!g) return;

  if (elapsed < GRENADE_APPEAR || phase === 4) {
    g.visible = false;
    updateExplosionBurst();
    return;
  }

  if (!_grenadeExploded) {
    g.visible = true;

    if (elapsed < GRENADE_APPEAR + 20) {
      // Rise from ocean (65→85 s)
      const p = (elapsed - GRENADE_APPEAR) / 20;
      g.position.y = THREE.MathUtils.lerp(-6.5, 0.8, Intro.ease.out(p));
      g.position.x = THREE.MathUtils.lerp(2.0, 1.6, Intro.ease.out(p));
      g.position.z = THREE.MathUtils.lerp(-1.0, -0.8, Intro.ease.out(p));
      g.rotation.y = elapsed * 0.24;
      g.rotation.x = elapsed * 0.16;
    } else if (elapsed < GRENADE_EXPLODE) {
      // Hover — spinning faster as it approaches detonation (builds tension)
      const tensionP  = (elapsed - (GRENADE_APPEAR + 20)) / (GRENADE_EXPLODE - GRENADE_APPEAR - 20);
      const spinRate  = 0.22 + tensionP * 0.20;
      g.position.y    = 0.8 + Math.sin(elapsed * 0.45) * 0.10;
      g.rotation.y   += spinRate * 0.016;
      g.rotation.x    = Math.sin(elapsed * 0.22) * (0.30 + tensionP * 0.25);
      g.rotation.z    = Math.cos(elapsed * 0.18) * (0.20 + tensionP * 0.20);
    } else {
      // DETONATE
      _grenadeExploded = true;
      g.visible = false;
      triggerExplosion(g.position.clone());
    }
  }

  updateExplosionBurst();
}

function triggerExplosion(pos) {
  const fire  = Intro.fireBurst;
  const smoke = Intro.smokeBurst;
  const ember = Intro.emberBurst;
  if (!fire || !smoke || !ember) return;

  // Deep red-orange flash — not cold blue; restores original colors after
  if (Intro.rimLight && Intro.dirLight) {
    Intro.rimLight.color.setHex(0xff2200);
    Intro.rimLight.intensity = 30.0;
    Intro.dirLight.color.setHex(0xff5500);
    Intro.dirLight.intensity = 22.0;
    setTimeout(() => { if (Intro.rimLight) Intro.rimLight.intensity = 12.0; }, 50);
    setTimeout(() => { if (Intro.rimLight) Intro.rimLight.intensity = 20.0; }, 95);
    setTimeout(() => {
      if (Intro.rimLight) { Intro.rimLight.intensity = 3.5; Intro.rimLight.color.setHex(0x1144ff); }
      if (Intro.dirLight) { Intro.dirLight.intensity = 3.2; Intro.dirLight.color.setHex(0xddeeff); }
    }, 420);
  }

  // Fire burst — slow initial velocity, heavy drag = ultra slow-mo cinematic expand
  fire.active = true; fire.age = 0; fire.pts.visible = true;
  for (let i = 0; i < fire.N; i++) {
    const i3 = i * 3;
    fire.pos[i3]   = pos.x + (Math.random() - 0.5) * 0.30;
    fire.pos[i3+1] = pos.y + (Math.random() - 0.5) * 0.20;
    fire.pos[i3+2] = pos.z + (Math.random() - 0.5) * 0.30;
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);
    const speed = 0.025 + Math.random() * 0.055;  // much slower
    fire.vel[i3]   = Math.sin(phi) * Math.cos(theta) * speed;
    fire.vel[i3+1] = Math.abs(Math.cos(phi)) * speed + 0.012 + Math.random() * 0.028;
    fire.vel[i3+2] = Math.sin(phi) * Math.sin(theta) * speed;
  }
  fire.pts.geometry.attributes.position.needsUpdate = true;

  // Smoke columns — very slow, thick billowing rise
  smoke.active = true; smoke.age = 0; smoke.pts.visible = true;
  for (let i = 0; i < smoke.N; i++) {
    const i3 = i * 3;
    smoke.pos[i3]   = pos.x + (Math.random() - 0.5) * 0.55;
    smoke.pos[i3+1] = pos.y + (Math.random() - 0.5) * 0.30;
    smoke.pos[i3+2] = pos.z + (Math.random() - 0.5) * 0.55;
    const theta = Math.random() * Math.PI * 2;
    const speed = 0.008 + Math.random() * 0.018;  // slower radial spread
    smoke.vel[i3]   = Math.cos(theta) * speed;
    smoke.vel[i3+1] = 0.006 + Math.random() * 0.016;  // slower rise
    smoke.vel[i3+2] = Math.sin(theta) * speed;
  }
  smoke.pts.geometry.attributes.position.needsUpdate = true;

  // Ember scatter — slower arc, orange-red, gravity pulls them down
  ember.active = true; ember.age = 0; ember.pts.visible = true;
  for (let i = 0; i < ember.N; i++) {
    const i3 = i * 3;
    ember.pos[i3]   = pos.x + (Math.random() - 0.5) * 0.25;
    ember.pos[i3+1] = pos.y + (Math.random() - 0.5) * 0.20;
    ember.pos[i3+2] = pos.z + (Math.random() - 0.5) * 0.25;
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);
    const speed = 0.045 + Math.random() * 0.090;  // slower scatter
    ember.vel[i3]   = Math.sin(phi) * Math.cos(theta) * speed;
    ember.vel[i3+1] = Math.abs(Math.cos(phi)) * speed * 0.7 + 0.018;
    ember.vel[i3+2] = Math.sin(phi) * Math.sin(theta) * speed;
  }
  ember.pts.geometry.attributes.position.needsUpdate = true;
}

function updateExplosionBurst() {
  _updateFireBurst();
  _updateSmokeBurst();
  _updateEmberBurst();
}

function _updateFireBurst() {
  const b = Intro.fireBurst;
  if (!b || !b.active) return;
  b.age += 0.016;
  const LIFE = 10.0;  // hangs longer
  if (b.age > LIFE) { b.pts.material.opacity = 0; b.pts.visible = false; b.active = false; return; }
  const peakT = 1.2;  // slower build to peak
  b.pts.material.opacity = Math.max(0,
    b.age < peakT
      ? Intro.ease.out(b.age / peakT) * 0.82
      : 0.82 * Intro.ease.out(1 - (b.age - peakT) / (LIFE - peakT))
  );
  const drag = Math.max(0.90, 1 - b.age * 0.028);  // light drag — stays slow throughout
  for (let i = 0; i < b.N; i++) {
    const i3 = i * 3;
    b.vel[i3]   *= drag; b.vel[i3+2] *= drag;
    b.vel[i3+1] *= 0.97; b.vel[i3+1] += 0.0004;
    b.pos[i3]   += b.vel[i3]; b.pos[i3+1] += b.vel[i3+1]; b.pos[i3+2] += b.vel[i3+2];
  }
  b.pts.geometry.attributes.position.needsUpdate = true;
}

function _updateSmokeBurst() {
  const b = Intro.smokeBurst;
  if (!b || !b.active) return;
  b.age += 0.016;
  const LIFE = 20.0;
  if (b.age > LIFE) { b.pts.material.opacity = 0; b.pts.visible = false; b.active = false; return; }
  const peakT = 2.8;
  b.pts.material.opacity = Math.max(0,
    b.age < peakT
      ? Intro.ease.out(b.age / peakT) * 0.52
      : 0.52 * (1 - Intro.ease.in((b.age - peakT) / (LIFE - peakT)))
  );
  const drag = Math.max(0.94, 1 - b.age * 0.002);
  for (let i = 0; i < b.N; i++) {
    const i3 = i * 3;
    b.vel[i3]   *= drag; b.vel[i3+2] *= drag;
    b.vel[i3+1] += 0.00022;
    b.pos[i3]   += b.vel[i3]; b.pos[i3+1] += b.vel[i3+1]; b.pos[i3+2] += b.vel[i3+2];
  }
  b.pts.geometry.attributes.position.needsUpdate = true;
}

function _updateEmberBurst() {
  const b = Intro.emberBurst;
  if (!b || !b.active) return;
  b.age += 0.016;
  const LIFE = 10.0;
  if (b.age > LIFE) { b.pts.material.opacity = 0; b.pts.visible = false; b.active = false; return; }
  const peakT = 0.25;
  b.pts.material.opacity = Math.max(0,
    b.age < peakT
      ? Intro.ease.out(b.age / peakT) * 0.95
      : 0.95 * (1 - Intro.ease.in((b.age - peakT) / (LIFE - peakT)))
  );
  const drag = Math.max(0.82, 1 - b.age * 0.025);
  for (let i = 0; i < b.N; i++) {
    const i3 = i * 3;
    b.vel[i3]   *= drag; b.vel[i3+2] *= drag;
    b.vel[i3+1] *= 0.97; b.vel[i3+1] -= 0.0004;
    b.pos[i3]   += b.vel[i3]; b.pos[i3+1] += b.vel[i3+1]; b.pos[i3+2] += b.vel[i3+2];
  }
  b.pts.geometry.attributes.position.needsUpdate = true;
}

// ── Smoke rings (pan surface break effect) ────────────────────────────
function updateSmokeRings() {
  if (!Intro.smokeRings) return;
  const pan = Intro.panGroup;

  if (!_smokeTriggered && pan && pan.position.y > _PAN_SURFACE) {
    _smokeTriggered = true;
    Intro.smokeRings.forEach(r => { r.active = true; r.age = -r.delay; });
  }

  Intro.smokeRings.forEach(r => {
    if (!r.active) return;
    r.age += 0.016;
    if (r.age < 0) return;
    const life = r.age / 3.5;
    if (life >= 1) { r.mat.opacity = 0; return; }
    const s = 0.5 + life * 6.5;
    r.mesh.scale.set(s, 1, s);
    r.mat.opacity = (1 - life) * 0.38 * Math.min(1, r.age * 4);
  });
}

// ── HK416 — seeps from ocean like the pan ─────────────────────────────
function updateRifle(elapsed, phase, progress) {
  const g = Intro.rifleGroup;
  if (!g) return;

  if (elapsed < RIFLE_APPEAR) {
    g.visible = false;
    return;
  }
  g.visible = true;

  if (elapsed < RIFLE_APPEAR + RIFLE_RISE) {
    // Slow seep through the surface
    const rp = (elapsed - RIFLE_APPEAR) / RIFLE_RISE;
    g.position.y = THREE.MathUtils.lerp(-7.0, 0.65, Intro.ease.out(rp));
    // Gentle rotation while rising — slightly faster than pan, gun feels heavier
    g.rotation.y = -0.26 + elapsed * 0.055;
    g.rotation.x =  0.16 + Math.sin(elapsed * 0.16) * 0.04;

    // Flash as it breaks surface (once)
    if (!_rifleTriggered && g.position.y > _PAN_SURFACE - 0.1) {
      _rifleTriggered = true;
      if (Intro.rimLight) {
        const orig = Intro.rimLight.intensity;
        Intro.rimLight.intensity = 8.0;
        setTimeout(() => { if (Intro.rimLight) Intro.rimLight.intensity = orig; }, 120);
      }
    }
  } else if (phase < 4) {
    // Hover — settles like the pan, independent timing
    const rfSettle   = Math.min(1, (elapsed - (RIFLE_APPEAR + RIFLE_RISE)) / 70);
    const rfRotSpeed = THREE.MathUtils.lerp(0.22, 0.13, rfSettle);
    g.rotation.y     = elapsed * rfRotSpeed;
    g.rotation.x     = 0.16 + Math.sin(elapsed * 0.25) * THREE.MathUtils.lerp(0.07, 0.04, rfSettle);
    g.position.y     = 0.65 + Math.sin(elapsed * 0.31) * 0.24;
  } else {
    // Phase 4 — sink back
    g.position.y = 0.65 + Math.sin(elapsed * 0.31) * 0.24 - Intro.ease.in(progress) * 5;
    g.rotation.y = elapsed * 0.18;
  }

  // Rifle lives on the right — drifts further out to that side
  g.position.x = 2.2 + Math.sin(elapsed * 0.09) * 0.42;
  g.position.z = -0.5 + Math.cos(elapsed * 0.07) * 0.30;
}

// ── Bullet ────────────────────────────────────────────────────────────
function updateBullet(elapsed, phase, progress) {
  const g  = Intro.bulletGroup;
  const bd = Intro.bulletDepth;
  if (!g) return;

  if (elapsed < 25) { g.visible = false; return; }
  g.visible = true;

  if (phase < 4) {
    g.rotation.y = elapsed * 0.85;
    g.rotation.x = elapsed * 0.28;
    g.position.y = 0.45 + Math.sin(elapsed * 0.52) * 0.13;
    g.position.x = -1.7 + Math.sin(elapsed * 0.17) * 0.11;
    // Depth drift — slow approach/recede
    if (bd) {
      const depthT = Math.sin(elapsed * bd.depthFreq + bd.depthOffset) * 0.5 + 0.5;
      g.scale.setScalar(THREE.MathUtils.lerp(0.60, 0.60 + bd.depthAmp * 2.2, depthT));
    }
  } else {
    g.scale.setScalar(Math.max(0.001, 1 - Intro.ease.in(progress)));
  }
}

// ── Ambient bullets — extra floating instances ────────────────────────
function updateAmbientBullets(elapsed, phase) {
  const bullets = Intro.ambientBullets;
  if (!bullets) return;
  bullets.forEach((b, i) => {
    // Target opacity: 0 before appearAt, fades in over 12 s, fades out in phase 4
    const age = elapsed - b.appearAt;
    const targetOp =
      phase === 4 ? 0 :
      age   < 0   ? 0 :
                    Math.min(1, age / 12);

    b.mats.forEach(m => {
      m.opacity = THREE.MathUtils.lerp(m.opacity, targetOp, 0.025);
    });

    if (b.mats[0].opacity > 0.02) {
      b.grp.position.y = b.baseY + Math.sin(elapsed * b.floatFreq + b.floatOffset) * 0.13;
      b.grp.rotation.y += 0.004 + i * 0.002;
      b.grp.rotation.x += 0.002;
      // Depth drift — scale pulses slowly, making each bullet feel like it drifts toward viewer
      const depthT = Math.sin(elapsed * b.depthFreq + b.depthOffset) * 0.5 + 0.5;
      b.grp.scale.setScalar(b.baseScale * THREE.MathUtils.lerp(0.60, 0.60 + b.depthAmp * 2.0, depthT));
    }
  });
}

// ── Debris ────────────────────────────────────────────────────────────
function updateDebris(elapsed, phase, progress) {
  const g = Intro.debrisGroup;
  if (!g) return;

  if (elapsed < 25) { g.visible = false; return; }
  g.visible = true;

  Intro.debrisData.forEach(d => {
    d.mesh.rotateOnAxis(d.rotAxis, d.rotSpeed);
    d.mesh.position.y = d.baseY + Math.sin(elapsed * d.floatFreq + d.floatOffset) * d.floatAmp;
  });
  if (phase === 4) {
    g.scale.setScalar(Math.max(0.001, 1 - Intro.ease.in(progress) * 0.88));
  }
}

// ── Camera ────────────────────────────────────────────────────────────
function updateCamera(phase, progress, elapsed) {
  const cam   = Intro.camera;
  const mouse = Intro.mouse;

  mouse.x = THREE.MathUtils.lerp(mouse.x, mouse.targetX, 0.05);
  mouse.y = THREE.MathUtils.lerp(mouse.y, mouse.targetY, 0.05);

  // Phase 1: slow pull-in — builds tension during cold open and pan emergence
  let baseX = 0, baseY = 2.2, baseZ = 8.2;

  if (phase === 1) {
    baseZ = 8.2 - Intro.ease.inOut(progress) * 0.6;
    baseY = 2.2 - progress * 0.22;
  } else if (phase === 2) {
    const angle = elapsed * 0.022;   // very slow drift — observer, not showcase
    baseX = Math.sin(angle) * 2.0;
    baseZ = Math.cos(angle) * 7.8;
    baseY = 2.0 + Math.sin(elapsed * 0.06) * 0.18;
  } else if (phase === 3) {
    baseZ = 7.6 - progress * 1.3;
    baseY = 2.0 - progress * 0.35;
  } else {
    baseZ = 6.3 + Intro.ease.in(progress) * 2.5;
    baseY = 1.7 + Intro.ease.in(progress) * 1.8;
  }

  const parallax = phase >= 2 ? 0.22 : 0.08;
  cam.position.x = THREE.MathUtils.lerp(cam.position.x, baseX + mouse.x * parallax, 0.008);
  cam.position.y = THREE.MathUtils.lerp(cam.position.y, baseY - mouse.y * parallax * 0.4, 0.008);
  cam.position.z = THREE.MathUtils.lerp(cam.position.z, baseZ, 0.005);
  cam.lookAt(0, 0.35, 0);
}

// ── Lights ────────────────────────────────────────────────────────────
function updateLights(elapsed, phase, progress) {
  Intro.rimLight.intensity = 3.5 + Math.sin(elapsed * 0.32) * 0.5;

  // Smooth dirLight variation — slow sine only, no random jumps
  Intro.dirLight.intensity = THREE.MathUtils.lerp(
    Intro.dirLight.intensity,
    3.0 + Math.sin(elapsed * 0.08) * 0.4,
    0.025
  );

  const depthTarget =
    phase === 1 ? 0 :
    phase === 2 ? progress * 0.8 :
    phase === 3 ? 0.8 + progress * 1.2 :
                  2.0 - Intro.ease.in(progress) * 1.8;
  Intro.bottomLight.intensity = THREE.MathUtils.lerp(Intro.bottomLight.intensity, depthTarget, 0.022);

  // Object fill: starts building from t=20s so weapons are already lit when
  // letters begin seeping in at t=50s.
  if (Intro.objFillLight) {
    const objFillTarget =
      elapsed < 20  ? 0 :
      elapsed < 50  ? Intro.ease.out((elapsed - 20) / 30) * 0.85 :
      elapsed < 90  ? 0.85 + Intro.ease.inOut((elapsed - 50) / 40) * 1.35 :
      phase < 4     ? 2.2 - progress * 0.55 :
                      0;
    Intro.objFillLight.intensity = THREE.MathUtils.lerp(
      Intro.objFillLight.intensity, objFillTarget, 0.018
    );
  }
}

// ── Letter seep-from-water emergence ──────────────────────────────────
// Letters rise from below like ink solidifying out of the ocean surface.
// No fly-in — just slow, heavy upward seep with blur clearing as they surface.
function updateLetters(elapsed, phase, progress) {
  const container = document.getElementById('name-text');
  if (!container) return;

  // Container: no global blur — handled per-letter
  container.style.filter = 'none';
  container.style.opacity = phase === 4
    ? Math.max(0, 1 - Intro.ease.in(progress) * 1.2)
    : 1;

  if (!Intro.letterStates) return;

  Intro.letterStates.forEach(state => {
    if (state.done) return;
    const age = elapsed - state.startTime;

    if (age < 0) {
      // Not yet — hold submerged
      state.span.style.opacity   = 0;
      state.span.style.filter    = 'blur(8px)';
      state.span.style.transform = `translateY(${state.startY}px)`;
      return;
    }

    const p  = Math.min(1, age / state.duration);
    const ep = Intro.ease.out(p);   // decelerate as it surfaces, no snap

    // Blur clears slowly as letter breaks through surface
    const blurPx = Math.max(0, 6 * (1 - ep * 1.2));

    state.span.style.opacity   = Math.min(1, ep * 1.3);
    state.span.style.filter    = `blur(${blurPx}px)`;
    state.span.style.transform =
      `translateY(${state.startY * (1 - ep)}px) rotate(${state.startRot * (1 - ep)}deg)`;

    if (p >= 1) {
      state.done = true;
      state.span.style.opacity   = 1;
      state.span.style.filter    = 'none';
      state.span.style.transform = 'none';
    }
  });
}

// ── HUD (Countdown + Starting Soon → Starting Now) ────────────────────
function updateHUD(phase, progress, elapsed) {
  const startingEl  = document.getElementById('starting-soon');
  const countdownEl = document.getElementById('countdown');

  const cdTarget =
    elapsed < 25 ? 0.18 + (elapsed / 25) * 0.12 :
    phase === 1  ? 0.10 + Intro.ease.inOut(progress) * 0.22 :
    phase === 2  ? 0.32 + Intro.ease.inOut(progress) * 0.35 :
    phase === 3  ? 0.67 + progress * 0.30 :
                   Math.max(0, 1 - Intro.ease.in(progress) * 1.8);
  countdownEl.style.opacity = cdTarget;
  countdownEl.textContent   = Intro.timer.format(Intro.timer.getRemaining());

  const SS_START    = 122;
  const SS_DURATION = 28;

  if (elapsed < SS_START) {
    startingEl.style.opacity   = 0;
    startingEl.style.filter    = 'blur(8px)';
    startingEl.style.transform = 'none';
  } else if (phase === 4) {
    // Record when phase 4 began
    if (_startingNowAt < 0) _startingNowAt = elapsed;
    const swapAge = elapsed - _startingNowAt;

    const SLIDE_OUT = 0.32;  // seconds to slide "Soon" out
    const GAP       = 0.05;  // brief invisible gap while text swaps
    const SLIDE_IN  = 0.36;  // seconds to slide "Now" in

    if (swapAge < SLIDE_OUT) {
      // "Starting Soon" slides right and fades
      const p = Intro.ease.in(swapAge / SLIDE_OUT);
      startingEl.style.opacity   = (0.88 * (1 - p)).toString();
      startingEl.style.transform = `translateX(${p * 22}px)`;
      startingEl.style.filter    = 'blur(0px)';
    } else if (swapAge < SLIDE_OUT + GAP) {
      // Invisible — swap the word
      startingEl.textContent     = 'Starting Now';
      startingEl.style.opacity   = '0';
      startingEl.style.transform = 'translateX(-18px)';
      startingEl.style.filter    = 'blur(0px)';
    } else if (swapAge < SLIDE_OUT + GAP + SLIDE_IN) {
      // "Starting Now" slides in from left
      const p = Intro.ease.out((swapAge - SLIDE_OUT - GAP) / SLIDE_IN);
      startingEl.style.opacity   = (0.88 * p).toString();
      startingEl.style.transform = `translateX(${-18 * (1 - p)}px)`;
      startingEl.style.filter    = 'blur(0px)';
    } else {
      // Word swap done — fade out with the rest of phase 4
      startingEl.style.transform = 'translateX(0)';
      const fadeP = Math.max(0, (progress - 0.06) / 0.94);
      startingEl.style.opacity   = Math.max(0, 0.88 * (1 - Intro.ease.in(fadeP) * 1.4));
      startingEl.style.filter    = 'blur(0px)';
    }
  } else {
    const p  = Math.min(1, (elapsed - SS_START) / SS_DURATION);
    const ep = Intro.ease.inOut(p);
    startingEl.style.opacity   = ep * 0.88;
    startingEl.style.filter    = `blur(${7 * (1 - ep)}px)`;
    startingEl.style.transform = 'none';
  }
}

// ── Final fade to black ───────────────────────────────────────────────
function updateFade(phase, progress) {
  document.getElementById('fade-overlay').style.opacity =
    phase === 4 ? Intro.ease.inOut(progress) : 0;
}
