// AI disclosure: written with AI assistance (Claude) for Team Dahna, NASA Space Apps 2026.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const { gsap, ScrollTrigger } = window;
gsap.registerPlugin(ScrollTrigger);
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
let lenis = null;
if (!matchMedia('(prefers-reduced-motion: reduce)').matches && window.Lenis) {
  lenis = new window.Lenis({ lerp: 0.085, wheelMultiplier: 0.9, anchors: { offset: 0 } });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add(t => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}
const scrollToY = y => (lenis ? lenis.scrollTo(y, { duration: 1.4 }) : window.scrollTo({ top: y, behavior: 'smooth' }));
// progressive textures: 4K first, 8K when the GPU allows it
function progressiveTexture(renderer, name, onSwap) {
  const tl = new THREE.TextureLoader();
  const prep = t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t; };
  const tex = prep(tl.load(`assets/globes/${name}.jpg?v=20`));
  if (renderer.capabilities.maxTextureSize >= 8192) {
    tl.load(`assets/globes/${name}-8k.jpg?v=20`, hi => onSwap(prep(hi)), undefined, () => {});
  }
  return tex;
}
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const D2R = Math.PI / 180;
const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

const TWIN = {
  Mars: { label: 'Mars', range: '−90 to +20 °C', swing: 110, gravity: '0.38 g', kmPerDeg: 59.16, src: 'NASA Mars Trek · Viking MDIM 2.1' },
  Moon: { label: 'Moon', range: '−170 to +120 °C', swing: 290, gravity: '0.17 g', kmPerDeg: 30.32, src: 'NASA Moon Trek · LRO WAC' },
};

/* =========================================================
   1 · Opening globe: Earth turns to Arabia, then becomes Mars
   ========================================================= */
function initGlobe() {
  const canvas = document.getElementById('globe');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  camera.position.set(0, 0, 4.2);

  const uniforms = {
    uEarth: { value: null }, uMars: { value: null },
    uMix: { value: 0 }, uSun: { value: new THREE.Vector3(-0.35, 0.3, 0.88).normalize() },
  };
  uniforms.uEarth.value = progressiveTexture(renderer, 'earth', t => { uniforms.uEarth.value = t; });
  uniforms.uMars.value = progressiveTexture(renderer, 'mars', t => { uniforms.uMars.value = t; });
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv=uv; vec4 wp=modelMatrix*vec4(position,1.); vN=normalize(mat3(modelMatrix)*normal);
      vV=normalize(cameraPosition-wp.xyz); gl_Position=projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: `uniform sampler2D uEarth; uniform sampler2D uMars; uniform float uMix; uniform vec3 uSun;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        vec3 e=texture2D(uEarth,vUv).rgb; vec3 m=texture2D(uMars,vUv).rgb*1.08;
        // dissolve with a soft front so the change reads as material, not a crossfade
        float n=fract(sin(dot(floor(vUv*vec2(900.,450.)),vec2(12.9898,78.233)))*43758.5453);
        float edge=smoothstep(uMix-.08,uMix+.08,mix(vUv.x*.6+.2+n*.08,1.,0.));
        float k=clamp(uMix*1.25-(vUv.x*.25),0.,1.);
        vec3 c=mix(e,m,smoothstep(0.,1.,k));
        float d=max(dot(vN,uSun),0.);
        float light=.08+.97*smoothstep(-.12,.5,d);
        float rim=pow(1.-max(dot(vN,vV),0.),3.2);
        vec3 atm=mix(vec3(.45,.62,.85),vec3(.85,.52,.33),uMix);
        c=c*light + atm*rim*(.28+.6*d);
        gl_FragColor=vec4(c,1.);
        #include <colorspace_fragment>
      }`,
  });
  const tilt = new THREE.Group();
  const spin = new THREE.Group();
  const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), mat);
  spin.add(globe); tilt.add(spin); scene.add(tilt);

  // halo
  const halo = new THREE.Mesh(new THREE.SphereGeometry(1.04, 64, 48), new THREE.ShaderMaterial({
    uniforms: { uMix: uniforms.uMix }, transparent: true, side: THREE.BackSide, depthWrite: false,
    vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 wp=modelMatrix*vec4(position,1.);
      vN=normalize(mat3(modelMatrix)*normal); vV=normalize(cameraPosition-wp.xyz); gl_Position=projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: `uniform float uMix; varying vec3 vN; varying vec3 vV; void main(){
      float f=pow(1.-abs(dot(vN,vV)),5.); vec3 c=mix(vec3(.42,.6,.9),vec3(.86,.5,.3),uMix);
      gl_FragColor=vec4(c,f*.55); }`,
  }));
  tilt.add(halo);

  // star field (static points)
  const N = 2600, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, r = 60;
    const s = Math.sqrt(1 - u * u);
    pos.set([r * s * Math.cos(t), r * u, r * s * Math.sin(t)], i * 3);
    const b = 0.35 + Math.random() * 0.65; col.set([b, b * 0.96, b * 0.9], i * 3);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.4, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.8 })));

  // keyframes: lon/lat that faces the camera, camera distance, Earth→Mars mix
  const K = [
    { p: 0.00, lon: 18, lat: 8, dist: 5.6, y: -0.74, mix: 0 },   // whole Earth under the title
    { p: 0.30, lon: 45, lat: 23, dist: 2.05, y: -0.32, mix: 0 },  // dive in: Arabia fills the screen
    { p: 0.50, lon: 45, lat: 23, dist: 1.95, y: -0.32, mix: 0 },
    { p: 0.74, lon: 26, lat: 23, dist: 2.05, y: -0.32, mix: 1 },  // the ground turns into Mars, close up
    { p: 1.00, lon: 16, lat: 18, dist: 5.0, y: -0.7, mix: 1 },    // pull back to reveal the whole planet
  ];
  const sample = p => {
    for (let i = 0; i < K.length - 1; i++) {
      const a = K[i], b = K[i + 1];
      if (p <= b.p) { const t = ease((p - a.p) / (b.p - a.p)); return { lon: lerp(a.lon, b.lon, t), lat: lerp(a.lat, b.lat, t), dist: lerp(a.dist, b.dist, t), y: lerp(a.y, b.y, t), mix: lerp(a.mix, b.mix, t) }; }
    }
    return K[K.length - 1];
  };

  let target = 0, cur = 0, visible = true, t0 = performance.now();
  ScrollTrigger.create({ trigger: '.opening', start: 'top top', end: 'bottom bottom', onUpdate: s => { target = s.progress; } });
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);

  // story beats
  const beats = [...document.querySelectorAll('.beat')];
  // each beat owns a scroll window; windows never overlap, so two texts can never show together
  const WIN = [[-1, 0.17], [0.27, 0.5], [0.66, 2]], FADE = 0.06;
  const smooth01 = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const paintBeats = p => beats.forEach((el, i) => {
    const [a, b] = WIN[i];
    const vin = smooth01((p - a) / FADE), vout = smooth01((b - p) / FADE), o = Math.min(vin, vout);
    const dy = p < a + FADE ? (1 - vin) * 26 : (vout < 1 ? -(1 - vout) * 26 : 0);
    el.style.opacity = o.toFixed(3);
    el.style.transform = `translate(-50%, ${dy.toFixed(1)}px)`;
    el.style.filter = o > 0.98 ? 'none' : `blur(${((1 - o) * 10).toFixed(1)}px)`;
    el.style.visibility = o < 0.01 ? 'hidden' : 'visible';
  });
  const coord = document.getElementById('coord');

  function layout() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  addEventListener('resize', layout); layout();

  renderer.setAnimationLoop(now => {
    if (!visible) return;
    cur += (target - cur) * (reduce ? 1 : 0.075);
    const s = sample(cur);
    const drift = reduce ? 0 : ((now - t0) / 1000) * 0.6; // slow idle drift, in degrees
    spin.rotation.y = -Math.PI / 2 - (s.lon + (cur < 0.02 ? drift : 0)) * D2R;
    tilt.rotation.x = s.lat * D2R;
    uniforms.uMix.value = s.mix;
    const wide = canvas.clientWidth > 900;
    tilt.position.set(0, s.y * (wide ? 1 : 1.08), 0);
    camera.position.z = s.dist * (wide ? 1.5 : 1.9);
    paintBeats(cur);
    coord.textContent = s.mix < 0.5
      ? `EARTH · ${s.lat.toFixed(1)}°N ${s.lon.toFixed(1)}°E`
      : `MARS · ${cur > 0.75 ? 'ARABIA TERRA · ' : ''}${s.lat.toFixed(1)}°N ${s.lon.toFixed(1)}°E`;
    renderer.render(scene, camera);
  });
}

/* =========================================================
   2 · Site explorer: real SRTM terrain block + Sentinel-2
   ========================================================= */
function scoreOf(s) {
  const aridity = clamp(100 - s.climate.rainMm);
  const swing = s.climate.tsMax - s.climate.tsMin;       // ground (skin) temperature, like the Mars/Moon figures
  const thermal = clamp((swing / TWIN[s.body].swing) * 100);
  const parts = [
    { k: 'Geology', v: s.geologyMatch.score, how: 'geologic maps', m: 1 },
    { k: 'Terrain', v: s.terrainMatch.score, how: 'measured', m: 1 },
    { k: 'Aridity', v: Math.round(aridity), how: 'measured', m: 1 },
    { k: 'Thermal swing', v: Math.round(thermal), how: 'measured', m: 1 },
  ];
  const total = Math.round(parts[0].v * 0.35 + parts[1].v * 0.25 + parts[2].v * 0.25 + parts[3].v * 0.15);
  return { total, parts };
}

function strataTexture() {
  // eight even rock layers across the slab, warm sandstone to dark basalt
  const bands = ['#b8956c', '#8f6d4d', '#c4a27a', '#7a5a40', '#a8845f', '#6a4d36', '#9c7a57', '#5b412d'];
  const c = document.createElement('canvas'); c.width = 8; c.height = 256;
  const g = c.getContext('2d');
  bands.forEach((col, i) => { g.fillStyle = col; g.fillRect(0, i * 32, 8, 32); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter; t.flipY = false; return t;
}

async function initExplorer() {
  const res = await fetch('assets/data.json?v=53');
  const data = await res.json();
  const sites = data.sites;
  document.getElementById('genNote').textContent =
    `Data downloaded ${data.generated}. NASA POWER values are long-term monthly climatology at each site's centre point. Geology compares rock classes from geologic maps plus a cited landform match; terrain compares SRTM with MOLA or LOLA at the same pixel size.`;

  const canvas = document.getElementById('terrain');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.3;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
  camera.position.set(3.4, 2.35, 3.4);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.06;
  controls.enableZoom = false; controls.zoomToCursor = true; controls.minDistance = 0.8; controls.maxDistance = 7;
  controls.minPolarAngle = 0.05; controls.maxPolarAngle = 1.5;
  controls.enablePan = false; controls.autoRotate = !reduce; controls.autoRotateSpeed = 0.25;
  controls.target.set(0, 0, 0);

  scene.add(new THREE.HemisphereLight(0xfffaf2, 0x8a7a68, 1.1));
  const sun = new THREE.DirectionalLight(0xffe2bf, 2.6);
  sun.position.set(-2.6, 3.2, 1.8); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2 });
  scene.add(sun);

  // soft contact shadow under the block
  const sc = document.createElement('canvas'); sc.width = sc.height = 256;
  const sg = sc.getContext('2d'); const gr = sg.createRadialGradient(128, 128, 20, 128, 128, 128);
  gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); sg.fillStyle = gr; sg.fillRect(0, 0, 256, 256);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false, opacity: 0.45 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.17; scene.add(floor);
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.ShadowMaterial({ opacity: 0.18 }));
  catcher.rotation.x = -Math.PI / 2; catcher.position.y = -0.165; catcher.receiveShadow = true; scene.add(catcher);

  const G = 513, SIZE = 2, BASE = -0.15;
  const topGeo = new THREE.PlaneGeometry(SIZE, SIZE, G - 1, G - 1); topGeo.rotateX(-Math.PI / 2);
  const topMat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
  const top = new THREE.Mesh(topGeo, topMat); top.castShadow = top.receiveShadow = true; scene.add(top);

  const sideGeo = new THREE.BufferGeometry();
  const sidePos = new Float32Array(4 * G * 2 * 3), sideUv = new Float32Array(4 * G * 2 * 2), idx = [];
  for (let s = 0; s < 4; s++) for (let i = 0; i < G - 1; i++) {
    const a = (s * G + i) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  sideGeo.setAttribute('position', new THREE.BufferAttribute(sidePos, 3));
  sideGeo.setAttribute('uv', new THREE.BufferAttribute(sideUv, 2));
  sideGeo.setIndex(idx);
  const strata = strataTexture();
  const side = new THREE.Mesh(sideGeo, new THREE.MeshStandardMaterial({ map: strata, roughness: 1, side: THREE.DoubleSide }));
  side.castShadow = true;
  scene.add(side);

  const cache = new Map(), tl = new THREE.TextureLoader();
  async function load(s, twin = false) {
    const key = s.id + (twin ? ':twin' : '');
    if (cache.has(key)) return cache.get(key);
    const [buf, tex] = await Promise.all([
      fetch(`assets/sites/${s.id}-${twin ? 'twin-height' : 'height'}.bin?v=40`).then(r => r.arrayBuffer()),
      tl.loadAsync(`assets/sites/${s.id}-${twin ? 'twin' : 'sat'}.jpg?v=20`),
    ]);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const raw = new Uint16Array(buf), n = Math.round(Math.sqrt(raw.length));
    let a = Float32Array.from(raw, x => x / 65535), b = new Float32Array(a.length);
    for (let pass = 0; pass < 2; pass++) {           // two 5x5 box passes ~ gentle gaussian
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        let sum = 0, c = 0;
        for (let dy = -2; dy <= 2; dy++) { const yy = y + dy; if (yy < 0 || yy >= n) continue;
          for (let dx = -2; dx <= 2; dx++) { const xx = x + dx; if (xx < 0 || xx >= n) continue; sum += a[yy * n + xx]; c++; } }
        b[y * n + x] = sum / c;
      }
      [a, b] = [b, a];
    }
    const v = { h: a, tex }; cache.set(key, v); return v;
  }

  let current = null, exag = 2, view = 'earth';
  const dims = s => view === 'twin' ? { relief: s.twinDem.relief, widthM: s.twinDem.widthM }
    : { relief: s.dem.relief, widthM: s.half * 2 * 111320 * Math.cos(s.lat * D2R) };
  function shape(s, h) {
    const { relief, widthM } = dims(s);
    const k = (relief / widthM) * SIZE * exag; // exag 1 = true scale
    const p = topGeo.attributes.position;
    for (let i = 0; i < G * G; i++) p.setY(i, h[i] * k);
    p.needsUpdate = true; topGeo.computeVertexNormals();
    // side walls follow the edge profile
    const edge = (s2, i) => {
      if (s2 === 0) return [i, 0]; if (s2 === 1) return [G - 1, i]; if (s2 === 2) return [G - 1 - i, G - 1]; return [0, G - 1 - i];
    };
    for (let s2 = 0; s2 < 4; s2++) for (let i = 0; i < G; i++) {
      const [c, r] = edge(s2, i), vi = r * G + c;
      const x = p.getX(vi), y = p.getY(vi), z = p.getZ(vi), a = (s2 * G + i) * 2;
      sidePos.set([x, y, z, x, BASE, z], a * 3);
      const u = (s2 + i / (G - 1)) * 2;
      sideUv.set([u, Math.min(1, (y - BASE) / -BASE), u, 0], a * 2); // slab height = 8 layers
    }
    sideGeo.attributes.position.needsUpdate = true; sideGeo.attributes.uv.needsUpdate = true; sideGeo.computeVertexNormals();
  }

  // ---------- panel ----------
  const $ = id => document.getElementById(id);
  const rail = $('rail');
  sites.forEach((s, i) => {
    const li = document.createElement('li'); const b = document.createElement('button');
    b.textContent = s.name.replace(/,.*$/, ''); b.addEventListener('click', () => goTo(i)); li.appendChild(b); rail.appendChild(li);
  });

  const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const CITIES = [['Madinah', 24.47, 39.61], ['Khaybar', 25.70, 39.29], ['Tabuk', 28.38, 36.57], ['AlUla', 26.62, 37.92],
    ['Riyadh', 24.71, 46.68], ['Jeddah', 21.54, 39.17], ['Taif', 21.27, 40.42], ['Al-Kharj', 24.15, 47.31],
    ['Wadi ad-Dawasir', 20.47, 44.78], ['Najran', 17.49, 44.13], ['Sharurah', 17.47, 47.12], ['Haradh', 24.12, 49.07], ['Al-Hofuf', 25.38, 49.59]];
  const kmTo = (a, b, c, d) => { const R = 6371, p1 = a * D2R, p2 = c * D2R, dp = (c - a) * D2R, dl = (d - b) * D2R;
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  function fillPlan(s) {
    const near = CITIES.map(([n, la, lo]) => [n, kmTo(s.lat, s.lng, la, lo)]).sort((a, b) => a[1] - b[1])[0];
    const ok = s.climate.monthlyMax.map(t => t <= 36.5);
    const okNames = MONTH_NAMES.filter((_, i) => ok[i]);
    $('pGrid').innerHTML = `
      <div><dt>Nearest city, straight line</dt><dd>${Math.round(near[1])}<small>km · ${near[0]}</small></dd></div>
      <div><dt>Test area in this block</dt><dd>${fmt(s.dem.areaKm2)}<small>km²</small></dd></div>
      <div><dt>Driveable ground, slope under 15°</dt><dd>${s.dem.trafficable}<small>%</small></dd></div>
      <div><dt>Steep ground, over 25°</dt><dd>${s.dem.steep}<small>%</small></dd></div>`;
    $('pMonths').innerHTML = s.climate.monthlyMax.map((t, i) =>
      `<span class="${ok[i] ? 'ok' : ''}" title="${MONTH_NAMES[i]}: mean max ${t} °C"><i></i>${MONTHS[i]}</span>`).join('');
    $('pList').innerHTML = s.plan.map(t => `<li>${t}</li>`).join('');
    $('pNote').textContent = `Field season (highlighted): ${okNames.join(', ') || 'none'}, the months whose mean daily maximum stays at or below 36.5 °C in NASA POWER. Slopes from SRTM over this block.` +
      (s.id === 'jirsan' ? ' Cave position is approximate; the published study does not give exact coordinates.' : '');
  }
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    ['overview', 'data', 'plan'].forEach(t => { $('tab-' + t).hidden = b.dataset.tab !== t; });
    if (!reduce) gsap.fromTo('#tab-' + b.dataset.tab, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.5, ease: 'expo.out' });
  }));

  // ---------- small SVG charts (Saudi = ink, twin = mars orange) ----------
  const TW_RANGE = { Mars: [-90, 20], Moon: [-170, 120] };
  function profileSVG(pr, label) {
    const W = 360, H = 120, P = 22, all = [...pr.earth, ...pr.twin], top = Math.max(10, ...all);
    const pts = a => a.map((v, i) => `${(P + i / (a.length - 1) * (W - P - 4)).toFixed(1)},${(H - 18 - v / top * (H - 34)).toFixed(1)}`).join(' ');
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Cross-section, Saudi site and ${label} twin, same scale">
      <line x1="${P}" x2="${W - 4}" y1="${H - 18}" y2="${H - 18}" class="ax"/>
      <text x="${P}" y="${H - 4}" class="tk">0</text><text x="${W - 4}" y="${H - 4}" class="tk" text-anchor="end">${pr.km} km</text>
      <text x="${P}" y="10" class="tk">${fmt(top)} m higher than the lowest point</text>
      <polyline points="${pts(pr.twin)}" class="ln tw"/><polyline points="${pts(pr.earth)}" class="ln ea"/></svg>`;
  }
  function histSVG(h, label) {
    const W = 360, H = 120, P = 6, n = h.earth.length, bw = (W - 2 * P) / n, top = Math.max(...h.earth, ...h.twin);
    const bars = h.earth.map((v, i) => {
      const x = P + i * bw, he = v / top * (H - 34), ht = h.twin[i] / top * (H - 34);
      return `<rect x="${x + 3}" y="${H - 18 - he}" width="${bw / 2 - 4}" height="${he}" class="ea"/>
        <rect x="${x + bw / 2 + 1}" y="${H - 18 - ht}" width="${bw / 2 - 4}" height="${ht}" class="tw"/>
        <text x="${x + bw / 2}" y="${H - 4}" class="tk" text-anchor="middle">${h.edges[i]}${i === n - 1 ? '+' : ''}°</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Share of ground in each slope class, Saudi site and ${label} twin">${bars}</svg>`;
  }
  function tempSVG(c, body) {
    const W = 360, H = 150, P = 30, [lo, hi] = TW_RANGE[body], mn = Math.min(lo, ...c.tsMonthMin) - 5, mx = Math.max(hi, ...c.tsMonthMax) + 5;
    const y = v => (H - 18 - (v - mn) / (mx - mn) * (H - 28)).toFixed(1), bw = (W - P - 4) / 12;
    const months = c.tsMonthMax.map((t, i) => `<rect x="${P + i * bw + 3}" y="${y(t)}" width="${bw - 6}" height="${(y(c.tsMonthMin[i]) - y(t)).toFixed(1)}" rx="3" class="ea"/>
      <text x="${P + i * bw + bw / 2}" y="${H - 4}" class="tk" text-anchor="middle">${MONTHS[i]}</text>`).join('');
    const ticks = [mn + 5, 0, mx - 5].map(v => Math.round(v)).filter((v, i, a) => a.indexOf(v) === i)
      .map(v => `<text x="${P - 4}" y="${+y(v) + 4}" class="tk" text-anchor="end">${v}°</text><line x1="${P}" x2="${W - 4}" y1="${y(v)}" y2="${y(v)}" class="gr"/>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Monthly ground temperature range against the ${body} surface range">
      <rect x="${P}" y="${y(hi)}" width="${W - P - 4}" height="${(y(lo) - y(hi)).toFixed(1)}" class="band"/>${ticks}${months}
      <text x="${W - 8}" y="${+y(lo) - 6}" class="tk tw-t" text-anchor="end">${body} surface ${lo}° to +${hi}°</text></svg>`;
  }
  const legend = label => `<p class="lg"><i class="ea"></i>Saudi site <i class="tw"></i>${label} twin</p>`;

  const fmt = (n, d = 0) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
  function fillPanel(s) {
    if (!reduce) gsap.fromTo('.card .site-head, .card .score, .card .tabpane:not([hidden])', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.6, ease: 'expo.out', stagger: 0.05 });
    const sc = scoreOf(s), T = TWIN[s.body];
    $('sAr').textContent = s.ar; $('sName').textContent = s.name; $('sKind').textContent = s.kind;
    gsap.fromTo({ v: Number($('sScore').textContent) || 0 }, { v: Number($('sScore').textContent) || 0 },
      { v: sc.total, duration: 0.9, ease: 'expo.out', onUpdate() { $('sScore').textContent = Math.round(this.targets()[0].v); } });
    $('sParts').innerHTML = sc.parts.map(p => `<div class="${p.m ? 'meas' : ''}"><dt>${p.k}<i>${p.how}</i></dt><dd><b style="width:0"></b></dd><span>${p.v}</span></div>`).join('');
    requestAnimationFrame(() => [...$('sParts').querySelectorAll('b')].forEach((b, i) => { b.style.width = sc.parts[i].v + '%'; }));
    const km = Math.round(s.thalf * 2 * T.kmPerDeg * Math.cos(s.tlat * D2R));
    $('tImg').src = `assets/sites/${s.id}-twin.jpg?v=20`;
    $('tImg').alt = `${T.label}: ${s.twin}, orbital mosaic`;
    $('tCap').innerHTML = `<b>${T.label} twin</b><br>${s.twin}<br>~${fmt(km)} km across · ${T.src}`;
    const c = s.climate, d = s.dem;
    $('sFacts').innerHTML = `
      <dt class="h">Measured · SRTM elevation</dt>
      <dt>Elevation</dt><dd>${fmt(d.elevMin)}–${fmt(d.elevMax)} m</dd>
      <dt>Mean slope / 90th pct.</dt><dd>${d.slopeMean}° / ${d.slopeP90}°</dd>
      <dt class="h">Measured · NASA POWER</dt>
      <dt>Ground temperature range</dt><dd>${c.tsMin} to ${c.tsMax} °C</dd>
      <dt>Air, hottest month mean max</dt><dd>${c.tMaxHot} °C</dd>
      <dt>Rain per year</dt><dd>${fmt(c.rainMm)} mm</dd>
            <dt class="h">${T.label} reference</dt>
      <dt>Surface temperature</dt><dd>${T.range}</dd>
      <dt>Gravity</dt><dd>${T.gravity}</dd>`;
    const tm = s.terrainMatch, g = s.geologyMatch, row = (k, a, b, u = '') => `<tr><th>${k}</th><td>${a}${u}</td><td>${b}${u}</td></tr>`;
    $('sCmp').innerHTML = `
      <h3>Side by side, measured</h3>
      <p class="cmp-note">Both grounds resampled to the same ${fmt(tm.cellM)} m pixels over the central ${tm.windowKm} km.</p>
      <table><thead><tr><th></th><th>Saudi site</th><th>${T.label} twin</th></tr></thead><tbody>
        ${row('Mean slope', tm.earth.slopeMean, tm.twin.slopeMean, '°')}
        ${row('Steepest 10% from', tm.earth.slopeP90, tm.twin.slopeP90, '°')}
        ${row('Roughness (slope spread)', tm.earth.rough, tm.twin.rough, '°')}
        ${row('Relief per km', fmt(tm.earth.reliefPerKm, 1), fmt(tm.twin.reliefPerKm, 1), ' m')}
        ${row('Ground temperature range', fmt(c.tsMax - c.tsMin), T.swing, ' °C')}
        ${row('Rock class', g.earthClass, g.twinClass)}
      </tbody></table>
      <h4>Cross-section through the centre, same scale</h4>${legend(T.label)}${profileSVG(tm.profile, T.label)}
      <h4>Slope mix: share of ground in each slope class</h4>${legend(T.label)}${histSVG(tm.slopeHist, T.label)}
      <p class="cmp-note">Driveable under 15°: Saudi ${Math.round(100 * tm.slopeHist.earth.slice(0, 6).reduce((a, b) => a + b, 0))}% · ${T.label} ${Math.round(100 * tm.slopeHist.twin.slice(0, 6).reduce((a, b) => a + b, 0))}%</p>
      <h4>Ground temperature, each month (NASA POWER) vs ${T.label}</h4>${tempSVG(c, s.body)}
      <p class="cmp-note">Bars: lowest night to highest day ground temperature per month. Shaded: ${T.label}'s surface range. Arabia covers ${Math.round(100 * (c.tsMax - c.tsMin) / T.swing)}% of it.</p>
      <p class="cmp-score">Terrain match <b>${tm.score}</b> = slope shape ${tm.parts.slopeShape} · roughness ${tm.parts.roughness} · relief ${tm.parts.relief}<br>
      Geology match <b>${g.score}</b> = rock class ${g.rock} · landform ${g.feature}</p>
      <dl class="geo">
        <dt>Saudi rock</dt><dd>${g.earth}<small>${g.earthSrc}</small></dd>
        <dt>${T.label} rock</dt><dd>${g.twin}<small>${g.twinSrc}</small></dd>
        <dt>Landform</dt><dd>${g.featureNote}</dd>
      </dl>`;
    $('sBases').innerHTML = s.bases.map(b => `<li><span class="bw ${b.world.toLowerCase()}">${b.world}</span><div><b>${b.site}</b><i>${b.task}</i></div></li>`).join('');
    $('sHolds').innerHTML = s.holds.map(t => `<li>${t}</li>`).join('');
    $('sBreaks').innerHTML = s.breaks.map(t => `<li>${t}</li>`).join('');
    $('sTest').textContent = s.test;
    paintSrc(s);
    [...rail.querySelectorAll('button')].forEach((b, i) => b.setAttribute('aria-current', String(sites[i] === s)));
    fillPlan(s);
  }

  const viewBtns = [...document.querySelectorAll('.view button')];
  function paintSrc(s) {
    const T = TWIN[s.body], d = s.dem, t = s.twinDem;
    viewBtns[1].textContent = `${T.label} twin`;
    $('vpSrc').textContent = view === 'twin'
      ? `${s.twin} · ${fmt(t.widthM / 1000)} km across · ${fmt(t.relief)} m relief · ${t.src} elevation, ${T.src.replace(/^NASA /, '')} imagery`
      : `${s.lat.toFixed(3)}°N ${s.lng.toFixed(3)}°E · ${fmt(Math.sqrt(d.areaKm2), 1)} km across · ${fmt(d.relief)} m relief · Sentinel-2 cloudless (ESA/EOX) draped on SRTM elevation`;
  }
  let token = 0;
  async function show(i, force = false) {
    const s = sites[i]; if (current === s && !force) return;
    const siteChanged = current !== s; current = s;
    const my = ++token;
    if (siteChanged) fillPanel(s); else paintSrc(s);
    $('tLoading').classList.add('on');
    const { h, tex } = await load(s, view === 'twin');
    if (my !== token) return;
    $('tLoading').classList.remove('on');
    topMat.map = tex; topMat.needsUpdate = true;
    side.material.color.set(view !== 'twin' ? 0xffffff : s.body === 'Moon' ? 0x8f8c88 : 0xe39a76); // rock layers match the world
    const { relief, widthM } = dims(s), trueH = (relief / widthM) * SIZE;
    exag = trueH > 0.06 ? 1 : trueH > 0.02 ? 2 : 4; // steep blocks read best at true scale, flat ones need lift
    document.querySelectorAll('.exag button').forEach(x => x.classList.toggle('on', Number(x.dataset.ex) === exag));
    shape(s, h);
    top.scale.y = 0.001; side.scale.y = 0.001;
    gsap.to([top.scale, side.scale], { y: 1, duration: reduce ? 0 : 1.4, ease: 'expo.out' });
    if (!reduce) gsap.fromTo(camera.position, { x: 4.6, y: 3.3, z: 4.6 }, { x: 3.4, y: 2.35, z: 3.4, duration: 1.6, ease: 'expo.out' });
  }

  document.querySelectorAll('.exag button').forEach(b => b.addEventListener('click', () => {
    exag = Number(b.dataset.ex);
    document.querySelectorAll('.exag button').forEach(x => x.classList.toggle('on', x === b));
    if (current) shape(current, cache.get(current.id + (view === 'twin' ? ':twin' : '')).h);
  }));
  viewBtns.forEach(b => b.addEventListener('click', () => {
    if (view === b.dataset.view) return;
    view = b.dataset.view;
    viewBtns.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    viewBtns.forEach(x => x.classList.toggle('on', x === b));
    document.querySelector('.ex-stage').classList.toggle('twin-view', view === 'twin');
    if (current) show(sites.indexOf(current), true);
  }));

  const explorer = document.querySelector('.explorer');
  const st = ScrollTrigger.create({
    trigger: explorer, start: 'top top', end: 'bottom bottom',
    onUpdate: self => show(Math.min(sites.length - 1, Math.floor(self.progress * sites.length * 0.9999))),
  });
  ScrollTrigger.refresh();
  addEventListener('load', () => ScrollTrigger.refresh());
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
  function goTo(i) {
    const y = st.start + ((i + 0.5) / sites.length) * (st.end - st.start);
    if (reduce) window.scrollTo(0, y); else scrollToY(y);
  }
  window.goToSite = id => { const i = sites.findIndex(s => s.id === id); if (i >= 0) goTo(i); };
  document.querySelectorAll('a[data-site]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); window.goToSite(a.dataset.site); }));
  // twin lightbox
  const lb = $('lightbox');
  $('tZoom').addEventListener('click', () => {
    $('lbImg').src = $('tImg').src; $('lbImg').alt = $('tImg').alt; $('lbCap').innerHTML = $('tCap').innerHTML;
    lb.showModal();
  });
  lb.addEventListener('click', e => { if (e.target === lb) lb.close(); });

  let visible = false;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
  const cardEl = document.querySelector('.card');
  // zoom: Ctrl/⌘ + scroll anytime (plain scroll keeps scrolling the page); free explore mode unlocks everything
  const stage = document.querySelector('.ex-stage'), exBtn = $('exploreBtn');
  let exploring = false;
  addEventListener('wheel', e => { controls.enableZoom = exploring || e.ctrlKey || e.metaKey; }, { capture: true, passive: true });
  const setExplore = on => {
    exploring = on;
    stage.classList.toggle('exploring', on);
    controls.enablePan = on; controls.autoRotate = !on && !reduce; controls.enableZoom = on;
    exBtn.setAttribute('aria-pressed', String(on));
    exBtn.querySelector('span').textContent = on ? 'Done' : 'Explore freely';
    if (lenis) on ? lenis.stop() : lenis.start();
    if (!on) { controls.target.set(0, 0, 0); gsap.to(camera.position, { x: 3.4, y: 2.35, z: 3.4, duration: 1.2, ease: 'expo.out' }); }
    requestAnimationFrame(layout);
  };
  exBtn.addEventListener('click', () => setExplore(!exploring));
  addEventListener('keydown', e => { if (e.key === 'Escape' && exploring) setExplore(false); });
  function layout() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    const side = w > 1100 && !exploring ? cardEl.offsetWidth + 24 : 0;
    const lift = w > 1100 || exploring ? 0 : h * 0.22;                 // phones: card sits at the bottom
    if (side || lift) camera.setViewOffset(w, h, side / 2, lift, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', layout); layout();
  renderer.setAnimationLoop(() => { if (!visible) return; controls.update(); renderer.render(scene, camera); });
  show(0);
}

/* =========================================================
   3 · Analog Finder map (Leaflet)
   ========================================================= */
async function initFinder() {
  const L = window.L;
  const f = await (await fetch('assets/finder/finder.json?v=50')).json();
  const sites = (await (await fetch('assets/data.json?v=53')).json()).sites;
  document.getElementById('fdCells').textContent = f.cells.toLocaleString('en-US');
  const [la0, lo0, la1, lo1] = f.bbox;
  const map = L.map('fmap', { zoomControl: false, scrollWheelZoom: false, attributionControl: true, minZoom: 4, maxZoom: 11 })
    .fitBounds([[la0 + 1, lo0 + 1], [la1 - 0.5, lo1 - 1]]);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Basemap Esri · Scan: SRTM, NASA MODIS NDVI, NASA Blue Marble, NASA POWER' }).addTo(map);
  const DEF = {
    overall: 'The best of the three analog types in each cell.',
    volcanic: 'Dark basaltic ground with moderate slopes: lava plains like Tharsis and lunar maria.',
    plains: 'Very smooth, bright, arid ground: the kind of terrain chosen for safe landings.',
    rugged: 'Steep slopes with high local relief: crater walls, scarps and highlands.',
  };
  let overlay = null;
  const setLayer = k => {
    if (overlay) map.removeLayer(overlay);
    overlay = L.imageOverlay(`assets/finder/${k}.png?v=50`, [[la0, lo0], [la1, lo1]], { opacity: 0.9, className: 'fd-heat' }).addTo(map);
    document.querySelectorAll('.fd-layers button').forEach(b => b.classList.toggle('on', b.dataset.layer === k));
    document.getElementById('fdDef').textContent = DEF[k];
  };
  document.querySelectorAll('.fd-layers button').forEach(b => b.addEventListener('click', () => setLayer(b.dataset.layer)));
  setLayer('overall');

  sites.forEach(s => {
    L.marker([s.lat, s.lng], { icon: L.divIcon({ className: '', html: '<span class="fd-pin known"></span>', iconSize: [26, 26] }), keyboard: false })
      .addTo(map).bindTooltip(`<b>${s.name}</b><br>Field site · click to open in 3D`, { className: 'fd-tip', direction: 'top', offset: [0, -12] })
      .on('click', () => window.goToSite?.(s.id));
  });
  const KIND = { volcanic: 'volcanic layer', plains: 'plains layer' };
  document.getElementById('fdVal').innerHTML = f.validation.map(v =>
    `<li><button type="button" data-go="${v.id}"><span>${v.name.replace(/,.*$/, '')}<br><small>${KIND[v.kind]}</small></span><b>top ${Math.max(0.1, +(100 - v.percentile).toFixed(1))}%</b></button></li>`).join('');
  document.querySelectorAll('#fdVal [data-go]').forEach(b => b.addEventListener('click', () => window.goToSite?.(b.dataset.go)));
  const KN = { volcanic: 'Volcanic', plains: 'Smooth plains', rugged: 'Rugged' };
  const list = document.getElementById('fdCands');
  f.candidates.slice(0, 10).forEach((c, i) => {
    const m = L.marker([c.lat, c.lng], { icon: L.divIcon({ className: '', html: `<span class="fd-pin">${i + 1}</span>`, iconSize: [26, 26] }) })
      .addTo(map).bindTooltip(`<b>${KN[c.kind]} candidate ${i + 1}</b><br>${c.label}<br>${c.lat}°N ${c.lng}°E · ${c.elev} m · slope ${c.slope}° · ${c.rain} mm/yr`, { className: 'fd-tip', direction: 'top', offset: [0, -12] });
    const li = document.createElement('li');
    li.innerHTML = `<button><span class="n">${i + 1}</span><span class="t">${KN[c.kind]} · ${c.label}<small>${c.lat}°N ${c.lng}°E · ${c.rain} mm rain/yr</small></span></button>`;
    const btn = li.querySelector('button');
    btn.addEventListener('click', () => {
      list.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === btn));
      map.flyTo([c.lat, c.lng], 8, { duration: reduce ? 0 : 1.2 }); m.openTooltip();
    });
    list.appendChild(li);
  });
  ScrollTrigger.refresh(); // finder content changes the page height above the explorer
}

/* =========================================================
   4 · Moon south-pole globe
   ========================================================= */
function initMoon() {
  const canvas = document.getElementById('moonGlobe');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, -4.3, 1.7); camera.lookAt(0, -0.35, 0);
  const moonMat = new THREE.MeshStandardMaterial({ roughness: 1 });
  moonMat.map = progressiveTexture(renderer, 'moon', t => { moonMat.map = t; moonMat.needsUpdate = true; });
  const moon = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 120), moonMat);
  scene.add(moon);
  const sun = new THREE.DirectionalLight(0xfff4e6, 3.2); sun.position.set(4, -0.4, 1); scene.add(sun);
  scene.add(new THREE.AmbientLight(0x8a8f96, 0.25));
  const pts = [];
  for (let i = 0; i <= 256; i++) { const t = (i / 256) * Math.PI * 2, la = -84 * D2R, r = 1.004;
    pts.push(new THREE.Vector3(r * Math.cos(la) * Math.cos(t), r * Math.sin(la), r * Math.cos(la) * Math.sin(t))); }
  moon.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xd6a462 })));
  let visible = false;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
  const layout = () => { const w = canvas.clientWidth; renderer.setSize(w, w, false); };
  addEventListener('resize', layout); layout();
  renderer.setAnimationLoop(t => { if (!visible) return; if (!reduce) moon.rotation.y = t / 30000; renderer.render(scene, camera); });
}

(function topbarTone() {
  const bar = document.getElementById('topbar');
  const dark = [...document.querySelectorAll('.opening, .moon')];
  const tick = () => {
    const y = 28;
    const onDark = dark.some(el => { const r = el.getBoundingClientRect(); return r.top <= y && r.bottom > y; });
    bar.classList.toggle('light', !onDark);
  };
  addEventListener('scroll', tick, { passive: true }); tick();
})();

initGlobe();
initFinder().catch(e => console.error('finder', e)).finally(() => ScrollTrigger.refresh());
initMoon();
initExplorer().catch(e => { console.error(e); document.getElementById('tLoading').textContent = 'Data not available'; });
