/**
 * scene.js — Three.js scene: renderer, lights, ocean shader, particles, objects.
 * All geometry and materials created once here; animation.js drives them per-frame.
 */
window.Intro = window.Intro || {};

Intro.init = function (canvas) {
  // ── Renderer ──────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.10;
  Intro.renderer = renderer;

  // ── Scene ─────────────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000003);
  scene.fog = new THREE.FogExp2(0x000008, 0.062);
  Intro.scene = scene;

  // ── Camera ────────────────────────────────────────────────────────────────
  const camera = new THREE.PerspectiveCamera(54, window.innerWidth / window.innerHeight, 0.1, 90);
  camera.position.set(0, 2.2, 8.0);
  camera.lookAt(0, 0.2, 0);
  Intro.camera = camera;

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  Intro.mouse = { x: 0, y: 0, targetX: 0, targetY: 0 };
  document.addEventListener('mousemove', (e) => {
    Intro.mouse.targetX = (e.clientX / window.innerWidth  - 0.5) * 2;
    Intro.mouse.targetY = (e.clientY / window.innerHeight - 0.5) * 2;
  });

  setupLights(scene);
  setupLiquid(scene);
  setupParticles(scene);
  setupObjects(scene);
};

// ── Shared helpers ────────────────────────────────────────────────────────
function v3(x, y, z) { return new THREE.Vector3(x, y, z); }

function metalMat(hex, rough = 0.25, metal = 0.88, emHex = 0x000000, emInt = 0) {
  return new THREE.MeshStandardMaterial({
    color: hex, roughness: rough, metalness: metal,
    emissive: emHex, emissiveIntensity: emInt,
  });
}

// ── Lights ────────────────────────────────────────────────────────────────
function setupLights(scene) {
  // Ambient — lifted slightly so midtones don't crush
  scene.add(new THREE.AmbientLight(0x060a18, 1.8));

  // Key from upper-right — reveals object surfaces
  const key = new THREE.DirectionalLight(0xddeeff, 3.2);
  key.position.set(5, 8, 4);
  scene.add(key);
  Intro.dirLight = key;

  // "Moonlight" — soft wide directional from above, slight blue-white
  const moon = new THREE.DirectionalLight(0xaabbdd, 0.9);
  moon.position.set(-2, 10, -1);
  scene.add(moon);
  Intro.moonLight = moon;

  // Rim — blue, behind-left, makes silhouettes pop
  const rim = new THREE.PointLight(0x1144ff, 4.0, 24);
  rim.position.set(-7, 4, -5);
  scene.add(rim);
  Intro.rimLight = rim;

  // Under-ocean depth glow — deep blue, builds over time
  const depth = new THREE.PointLight(0x0022cc, 0, 16);
  depth.position.set(0, -3.5, 0);
  scene.add(depth);
  Intro.bottomLight = depth;

  // Soft back-fill — prevents pure black crushing
  const fill = new THREE.PointLight(0x06091a, 0.8, 28);
  fill.position.set(0, 3, 10);
  scene.add(fill);

  // Object fill — ramps up when letters appear so pan + rifle stay readable.
  // Positioned front-left, blue-grey tint, short range so it only hits objects.
  const objFill = new THREE.PointLight(0x3355aa, 0, 14);
  objFill.position.set(-2, 2.5, 5);
  scene.add(objFill);
  Intro.objFillLight = objFill;
}

// ── Ocean liquid (GLSL — analytical normal, Fresnel, specular) ────────────
function setupLiquid(scene) {
  // Three.js provides `cameraPosition` and `modelMatrix` as built-in uniforms.
  const vert = /* glsl */`
    uniform float uTime;
    uniform float uIntensity;
    varying vec2  vUv;
    varying float vHeight;
    varying vec3  vNormal;
    varying vec3  vWorldPos;

    void main() {
      vUv = uv;
      vec3 pos = position;

      // Ink-ocean waves: heavy slow base swells + medium chop for surface texture
      // Base swells — slow, large, give the "thick fluid" weight
      float pa = pos.x * 0.052 + uTime * 0.055;
      float pb = pos.z * 0.044 + uTime * 0.042;
      float pc = pos.x * 0.118 + pos.z * 0.088 + uTime * 0.078;
      float pd = pos.z * 0.170 - pos.x * 0.128 + uTime * 0.095;
      // Medium chop — adds visible ripple texture across the surface
      float pe = pos.x * 0.360 + pos.z * 0.240 + uTime * 0.185;
      float pf = pos.z * 0.480 - pos.x * 0.310 + uTime * 0.230;
      // Fine ripple — subtle high-frequency detail that catches specular light
      float pg = pos.x * 0.780 + pos.z * 0.560 + uTime * 0.380;

      float h = sin(pa)*0.58 + sin(pb)*0.44 + sin(pc)*0.20 + sin(pd)*0.09
              + sin(pe)*0.055 + sin(pf)*0.034 + sin(pg)*0.016;

      pos.y    += h * uIntensity;
      vHeight   = h * uIntensity;
      vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;

      // Analytical surface normal — includes all wave components
      float dhdx = cos(pa)*0.052*0.58 + cos(pc)*0.118*0.20 - cos(pd)*0.128*0.09
                 + cos(pe)*0.360*0.055 - cos(pf)*0.310*0.034 + cos(pg)*0.780*0.016;
      float dhdz = cos(pb)*0.044*0.44 + cos(pc)*0.088*0.20 + cos(pd)*0.170*0.09
                 + cos(pe)*0.240*0.055 + cos(pf)*0.480*0.034 + cos(pg)*0.560*0.016;
      vNormal = normalize(vec3(-dhdx * uIntensity, 1.0, -dhdz * uIntensity));

      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `;

  const frag = /* glsl */`
    uniform float uTime;
    varying vec2  vUv;
    varying float vHeight;
    varying vec3  vNormal;
    varying vec3  vWorldPos;

    void main() {
      // ── Screen-space micro-normal — captures fine ripple detail ──────
      // dFdx/dFdy gives us the actual displaced surface tangents per fragment,
      // giving specular glints on fine ripples that vertex normals miss.
      vec3 dpdx = dFdx(vWorldPos);
      vec3 dpdy = dFdy(vWorldPos);
      vec3 microN = normalize(cross(dpdy, dpdx));
      // Blend: vertex normal for large-swell Fresnel, micro for ripple glints
      vec3 N = normalize(vNormal * 0.58 + microN * 0.42);

      // ── Deep ink-ocean palette ────────────────────────────────────────
      float t    = clamp((vHeight + 0.85) / 1.40, 0.0, 1.0);
      vec3 abyss = vec3(0.002, 0.004, 0.016);
      vec3 deep  = vec3(0.005, 0.012, 0.044);
      vec3 swell = vec3(0.010, 0.025, 0.076);
      vec3 col   = mix(abyss, deep,  clamp(t * 1.5, 0.0, 1.0));
      col        = mix(col,   swell, clamp((t - 0.46) * 3.0, 0.0, 1.0));

      // Subsurface glow hint — ink is not perfectly opaque at wave crests
      col += vec3(0.001, 0.003, 0.018) * smoothstep(0.55, 0.95, t);

      // ── Fresnel — grazing angle catches cold moonlight ────────────────
      vec3  viewDir  = normalize(cameraPosition - vWorldPos);
      float cosTheta = max(0.0, dot(N, viewDir));
      float fresnel  = pow(1.0 - cosTheta, 3.0);
      col += vec3(0.005, 0.015, 0.068) * fresnel * 1.6;

      // ── Moonlight specular — sharp peak + soft halo on ripple faces ───
      vec3  moonDir = normalize(vec3(0.22, 0.97, 0.14));
      vec3  halfVec = normalize(moonDir + viewDir);
      float hdotn   = max(0.0, dot(N, halfVec));
      float spec1   = pow(hdotn,  90.0) * 3.4;  // tight glint on ripple peaks
      float spec2   = pow(hdotn,  16.0) * 0.70; // soft halo around glint
      col += vec3(0.007, 0.020, 0.086) * (spec1 + spec2);

      // Anisotropic streak — moonlight elongated along wave fronts
      vec3  waveTan = normalize(vec3(-moonDir.z, 0.0, moonDir.x));
      float aniso   = max(0.0, dot(waveTan, halfVec));
      col += vec3(0.004, 0.011, 0.052) * pow(aniso, 20.0) * fresnel * 1.4;

      // ── Moonlight path — wide slow diagonal band across surface ───────
      float moonPath = vWorldPos.x * 0.18 + vWorldPos.z * 0.06 + uTime * 0.018;
      float moon     = pow(max(0.0, sin(moonPath) * 0.5 + 0.5), 4.0) * 0.75;
      moon          += pow(max(0.0, sin(moonPath * 0.55 + 0.60) * 0.5 + 0.5), 2.5) * 0.38;
      col += vec3(0.004, 0.011, 0.050) * moon;

      // ── Depth fog — distance fades to absolute black ──────────────────
      float dist     = length(vWorldPos.xz);
      float depthFog = 1.0 - smoothstep(14.0, 30.0, dist);
      col *= depthFog * 0.55 + 0.45;

      // ── Surface haze — very near surface slightly lighter (fog) ───────
      float surfaceHaze = smoothstep(0.72, 0.92, t);
      col += vec3(0.003, 0.008, 0.032) * surfaceHaze;

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  Intro.liquidUniforms = {
    uTime:      { value: 0.0 },
    uIntensity: { value: 0.35 },
  };

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(42, 42, 160, 160),
    new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, uniforms: Intro.liquidUniforms,
      polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2,
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -2.3;
  scene.add(mesh);
  Intro.liquid = mesh;
}

// ── Particle textures ─────────────────────────────────────────────────────
function makeSoftCircle(size, innerStop) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  g.addColorStop(0,         'rgba(255,255,255,1.0)');
  g.addColorStop(innerStop, 'rgba(255,255,255,0.35)');
  g.addColorStop(1,         'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

// ── Three-layer particle system ───────────────────────────────────────────
function setupParticles(scene) {
  const smokeTex = makeSoftCircle(64, 0.20);
  const sparkTex = makeSoftCircle(32, 0.68);

  // Layer 1 — Smoke (large, dark, slow)
  {
    const N = 650;
    const pos = new Float32Array(N*3), vel = new Float32Array(N*3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const i3 = i*3;
      pos[i3]=(Math.random()-.5)*20; pos[i3+1]=(Math.random()-.5)*10; pos[i3+2]=(Math.random()-.5)*16;
      vel[i3]=(Math.random()-.5)*.0018; vel[i3+1]=.0005+Math.random()*.0012; vel[i3+2]=(Math.random()-.5)*.0018;
      seed[i]=Math.random()*Math.PI*2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
    const mat = new THREE.PointsMaterial({ size:.65, map:smokeTex, color:0x14202e,
      transparent:true, opacity:0, sizeAttenuation:true, blending:THREE.NormalBlending, depthWrite:false });
    const pts = new THREE.Points(geo, mat);
    scene.add(pts);
    Intro.smokeLayer = { pts, pos, vel, seed, N };
  }

  // Layer 2 — Ash (small, grey-blue, medium)
  {
    const N = 4500;
    const pos = new Float32Array(N*3), col = new Float32Array(N*3),
          vel = new Float32Array(N*3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const i3 = i*3;
      pos[i3]=(Math.random()-.5)*24; pos[i3+1]=(Math.random()-.4)*13; pos[i3+2]=(Math.random()-.5)*20;
      const v=.45+Math.random()*.52; col[i3]=v; col[i3+1]=v; col[i3+2]=v+.12;
      vel[i3]=(Math.random()-.5)*.003; vel[i3+1]=.0008+Math.random()*.003; vel[i3+2]=(Math.random()-.5)*.003;
      seed[i]=Math.random()*Math.PI*2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
    geo.setAttribute('color',    new THREE.BufferAttribute(col,3));
    const mat = new THREE.PointsMaterial({ size:.052, map:sparkTex, vertexColors:true,
      transparent:true, opacity:0, sizeAttenuation:true, blending:THREE.AdditiveBlending, depthWrite:false });
    const pts = new THREE.Points(geo, mat);
    scene.add(pts);
    Intro.ashLayer = { pts, pos, col, vel, seed, N };
  }

  // Layer 3 — Electric blue embers
  {
    const N = 2000;
    const pos = new Float32Array(N*3), col = new Float32Array(N*3),
          vel = new Float32Array(N*3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const i3 = i*3;
      pos[i3]=(Math.random()-.5)*20; pos[i3+1]=(Math.random()-.3)*11; pos[i3+2]=(Math.random()-.5)*16;
      col[i3]=.04+Math.random()*.14; col[i3+1]=.22+Math.random()*.50; col[i3+2]=.78+Math.random()*.22;
      vel[i3]=(Math.random()-.5)*.004; vel[i3+1]=.0012+Math.random()*.004; vel[i3+2]=(Math.random()-.5)*.004;
      seed[i]=Math.random()*Math.PI*2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
    geo.setAttribute('color',    new THREE.BufferAttribute(col,3));
    const mat = new THREE.PointsMaterial({ size:.034, map:sparkTex, vertexColors:true,
      transparent:true, opacity:0, sizeAttenuation:true, blending:THREE.AdditiveBlending, depthWrite:false });
    const pts = new THREE.Points(geo, mat);
    scene.add(pts);
    Intro.emberLayer = { pts, pos, col, vel, seed, N };
  }
}

// ── 3D Objects ────────────────────────────────────────────────────────────
function setupObjects(scene) {
  buildLodgePan(scene);   // Phase-1 hero — emerges from ocean
  buildM4(scene);         // Phase-2 assembly
  buildBullet(scene);     // Appears at t=25s
  buildDebris(scene);     // Appears at t=25s
  buildSmokeRings(scene); // Triggered by pan breaking surface
  buildGrenade(scene);       // Appears at t=65s, detonates at t=100s
  buildAmbientBullets(scene); // Extra floating bullets
}

// ── Lodge Cast Iron Pan (HERO — emerges from ocean) ───────────────────────
function buildLodgePan(scene) {
  const iron   = new THREE.MeshStandardMaterial({ color: 0x161412, roughness: 0.76, metalness: 0.38,
    emissive: 0x040406, emissiveIntensity: 0.10 });
  const ironDk = new THREE.MeshStandardMaterial({ color: 0x0e0d0c, roughness: 0.84, metalness: 0.28 });
  const ironRidge = new THREE.MeshStandardMaterial({ color: 0x121110, roughness: 0.88, metalness: 0.22 });
  const grp = new THREE.Group();

  // Body — deep bowl, flared rim (Lodge style)
  grp.add(new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.48, 0.095, 44), iron));

  // Inner cooking surface — PUBG stamp on cast iron
  const pubgCanvas = document.createElement('canvas');
  pubgCanvas.width = pubgCanvas.height = 512;
  const pCtx = pubgCanvas.getContext('2d');
  // Dark iron base
  pCtx.fillStyle = '#0c0b0a';
  pCtx.fillRect(0, 0, 512, 512);
  // Subtle circular wear ring
  pCtx.beginPath();
  pCtx.arc(256, 256, 210, 0, Math.PI * 2);
  pCtx.strokeStyle = 'rgba(60,55,50,0.25)';
  pCtx.lineWidth = 6;
  pCtx.stroke();
  // "PUBG" stamp — pressed-in look (slightly lighter than iron)
  pCtx.font = 'bold 148px "Arial Narrow", Arial, sans-serif';
  pCtx.textAlign = 'center';
  pCtx.textBaseline = 'middle';
  pCtx.letterSpacing = '8px';
  pCtx.fillStyle = 'rgba(58, 52, 46, 0.92)';
  pCtx.fillText('PUBG', 256, 256);
  // Thin engraved edge on letters (1px lighter offset = pressed-in effect)
  pCtx.fillStyle = 'rgba(38, 34, 30, 0.55)';
  pCtx.fillText('PUBG', 258, 258);

  const pubgTex = new THREE.CanvasTexture(pubgCanvas);
  const ironStamp = new THREE.MeshStandardMaterial({
    map: pubgTex, roughness: 0.86, metalness: 0.26,
  });
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.50, 0.48, 0.022, 44), ironStamp);
  inner.position.y = 0.035;
  grp.add(inner);

  // Heavy rim lip
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.54, 0.028, 14, 52), iron);
  rim.rotation.x = -Math.PI/2; rim.position.y = 0.050;
  grp.add(rim);

  // Main handle — tapered rectangular cross-section
  const hTrans = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.060, 0.068), iron);
  hTrans.position.set(0.64, -0.004, 0);
  grp.add(hTrans);
  const hShaft = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.046, 0.052), iron);
  hShaft.position.set(1.07, -0.004, 0);
  grp.add(hShaft);
  // Hanging hole
  const hHole = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.013, 10, 20), iron);
  hHole.rotation.x = Math.PI/2; hHole.position.set(1.40, -0.004, 0);
  grp.add(hHole);

  // Helper handle posts (opposite side)
  [[-0.062], [0.062]].forEach(([z]) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.100, 8), iron);
    post.position.set(-0.62, 0.006, z);
    grp.add(post);
  });
  const hBar = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.124, 8), iron);
  hBar.rotation.z = Math.PI/2; hBar.position.set(-0.62, 0.056, 0);
  grp.add(hBar);

  // Pour spout stubs (Lodge has two small notches in rim)
  [-0.82, 0.82].forEach(angle => {
    const spout = new THREE.Mesh(new THREE.BoxGeometry(0.030, 0.022, 0.048), iron);
    spout.position.set(Math.sin(angle) * 0.54, 0.055, Math.cos(angle) * 0.54);
    grp.add(spout);
  });

  grp.position.set(-0.6, -5.8, 0.4);
  grp.rotation.set(0.25, 0.45, 0.08);
  grp.scale.setScalar(1.35);
  scene.add(grp);
  Intro.panGroup = grp;
}

// ── HK416 (seeps from ocean like the pan — phase 1.5 hero) ───────────────
function buildM4(scene) {
  const grp = new THREE.Group();

  const polymer = metalMat(0x0b0b0e, 0.65, 0.38, 0x010103, 0.03);
  const steel   = metalMat(0x0d0d14, 0.20, 0.94, 0x010109, 0.06);
  const handMat = metalMat(0x090912, 0.72, 0.32);
  const scopeM  = metalMat(0x101015, 0.20, 0.90);
  const HPI = Math.PI / 2;

  function add(geo, mat, px, py, pz, rx, ry, rz) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px || 0, py || 0, pz || 0);
    if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
    grp.add(m);
  }

  // ── Upper receiver (flat-top)
  add(new THREE.BoxGeometry(0.86, 0.116, 0.112), polymer,  0.00,  0.000, 0);
  // Full-length Picatinny rail (spans receiver + handguard)
  add(new THREE.BoxGeometry(1.42, 0.011, 0.028), steel,    0.28,  0.064, 0);
  // Charging handle
  add(new THREE.BoxGeometry(0.052, 0.034, 0.076), polymer, -0.40,  0.064, 0);
  // Ejection port cover
  add(new THREE.BoxGeometry(0.095, 0.004, 0.065), steel,    0.05,  0.002, 0.057);

  // ── Lower receiver
  add(new THREE.BoxGeometry(0.72, 0.098, 0.110), polymer,  0.04, -0.107, 0);

  // ── Barrel — long, thin, extends well past handguard
  add(new THREE.CylinderGeometry(0.019, 0.019, 1.22, 16), steel,  1.04,  0, 0, 0, 0, HPI);
  // Gas tube above barrel (visible through handguard top)
  add(new THREE.CylinderGeometry(0.006, 0.006, 0.58, 8),  steel,  0.67,  0.040, 0, 0, 0, HPI);
  // Gas block
  add(new THREE.BoxGeometry(0.060, 0.055, 0.062), steel,   0.63,  0.006, 0);
  // Flash hider — birdcage style
  add(new THREE.CylinderGeometry(0.026, 0.020, 0.068, 3),  steel,  1.430, 0, 0, 0, 0, HPI);
  add(new THREE.CylinderGeometry(0.013, 0.013, 0.046, 8),  steel,  1.476, 0, 0, 0, 0, HPI);

  // ── HK416 Quad-rail handguard — long, rectangular, very prominent
  add(new THREE.BoxGeometry(0.56, 0.086, 0.090), handMat,  0.65,  0.000, 0);
  // Top rail (flush with receiver rail)
  add(new THREE.BoxGeometry(0.56, 0.009, 0.090), steel,    0.65,  0.047, 0);
  // Rail teeth on top — 8 ridges, very characteristic HK416 look
  for (let i = 0; i < 8; i++) {
    add(new THREE.BoxGeometry(0.010, 0.013, 0.090), steel, 0.38 + i * 0.072, 0.051, 0);
  }
  // Bottom rail
  add(new THREE.BoxGeometry(0.56, 0.009, 0.090), steel,    0.65, -0.047, 0);
  // Side rail panel (left face)
  add(new THREE.BoxGeometry(0.56, 0.088, 0.009), steel,    0.65,  0.000, 0.050);
  // Side rail teeth (left face — shorter)
  for (let i = 0; i < 5; i++) {
    add(new THREE.BoxGeometry(0.010, 0.088, 0.013), steel, 0.42 + i * 0.100, 0, 0.053);
  }

  // ── Magazine — inserts forward of grip; banana curve arcs forward (positive X)
  // Mag well block (shows where mag seats into lower receiver)
  add(new THREE.BoxGeometry(0.118, 0.030, 0.096), polymer,  0.068, -0.128, 0);
  // Mag catch button (right side of mag well, small detail)
  add(new THREE.BoxGeometry(0.014, 0.026, 0.012), steel,    0.032, -0.145, 0.056);
  // 4-segment banana: top nearly vertical, bottom curves forward (positive X)
  add(new THREE.BoxGeometry(0.072, 0.124, 0.088), polymer,  0.072, -0.238, 0, 0, 0, -0.05);
  add(new THREE.BoxGeometry(0.069, 0.118, 0.086), polymer,  0.090, -0.347, 0, 0, 0, -0.13);
  add(new THREE.BoxGeometry(0.065, 0.109, 0.083), polymer,  0.117, -0.448, 0, 0, 0, -0.21);
  add(new THREE.BoxGeometry(0.060, 0.084, 0.080), polymer,  0.141, -0.537, 0, 0, 0, -0.27);
  // Mag base plate
  add(new THREE.BoxGeometry(0.076, 0.015, 0.092), polymer,  0.154, -0.581, 0, 0, 0, -0.28);

  // ── Pistol grip — sits clearly behind the mag well, near-vertical AR style
  add(new THREE.BoxGeometry(0.069, 0.200, 0.090), polymer, -0.165, -0.208, 0, 0.11, 0, 0);
  add(new THREE.BoxGeometry(0.073, 0.018, 0.092), polymer, -0.165, -0.308, 0, -0.13, 0, 0);
  // Grip backstrap ridge
  add(new THREE.BoxGeometry(0.005, 0.155, 0.092), steel,   -0.205, -0.214, 0, 0.08, 0, 0);

  // ── Trigger guard — wide enough to clearly bridge mag well and grip
  add(new THREE.BoxGeometry(0.270, 0.008, 0.092), polymer, -0.045, -0.218, 0);  // bottom bar
  add(new THREE.BoxGeometry(0.008, 0.072, 0.092), polymer, -0.178, -0.181, 0);  // grip-side post
  add(new THREE.BoxGeometry(0.008, 0.072, 0.092), polymer,  0.088, -0.181, 0);  // mag-side post

  // ── Collapsible tactical stock (Magpul CTR / HK416 A5 style)
  // Hinge block where stock meets receiver
  add(new THREE.BoxGeometry(0.028, 0.138, 0.096), polymer, -0.540,  0.006, 0);
  // Buffer tube spine running through stock
  add(new THREE.CylinderGeometry(0.024, 0.024, 0.46, 10), polymer, -0.730, -0.004, 0, 0, 0, HPI);
  // Main stock housing — solid chunky body, not struts
  add(new THREE.BoxGeometry(0.320, 0.112, 0.092), polymer, -0.730,  0.010, 0);
  // Cheek weld riser on top
  add(new THREE.BoxGeometry(0.260, 0.030, 0.094), polymer, -0.720,  0.068, 0);
  // Lock-up adjustment slots — two darker notches cut into the body
  add(new THREE.BoxGeometry(0.018, 0.116, 0.096), handMat, -0.650,  0.010, 0);
  add(new THREE.BoxGeometry(0.018, 0.116, 0.096), handMat, -0.790,  0.010, 0);
  // Release lever underneath (small tab)
  add(new THREE.BoxGeometry(0.048, 0.018, 0.034), steel,   -0.730, -0.060, 0.030);
  // Butt plate — wide solid slab
  add(new THREE.BoxGeometry(0.030, 0.170, 0.096), polymer, -0.895,  0.006, 0);
  // Rubber butt pad (slightly darker, matte)
  add(new THREE.BoxGeometry(0.018, 0.166, 0.100), handMat, -0.913,  0.006, 0);
  // Sling QD socket
  add(new THREE.TorusGeometry(0.022, 0.007, 6, 14), steel, -0.890, -0.070, 0, 0, HPI, 0);

  // ── Front flip-up sight (BUIS, near gas block)
  add(new THREE.BoxGeometry(0.010, 0.063, 0.042), steel,  0.55,  0.082, 0);
  add(new THREE.BoxGeometry(0.038, 0.008, 0.042), steel,  0.55,  0.118, 0);
  // Rear flip-up sight
  add(new THREE.BoxGeometry(0.010, 0.053, 0.040), steel, -0.30,  0.077, 0);
  add(new THREE.BoxGeometry(0.032, 0.008, 0.040), steel, -0.30,  0.107, 0);

  // ── Aimpoint CompM4-style red dot — prominent tube optic
  // QD mount base (clamps to rail)
  add(new THREE.BoxGeometry(0.130, 0.024, 0.058), scopeM,   0.040,  0.075, 0);
  // Mount riser posts (left and right of tube)
  add(new THREE.BoxGeometry(0.022, 0.042, 0.058), scopeM,  -0.032,  0.092, 0);
  add(new THREE.BoxGeometry(0.022, 0.042, 0.058), scopeM,   0.112,  0.092, 0);
  // Main cylindrical tube body
  add(new THREE.CylinderGeometry(0.032, 0.032, 0.128, 18), scopeM, 0.040, 0.128, 0, 0, 0, HPI);
  // Front lens cap — dark glass
  add(new THREE.CylinderGeometry(0.030, 0.030, 0.008, 16),
    metalMat(0x010108, 0.04, 0.98, 0x001428, 0.55),  0.108, 0.128, 0, 0, 0, HPI);
  // Rear lens
  add(new THREE.CylinderGeometry(0.030, 0.030, 0.008, 16),
    metalMat(0x010108, 0.04, 0.98, 0x001428, 0.45), -0.028, 0.128, 0, 0, 0, HPI);
  // Elevation turret (top)
  add(new THREE.CylinderGeometry(0.011, 0.011, 0.036, 8), steel,  0.040,  0.168, 0);
  // Windage turret (right side)
  add(new THREE.CylinderGeometry(0.011, 0.011, 0.036, 8), steel,  0.040,  0.128, 0.050, HPI, 0, 0);
  // Protective cap on elevation turret
  add(new THREE.CylinderGeometry(0.014, 0.014, 0.010, 8), polymer, 0.040,  0.189, 0);

  grp.position.set(1.8, -7.0, -0.3);
  grp.rotation.set(0.14, -0.30, 0.06);
  grp.scale.setScalar(1.22);
  scene.add(grp);

  Intro.rifleGroup = grp;
}

// ── Bullet casing ──────────────────────────────────────────────────────────
function buildBullet(scene) {
  const brass = metalMat(0x887020, 0.14, 0.96);
  const tip   = metalMat(0x3a5570, 0.22, 0.85, 0x000616, 0.10);
  const grp   = new THREE.Group();

  grp.add(new THREE.Mesh(new THREE.CylinderGeometry(0.040, 0.040, 0.23, 14), brass));
  const tipM = new THREE.Mesh(new THREE.CylinderGeometry(0, 0.040, 0.11, 14), tip);
  tipM.position.y = 0.17; grp.add(tipM);
  const rimM = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.007, 6, 14), brass);
  rimM.rotation.x = Math.PI/2; rimM.position.y = -0.12; grp.add(rimM);

  grp.position.set(-1.8, 0.5, 0.7);
  grp.visible = false;
  scene.add(grp);
  Intro.bulletGroup = grp;
  Intro.bulletDepth = { depthAmp: 0.35, depthFreq: 0.017, depthOffset: Math.random() * Math.PI * 2 };
}

// ── Metal debris ───────────────────────────────────────────────────────────
function buildDebris(scene) {
  const grp  = new THREE.Group();
  const mats = [
    metalMat(0x181820, 0.30, 0.88, 0x020210, 0.05),
    metalMat(0x1a1a18, 0.38, 0.72),
    metalMat(0x0c1428, 0.22, 0.90, 0x010414, 0.08),
  ];
  const debrisData = [];

  for (let i = 0; i < 32; i++) {
    const mat  = mats[i % mats.length];
    const s    = 0.016 + Math.random() * 0.065;
    const t    = Math.random();
    const geo  = t < 0.35 ? new THREE.BoxGeometry(s, s*0.28, s*0.55)
               : t < 0.65 ? new THREE.TetrahedronGeometry(s, 0)
               :             new THREE.OctahedronGeometry(s*0.65, 0);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((Math.random()-.5)*8, (Math.random()-.15)*5, (Math.random()-.5)*6);
    mesh.rotation.set(Math.random()*Math.PI*2, Math.random()*Math.PI*2, Math.random()*Math.PI*2);
    grp.add(mesh);
    debrisData.push({
      mesh,
      rotAxis:     v3(Math.random()-.5, Math.random()-.5, Math.random()-.5).normalize(),
      rotSpeed:    0.003 + Math.random() * 0.010,
      floatAmp:    0.04  + Math.random() * 0.09,
      floatFreq:   0.22  + Math.random() * 0.38,
      floatOffset: Math.random() * Math.PI * 2,
      baseY:       mesh.position.y,
    });
  }
  grp.visible = false;
  scene.add(grp);
  Intro.debrisGroup = grp;
  Intro.debrisData  = debrisData;
}

// ── Grenade (appears at t=65s, detonates at t=100s) ──────────────────────
function buildGrenade(scene) {
  const body     = new THREE.MeshStandardMaterial({ color: 0x252820, roughness: 0.72, metalness: 0.38, emissive: 0x010200, emissiveIntensity: 0.04 });
  const hardware = new THREE.MeshStandardMaterial({ color: 0x181a16, roughness: 0.42, metalness: 0.80 });
  const grp = new THREE.Group();

  // Main body
  grp.add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 28, 20), body));

  // Segmentation grooves
  [-0.07, 0.07].forEach(y => {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.208, 0.010, 8, 28), hardware);
    r.rotation.x = Math.PI / 2; r.position.y = y;
    grp.add(r);
  });
  const vg = new THREE.Mesh(new THREE.TorusGeometry(0.208, 0.010, 8, 28), hardware);
  vg.rotation.z = Math.PI / 2;
  grp.add(vg);

  // Fuse assembly
  const fuseBody = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.088, 0.115, 14), hardware);
  fuseBody.position.y = 0.245;
  grp.add(fuseBody);
  const fuseTop = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.052, 0.055, 10), hardware);
  fuseTop.position.y = 0.335;
  grp.add(fuseTop);

  // Safety spoon (lever)
  const spoon = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.175, 0.022), hardware);
  spoon.position.set(0.185, 0.13, 0);
  grp.add(spoon);

  // Safety pin ring
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.050, 0.011, 8, 16), hardware);
  ring.rotation.y = Math.PI / 2; ring.position.set(0.195, 0.295, 0);
  grp.add(ring);

  grp.position.set(2.0, -6.5, -1.0);
  grp.visible = false;
  scene.add(grp);
  Intro.grenadeGroup = grp;

  // ── Fire burst — deep orange/red, additive, slow cinematic expand (~10 s)
  {
    const N = 120, pos = new Float32Array(N*3), col = new Float32Array(N*3), vel = new Float32Array(N*3);
    for (let i = 0; i < N; i++) {
      const i3 = i*3;
      pos[i3] = pos[i3+1] = pos[i3+2] = 0;
      // Deep orange-red: high red, low-mid green (no yellow), no blue
      col[i3] = 1.0; col[i3+1] = 0.08 + Math.random() * 0.28; col[i3+2] = 0.0;
      vel[i3] = vel[i3+1] = vel[i3+2] = 0;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 1.1, map: makeSoftCircle(64, 0.10), vertexColors: true,
      transparent: true, opacity: 0, sizeAttenuation: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    pts.visible = false; scene.add(pts);
    Intro.fireBurst = { pts, pos, col, vel, N, active: false, age: 0 };
  }

  // ── Smoke columns — large dark particles, normal blending, slow billow (~20 s)
  {
    const N = 80, pos = new Float32Array(N*3), vel = new Float32Array(N*3);
    for (let i = 0; i < N; i++) { pos[i*3] = pos[i*3+1] = pos[i*3+2] = 0; vel[i*3] = vel[i*3+1] = vel[i*3+2] = 0; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 2.4, map: makeSoftCircle(64, 0.18), color: 0x1a1208,
      transparent: true, opacity: 0, sizeAttenuation: true,
      blending: THREE.NormalBlending, depthWrite: false,
    }));
    pts.visible = false; scene.add(pts);
    Intro.smokeBurst = { pts, pos, vel, N, active: false, age: 0 };
  }

  // ── Ember scatter — tiny bright sparks, wide spread, gravity fall (~10 s)
  {
    const N = 70, pos = new Float32Array(N*3), col = new Float32Array(N*3), vel = new Float32Array(N*3);
    for (let i = 0; i < N; i++) {
      const i3 = i*3;
      pos[i3] = pos[i3+1] = pos[i3+2] = 0;
      col[i3] = 1.0; col[i3+1] = 0.18 + Math.random() * 0.22; col[i3+2] = 0.0;
      vel[i3] = vel[i3+1] = vel[i3+2] = 0;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.18, map: makeSoftCircle(32, 0.65), vertexColors: true,
      transparent: true, opacity: 0, sizeAttenuation: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    pts.visible = false; scene.add(pts);
    Intro.emberBurst = { pts, pos, col, vel, N, active: false, age: 0 };
  }
}

// ── Extra ambient floating bullets ────────────────────────────────────────
function buildAmbientBullets(scene) {
  // [ x, y, z, rotX, rotY, rotZ, floatFreq, floatOffset, appearAt ]
  // appearAt = when the bullet starts fading in (seconds)
  const configs = [
    [ 2.4,  0.3,  0.5,  0.4, 1.2, 0.1, 0.15, 0.0, 28 ],
    [-2.6,  0.9, -0.4,  1.8, 0.6, 0.9, 0.21, 1.8, 36 ],
    [ 0.8, -0.2, -1.6,  0.8, 2.4, 1.4, 0.17, 3.6, 45 ],
  ];

  const bullets = configs.map(([x, y, z, rx, ry, rz, freq, off, appearAt]) => {
    // Each bullet gets its own material instances so opacity animates independently
    const brass = new THREE.MeshStandardMaterial({
      color: 0x887020, roughness: 0.14, metalness: 0.96,
      transparent: true, opacity: 0,
    });
    const tip = new THREE.MeshStandardMaterial({
      color: 0x3a5570, roughness: 0.22, metalness: 0.85,
      emissive: 0x000616, emissiveIntensity: 0.10,
      transparent: true, opacity: 0,
    });

    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.20, 12), brass));
    const tipM = new THREE.Mesh(new THREE.CylinderGeometry(0, 0.034, 0.09, 12), tip);
    tipM.position.y = 0.145; grp.add(tipM);
    const rimM = new THREE.Mesh(new THREE.TorusGeometry(0.040, 0.006, 6, 12), brass);
    rimM.rotation.x = Math.PI / 2; rimM.position.y = -0.105; grp.add(rimM);

    grp.position.set(x, y, z);
    grp.rotation.set(rx, ry, rz);
    scene.add(grp);
    return {
      grp, baseY: y, floatFreq: freq, floatOffset: off, appearAt, mats: [brass, tip],
      baseScale:   1.0,
      depthAmp:    0.22 + Math.random() * 0.38,
      depthFreq:   0.014 + Math.random() * 0.020,
      depthOffset: Math.random() * Math.PI * 2,
    };
  });
  Intro.ambientBullets = bullets;
}

// ── Cinematic fly-by bullet (periodic — passes close to camera) ───────────

// ── Smoke rings (triggered by pan breaking surface) ───────────────────────
function buildSmokeRings(scene) {
  const rings = [];
  for (let i = 0; i < 7; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x06122e, transparent: true,
      opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(0.10, 0.055, 8, 32), mat);
    mesh.rotation.x = -Math.PI/2;
    mesh.position.set(-0.6, -2.25, 0.4); // aligned with pan X/Z
    scene.add(mesh);
    rings.push({ mesh, mat, active: false, age: 0, delay: i * 0.38 });
  }
  Intro.smokeRings = rings;
}
