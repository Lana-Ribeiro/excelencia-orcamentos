// Texturas procedurais (geradas por código, sem baixar imagens): mármore, pedra
// polida em placas, reboco, latão escovado, nogueira e ônix retroiluminado.

import * as THREE from "three";

// ---------- ruído de valor periódico (repete sem emendas) ----------
function createNoise(seed: number) {
  let s = seed % 2147483647 || 1;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const perm = new Uint8Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const val = new Float32Array(256).map(() => rand());
  const fade = (t: number) => t * t * (3 - 2 * t);
  const noise = (x: number, y: number, period = 256) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const x0 = ((xi % period) + period) % period;
    const y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period;
    const y1 = (y0 + 1) % period;
    const h = (a: number, b: number) => val[perm[perm[a & 255] + (b & 255)]];
    const u = fade(xf);
    const v = fade(yf);
    const a = h(x0, y0) + (h(x1, y0) - h(x0, y0)) * u;
    const b = h(x0, y1) + (h(x1, y1) - h(x0, y1)) * u;
    return a + (b - a) * v;
  };
  const fbm = (x: number, y: number, octaves: number, period = 256) => {
    let sum = 0;
    let amp = 0.5;
    let f = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(x * f, y * f, period * f);
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  };
  return { noise, fbm, rand };
}

type RGB = [number, number, number];
const hex = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

function dataTexture(data: Uint8Array, size: number, color: boolean, repeat = false) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Mármore tipo Calacatta: fundo creme, veios cinza-dourados irregulares. */
export function marble(size = 512, seed = 7, opts: { base?: number; vein?: number; strength?: number } = {}) {
  const { fbm } = createNoise(seed);
  const base = hex(opts.base ?? 0xeee8de);
  const vein = hex(opts.vein ?? 0x8f8374);
  const gold = hex(0xb79c73);
  const strength = opts.strength ?? 1;
  const map = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const nx = (x / size) * 3;
      const ny = (y / size) * 3;
      const w = fbm(nx, ny, 5);
      const v1 = Math.pow(1 - Math.abs(Math.sin((nx * 0.55 + ny * 1.05 + w * 3.2) * Math.PI)), 14);
      const v2 = Math.pow(1 - Math.abs(Math.sin((nx * 1.9 - ny * 0.5 + fbm(nx * 2.1 + 5, ny * 2.1, 4) * 4.5) * Math.PI)), 28) * 0.6;
      const cloud = fbm(nx * 0.8 + 11, ny * 0.8, 3);
      let c = mix(base, [base[0] * 0.93, base[1] * 0.92, base[2] * 0.9], cloud);
      c = mix(c, vein, clamp01(v1 * 0.75 * strength));
      c = mix(c, gold, clamp01(v2 * 0.55 * strength));
      const i = (y * size + x) * 4;
      map[i] = c[0];
      map[i + 1] = c[1];
      map[i + 2] = c[2];
      map[i + 3] = 255;
      const r = 0.14 + cloud * 0.06 + v1 * 0.08;
      rough[i] = rough[i + 1] = rough[i + 2] = Math.round(clamp01(r) * 255);
      rough[i + 3] = 255;
    }
  return { map: dataTexture(map, size, true), roughness: dataTexture(rough, size, false) };
}

/** Pedra polida em placas grandes (travertino claro), com juntas finas. Repete sem emenda. */
export function stoneTiles(size = 1024, tilesPerSide = 2, seed = 21) {
  const { fbm, noise, rand } = createNoise(seed);
  const tones = Array.from({ length: tilesPerSide * tilesPerSide }, () => 0.94 + rand() * 0.1);
  const base = hex(0xd9cbb5);
  const band = hex(0xbfab8f);
  const grout = hex(0x857868);
  const map = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  const tile = size / tilesPerSide;
  const period = 8;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const tx = Math.floor(x / tile);
      const ty = Math.floor(y / tile);
      const lx = x - tx * tile;
      const ly = y - ty * tile;
      const edge = Math.min(lx, ly, tile - 1 - lx, tile - 1 - ly);
      const u = (x / size) * period;
      const v = (y / size) * period;
      // veios lineares típicos do travertino
      const bands = fbm(u * 0.35, v * 3.2, 4, period);
      const pores = noise(u * 22, v * 22, period * 22);
      const cloud = fbm(u * 0.6 + 3, v * 0.6, 3, period);
      let c = mix(base, band, clamp01((bands - 0.42) * 2.2));
      const tone = tones[ty * tilesPerSide + tx] * (0.96 + cloud * 0.08);
      c = [c[0] * tone, c[1] * tone, c[2] * tone];
      if (pores > 0.86) c = mix(c, band, (pores - 0.86) * 4);
      let r = 0.1 + cloud * 0.05;
      if (edge < 2.5) {
        c = grout;
        r = 0.65;
      } else if (edge < 4) {
        c = mix(c, grout, 0.4);
        r = 0.3;
      }
      const i = (y * size + x) * 4;
      map[i] = Math.min(255, c[0]);
      map[i + 1] = Math.min(255, c[1]);
      map[i + 2] = Math.min(255, c[2]);
      map[i + 3] = 255;
      rough[i] = rough[i + 1] = rough[i + 2] = Math.round(clamp01(r) * 255);
      rough[i + 3] = 255;
    }
  return { map: dataTexture(map, size, true, true), roughness: dataTexture(rough, size, false, true) };
}

/** Reboco em cal (mesclado suave) + relevo. Repete sem emenda. */
export function plaster(size = 512, seed = 5, color = 0xb9aa96) {
  const { fbm } = createNoise(seed);
  const base = hex(color);
  const map = new Uint8Array(size * size * 4);
  const bump = new Uint8Array(size * size * 4);
  const period = 6;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x / size) * period;
      const v = (y / size) * period;
      const m = fbm(u, v, 5, period);
      const fine = fbm(u * 8, v * 8, 2, period * 8);
      const k = 0.9 + m * 0.18 + (fine - 0.5) * 0.04;
      const i = (y * size + x) * 4;
      map[i] = Math.min(255, base[0] * k);
      map[i + 1] = Math.min(255, base[1] * k);
      map[i + 2] = Math.min(255, base[2] * k);
      map[i + 3] = 255;
      bump[i] = bump[i + 1] = bump[i + 2] = Math.round(clamp01(m * 0.7 + fine * 0.3) * 255);
      bump[i + 3] = 255;
    }
  return { map: dataTexture(map, size, true, true), bump: dataTexture(bump, size, false, true) };
}

/** Rugosidade de metal escovado (riscos finos numa direção). */
export function brushed(size = 256, seed = 3) {
  const { noise } = createNoise(seed);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const n = noise(x * 0.02, y * 1.6, 256) * 0.7 + noise(x * 0.05, y * 4.1, 256) * 0.3;
      const r = 0.2 + n * 0.16;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.round(clamp01(r) * 255);
      data[i + 3] = 255;
    }
  return dataTexture(data, size, false, true);
}

/** Nogueira: veios e anéis. */
export function walnut(size = 512, seed = 9) {
  const { fbm } = createNoise(seed);
  const dark = hex(0x2e1d12);
  const light = hex(0x6a4630);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const w = fbm(u * 3, v * 0.6, 4);
      const rings = (v * 14 + w * 5) % 1;
      const streak = fbm(u * 40, v * 2, 3);
      const t = clamp01(Math.pow(Math.abs(rings - 0.5) * 2, 3) * 0.7 + streak * 0.35);
      const c = mix(dark, light, t);
      const i = (y * size + x) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  return dataTexture(data, size, true, true);
}
