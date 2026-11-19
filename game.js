// MONO STRIKE — a retro monochrome side-scrolling shooter, in 3D.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ───────────────────────────── constants ─────────────────────────────
// Playfield in world units. Width is fixed; height grows on taller (portrait) screens, 18 → max 24.
const W = 24, HW = W / 2;               // visible playfield width in world units (smaller = bigger ships)
let H = 18, HH = H / 2;
const LCD_ROWS = 200;                    // virtual LCD vertical resolution
const STORE = 'monostrike.';
const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

function load(key, def) { try { const v = localStorage.getItem(STORE + key); return v === null ? def : JSON.parse(v); } catch { return def; } }
function save(key, v) { try { localStorage.setItem(STORE + key, JSON.stringify(v)); } catch { /* ignore */ } }

const DEBUG = new URLSearchParams(location.search);
const settings = { modern: load('modern', false), sound: load('sound', true), orient: load('orient', 'auto') };
let hiScore = load('hi', 0);

// ───────────────────────────── renderer ─────────────────────────────
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 300);

const ambient = new THREE.AmbientLight(0xffffff, 0.55);
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-6, 10, 14);
scene.add(ambient, sun);

// LCD post-process: render low-res, quantize to 4 shades, draw a pixel grid.
const lcdTarget = new THREE.WebGLRenderTarget(16, 16, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
const lcdMat = new THREE.ShaderMaterial({
  uniforms: {
    tDiffuse: { value: lcdTarget.texture },
    res: { value: new THREE.Vector2(16, 16) },
    cLight: { value: new THREE.Color(0xc7f0d8) },
    cDark: { value: new THREE.Color(0x43523d) },
    flash: { value: 0 }
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 res; uniform vec3 cLight; uniform vec3 cDark; uniform float flash;
    varying vec2 vUv;
    void main(){
      vec2 px = vUv * res;
      vec3 c = texture2D(tDiffuse, (floor(px) + 0.5) / res).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      l = pow(clamp(l, 0.0, 1.0), 0.4545);
      float q = floor(clamp(l * 1.15, 0.0, 1.0) * 3.999) / 3.0;
      q = mix(q, 1.0 - q, flash);
      vec3 col = mix(cLight, cDark, q);
      vec2 f = fract(px);
      float edge = step(0.12, f.x) * step(0.12, f.y);
      col = mix(col * 0.93 + cDark * 0.02, col, edge);
      vec2 v = vUv - 0.5;
      col *= 1.0 - dot(v, v) * 0.28;
      gl_FragColor = vec4(col, 1.0);
    }`,
  depthTest: false, depthWrite: false
});
const postScene = new THREE.Scene();
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), lcdMat));

let pxPerUnit = 30;
function fitCamera() {
  const scr = $('screen');
  const w = Math.max(1, scr.clientWidth), h = Math.max(1, scr.clientHeight);
  renderer.setSize(w, h, false);
  H = clamp(W / (w / h), 15, 20); HH = H / 2;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // binary search a camera distance that keeps the whole playfield on screen
  const corners = [[-HW, -HH], [HW, -HH], [-HW, HH], [HW, HH]].map(([x, y]) => new THREE.Vector3(x * 1.04, y * 1.08, 0));
  let lo = 5, hi = 400;
  const tmp = new THREE.Vector3();
  for (let i = 0; i < 30; i++) {
    const d = (lo + hi) / 2;
    placeCamera(d);
    const ok = corners.every((c) => { tmp.copy(c).project(camera); return Math.abs(tmp.x) <= 1 && Math.abs(tmp.y) <= 1; });
    if (ok) hi = d; else lo = d;
  }
  placeCamera(hi);
  camDist = hi;
  const a = new THREE.Vector3(0, 0, 0).project(camera), b = new THREE.Vector3(1, 0, 0).project(camera);
  pxPerUnit = Math.abs(b.x - a.x) * 0.5 * w;
  const rows = LCD_ROWS, cols = Math.round(rows * camera.aspect);
  lcdTarget.setSize(cols, rows);
  lcdMat.uniforms.res.value.set(cols, rows);
}
let camDist = 40;
function placeCamera(d) {
  camera.position.set(-d * 0.06, -d * 0.2, d);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
}
window.addEventListener('resize', fitCamera);
window.addEventListener('orientationchange', () => setTimeout(fitCamera, 200));
if (window.ResizeObserver) new ResizeObserver(() => fitCamera()).observe($('screen'));

// ───────────────────────────── palette / materials ─────────────────────────────
const PAL = {
  player: [0x4fd1ff, 0xfff27a], drone: [0xff5a7a, 0xffffff], waver: [0xc77dff, 0xffffff],
  shooter: [0xff9f43, 0xfff27a], diver: [0x2ee59d, 0xffffff], rock: [0x9a8c7a, 0xc2b59b],
  carrier: [0xffd166, 0xff5a7a], zigzag: [0x48dbfb, 0xffffff], bomber: [0xee5253, 0xfff27a], orbiter: [0x1dd1a1, 0xffffff], boss: [0xe056fd, 0xfff27a], pbullet: 0xfff27a, ebullet: 0xff4757
};
function makeMats(pair) {
  return [
    new THREE.MeshLambertMaterial({ color: pair[0] }),
    new THREE.MeshLambertMaterial({ color: pair[1], emissive: pair[1], emissiveIntensity: 0.7 })
  ];
}

// ───────────────────────────── voxel models ─────────────────────────────
// '#' body voxel, '@' thick body voxel, 'o' glowing accent voxel. Ships face right (player) or left (enemies).
const MODELS = {
  player: ["..##......", "..###.....", ".#####....", "####@@#o#.", "##@@@@####", "####@@#o#.", ".#####....", "..###.....", "..##......"],
  drone: ["...###..", ".######.", "##o##o##", ".######.", "...###.."],
  waver: ["#.....#", "##...##", ".#####.", "..#o#..", ".#####.", "##...##", "#.....#"],
  shooter: ["....####", "..######", "o##@@###", "..######", "....####", "...#..#."],
  diver: ["...##", ".####", "o#@##", ".####", "...##"],
  rock: ["..###..", ".#####.", "###@###", "##@@@##", "###@###", ".#####.", "..###.."],
  carrier: ["..######..", ".##o##o##.", "###@@@@###", "#.#.##.#.#", "..######.."],
  boss0: ["......######", "....##########", "..####@@@@######", ".##o##@@@@###...", "################", "o###@@@@@@@@####",
    "################", ".##o##@@@@###...", "..####@@@@######", "....##########", "......######"],
  boss1: ["##..........##", ".##........##.", "..##########..", ".####o##o####.", "##############", "##@@@@@@@@@@##",
    "##############", ".####o##o####.", "..##########..", ".##........##.", "##..........##"],
  boss2: ["....######....", "..##########..", ".####@@@@####.", "###@@oooo@@###", "##@@oooooo@@##", "##@@oooooo@@##",
    "###@@oooo@@###", ".####@@@@####.", "..##########..", "....######...."]
};
const mirror = (half) => half.concat(half.slice(0, -1).reverse());   // draw the top half, get the full (up/down symmetric) ship
Object.assign(MODELS, {
  zigzag: ["...#...", "..###..", ".##o##.", "#######", ".#...#."],
  bomber: ["#.......", "##.####.", "###@@@##", "##o####.", "#...#..."],
  orbiter: ["..###..", ".#ooo#.", "##ooo##", ".#ooo#.", "..###.."],
  // bosses
  ufo: [".....######.....", "...##########...", "..####@@@@####..", "################", "#o##o##o##o##o##", "################", ".##...####...##.", "..#...#..#...#.."],
  spider: ["#...........#", ".#.........#.", "..#..###..#..", "..###o#o###..", "#.###@@@###.#", "..###@@@###..", "..#..###..#..", ".#.........#.", "#...........#"],
  rocket: mirror(["####............", ".###....####....", "..###.########..", "..##@@@@@@@@###.", "oo##@@@@@@@@@###"]),
  octopus: ["....#####....", "..#########..", ".###########.", ".##oo###oo##.", ".###########.", "#############", "#.##.###.##.#", "#.#..#.#..#.#", "#.#..#.#..#.#", ".#....#....#."],
  crab: mirror(["#..#..#........", ".#..#..#.....##", "..#######..####", "..##o###o.##..#", "..#########....", "..####@@@@####."]),
  manta: mirror(["###............", ".#####.........", "..#######......", "...#########...", "....##o#######.", "#######@@@@####"]),
  skull: ["..#######..", ".#########.", "###########", "##oo###oo##", "##oo###oo##", "###########", "#####.#####", "..#######..", "..#.#.#.#..", "..#.#.#.#.."],
  mech: ["...#####...", "..##o###o##", "...#####...", "#####@#####", "###########", "##.#@@@#.##", "##.#@@@#.##", "##..###..##", "....#.#....", "...##.##...", "...##.##...", "..###.###.."],
  queen: mirror(["##...............", ".###.............", "..####....###....", "...#####.#####...", "....#########o##.", ".....#@@@@@@@####"])
});
const geoCache = new Map();
function voxelModel(name, s) {
  const key = name + s;
  if (geoCache.has(key)) return geoCache.get(key);
  const pat = MODELS[name];
  const h = pat.length, w = Math.max(...pat.map((r) => r.length));
  const body = [], glow = [];
  for (let r = 0; r < h; r++) for (let c = 0; c < pat[r].length; c++) {
    const ch = pat[r][c];
    if (ch === '.' || ch === ' ') continue;
    const depth = ch === '@' ? 2.4 : ch === 'o' ? 1.6 : 1.3;
    const g = new THREE.BoxGeometry(s * 0.96, s * 0.96, s * depth);
    g.translate((c - (w - 1) / 2) * s, ((h - 1) / 2 - r) * s, 0);
    (ch === 'o' ? glow : body).push(g);
  }
  const parts = [mergeGeometries(body)];
  if (glow.length) parts.push(mergeGeometries(glow));
  const geo = mergeGeometries(parts, true);
  const m = { geo, hw: (w * s) / 2, hh: (h * s) / 2 };
  geoCache.set(key, m);
  return m;
}
function makeShip(name, s, palette, flip = false) {
  const m = voxelModel(name, s);
  const mats = makeMats(palette);
  const mesh = new THREE.Mesh(m.geo, mats);
  if (flip) mesh.rotation.y = Math.PI; // face left
  return { mesh, mats, hw: m.hw, hh: m.hh };
}

// ───────────────────────────── background ─────────────────────────────
const bg = new THREE.Group();
scene.add(bg);
// stars
const STAR_N = 260;
const starPos = new Float32Array(STAR_N * 3);
const starSpd = new Float32Array(STAR_N);
for (let i = 0; i < STAR_N; i++) {
  starPos[i * 3] = rand(-HW * 2, HW * 2);
  starPos[i * 3 + 1] = rand(-HH * 2, HH * 2);
  starPos[i * 3 + 2] = rand(-60, -6);
  starSpd[i] = rand(2, 9);
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
const starMat = new THREE.PointsMaterial({ color: 0x8899bb, size: 2, sizeAttenuation: false });
bg.add(new THREE.Points(starGeo, starMat));

// floating debris cubes far behind
const DEB_N = 36;
const debrisMat = new THREE.MeshLambertMaterial({ color: 0x4a5878 });
const debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), debrisMat, DEB_N);
const debData = [];
for (let i = 0; i < DEB_N; i++) debData.push({ x: rand(-50, 50), y: rand(-22, 22), z: rand(-45, -14), s: rand(0.6, 2.4), rx: rand(0, 6), ry: rand(0, 6), v: rand(1.5, 4) });
bg.add(debris);

// scrolling voxel terrain (floor & ceiling) for later stages
const COLS = 64, COL_W = 1.0;
const terrainMat = new THREE.MeshLambertMaterial({ color: 0x3d5a80 });
const floor = new THREE.InstancedMesh(new THREE.BoxGeometry(COL_W * 0.94, 1, 3), terrainMat, COLS);
const ceil = new THREE.InstancedMesh(new THREE.BoxGeometry(COL_W * 0.94, 1, 3), terrainMat, COLS);
floor.position.z = ceil.position.z = -0.6;
bg.add(floor, ceil);
const floorH = new Float32Array(COLS), ceilH = new Float32Array(COLS);
let terrainOffset = 0, terrainSeed = 0;
function terrainHeight(i, seed, top) {
  const t = i * 0.35 + seed + (top ? 40 : 0);
  return 1.2 + Math.abs(Math.sin(t) * 1.6 + Math.sin(t * 2.7) * 0.9 + Math.sin(t * 0.31) * 1.4);
}
const dummy = new THREE.Object3D();
function updateBackground(dt, speed) {
  const p = starGeo.attributes.position.array;
  for (let i = 0; i < STAR_N; i++) {
    p[i * 3] -= starSpd[i] * speed * dt;
    if (p[i * 3] < -HW * 2.2) { p[i * 3] = HW * 2.2; p[i * 3 + 1] = rand(-HH * 2, HH * 2); }
  }
  starGeo.attributes.position.needsUpdate = true;
  for (let i = 0; i < DEB_N; i++) {
    const d = debData[i];
    d.x -= d.v * speed * dt; d.rx += dt * 0.4; d.ry += dt * 0.3;
    if (d.x < -55) { d.x = 55; d.y = rand(-22, 22); }
    dummy.position.set(d.x, d.y, d.z); dummy.rotation.set(d.rx, d.ry, 0); dummy.scale.setScalar(d.s);
    dummy.updateMatrix(); debris.setMatrixAt(i, dummy.matrix);
  }
  debris.instanceMatrix.needsUpdate = true;

  const showFloor = theme.floor, showCeil = theme.ceil;
  floor.visible = showFloor; ceil.visible = showCeil;
  if (showFloor || showCeil) {
    terrainOffset += 6 * speed * dt;
    const shift = Math.floor(terrainOffset / COL_W), frac = terrainOffset % COL_W;
    for (let i = 0; i < COLS; i++) {
      const idx = i + shift;
      const x = (i - COLS / 2) * COL_W - frac;
      const fh = terrainHeight(idx, terrainSeed, false), ch = terrainHeight(idx, terrainSeed, true);
      floorH[i] = fh; ceilH[i] = ch;
      dummy.rotation.set(0, 0, 0);
      dummy.position.set(x, -HH - 0.8 + fh / 2, 0); dummy.scale.set(1, fh, 1); dummy.updateMatrix(); floor.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, HH + 0.8 - ch / 2, 0); dummy.scale.set(1, ch, 1); dummy.updateMatrix(); ceil.setMatrixAt(i, dummy.matrix);
    }
    floor.instanceMatrix.needsUpdate = true; ceil.instanceMatrix.needsUpdate = true;
  }
}

// ───────────────────────────── particles ─────────────────────────────
const PART_N = 700;
const parts = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), PART_N);
parts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
const partData = [];
const tmpColor = new THREE.Color();
for (let i = 0; i < PART_N; i++) { partData.push({ life: 0 }); parts.setColorAt(i, tmpColor.set(0xffffff)); }
parts.frustumCulled = false;
scene.add(parts);
let partCursor = 0;
function burst(x, y, color, n = 24, power = 8, size = 0.28) {
  for (let k = 0; k < n; k++) {
    const p = partData[partCursor];
    const a = Math.random() * Math.PI * 2, e = rand(-1, 1), s = rand(0.3, 1) * power;
    p.x = x; p.y = y; p.z = rand(-0.5, 0.5);
    p.vx = Math.cos(a) * s - 2; p.vy = Math.sin(a) * s; p.vz = e * s * 0.6;
    p.life = p.max = rand(0.4, 1.0); p.s = size * rand(0.6, 1.4);
    p.rx = rand(0, 6); p.ry = rand(0, 6);
    parts.setColorAt(partCursor, tmpColor.set(color));
    partCursor = (partCursor + 1) % PART_N;
  }
  parts.instanceColor.needsUpdate = true;
}
function updateParticles(dt) {
  for (let i = 0; i < PART_N; i++) {
    const p = partData[i];
    if (p.life <= 0) { dummy.scale.setScalar(0); dummy.position.set(0, 0, -999); }
    else {
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.vx *= 0.96; p.vy *= 0.96; p.rx += dt * 6; p.ry += dt * 5;
      dummy.position.set(p.x, p.y, p.z); dummy.rotation.set(p.rx, p.ry, 0);
      dummy.scale.setScalar(Math.max(0, p.s * (p.life / p.max)));
    }
    dummy.updateMatrix(); parts.setMatrixAt(i, dummy.matrix);
  }
  parts.instanceMatrix.needsUpdate = true;
}

// ───────────────────────────── audio ─────────────────────────────
let actx = null, master = null;
function audioInit() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    master = actx.createGain(); master.gain.value = settings.sound ? 0.5 : 0; master.connect(actx.destination);
  }
  if (actx.state === 'suspended') actx.resume();
}
function tone(f, d, type = 'square', v = 0.08, f2 = null, delay = 0) {
  if (!actx || !settings.sound) return;
  const t = actx.currentTime + delay;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + d + 0.02);
}
let noiseBuf = null;
function noise(d, v = 0.2, lp = 1200) {
  if (!actx || !settings.sound) return;
  if (!noiseBuf) {
    noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  }
  const t = actx.currentTime;
  const s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
  s.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.setValueAtTime(lp, t); f.frequency.exponentialRampToValueAtTime(80, t + d);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + d);
}
const sfx = {
  shoot: () => tone(1400, 0.05, 'square', 0.025, 700),
  hit: () => tone(300, 0.06, 'square', 0.04, 150),
  boom: () => { noise(0.35, 0.22, 1800); tone(160, 0.25, 'triangle', 0.1, 40); },
  bigBoom: () => { noise(1.2, 0.35, 2400); tone(90, 1.0, 'sawtooth', 0.12, 25); },
  pickup: () => [660, 880, 1320].forEach((f, i) => tone(f, 0.08, 'square', 0.05, null, i * 0.06)),
  missile: () => tone(500, 0.25, 'sawtooth', 0.05, 1500),
  laser: () => tone(2200, 0.5, 'sawtooth', 0.04, 300),
  shield: () => tone(300, 0.4, 'triangle', 0.08, 1200),
  hurt: () => { noise(0.5, 0.3, 900); tone(220, 0.5, 'square', 0.08, 55); },
  warn: () => [0, 0.3, 0.6].forEach((d) => tone(440, 0.22, 'square', 0.06, 330, d)),
  clear: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.16, 'square', 0.06, null, i * 0.12)),
  life: () => [523, 784, 1046, 1568].forEach((f, i) => tone(f, 0.1, 'triangle', 0.08, null, i * 0.07))
};
// tiny chiptune bass loop
const BASS = [55, 0, 55, 65.4, 0, 73.4, 55, 0, 49, 0, 49, 58.3, 0, 65.4, 49, 0];
let musicStep = 0, musicNext = 0, musicOn = false;
function musicTick() {
  if (!actx || !musicOn || !settings.sound) return;
  const spb = 60 / 150 / 2;
  while (musicNext < actx.currentTime + 0.12) {
    const f = BASS[musicStep % BASS.length] * (boss ? 1.122 : 1);
    if (f) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'square'; o.frequency.value = f * 2;
      g.gain.setValueAtTime(0.03, musicNext); g.gain.exponentialRampToValueAtTime(0.0001, musicNext + spb * 0.9);
      o.connect(g); g.connect(master); o.start(musicNext); o.stop(musicNext + spb);
    }
    if (musicStep % 4 === 0) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(150, musicNext); o.frequency.exponentialRampToValueAtTime(40, musicNext + 0.1);
      g.gain.setValueAtTime(0.06, musicNext); g.gain.exponentialRampToValueAtTime(0.0001, musicNext + 0.12);
      o.connect(g); g.connect(master); o.start(musicNext); o.stop(musicNext + 0.13);
    }
    musicStep++; musicNext += spb;
  }
}
function startMusic() { if (!actx) return; musicOn = true; musicNext = actx.currentTime + 0.05; }
function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* ignore */ } }

// ───────────────────────────── game state ─────────────────────────────
let state = 'menu';         // menu | playing | paused | over
let score = 0, lives = 3, stageNo = 1, loop = 0;
let godMode = false;
let victoryShown = false;      // tap MODE 7 times: infinite lives + drag the ship directly
let enemies = [], pBullets = [], eBullets = [], pickups = [], missiles = [];
let boss = null;
let shake = 0, flashT = 0, bannerT = 0;
let theme = { floor: false, ceil: false };
let director = null;

const STAGES = [
  { name: 'OUTER RIM',    floor: false, ceil: false, boss: 'ufo',     bname: 'ALIEN SAUCER', mix: ['drone', 'drone', 'waver', 'diver', 'carrier'],
    pat: ['aimed', 'spread', 'minions'], mv: [0.7, 0.45, 2], pal: [0xe056fd, 0xfff27a] },
  { name: 'ROCK BELT',    floor: false, ceil: false, boss: 'spider',  bname: 'ROCK SPIDER', mix: ['rock', 'drone', 'waver', 'shooter', 'carrier'],
    pat: ['spread', 'wall', 'aimed', 'minions'], mv: [1.0, 0.5, 2.5], pal: [0xc8a27a, 0xff6b4a] },
  { name: 'SURFACE RUN',  floor: true,  ceil: false, boss: 'rocket',  bname: 'ROCKET SHIP', mix: ['drone', 'diver', 'shooter', 'waver', 'carrier', 'zigzag'],
    pat: ['aimed', 'rain', 'aimed', 'minions'], mv: [0.8, 0.9, 3], pal: [0xff6b6b, 0xfff27a] },
  { name: 'DEEP CAVERN',  floor: true,  ceil: true,  boss: 'octopus', bname: 'CAVE OCTOPUS', mix: ['waver', 'diver', 'shooter', 'rock', 'carrier', 'orbiter'],
    pat: ['ring', 'aimed', 'spiral', 'minions'], mv: [0.55, 0.4, 1.5], pal: [0x9b59b6, 0xff9ff3] },
  { name: 'THE CORE',     floor: false, ceil: false, boss: 'core',    bname: 'CORE GUARDIAN', mix: ['drone', 'waver', 'shooter', 'diver', 'rock', 'carrier', 'zigzag'],
    pat: ['ring', 'spiral', 'spread', 'minions'], mv: [0.7, 0.45, 2], pal: [0xe056fd, 0xfff27a] },
  { name: 'NEBULA',       floor: false, ceil: false, boss: 'crab',    bname: 'STAR CRAB', mix: ['zigzag', 'orbiter', 'drone', 'shooter', 'bomber'],
    pat: ['wall', 'spread', 'rain', 'aimed'], mv: [0.85, 0.6, 2.5], pal: [0xff7f50, 0xfff27a] },
  { name: 'ICE RING',     floor: false, ceil: true,  boss: 'manta',   bname: 'ICE MANTA', mix: ['bomber', 'diver', 'zigzag', 'waver', 'carrier'],
    pat: ['aimed', 'spiral', 'rain', 'minions'], mv: [0.75, 1.0, 3.5], pal: [0x54a0ff, 0xdff9fb] },
  { name: 'WARP GATE',    floor: true,  ceil: false, boss: 'skull',   bname: 'DEATH SKULL', mix: ['orbiter', 'bomber', 'rock', 'shooter', 'diver'],
    pat: ['ring', 'wall', 'spiral', 'aimed'], mv: [0.65, 0.5, 2], pal: [0xdfe4ea, 0xff4757] },
  { name: 'DEAD FLEET',   floor: true,  ceil: true,  boss: 'mech',    bname: 'WAR MECH', mix: ['bomber', 'zigzag', 'orbiter', 'shooter', 'carrier', 'rock'],
    pat: ['spread', 'rain', 'wall', 'ring', 'minions'], mv: [0.9, 0.55, 2.5], pal: [0x7bed9f, 0xff6348] },
  { name: 'THE HIVE',     floor: false, ceil: false, boss: 'queen',   bname: 'HIVE QUEEN', mix: ['bomber', 'orbiter', 'zigzag', 'shooter', 'diver', 'rock', 'carrier'],
    pat: ['ring', 'spiral', 'rain', 'spread', 'wall', 'minions'], mv: [1.0, 0.7, 3], pal: [0xff4d6d, 0xfff27a] }
];

// ── player
const player = {
  ...makeShip('player', 0.22, PAL.player),
  x: -HW + 4, y: 0, vx: 0, vy: 0, alive: true, inv: 0, fireCd: 0, power: 1,
  special: null, ammo: 0, laserT: 0, shieldT: 0, respawnT: 0
};
scene.add(player.mesh);
const engine = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.35), new THREE.MeshBasicMaterial({ color: 0xfff27a }));
player.mesh.add(engine);
engine.position.set(-1.35, 0, 0);

const laserMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 0.42, 0.42), new THREE.MeshBasicMaterial({ color: 0xffffff }));
laserMesh.visible = false; scene.add(laserMesh);

const shieldGroup = new THREE.Group();
const shieldCubes = [];
for (let i = 0; i < 4; i++) {
  const c = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), new THREE.MeshLambertMaterial({ color: 0x7bed9f, emissive: 0x2ecc71, emissiveIntensity: 0.6 }));
  shieldGroup.add(c); shieldCubes.push(c);
}
shieldGroup.visible = false; scene.add(shieldGroup);

// ── bullets
const pBulletGeo = new THREE.BoxGeometry(0.6, 0.14, 0.14);
const pBulletMat = new THREE.MeshBasicMaterial({ color: PAL.pbullet });
const eBulletGeo = new THREE.BoxGeometry(0.32, 0.32, 0.32);
const eBulletMat = new THREE.MeshBasicMaterial({ color: PAL.ebullet });
function firePlayer() {
  const spreads = player.power >= 3 ? [0, 0.16, -0.16] : player.power === 2 ? [0.05, -0.05] : [0];
  for (const a of spreads) {
    const m = new THREE.Mesh(pBulletGeo, pBulletMat);
    const yOff = player.power === 2 ? Math.sign(a) * 0.3 : 0;
    m.position.set(player.x + 1.2, player.y + yOff, 0);
    m.rotation.z = a;
    scene.add(m);
    pBullets.push({ mesh: m, x: player.x + 1.2, y: player.y + yOff, vx: Math.cos(a) * 34, vy: Math.sin(a) * 34, dmg: 1 });
  }
  sfx.shoot();
}
function fireEnemy(x, y, angle, speed = 10) {
  const m = new THREE.Mesh(eBulletGeo, eBulletMat);
  m.position.set(x, y, 0); scene.add(m);
  eBullets.push({ mesh: m, x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed });
}
function aimAt(x, y) { return Math.atan2(player.y - y, player.x - x); }

// ── specials
const SPECIALS = {
  M: { label: 'MISSILE', ammo: 6 },
  L: { label: 'LASER', ammo: 3 },
  B: { label: 'BARRIER', ammo: 2 }
};
const missileGeo = new THREE.BoxGeometry(0.7, 0.24, 0.24);
const missileMat = new THREE.MeshLambertMaterial({ color: 0xffa502, emissive: 0xff6348, emissiveIntensity: 0.6 });
const pickupGeo = new THREE.BoxGeometry(1, 1, 1);
const pickupMats = {};
function useSpecial() {
  if (state !== 'playing' || !player.alive || !player.special || player.ammo <= 0) return;
  if (player.special === 'L' && player.laserT > 0) return;
  if (player.special === 'B' && player.shieldT > 0) return;
  player.ammo--;
  if (player.special === 'M') {
    for (const dy of [0.4, -0.4]) {
      const m = new THREE.Mesh(missileGeo, missileMat);
      m.position.set(player.x, player.y + dy, 0); scene.add(m);
      missiles.push({ mesh: m, x: player.x, y: player.y + dy, vx: 6, vy: dy * 8, t: 0 });
    }
    sfx.missile();
  } else if (player.special === 'L') { player.laserT = 0.7; sfx.laser(); shake = Math.max(shake, 0.25); }
  else if (player.special === 'B') { player.shieldT = 8; sfx.shield(); }
  if (player.ammo <= 0) player.special = null;
  updateHud();
}

// ── enemies
const ETYPES = {
  drone: { hp: 1, score: 10, s: 0.24, speed: 6 },
  waver: { hp: 1, score: 15, s: 0.22, speed: 5 },
  shooter: { hp: 3, score: 30, s: 0.24, speed: 5 },
  diver: { hp: 2, score: 25, s: 0.26, speed: 8 },
  rock: { hp: 6, score: 40, s: 0.32, speed: 3 },
  carrier: { hp: 4, score: 50, s: 0.24, speed: 4 },
  zigzag: { hp: 1, score: 20, s: 0.26, speed: 6 },
  bomber: { hp: 4, score: 45, s: 0.26, speed: 3.5 },
  orbiter: { hp: 2, score: 30, s: 0.24, speed: 5 }
};
function spawnY(m = 2) { const lo = -HH + m + (theme.floor ? 3.2 : 0), hi = HH - m - (theme.ceil ? 3.2 : 0); return rand(lo, hi); }
// every stage dresses the enemies in slightly different colours
function stageTint(pair) {
  const i = (stageNo - 1) % STAGES.length;
  return [new THREE.Color(pair[0]).offsetHSL(i * 0.083, 0, 0).getHex(), pair[1]];
}
function difficulty() { return 1 + (stageNo - 1) * 0.12 + loop * 0.45; }
function spawnEnemy(type, x, y, extra = {}) {
  const def = ETYPES[type];
  const ship = makeShip(type, def.s, stageTint(PAL[type]), true);
  ship.mesh.position.set(x, y, 0);
  scene.add(ship.mesh);
  const d = difficulty();
  const e = {
    ...ship, type, x, y, baseY: y, t: rand(0, 6), hp: Math.ceil(def.hp * (type === 'rock' || type === 'carrier' ? d : 1)),
    score: def.score, speed: def.speed * (0.85 + d * 0.15), fireCd: rand(0.8, 2.2) / d, flash: 0, ...extra
  };
  if (type === 'rock') { e.spin = new THREE.Vector3(rand(-2, 2), rand(-2, 2), rand(-1, 1)); }
  enemies.push(e);
  return e;
}
const FORMATIONS = {
  drone: () => { const y = spawnY(2); const n = 4 + ((Math.random() * 3) | 0); for (let i = 0; i < n; i++) spawnEnemy('drone', HW + 2 + i * 1.8, y); },
  waver: () => { const y = spawnY(4); for (let i = 0; i < 6; i++) spawnEnemy('waver', HW + 2 + i * 1.6, y, { phase: i * 0.6, amp: rand(2, 4) }); },
  shooter: () => { const n = 1 + (Math.random() < 0.4 + stageNo * 0.1 ? 1 : 0); for (let i = 0; i < n; i++) spawnEnemy('shooter', HW + 2 + i * 2, spawnY(2), { stopX: rand(HW - 9, HW - 4), shots: 3 + stageNo }); },
  diver: () => { for (let i = 0; i < 3; i++) spawnEnemy('diver', HW + 2 + i * 2.5, spawnY(2)); },
  rock: () => { const n = 2 + ((Math.random() * 2) | 0); for (let i = 0; i < n; i++) spawnEnemy('rock', HW + 2 + i * 4, spawnY(2)); },
  carrier: () => spawnEnemy('carrier', HW + 2, spawnY(3), { drop: true }),
  zigzag: () => { const y = spawnY(4); for (let i = 0; i < 5; i++) spawnEnemy('zigzag', HW + 2 + i * 1.5, y, { phase: i * 0.5, amp: rand(2, 3.2) }); },
  bomber: () => { const n = 1 + (Math.random() < 0.3 + stageNo * 0.05 ? 1 : 0); for (let i = 0; i < n; i++) spawnEnemy('bomber', HW + 2 + i * 3, spawnY(2.5), { stopX: rand(HW - 8, HW - 3) }); },
  orbiter: () => { const y = spawnY(4); for (let i = 0; i < 3; i++) spawnEnemy('orbiter', HW + 2 + i * 2.4, y, { phase: i * 2.1, amp: rand(2, 3.4) }); },
  vee: () => { const y = spawnY(4); for (let i = 0; i < 5; i++) { const k = Math.abs(i - 2); spawnEnemy('drone', HW + 2 + k * 1.6, y + (i - 2) * 1.4); } }
};
function removeEntity(e) { scene.remove(e.mesh); if (e.mats) e.mats.forEach((m) => m.dispose()); }

// ── pickups
const pickupTex = {};
function pickupTexture(letter) {
  if (pickupTex[letter]) return pickupTex[letter];
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 32, 32);
  g.fillStyle = '#111111'; g.fillRect(3, 3, 26, 26);
  g.fillStyle = '#ffffff'; g.font = 'bold 22px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(letter, 16, 18);
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return (pickupTex[letter] = t);
}
const PICKUP_COLORS = { P: 0x4fd1ff, M: 0xffa502, L: 0xff6b81, B: 0x7bed9f, '+': 0xff4757 };
function spawnPickup(x, y, kind) {
  if (!kind) {
    const r = Math.random();
    kind = r < 0.3 ? 'P' : r < 0.53 ? 'M' : r < 0.74 ? 'L' : r < 0.92 ? 'B' : '+';
    if (kind === 'P' && player.power >= 3) kind = 'M';
  }
  pickupMats[kind] ||= new THREE.MeshLambertMaterial({ map: pickupTexture(kind === '+' ? '♥' : kind), color: PICKUP_COLORS[kind], emissive: PICKUP_COLORS[kind], emissiveIntensity: 0.25 });
  const m = new THREE.Mesh(pickupGeo, pickupMats[kind]);
  m.position.set(x, y, 0); scene.add(m);
  pickups.push({ mesh: m, x, y, kind, t: 0 });
}
function collectPickup(p) {
  const k = p.kind;
  if (k === 'P') { player.power = Math.min(3, player.power + 1); flashBanner('POWER UP', 0.8); sfx.pickup(); }
  else if (k === '+') { lives = Math.min(9, lives + 1); flashBanner('1 UP', 0.8); sfx.life(); }
  else {
    if (player.special === k) player.ammo += SPECIALS[k].ammo;
    else { player.special = k; player.ammo = SPECIALS[k].ammo; }
    flashBanner(SPECIALS[k].label, 0.8); sfx.pickup();
  }
  addScore(25);
  updateHud();
}

// ── boss
function spawnBoss() {
  const st = STAGES[(stageNo - 1) % STAGES.length];
  const model = st.boss === 'core' ? 'boss2' : st.boss;
  const ship = makeShip(model, 0.42, st.pal, !['core', 'octopus', 'skull', 'mech'].includes(st.boss));
  ship.mesh.position.set(HW + 8, 0, 0);
  scene.add(ship.mesh);
  const hp = Math.round((60 + stageNo * 25) * (1 + loop * 0.6));
  boss = { ...ship, x: HW + 8, y: 0, hp, maxHp: hp, t: 0, phase: 'enter', atkCd: 2, atk: 0, flash: 0, kind: st.boss, pat: st.pat, mv: st.mv };
  flashBanner(st.bname, 1.8);
  $('boss-bar').classList.remove('hidden');
  updateBossBar();
}
function updateBossBar() { if (boss) $('boss-fill').style.width = `${(100 * boss.hp) / boss.maxHp}%`; }
function bossAttack() {
  const d = difficulty();
  const patterns = boss.pat;
  const p = patterns[boss.atk % patterns.length];
  boss.atk++;
  const bx = boss.x - boss.hw * 0.7, by = boss.y;
  if (p === 'aimed') { for (let i = 0; i < 3 + loop; i++) setTimeout(() => boss && fireEnemy(bx, boss.y, aimAt(bx, boss.y), 11 * Math.sqrt(d)), i * 160); boss.atkCd = 1.4; }
  else if (p === 'spread') { const n = 5 + stageNo; for (let i = 0; i < n; i++) fireEnemy(bx, by, Math.PI + (i - (n - 1) / 2) * 0.17, 8 * Math.sqrt(d)); boss.atkCd = 1.6; }
  else if (p === 'wall') { const gap = rand(-HH + 3, HH - 3); for (let y = -HH + 0.8; y < HH; y += 1.3) if (Math.abs(y - gap) > 2) fireEnemy(HW + 1, y, Math.PI, 7 * Math.sqrt(d)); boss.atkCd = 2.0; }
  else if (p === 'ring') { const n = 14 + stageNo * 2; const off = Math.random(); for (let i = 0; i < n; i++) fireEnemy(boss.x, by, off + (i / n) * Math.PI * 2, 7 * Math.sqrt(d)); boss.atkCd = 1.8; }
  else if (p === 'spiral') { for (let i = 0; i < 18; i++) setTimeout(() => boss && fireEnemy(boss.x, boss.y, boss.t * 3 + i * 0.5, 7.5), i * 70); boss.atkCd = 2.0; }
  else if (p === 'rain') { for (let i = 0; i < 7; i++) fireEnemy(rand(-HW * 0.3, HW), HH + 0.8, -Math.PI / 2 - rand(0.1, 0.45), 6.5 * Math.sqrt(d)); boss.atkCd = 1.4; }
  else if (p === 'minions') { for (let i = 0; i < 3; i++) spawnEnemy(pick(['drone', 'diver']), HW + 2 + i * 1.5, clamp(by + (i - 1) * 3, -HH + 2, HH - 2)); boss.atkCd = 1.5; }
  boss.atkCd /= Math.sqrt(d);
}
function killBoss() {
  const b = boss;
  boss = null;
  $('boss-bar').classList.add('hidden');
  addScore(1000 * stageNo);
  sfx.bigBoom(); vibrate([60, 40, 120]);
  shake = 1.2; flashT = 0.3;
  for (let i = 0; i < 8; i++) setTimeout(() => burst(b.x + rand(-b.hw, b.hw), b.y + rand(-b.hh, b.hh), pick([0xe056fd, 0xfff27a, 0xffffff]), 40, 12, 0.4), i * 120);
  removeEntity(b);
  const last = stageNo >= STAGES.length;
  eBullets.forEach((eb) => scene.remove(eb.mesh)); eBullets = [];
  director.phase = 'clear'; director.t = 0;
  setTimeout(() => { sfx.clear(); flashBanner(last ? 'ALL CLEAR!' : `STAGE ${stageNo}\nCLEAR!`, 2.6); }, 900);
}

// ── stage director
function startStage(n) {
  stageNo = n;
  const st = STAGES[(n - 1) % STAGES.length];
  loop = Math.floor((n - 1) / STAGES.length);
  theme = { floor: st.floor, ceil: st.ceil };
  terrainSeed = rand(0, 100);
  director = { phase: 'intro', t: 0, waves: 10 + Math.min(8, n * 2), spawned: 0, cd: 2.5 };
  applyStageColors(n);
  flashBanner(`STAGE ${n}\n${st.name}`, 2.4);
  updateHud();
}
function updateDirector(dt) {
  const d = director;
  d.t += dt;
  if (d.phase === 'intro') { if (d.t > 2.4) { d.phase = 'waves'; d.t = 0; } return; }
  if (d.phase === 'waves') {
    d.cd -= dt;
    if (d.cd <= 0 && d.spawned < d.waves) {
      const st = STAGES[(stageNo - 1) % STAGES.length];
      let f = pick(st.mix);
      if (f === 'carrier' && Math.random() < 0.5) f = 'drone';
      if (f === 'drone' && Math.random() < 0.35) f = 'vee';
      FORMATIONS[f]();
      d.spawned++;
      d.cd = Math.max(1.3, 3.2 - stageNo * 0.2 - loop * 0.4) * rand(0.8, 1.2);
    }
    if (d.spawned >= d.waves && enemies.length === 0) { d.phase = 'warning'; d.t = 0; flashBanner('!! WARNING !!', 2.2, true); sfx.warn(); }
    return;
  }
  if (d.phase === 'warning') { if (d.t > 2.4) { d.phase = 'boss'; spawnBoss(); } return; }
  if (d.phase === 'clear') { if (d.t > 4) { if (stageNo >= STAGES.length) victory(); else startStage(stageNo + 1); } }
}

// ── colors per stage (modern mode)
const STAGE_BG = [0x060a1a, 0x120a1a, 0x061410, 0x0f0a05, 0x150515, 0x180a14, 0x06141c, 0x0a0a0f, 0x140808, 0x14050f];
const STAGE_TERRAIN = [0x3d5a80, 0x6d4c41, 0x2e7d32, 0x5d4037, 0x7b1fa2, 0x8e44ad, 0x4a90b8, 0x57606f, 0x7f3b2e, 0x9b2c5a];
function applyStageColors(n) {
  const i = (n - 1) % STAGES.length;
  terrainMat.color.set(STAGE_TERRAIN[i]);
  if (settings.modern) { scene.background = new THREE.Color(STAGE_BG[i]); scene.fog = new THREE.Fog(STAGE_BG[i], camDist + 10, camDist + 70); }
}
function applyMode() {
  document.body.classList.toggle('modern', settings.modern);
  if (settings.modern) {
    applyStageColors(stageNo);
    starMat.color.set(0xb8c7ff); starMat.size = 2; debrisMat.color.set(0x4a5878);
  } else {
    scene.background = new THREE.Color(0x000000);
    scene.fog = null;
    starMat.color.set(0x404040); starMat.size = 1 / renderer.getPixelRatio(); debrisMat.color.set(0x262626);
  }
  const label = `MODE: ${settings.modern ? 'NEON' : 'LCD'}`;
  $('btn-mode').textContent = label; $('btn-mode2').textContent = label;
}

// ───────────────────────────── scoring / HUD ─────────────────────────────
function addScore(n) { score += n; $('hud-score').textContent = String(score).padStart(6, '0'); }
function updateHud() {
  $('hud-lives').textContent = godMode ? '♥ ∞' : '♥'.repeat(Math.min(lives, 5)) + (lives > 5 ? `×${lives}` : '');
  $('hud-special').textContent = player.special ? `${SPECIALS[player.special].label} ${player.ammo}` : `PWR ${'▮'.repeat(player.power)}`;
  if (player.special) $('hud-special').textContent += `  PWR ${'▮'.repeat(player.power)}`;
  $('hud-stage').textContent = `STAGE ${stageNo}`;
  $('hud-score').textContent = String(score).padStart(6, '0');
}
let bannerTimer = null;
function flashBanner(text, secs, blink = false) {
  const b = $('banner');
  b.textContent = text; b.classList.remove('hidden'); b.classList.toggle('blink', blink);
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.add('hidden'), secs * 1000);
}

// ───────────────────────────── damage / collisions ─────────────────────────────
function hitBox(a, x, y, pad = 0) { return Math.abs(a.x - x) < a.hw * 0.85 + pad && Math.abs(a.y - y) < a.hh * 0.85 + pad; }
function damageEnemy(e, dmg) {
  e.hp -= dmg; e.flash = 0.08;
  if (e.hp <= 0 && !e.dead) {
    e.dead = true;
    addScore(e.score);
    burst(e.x, e.y, PAL[e.type][0], e.type === 'rock' ? 34 : 22, 8);
    sfx.boom(); shake = Math.max(shake, 0.15);
    if (e.drop || Math.random() < 0.06) spawnPickup(e.x, e.y);
  } else sfx.hit();
}
function damageBoss(dmg) {
  if (!boss || boss.phase === 'enter') return;
  boss.hp -= dmg; boss.flash = 0.06;
  if (Math.random() < 0.3) burst(boss.x - boss.hw * 0.6, boss.y + rand(-1, 1), 0xfff27a, 3, 4, 0.18);
  updateBossBar();
  if (boss.hp <= 0) killBoss();
}
function hurtPlayer() {
  if (!player.alive || player.inv > 0 || player.shieldT > 0 || godMode) return;
  player.alive = false;
  player.mesh.visible = false;
  burst(player.x, player.y, PAL.player[0], 50, 11, 0.32);
  sfx.hurt(); vibrate(200);
  shake = 0.8; flashT = 0.2;
  lives--;
  player.power = Math.max(1, player.power - 1);
  player.laserT = 0;
  updateHud();
  if (lives <= 0) setTimeout(gameOver, 1500);
  else player.respawnT = 1.4;
}

// ───────────────────────────── input ─────────────────────────────
const keys = new Set();
const input = { fire: false, touchFire: false, dx: 0, dy: 0, padX: 0, padY: 0 };
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  audioInit();
  if (state === 'playing') {
    if (['KeyX', 'KeyK', 'ShiftLeft', 'ShiftRight'].includes(e.code)) useSpecial();
    if (['KeyP', 'Escape'].includes(e.code)) pauseGame();
  } else if (state === 'paused' && ['KeyP', 'Escape'].includes(e.code)) resumeGame();
  else if (state === 'menu' && ['Enter', 'Space'].includes(e.code) && document.activeElement?.tagName !== 'BUTTON') startGame();
  if (e.code === 'KeyC') toggleMode();
  if (e.code === 'KeyM') toggleSound();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); releaseTouchControls(); if (state === 'playing') pauseGame(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') pauseGame(); });

// ── touch: handheld gamepad controls
const isTouch = DEBUG.has('pad') || window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
// The Nokia handset is shown everywhere; on desktop it is a centred portrait phone.
document.body.classList.add('pad');
document.body.classList.toggle('deskphone', !isTouch);
// Menus live on the phone's screen, not over the whole window.
$('screen').append($('menu'), $('pause'), $('over'));

// D-pad: press or slide; 8 directions decided from the thumb's angle to the pad centre.
const dpad = $('dpad');
const arms = { up: dpad.querySelector('.up'), down: dpad.querySelector('.down'), left: dpad.querySelector('.left'), right: dpad.querySelector('.right') };
let dpadId = null;
function setPadDir(x, y) {
  if ((x || y) && (x !== input.padX || y !== input.padY)) vibrate(8);
  input.padX = x; input.padY = y;
  arms.up.classList.toggle('on', y > 0); arms.down.classList.toggle('on', y < 0);
  arms.left.classList.toggle('on', x < 0); arms.right.classList.toggle('on', x > 0);
}
function dpadFrom(e) {
  const r = dpad.getBoundingClientRect();
  const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
  const len = Math.hypot(dx, dy);
  if (len < r.width * 0.1) return setPadDir(0, 0);           // dead zone in the middle
  const k = 0.38;                                            // sin(22.5°): 8 equal sectors
  setPadDir(Math.abs(dx) > len * k ? Math.sign(dx) : 0, Math.abs(dy) > len * k ? -Math.sign(dy) : 0);
}
dpad.addEventListener('pointerdown', (e) => { e.preventDefault(); audioInit(); dpadId = e.pointerId; dpad.setPointerCapture(e.pointerId); dpadFrom(e); });
dpad.addEventListener('pointermove', (e) => { if (e.pointerId === dpadId) dpadFrom(e); });
const dpadEnd = (e) => { if (e.pointerId === dpadId) { dpadId = null; setPadDir(0, 0); } };
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) dpad.addEventListener(ev, dpadEnd);

// A/B buttons: each finger tracks which button it is over, so you can slide between them.
const actionsEl = $('actions');
const actButtons = [...actionsEl.querySelectorAll('.act')];
const actFingers = new Map();
function actAt(x, y) {
  let best = null, bestD = Infinity;
  for (const b of actButtons) {
    const r = b.getBoundingClientRect();
    const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
    if (d < r.width * 0.75 && d < bestD) { best = b.dataset.act; bestD = d; }
  }
  return best;
}
function refreshActs() {
  const held = new Set(actFingers.values());
  input.touchFire = held.has('fire');
  for (const b of actButtons) b.classList.toggle('on', held.has(b.dataset.act));
}
function setFinger(id, act) {
  if (actFingers.get(id) === act) return;
  actFingers.set(id, act);
  if (act) vibrate(10);
  if (act === 'special') useSpecial();
  refreshActs();
}
actionsEl.addEventListener('pointerdown', (e) => { e.preventDefault(); audioInit(); actionsEl.setPointerCapture(e.pointerId); setFinger(e.pointerId, actAt(e.clientX, e.clientY)); });
actionsEl.addEventListener('pointermove', (e) => { if (actFingers.has(e.pointerId)) setFinger(e.pointerId, actAt(e.clientX, e.clientY)); });
const actEnd = (e) => { if (actFingers.delete(e.pointerId)) refreshActs(); };
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) actionsEl.addEventListener(ev, actEnd);

function releaseTouchControls() { actFingers.clear(); refreshActs(); dpadId = null; setPadDir(0, 0); dragId = null; }

// Optional: drag directly on the game screen to move (relative, like a touchpad).
let dragId = null, dragX = 0, dragY = 0;
canvas.addEventListener('pointerdown', (e) => { if (!godMode || !isTouch || state !== 'playing') return; audioInit(); dragId = e.pointerId; dragX = e.clientX; dragY = e.clientY; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== dragId) return;
  const sens = 1 / pxPerUnit;           // 1:1, the ship follows the finger
  input.dx += (e.clientX - dragX) * sens; input.dy -= (e.clientY - dragY) * sens;
  dragX = e.clientX; dragY = e.clientY;
});
const endDrag = (e) => { if (e.pointerId === dragId) dragId = null; };
canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);

$('btn-pause').addEventListener('click', () => { audioInit(); if (state === 'playing') pauseGame(); else if (state === 'paused') resumeGame(); });
// MODE switches the screen colours; tapping it 7 times in a row toggles god mode instead.
let modeTaps = 0, modeTapT = 0;
$('btn-padmode').addEventListener('click', () => {
  const now = performance.now();
  modeTaps = now - modeTapT < 350 ? modeTaps + 1 : 1;   // each tap within 0.35 s of the last: only very fast tapping counts
  modeTapT = now;
  if (modeTaps >= 7) {
    modeTaps = 0;
    godMode = !godMode;
    dragId = null;
    updateHud(); vibrate(60); audioInit();
    flashBanner(godMode ? 'GOD MODE ON' : 'GOD MODE OFF', 1.6);
    return;                       // 7th tap: no colour switch (the six before it cancel out in pairs)
  }
  toggleMode();
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

// gamepad
let padSpecialPrev = false, padStartPrev = false;
function readGamepad() {
  const gps = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of gps) {
    if (!gp) continue;
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    const r = { x: Math.abs(ax) > 0.2 ? ax : 0, y: Math.abs(ay) > 0.2 ? -ay : 0, fire: false };
    const b = (i) => gp.buttons[i] && gp.buttons[i].pressed;
    if (b(12)) r.y = 1; if (b(13)) r.y = -1; if (b(14)) r.x = -1; if (b(15)) r.x = 1;
    r.fire = b(0) || b(7);
    const sp = b(1) || b(2) || b(6);
    if (sp && !padSpecialPrev && state === 'playing') useSpecial();
    padSpecialPrev = sp;
    const st = b(9);
    if (st && !padStartPrev) { if (state === 'playing') pauseGame(); else if (state === 'paused') resumeGame(); else if (state === 'menu') startGame(); else if (state === 'over') continueGame(); }
    padStartPrev = st;
    return r;
  }
  return null;
}

// ───────────────────────────── flow ─────────────────────────────
function clearWorld() {
  enemies.forEach(removeEntity); enemies = [];
  [...pBullets, ...eBullets, ...pickups, ...missiles].forEach((b) => scene.remove(b.mesh));
  pBullets = []; eBullets = []; pickups = []; missiles = [];
  if (boss) { removeEntity(boss); boss = null; }
  $('boss-bar').classList.add('hidden');
}
function showOnly(id) {
  for (const o of ['menu', 'pause', 'over']) $(o).classList.toggle('hidden', o !== id);
  const playing = id === null;
  $('hud').classList.toggle('hidden', !playing && id !== 'pause');
}
// PLAY starts from stage 1 with score 0; CONTINUE (after game over) restarts the stage you died on and keeps the score.
function startGame(from = 1, keepScore = false) {
  audioInit(); startMusic();
  clearWorld();
  victoryShown = false;
  if (!keepScore) score = 0;
  lives = 3;
  Object.assign(player, { x: -HW + 4, y: 0, alive: true, inv: 2, power: 1, special: null, ammo: 0, laserT: 0, shieldT: 0, respawnT: 0 });
  player.mesh.visible = true; input.dx = input.dy = 0; laserMesh.visible = false; shieldGroup.visible = false;
  state = 'playing';
  showOnly(null);
  startStage(Math.max(1, parseInt(DEBUG.get('stage'), 10) || from));
  if (DEBUG.has('boss')) director.waves = 0;
  if (isTouch) {
    try { const el = document.documentElement; if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {}); } catch { /* ignore */ }
  }
}
function pauseGame() { if (state !== 'playing') return; releaseTouchControls(); state = 'paused'; musicOn = false; showOnly('pause'); }
function resumeGame() { if (state !== 'paused') return; state = 'playing'; input.dx = input.dy = 0; startMusic(); showOnly(null); }
function quitToMenu() { clearWorld(); state = 'menu'; musicOn = false; player.mesh.visible = true; player.alive = true; player.inv = 0; player.laserT = 0; player.shieldT = 0; laserMesh.visible = false; shieldGroup.visible = false; theme = { floor: false, ceil: false }; showOnly('menu'); refreshHi(); $('banner').classList.add('hidden'); }
function continueGame() { if (victoryShown) startGame(1); else startGame(stageNo, true); }
function victory() {
  if (state !== 'playing') return;
  state = 'over'; musicOn = false; victoryShown = true;
  const newHi = score > hiScore;
  if (newHi) { hiScore = score; save('hi', hiScore); }
  $('over-title').textContent = 'YOU WIN!';
  $('over-score').innerHTML = `ALL ${STAGES.length} STAGES CLEAR<br/><br/>SCORE ${String(score).padStart(6, '0')}<br/><br/>${newHi ? 'NEW HIGH SCORE!' : `HI ${String(hiScore).padStart(6, '0')}`}`;
  $('btn-retry').textContent = 'PLAY AGAIN';
  showOnly('over');
}
function gameOver() {
  if (state !== 'playing' && state !== 'paused') return;
  state = 'over'; musicOn = false;
  const newHi = score > hiScore;
  if (newHi) { hiScore = score; save('hi', hiScore); }
  $('over-title').textContent = 'GAME OVER';
  $('over-score').innerHTML = `SCORE ${String(score).padStart(6, '0')}<br/><br/>${newHi ? 'NEW HIGH SCORE!' : `HI ${String(hiScore).padStart(6, '0')}`}<br/><br/>REACHED STAGE ${stageNo}`;
  $('btn-retry').textContent = `CONTINUE · STAGE ${stageNo}`;
  showOnly('over');
}
function refreshHi() { $('hiscore').textContent = `HI ${String(hiScore).padStart(6, '0')}`; }
function toggleMode() { settings.modern = !settings.modern; save('modern', settings.modern); applyMode(); }
// Screen orientation (phones): auto, portrait or landscape. Locks when the browser allows it, otherwise asks to rotate.
const ORIENT_LABEL = { auto: 'AUTO', portrait: 'PORTRAIT', landscape: 'LANDSCAPE' };
function updateRotateHint() {
  const want = settings.orient, portrait = innerHeight > innerWidth;
  const mismatch = isTouch && want !== 'auto' && (want === 'portrait') !== portrait;
  $('rotate').classList.toggle('hidden', !mismatch);
  if (mismatch) {
    $('rotate-text').textContent = want === 'landscape' ? 'ROTATE YOUR PHONE SIDEWAYS' : 'HOLD YOUR PHONE UPRIGHT';
    if (state === 'playing') pauseGame();
  }
}
async function applyOrient(userGesture = false) {
  const o = screen.orientation;
  try {
    if (settings.orient === 'auto') o?.unlock?.();
    else if (o?.lock && userGesture) {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.().catch(() => {});
      await o.lock(settings.orient).catch(() => {});
    }
  } catch { /* not supported: the rotate hint covers it */ }
  updateRotateHint();
}
function cycleOrient() {
  const order = ['auto', 'portrait', 'landscape'];
  settings.orient = order[(order.indexOf(settings.orient) + 1) % order.length];
  save('orient', settings.orient);
  syncOrientButtons();
  applyOrient(true);
}
function syncOrientButtons() { for (const id of ['btn-orient', 'btn-orient2']) $(id).textContent = `SCREEN: ${ORIENT_LABEL[settings.orient]}`; }
function toggleSound() {
  settings.sound = !settings.sound; save('sound', settings.sound);
  if (master) master.gain.value = settings.sound ? 0.5 : 0;
  const label = `SOUND: ${settings.sound ? 'ON' : 'OFF'}`;
  $('btn-sound').textContent = label; $('btn-sound2').textContent = label;
}

$('btn-play').addEventListener('click', () => startGame());
$('btn-retry').addEventListener('click', continueGame);
$('btn-menu').addEventListener('click', quitToMenu);
$('btn-resume').addEventListener('click', resumeGame);
$('btn-quit').addEventListener('click', quitToMenu);
for (const id of ['btn-mode', 'btn-mode2']) $(id).addEventListener('click', toggleMode);
for (const id of ['btn-orient', 'btn-orient2']) $(id).addEventListener('click', () => { audioInit(); cycleOrient(); });
syncOrientButtons();
addEventListener('resize', updateRotateHint);
addEventListener('orientationchange', () => setTimeout(updateRotateHint, 150));
updateRotateHint();
for (const id of ['btn-sound', 'btn-sound2']) $(id).addEventListener('click', () => { audioInit(); toggleSound(); });

// PWA install prompt
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; $('btn-install').classList.remove('hidden'); });
$('btn-install').addEventListener('click', async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice.catch(() => {});
  deferredInstall = null; $('btn-install').classList.add('hidden');
});
window.addEventListener('appinstalled', () => $('btn-install').classList.add('hidden'));

// ───────────────────────────── update ─────────────────────────────
function updatePlayer(dt) {
  if (!player.alive) {
    if (player.respawnT > 0) {
      player.respawnT -= dt;
      if (player.respawnT <= 0 && lives > 0) {
        Object.assign(player, { alive: true, x: -HW + 4, y: 0, inv: 2.5 });
        player.mesh.visible = true;
      }
    }
    return;
  }
  const gp = gpState;
  let mx = 0, my = 0;
  if (keys.has('ArrowLeft') || keys.has('KeyA')) mx -= 1;
  if (keys.has('ArrowRight') || keys.has('KeyD')) mx += 1;
  if (keys.has('ArrowUp') || keys.has('KeyW')) my += 1;
  if (keys.has('ArrowDown') || keys.has('KeyS')) my -= 1;
  if (gp) { mx += gp.x; my += gp.y; }
  mx += input.padX; my += input.padY;
  const len = Math.hypot(mx, my);
  if (len > 1) { mx /= len; my /= len; }
  const speed = 13;
  const tvx = mx * speed, tvy = my * speed;
  player.vx += (tvx - player.vx) * Math.min(1, dt * 14);
  player.vy += (tvy - player.vy) * Math.min(1, dt * 14);
  player.x += player.vx * dt + input.dx;
  player.y += player.vy * dt + input.dy;
  const tiltV = player.vy + input.dy / Math.max(dt, 0.001) * 0.05;
  input.dx = 0; input.dy = 0;
  // keep inside playfield (and above/below terrain)
  const minY = -HH + 0.8 + (theme.floor ? 2.2 : 0), maxY = HH - 0.8 - (theme.ceil ? 2.2 : 0);
  player.x = clamp(player.x, -HW + 1.2, HW - 3);
  player.y = clamp(player.y, minY, maxY);

  player.mesh.position.set(player.x, player.y, 0);
  player.mesh.rotation.x = clamp(-tiltV * 0.05, -0.6, 0.6);
  engine.scale.x = 0.7 + Math.random() * 0.8;

  if (player.inv > 0) { player.inv -= dt; player.mesh.visible = Math.floor(player.inv * 12) % 2 === 0 || player.inv <= 0; }

  player.fireCd -= dt;
  const firing = keys.has('Space') || keys.has('KeyJ') || keys.has('KeyZ') || input.touchFire || (gp && gp.fire);
  if (firing && player.fireCd <= 0) { firePlayer(); player.fireCd = 0.13; }

  // laser
  if (player.laserT > 0) {
    player.laserT -= dt;
    const len2 = HW - player.x + 2;
    laserMesh.visible = true;
    laserMesh.position.set(player.x + 1 + len2 / 2, player.y, 0);
    laserMesh.scale.set(len2, 0.6 + Math.random() * 0.8, 1);
    for (const e of enemies) if (e.x > player.x && Math.abs(e.y - player.y) < e.hh + 0.3) damageEnemy(e, 14 * dt);
    if (boss && boss.x > player.x && Math.abs(boss.y - player.y) < boss.hh * 0.85) damageBoss(18 * dt);
    for (const b of eBullets) if (b.x > player.x && Math.abs(b.y - player.y) < 0.5) b.dead = true;
  } else laserMesh.visible = false;

  // barrier
  if (player.shieldT > 0) {
    player.shieldT -= dt;
    shieldGroup.visible = player.shieldT > 1.5 || Math.floor(player.shieldT * 10) % 2 === 0;
    shieldGroup.position.set(player.x, player.y, 0);
    const t = performance.now() / 1000;
    shieldCubes.forEach((c, i) => {
      const a = t * 4 + (i * Math.PI) / 2;
      c.position.set(Math.cos(a) * 1.7, Math.sin(a) * 1.7, Math.sin(a * 2) * 0.4);
      c.rotation.set(t * 3, t * 2, 0);
      const wx = player.x + c.position.x, wy = player.y + c.position.y;
      for (const b of eBullets) if (Math.abs(b.x - wx) < 0.55 && Math.abs(b.y - wy) < 0.55) b.dead = true;
      for (const e of enemies) if (hitBox(e, wx, wy, 0.3)) damageEnemy(e, 6 * dt);
    });
  } else shieldGroup.visible = false;

  // terrain collision
  if ((theme.floor || theme.ceil) && player.inv <= 0) {
    const i = Math.round((player.x + COLS / 2 * COL_W + (terrainOffset % COL_W)) / COL_W);
    if (i >= 0 && i < COLS) {
      if (theme.floor && player.y - 0.4 < -HH - 0.8 + floorH[i]) hurtPlayer();
      if (theme.ceil && player.y + 0.4 > HH + 0.8 - ceilH[i]) hurtPlayer();
    }
  }
}

function updateEnemies(dt) {
  const d = difficulty();
  for (const e of enemies) {
    e.t += dt;
    switch (e.type) {
      case 'drone':
        e.x -= e.speed * dt;
        if (stageNo > 1 && e.fireCd !== undefined) { e.fireCd -= dt; if (e.fireCd <= 0 && e.x < HW - 1 && e.x > player.x + 4) { if (Math.random() < 0.12 * d) fireEnemy(e.x, e.y, aimAt(e.x, e.y), 8); e.fireCd = rand(1.5, 3); } }
        break;
      case 'waver':
        e.x -= e.speed * dt;
        e.y = e.baseY + Math.sin(e.t * 3 + (e.phase || 0)) * (e.amp || 3);
        break;
      case 'shooter':
        if (e.x > e.stopX && e.shots > 0) e.x -= e.speed * dt;
        else if (e.shots > 0) {
          e.y += (player.y - e.y) * dt * 0.8;
          e.fireCd -= dt;
          if (e.fireCd <= 0) { fireEnemy(e.x - 1, e.y, aimAt(e.x, e.y), 9 + d * 1.5); e.shots--; e.fireCd = 1.1 / d; }
        } else e.x -= e.speed * 1.4 * dt;
        break;
      case 'diver':
        e.x -= e.speed * dt;
        if (e.x < HW - 2) e.y += clamp(player.y - e.y, -1, 1) * dt * 5;
        break;
      case 'rock':
        e.x -= e.speed * dt;
        e.mesh.rotation.x += e.spin.x * dt; e.mesh.rotation.z += e.spin.z * dt;
        break;
      case 'carrier':
        e.x -= e.speed * dt;
        e.y = e.baseY + Math.sin(e.t * 1.5) * 1.2;
        break;
      case 'zigzag': {
        e.x -= e.speed * dt;
        const w = (e.t * 2.2 + (e.phase || 0)) % 2;                       // triangle wave: sharp turns
        e.y = clamp(e.baseY + (w < 1 ? w * 2 - 1 : 3 - w * 2) * (e.amp || 2.5), -HH + 1, HH - 1);
        break;
      }
      case 'orbiter': {
        e.x -= e.speed * 0.6 * dt;
        e.y = clamp(e.baseY + Math.sin(e.t * 2.4 + (e.phase || 0)) * (e.amp || 2.5), -HH + 1, HH - 1);
        e.mesh.rotation.z = e.t * 3;
        e.fireCd -= dt;
        if (e.fireCd <= 0 && e.x < HW - 2 && e.x > player.x + 5) { fireEnemy(e.x - 0.8, e.y, aimAt(e.x, e.y), 8 + d); e.fireCd = rand(2, 3.4) / d; }
        break;
      }
      case 'bomber':
        if (e.x > e.stopX) e.x -= e.speed * dt; else e.x -= e.speed * 0.3 * dt;
        e.fireCd -= dt;
        if (e.fireCd <= 0 && e.x < HW - 1) { for (const da of [-0.22, 0, 0.22]) fireEnemy(e.x - 1, e.y, Math.PI + da, 7 + d); e.fireCd = 1.8 / d; }
        break;
    }
    if (e.type !== 'rock' && e.type !== 'orbiter') e.mesh.rotation.x = Math.sin(e.t * 2) * 0.25;
    e.mesh.position.set(e.x, e.y, 0);
    if (e.flash > 0) { e.flash -= dt; e.mats[0].emissive.setHex(0xffffff); e.mats[0].emissiveIntensity = 1; }
    else { e.mats[0].emissiveIntensity = 0; }
    if (e.x < -HW - 4) e.dead = true;
    // collide with player
    if (player.alive && hitBox(e, player.x, player.y, 0.35)) {
      if (player.shieldT > 0) damageEnemy(e, 99);
      else { hurtPlayer(); if (e.type !== 'rock') damageEnemy(e, 99); }
    }
  }
  enemies = enemies.filter((e) => { if (e.dead) removeEntity(e); return !e.dead; });
}

function updateBoss(dt) {
  if (!boss) return;
  const b = boss;
  b.t += dt;
  if (b.phase === 'enter') {
    b.x += (HW - 5 - b.x) * dt * 1.2;
    if (Math.abs(b.x - (HW - 5)) < 0.3) b.phase = 'fight';
  } else {
    const range = HH - b.hh - 0.5 - (theme.floor ? 2 : 0);
    b.y = Math.sin(b.t * b.mv[0]) * Math.max(0, range);
    b.x = HW - 5 + Math.sin(b.t * b.mv[1]) * b.mv[2];
    b.atkCd -= dt;
    if (b.atkCd <= 0) bossAttack();
  }
  b.mesh.position.set(b.x, b.y, 0);
  b.mesh.rotation.x = Math.sin(b.t * 1.3) * 0.25;
  if (b.kind === 'core') b.mesh.rotation.z = b.t * 0.6;
  else if (b.kind === 'octopus' || b.kind === 'skull' || b.kind === 'mech') b.mesh.rotation.z = Math.sin(b.t * 1.6) * 0.12;
  if (b.flash > 0) { b.flash -= dt; b.mats[0].emissive.setHex(0xffffff); b.mats[0].emissiveIntensity = 0.8; } else b.mats[0].emissiveIntensity = 0;
  if (player.alive && hitBox(b, player.x, player.y, 0.2)) hurtPlayer();
}

function updateProjectiles(dt) {
  for (const b of pBullets) {
    b.x += b.vx * dt; b.y += b.vy * dt;
    b.mesh.position.set(b.x, b.y, 0);
    if (b.x > HW + 2 || Math.abs(b.y) > HH + 2) { b.dead = true; continue; }
    for (const e of enemies) if (!e.dead && hitBox(e, b.x, b.y, 0.15)) { damageEnemy(e, b.dmg); b.dead = true; break; }
    if (!b.dead && boss && hitBox(boss, b.x, b.y, 0)) { damageBoss(b.dmg); b.dead = true; }
  }
  pBullets = pBullets.filter((b) => { if (b.dead) scene.remove(b.mesh); return !b.dead; });

  for (const m of missiles) {
    m.t += dt;
    let target = boss;
    let best = target ? Math.hypot(target.x - m.x, target.y - m.y) : Infinity;
    for (const e of enemies) { const dd = Math.hypot(e.x - m.x, e.y - m.y); if (!e.dead && e.x > m.x - 2 && dd < best) { best = dd; target = e; } }
    const sp = Math.min(26, 6 + m.t * 40);
    if (target && m.t > 0.12) {
      const a = Math.atan2(target.y - m.y, target.x - m.x);
      m.vx += (Math.cos(a) * sp - m.vx) * Math.min(1, dt * 7);
      m.vy += (Math.sin(a) * sp - m.vy) * Math.min(1, dt * 7);
    } else { m.vx += (sp - m.vx) * dt * 3; }
    m.x += m.vx * dt; m.y += m.vy * dt;
    m.mesh.position.set(m.x, m.y, 0); m.mesh.rotation.z = Math.atan2(m.vy, m.vx);
    if (Math.random() < 0.6) burst(m.x - 0.3, m.y, 0xaaaaaa, 1, 1, 0.16);
    let hit = false;
    for (const e of enemies) if (!e.dead && hitBox(e, m.x, m.y, 0.2)) { hit = true; break; }
    if (boss && hitBox(boss, m.x, m.y, 0)) hit = true;
    if (hit) {
      m.dead = true;
      burst(m.x, m.y, 0xffa502, 18, 7, 0.25); sfx.boom();
      for (const e of enemies) if (!e.dead && Math.hypot(e.x - m.x, e.y - m.y) < 2.4) damageEnemy(e, 5);
      if (boss && hitBox(boss, m.x, m.y, 1)) damageBoss(5);
    }
    if (m.x > HW + 3 || Math.abs(m.y) > HH + 3 || m.t > 4) m.dead = true;
  }
  missiles = missiles.filter((m) => { if (m.dead) scene.remove(m.mesh); return !m.dead; });

  for (const b of eBullets) {
    b.x += b.vx * dt; b.y += b.vy * dt;
    b.mesh.position.set(b.x, b.y, 0); b.mesh.rotation.x += dt * 8; b.mesh.rotation.y += dt * 6;
    if (b.x < -HW - 2 || b.x > HW + 3 || Math.abs(b.y) > HH + 2) b.dead = true;
    if (!b.dead && player.alive && Math.abs(b.x - player.x) < 0.75 && Math.abs(b.y - player.y) < 0.4) { b.dead = true; hurtPlayer(); }
  }
  eBullets = eBullets.filter((b) => { if (b.dead) scene.remove(b.mesh); return !b.dead; });

  for (const p of pickups) {
    p.t += dt; p.x -= 3 * dt; p.y += Math.sin(p.t * 3) * dt;
    p.mesh.position.set(p.x, p.y, 0); p.mesh.rotation.set(p.t * 1.5, p.t * 2, 0);
    p.mesh.scale.setScalar(0.9 + Math.sin(p.t * 8) * 0.1);
    if (player.alive && Math.abs(p.x - player.x) < 1.2 && Math.abs(p.y - player.y) < 1.0) { p.dead = true; collectPickup(p); }
    if (p.x < -HW - 2) p.dead = true;
  }
  pickups = pickups.filter((p) => { if (p.dead) scene.remove(p.mesh); return !p.dead; });
}

// ───────────────────────────── main loop ─────────────────────────────
let last = performance.now();
let gpState = null;
const camBase = new THREE.Vector3();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  musicTick();
  gpState = readGamepad();

  if (state === 'playing') {
    updateDirector(dt);
    updatePlayer(dt);
    updateEnemies(dt);
    updateBoss(dt);
    updateProjectiles(dt);
    updateBackground(dt, boss ? 0.6 : 1);
    updateParticles(dt);
  } else if (state === 'menu') {
    // attract mode: ship drifts and bobs
    const t = now / 1000;
    player.x = -6 + Math.sin(t * 0.5) * 3; player.y = Math.sin(t * 1.1) * 2.5;
    player.mesh.position.set(player.x, player.y, 0);
    player.mesh.rotation.x = Math.sin(t * 1.1) * 0.4;
    player.mesh.visible = true;
    updateBackground(dt, 1.4);
    updateParticles(dt);
  } else if (state === 'over') {
    updateBackground(dt, 0.4); updateParticles(dt);
  }

  // camera shake
  camBase.copy(camera.position);
  if (shake > 0) { shake = Math.max(0, shake - dt * 2.2); const s = shake * 0.5; camera.position.x += rand(-s, s); camera.position.y += rand(-s, s); }
  if (flashT > 0) flashT -= dt;

  if (settings.modern) {
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
  } else {
    lcdMat.uniforms.flash.value = flashT > 0 ? 1 : 0;
    renderer.setRenderTarget(lcdTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCam);
  }
  camera.position.copy(camBase);
}

// ───────────────────────────── boot ─────────────────────────────
fitCamera();
applyMode();
refreshHi();
{ const l = `SOUND: ${settings.sound ? 'ON' : 'OFF'}`; $('btn-sound').textContent = l; $('btn-sound2').textContent = l; }
updateHud();
showOnly('menu');
$('loading').classList.add('hidden');
requestAnimationFrame(frame);
