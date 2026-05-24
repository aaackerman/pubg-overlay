/**
 * main.js — Entry point: scene init, letter animation setup, render loop.
 */
(function () {
  const canvas = document.getElementById('canvas');

  Intro.init(canvas);
  Intro.timer.start();

  // ── Letter fly-in setup ───────────────────────────────────────────────
  // Populate #name-text with individual <span.letter> elements then store
  // per-letter animation state so animation.js can drive each one.
  // Name resolution: ?name= URL param wins; otherwise fetch PLAYER_NAME from
  // /config; otherwise "PLAYER". Letters don't animate until t=50s so the
  // fetch has plenty of time to land.
  async function resolvePlayerName() {
    const urlName = new URLSearchParams(window.location.search).get('name');
    if (urlName) return urlName;
    try {
      const res = await fetch('/config');
      if (res.ok) {
        const data = await res.json();
        if (data.playerName) return data.playerName;
      }
    } catch { /* server down — fall through */ }
    return 'PLAYER';
  }

  resolvePlayerName().then(rawName => {
    const name = rawName.toLowerCase();
    document.title = `${name} — Starting Soon`;

    const container = document.getElementById('name-text');
    const rng = (lo, hi) => lo + Math.random() * (hi - lo);

    Intro.letterStates = name.split('').map((char, i) => {
      const span = document.createElement('span');
      span.className   = 'letter';
      span.textContent = char;

      // Letters seep upward from below — positive Y = below baseline in CSS
      const startX   = rng(-4, 4);       // almost no horizontal offset
      const startY   = rng(55, 85);      // submerged below text line
      const startRot = rng(-2.5, 2.5);   // very slight tilt as it surfaces

      span.style.opacity   = 0;
      span.style.transform =
        `translate(${startX}px, ${startY}px) rotate(${startRot}deg)`;

      container.appendChild(span);

      return {
        span,
        startTime: 50 + i * 7.0,    // staggered 7 s between letters — slow seep
        duration:  14,               // each takes 14 s to fully surface
        startX, startY, startRot,
        done: false,
      };
    });
  });

  // ── Film grain ────────────────────────────────────────────────────────
  const grain = document.getElementById('grain');
  const gCtx  = grain.getContext('2d');

  function resizeGrain() {
    grain.style.width  = window.innerWidth  + 'px';
    grain.style.height = window.innerHeight + 'px';
  }
  resizeGrain();
  window.addEventListener('resize', resizeGrain);

  function drawGrain() {
    const w = Math.floor(window.innerWidth  / 3);
    const h = Math.floor(window.innerHeight / 3);
    grain.width  = w;
    grain.height = h;
    const imgd = gCtx.createImageData(w, h);
    const d    = imgd.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.random() * 255 | 0;
      d[i] = d[i+1] = d[i+2] = v; d[i+3] = 255;
    }
    gCtx.putImageData(imgd, 0, 0);
  }

  // ── Adaptive quality ──────────────────────────────────────────────────
  let lastTime   = performance.now();
  let fps        = 60;
  let frameCount = 0;
  let qualityOK  = true;

  // ── Render loop ───────────────────────────────────────────────────────
  function loop() {
    requestAnimationFrame(loop);

    const now = performance.now();
    const dt  = Math.min((now - lastTime) / 1000, 0.05);
    lastTime  = now;
    frameCount++;

    fps = fps * 0.93 + (1 / dt) * 0.07;

    // Drop ash particle size if FPS tanks
    if (qualityOK && fps < 28 && frameCount > 120) {
      qualityOK = false;
      if (Intro.ashLayer)   Intro.ashLayer.pts.material.size   *= 0.7;
      if (Intro.emberLayer) Intro.emberLayer.pts.material.size *= 0.7;
      console.warn('[Intro] FPS low — reduced particle quality');
    } else if (!qualityOK && fps > 45) {
      qualityOK = true;
    }

    Intro.timer.update();
    Intro.update(dt);

    if (frameCount % 4 === 0) drawGrain();

    Intro.renderer.render(Intro.scene, Intro.camera);
  }

  loop();
})();
