// Cena 3D da capa: galeria de uma boutique de luxo, com materiais e luz realistas.
//
// Realismo: texturas procedurais (mármore, pedra polida, reboco canelado, latão
// escovado, nogueira, veludo), reflexo suave no piso, oclusão de ambiente (sombras de
// contato), luz rasante nas paredes, câmera nivelada à altura dos olhos (verticais
// retas, como em fotografia de arquitetura), granulação e vinheta de lente.
// Abertura: começa como desenho técnico e "acende" até o espaço iluminado.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { Pass } from "three/examples/jsm/postprocessing/Pass.js";
import { brushed, marble, plaster, stoneTiles, walnut } from "./textures";

const WARM = 0xffd2a1; // ~2800 K

/** Liga/desliga um objeto entre passes do pós-processamento (reflexo fora da oclusão). */
class VisibilityPass extends Pass {
  private obj: THREE.Object3D;
  private show: boolean;
  constructor(obj: THREE.Object3D, show: boolean) {
    super();
    this.obj = obj;
    this.show = show;
    this.needsSwap = false;
  }
  render() {
    this.obj.visible = this.show;
  }
}

/** Reflexo do piso: suave (levemente desfocado) e parcial, como pedra polida. */
const SoftReflectionShader = {
  name: "SoftReflection",
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uOpacity: { value: 0.2 },
    uTexel: { value: new THREE.Vector2(1 / 640, 1 / 640) },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform float uOpacity;
    uniform vec2 uTexel;
    varying vec4 vUv;
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      vec2 uv = vUv.xy / vUv.w;
      vec3 c = texture2D(tDiffuse, uv).rgb * 0.28;
      c += texture2D(tDiffuse, uv + vec2(uTexel.x * 2.0, 0.0)).rgb * 0.12;
      c += texture2D(tDiffuse, uv - vec2(uTexel.x * 2.0, 0.0)).rgb * 0.12;
      c += texture2D(tDiffuse, uv + vec2(0.0, uTexel.y * 4.0)).rgb * 0.16;
      c += texture2D(tDiffuse, uv - vec2(0.0, uTexel.y * 4.0)).rgb * 0.16;
      c += texture2D(tDiffuse, uv + vec2(0.0, uTexel.y * 9.0)).rgb * 0.08;
      c += texture2D(tDiffuse, uv - vec2(0.0, uTexel.y * 9.0)).rgb * 0.08;
      gl_FragColor = vec4(c * color, uOpacity);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

/** Acabamento fotográfico: vinheta, granulação e leve aberração cromática. */
const FinishShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; varying vec2 vUv;
    float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float ca = 0.0016 * length(c);
      vec3 col = vec3(texture2D(tDiffuse, vUv + c * ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - c * ca).b);
      float vig = smoothstep(0.92, 0.28, length(c * vec2(1.05, 1.0)));
      col *= mix(0.58, 1.0, vig);
      float g = rand(vUv * uRes + fract(uTime * 0.37) * 91.7) - 0.5;
      col += g * 0.028;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export default function Scene3D({ onError }: { onError?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  // a cena é montada uma única vez; o callback fica numa ref para não recriá-la a cada renderização
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    } catch {
      onErrorRef.current?.();
      return;
    }
    let pixelRatio = Math.min(window.devicePixelRatio, 1.25);
    renderer.setPixelRatio(pixelRatio);
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false; // cena parada: sombras calculadas uma vez
    renderer.shadowMap.needsUpdate = true;
    el.appendChild(renderer.domElement);
    const maxAniso = renderer.capabilities.getMaxAnisotropy();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e0b09);
    scene.fog = new THREE.Fog(0x120e0b, 27, 62);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    scene.environmentIntensity = 0;

    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
    camera.position.set(0, 1.55, 12.5);

    // ---------- texturas e materiais ----------
    const textures: THREE.Texture[] = [];
    const keep = <T extends THREE.Texture>(t: T) => (textures.push(t), t);

    const floorTex = stoneTiles(1024, 2);
    const W = 12; // largura do salão (m)
    const L = 40; // comprimento
    const TILE = 1.2; // placas de 1,20 m
    for (const t of [floorTex.map, floorTex.roughness]) {
      t.repeat.set(W / (TILE * 2), L / (TILE * 2));
      t.anisotropy = maxAniso;
      keep(t);
    }
    const floorMat = new THREE.MeshStandardMaterial({ map: floorTex.map, roughnessMap: floorTex.roughness, roughness: 1, metalness: 0 });

    const marbleTex = marble(512, 7);
    keep(marbleTex.map);
    keep(marbleTex.roughness);
    const marbleMat = new THREE.MeshStandardMaterial({ map: marbleTex.map, roughnessMap: marbleTex.roughness, roughness: 1 });

    const plasterTex = plaster(512, 5, 0xb3a28c);
    keep(plasterTex.map);
    keep(plasterTex.bump);
    plasterTex.map.repeat.set(1, 3);
    plasterTex.bump.repeat.set(1, 3);
    const washData = new Uint8Array(4 * 256);
    for (let i = 0; i < 256; i++) {
      const v = i / 255; // 0 = base, 1 = topo
      const g = Math.round(255 * Math.pow(v, 3.2));
      washData.set([g, g, g, 255], i * 4);
    }
    const washTex = keep(new THREE.DataTexture(washData, 1, 256, THREE.RGBAFormat));
    washTex.needsUpdate = true;
    washTex.magFilter = THREE.LinearFilter;
    const fluteMat = new THREE.MeshStandardMaterial({
      map: plasterTex.map,
      bumpMap: plasterTex.bump,
      bumpScale: 0.8,
      roughness: 0.92,
      emissive: 0xffc58a,
      emissiveMap: washTex,
      emissiveIntensity: 0,
    });
    const wallTex = plaster(512, 8, 0xa8977f);
    keep(wallTex.map);
    keep(wallTex.bump);
    wallTex.map.repeat.set(6, 1.5);
    wallTex.bump.repeat.set(6, 1.5);
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex.map, bumpMap: wallTex.bump, bumpScale: 0.6, roughness: 0.95 });
    const ceilTex = plaster(512, 12, 0xd6cabb);
    keep(ceilTex.map);
    ceilTex.bump.dispose();
    ceilTex.map.repeat.set(3, 10);
    const ceilingMat = new THREE.MeshStandardMaterial({ map: ceilTex.map, roughness: 0.97 });

    const brushTex = keep(brushed(256, 3));
    brushTex.repeat.set(1, 4);
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a067, metalness: 1, roughness: 1, roughnessMap: brushTex });
    const bronze = new THREE.MeshPhysicalMaterial({ color: 0x6e4b2c, metalness: 1, roughness: 0.38, clearcoat: 0.3 });
    const walnutTex = keep(walnut(512, 9));
    const walnutMat = new THREE.MeshPhysicalMaterial({ map: walnutTex, roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.25 });
    const velvet = new THREE.MeshPhysicalMaterial({ color: 0x1c3a30, roughness: 0.9, sheen: 1, sheenColor: new THREE.Color(0x7aa892), sheenRoughness: 0.4 });
    const ceramic = new THREE.MeshPhysicalMaterial({ color: 0xd9ccb8, roughness: 0.62, clearcoat: 0.15 });
    const ceramicDark = new THREE.MeshPhysicalMaterial({ color: 0x2c2723, roughness: 0.2, clearcoat: 0.9, clearcoatRoughness: 0.08 });
    const bookMats = [0xe8e0d0, 0x8c9a86, 0x2f2d2a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));
    const opal = new THREE.MeshStandardMaterial({ color: 0xfff3e2, emissive: WARM, emissiveIntensity: 0, roughness: 0.4 });
    const ledMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: WARM, emissiveIntensity: 0 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x1b1714, roughness: 0.6, metalness: 0.4 });
    const onyxTex = marble(512, 31, { base: 0xf0b067, vein: 0x6b3a14, strength: 1.3 });
    keep(onyxTex.map);
    onyxTex.roughness.dispose();
    const onyx = new THREE.MeshStandardMaterial({ color: 0x120c07, emissive: 0xffffff, emissiveMap: onyxTex.map, emissiveIntensity: 0, roughness: 0.25 });

    const lineMat = new THREE.LineBasicMaterial({ color: 0xe8d9bd, transparent: true, opacity: 0.85, depthWrite: false });
    const outlineTargets: THREE.Mesh[] = [];
    const add = <T extends THREE.Object3D>(obj: T, opts: { cast?: boolean; receive?: boolean; outline?: boolean } = {}) => {
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = !!opts.cast;
        m.receiveShadow = opts.receive ?? true;
        if (opts.outline) outlineTargets.push(m);
      });
      scene.add(obj);
      return obj;
    };

    // ---------- arquitetura ----------
    const Z0 = 12;
    const ZC = Z0 - L / 2; // centro do salão em Z
    const H = 5.2; // pé-direito

    const floor = add(new THREE.Mesh(new THREE.PlaneGeometry(W, L), floorMat));
    floor.rotation.x = -Math.PI / 2;
    floor.position.z = ZC;

    const reflector = new Reflector(new THREE.PlaneGeometry(W, L), {
      shader: SoftReflectionShader,
      color: 0xffffff,
      textureWidth: 640,
      textureHeight: 640,
      clipBias: 0.003,
      multisample: 0,
    });
    const refMat = reflector.material as THREE.ShaderMaterial;
    refMat.transparent = true;
    refMat.depthWrite = false;
    reflector.rotation.x = -Math.PI / 2;
    reflector.position.set(0, 0.002, ZC);
    scene.add(reflector);
    const updateReflection = reflector.onBeforeRender;
    let reflectTick = 0;
    reflector.onBeforeRender = function (...args) {
      // a câmera anda devagar: atualizar o reflexo a cada 2 quadros não aparece
      if (reflectTick++ % 2 === 0) updateReflection.apply(this, args);
    };

    const ceiling = add(new THREE.Mesh(new THREE.PlaneGeometry(W, L), ceilingMat));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, H, ZC);

    // paredes: reboco + painel canelado (meia-cana) + rodapé em pedra + fita de LED rasante
    const FLUTE_TOP = 4.5;
    const fluteGeo = new THREE.CylinderGeometry(0.075, 0.075, FLUTE_TOP - 0.16, 14, 1, true, 0, Math.PI);
    const perWall = Math.floor(L / 0.15);
    const flutes = new THREE.InstancedMesh(fluteGeo, fluteMat, perWall * 2);
    const mtx = new THREE.Matrix4();
    const rotR = new THREE.Matrix4().makeRotationY(Math.PI);
    for (let i = 0; i < perWall; i++) {
      const z = Z0 - 0.075 - i * 0.15;
      mtx.makeTranslation(-W / 2, 0.16 + (FLUTE_TOP - 0.16) / 2, z);
      flutes.setMatrixAt(i, mtx);
      mtx.makeTranslation(W / 2, 0.16 + (FLUTE_TOP - 0.16) / 2, z).multiply(rotR);
      flutes.setMatrixAt(perWall + i, mtx);
    }
    flutes.receiveShadow = true;
    scene.add(flutes);
    for (const side of [-1, 1]) {
      const wall = add(new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMat));
      wall.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      wall.position.set((side * W) / 2 + side * 0.01, H / 2, ZC);
      const skirt = add(new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.16, L, 2, 0.01), marbleMat));
      skirt.position.set((side * W) / 2 - side * 0.03, 0.08, ZC);
      const gap = add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, L), trimMat));
      gap.position.set((side * W) / 2 - side * 0.02, FLUTE_TOP + 0.03, ZC);
      const led = add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, L), ledMat));
      led.position.set((side * W) / 2 - side * 0.28, FLUTE_TOP + 0.08, ZC);
    }

    // parede do fundo com painel de ônix retroiluminado emoldurado em latão
    const ZB = Z0 - L;
    const back = add(new THREE.Mesh(new THREE.PlaneGeometry(W, H), wallMat));
    back.position.set(0, H / 2, ZB + 0.01);
    const panel = add(new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.9), onyx));
    panel.position.set(0, 2.35, ZB + 0.05);
    for (const [w, h, x, y] of [
      [3.36, 0.08, 0, 4.34],
      [3.36, 0.08, 0, 0.36],
      [0.08, 3.98, -1.64, 2.35],
      [0.08, 3.98, 1.64, 2.35],
    ] as const) {
      const f = add(new THREE.Mesh(new RoundedBoxGeometry(w, h, 0.08, 2, 0.01), brass), { outline: true });
      f.position.set(x, y, ZB + 0.08);
    }

    // pórticos em latão (faixa em arco extrudada)
    const R = 2.4;
    const band = 0.1;
    const LEG = 2.55;
    const archShape = new THREE.Shape();
    archShape.absarc(0, 0, R + band / 2, 0, Math.PI, false);
    archShape.lineTo(-(R - band / 2), 0);
    archShape.absarc(0, 0, R - band / 2, Math.PI, 0, true);
    archShape.lineTo(R + band / 2, 0);
    const archGeo = new THREE.ExtrudeGeometry(archShape, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 72 });
    archGeo.translate(0, 0, -0.07);
    const legGeo = new RoundedBoxGeometry(band, LEG, 0.156, 2, 0.008);
    for (const z of [2, -4.5, -11, -17.5]) {
      const g = new THREE.Group();
      const arc = new THREE.Mesh(archGeo, brass);
      arc.position.y = LEG;
      g.add(arc);
      for (const x of [-R, R]) {
        const leg = new THREE.Mesh(legGeo, brass);
        leg.position.set(x, LEG / 2, 0);
        g.add(leg);
      }
      g.position.z = z;
      add(g, { cast: true, outline: true });
    }

    // mesa expositora em mármore com objetos (escultura em bronze, livros, bowl)
    const TZ = -1.4;
    const table = add(new THREE.Mesh(new RoundedBoxGeometry(2.3, 0.86, 1.05, 4, 0.02), marbleMat), { cast: true, outline: true });
    table.position.set(0, 0.43, TZ);
    const sculpture = new THREE.Group();
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 64, 32), bronze);
    orb.position.y = 0.2;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.011, 16, 160), brass);
    ring.position.y = 0.38;
    sculpture.add(orb, ring);
    sculpture.position.set(0.42, 0.86, TZ);
    add(sculpture, { cast: true });
    const books = new THREE.Group();
    (
      [
        [0.36, 0.045, 0.27, 0.05],
        [0.33, 0.04, 0.25, -0.08],
        [0.3, 0.035, 0.23, 0.14],
      ] as const
    ).forEach(([w, h, d, rot], i) => {
      const b = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, 0.006), bookMats[i]);
      b.position.y = 0.0225 + i * 0.043;
      b.rotation.y = rot;
      books.add(b);
    });
    books.position.set(-0.62, 0.86, TZ + 0.12);
    add(books, { cast: true });
    const bowlProfile = [
      [0.001, 0],
      [0.09, 0],
      [0.16, 0.03],
      [0.2, 0.08],
      [0.215, 0.1],
      [0.205, 0.1],
      [0.18, 0.07],
      [0.11, 0.035],
      [0.001, 0.03],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const bowl = add(new THREE.Mesh(new THREE.LatheGeometry(bowlProfile, 64), ceramicDark), { cast: true });
    bowl.position.set(-0.08, 0.86, TZ - 0.2);

    // banco em veludo sobre base de nogueira
    const bench = new THREE.Group();
    const bBase = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.1, 1.9, 3, 0.02), walnutMat);
    bBase.position.y = 0.05;
    const seat = new THREE.Mesh(new RoundedBoxGeometry(0.58, 0.3, 2.0, 6, 0.09), velvet);
    seat.position.y = 0.25;
    bench.add(bBase, seat);
    bench.position.set(-3.9, 0, 4.2);
    add(bench, { cast: true, outline: true });

    // bases em mármore com vasos cerâmicos
    const lathe = (pts: number[][]) =>
      new THREE.LatheGeometry(
        pts.map(([x, y]) => new THREE.Vector2(x, y)),
        72,
      );
    const vaseTall = lathe([
      [0.001, 0],
      [0.13, 0],
      [0.2, 0.1],
      [0.25, 0.34],
      [0.22, 0.58],
      [0.1, 0.8],
      [0.085, 0.96],
      [0.12, 1.02],
      [0.105, 1.03],
    ]);
    const vaseRound = lathe([
      [0.001, 0],
      [0.12, 0],
      [0.27, 0.14],
      [0.29, 0.3],
      [0.2, 0.48],
      [0.12, 0.54],
      [0.13, 0.57],
    ]);
    const plinthGeo = new RoundedBoxGeometry(0.72, 0.9, 0.72, 3, 0.015);
    const displays: [number, number, [THREE.BufferGeometry, THREE.Material, number, number, number][]][] = [
      [3.9, -2.8, [[vaseTall, ceramic, 0, 0, 1.15]]],
      [-3.9, -8.5, [[vaseRound, ceramicDark, -0.12, 0.08, 1], [vaseTall, ceramic, 0.16, -0.1, 0.72]]],
      [3.9, -14, [[vaseRound, ceramic, 0, 0, 1.1]]],
    ];
    for (const [x, z, vases] of displays) {
      const p = add(new THREE.Mesh(plinthGeo, marbleMat), { cast: true, outline: true });
      p.position.set(x, 0.45, z);
      for (const [geo, mat, dx, dz, s] of vases) {
        const v = add(new THREE.Mesh(geo, mat), { cast: true });
        v.scale.setScalar(s);
        v.position.set(x + dx, 0.9, z + dz);
      }
    }

    // pendentes em vidro opalino sobre a mesa
    const rodGeo = new THREE.CylinderGeometry(0.005, 0.005, 1, 8);
    for (const x of [-0.75, 0, 0.75]) {
      const drop = x === 0 ? 1.55 : 1.35;
      const rod = add(new THREE.Mesh(rodGeo, brass), { receive: false });
      rod.scale.y = drop;
      rod.position.set(x, H - drop / 2, TZ);
      const cap = add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.05, 24), brass), { receive: false });
      cap.position.set(x, H - drop, TZ);
      const globe = add(new THREE.Mesh(new THREE.SphereGeometry(0.15, 48, 24), opal), { receive: false });
      globe.position.set(x, H - drop - 0.16, TZ);
    }

    // spots embutidos no forro (visuais)
    const spotXs = [-3.9, 3.9];
    const spotZs = [9, 5.5, 2, -1.5, -5, -8.5, -12, -15.5, -19, -22.5];
    const discGeo = new THREE.CircleGeometry(0.055, 24);
    const ringGeo = new THREE.RingGeometry(0.055, 0.09, 32);
    const discs = new THREE.InstancedMesh(discGeo, ledMat, spotXs.length * spotZs.length);
    const rings = new THREE.InstancedMesh(ringGeo, trimMat, spotXs.length * spotZs.length);
    const down = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    let k = 0;
    for (const x of spotXs)
      for (const z of spotZs) {
        mtx.makeTranslation(x, H - 0.004, z).multiply(down);
        discs.setMatrixAt(k, mtx);
        rings.setMatrixAt(k, mtx);
        k++;
      }
    scene.add(discs, rings);

    // contornos técnicos (desenho) das peças principais — somem quando a luz acende
    const outlines = new THREE.Group();
    scene.updateMatrixWorld(true);
    for (const m of outlineTargets) {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 30), lineMat);
      edges.applyMatrix4(m.matrixWorld);
      outlines.add(edges);
    }
    for (const side of [-1, 1])
      for (const y of [0, H])
        outlines.add(
          new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3((side * W) / 2, y, Z0), new THREE.Vector3((side * W) / 2, y, ZB)]), lineMat),
        );
    scene.add(outlines);

    // ---------- luzes ----------
    const hemi = new THREE.HemisphereLight(0xfff0dc, 0x1a140f, 0);
    scene.add(hemi);
    const key = new THREE.SpotLight(0xffd8ad, 0, 12, 0.42, 0.7, 1.6);
    key.position.set(0.6, H - 0.05, TZ + 0.6);
    key.target.position.set(0, 0.8, TZ);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0003;
    key.shadow.radius = 4;
    scene.add(key, key.target);
    const pools: THREE.SpotLight[] = [];
    for (const [x, z] of [
      [3.9, -1.5],
      [-3.9, -8.5],
      [3.9, -15.5],
    ] as const) {
      const s = new THREE.SpotLight(0xffcf9c, 0, 9, 0.5, 0.95, 1.8);
      s.position.set(x, H - 0.05, z);
      s.target.position.set(x * 0.92, 0, z - 0.4);
      scene.add(s, s.target);
      pools.push(s);
    }
    const benchLight = new THREE.SpotLight(0xffd3a3, 0, 9, 0.45, 0.8, 1.7);
    benchLight.position.set(-3.6, H - 0.05, 4.8);
    benchLight.target.position.set(-3.9, 0.2, 4.2);
    benchLight.castShadow = true;
    benchLight.shadow.mapSize.set(1024, 1024);
    benchLight.shadow.radius = 4;
    scene.add(benchLight, benchLight.target);
    const pendantLight = new THREE.PointLight(0xffc88e, 0, 6, 1.8);
    pendantLight.position.set(0, 3.55, TZ);
    scene.add(pendantLight);

    // ---------- pós-processamento ----------
    const target = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 2 });
    const composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    const gtao = new GTAOPass(scene, camera, 2, 2);
    gtao.updateGtaoMaterial({ radius: 0.5, distanceFallOff: 1, thickness: 1.2, samples: 16 });
    gtao.blendIntensity = 0.9;
    gtao.enabled = false;
    composer.addPass(new VisibilityPass(reflector, false));
    composer.addPass(gtao);
    composer.addPass(new VisibilityPass(reflector, true));
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0, 0.55, 1.0);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    const finish = new ShaderPass(FinishShader);
    composer.addPass(finish);

    // ---------- tamanho ----------
    const resize = () => {
      const w = el.clientWidth || window.innerWidth;
      const h = el.clientHeight || window.innerHeight;
      renderer.setPixelRatio(pixelRatio);
      composer.setPixelRatio(pixelRatio);
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      bloom.resolution.set(w / 3, h / 3);
      (finish.uniforms.uRes.value as THREE.Vector2).set(w * pixelRatio, h * pixelRatio);
      camera.aspect = w / h;
      camera.fov = w / h < 0.8 ? 56 : 36;
      camera.updateProjectionMatrix();
      if (reduced) requestAnimationFrame(() => composer.render());
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // ---------- animação ----------
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMove = (e: PointerEvent) => {
      pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove);

    const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
    let start = 0;
    let raf = 0;
    let frames = 0;
    let last = 0;
    let slowFrames = 0;
    let quality = 1; // 2 = com oclusão, 1 = padrão, 0 = resolução reduzida
    let fastSum = 0;
    const look = new THREE.Vector3();

    renderer.compile(scene, camera);

    const frame = (now: number) => {
      if (!start) start = now;
      const t = (now - start) / 1000;
      const lit = reduced ? 1 : ease((t - 0.5) / 2.4);
      const intro = reduced ? 1 : ease(t / 5);
      const stage = (d: number) => (reduced ? 1 : ease((t - d) / 1.6));

      lineMat.opacity = 0.85 * (1 - lit);
      outlines.visible = lineMat.opacity > 0.01;
      scene.environmentIntensity = 0.2 * lit;
      hemi.intensity = 0.2 * lit;
      key.intensity = 56 * stage(0.8);
      benchLight.intensity = 38 * stage(1.1);
      pools.forEach((s, i) => (s.intensity = 40 * stage(0.9 + i * 0.18)));
      fluteMat.emissiveIntensity = 0.55 * stage(0.6);
      pendantLight.intensity = 4 * stage(1.3);
      opal.emissiveIntensity = 2.6 * stage(1.3);
      ledMat.emissiveIntensity = 3.2 * lit;
      onyx.emissiveIntensity = 1.5 * stage(1.5);
      refMat.uniforms.uOpacity.value = 0.2 * lit;
      bloom.strength = 0.3 * lit;
      finish.uniforms.uTime.value = t;

      pointer.x += (pointer.tx - pointer.x) * 0.03;
      pointer.y += (pointer.ty - pointer.y) * 0.03;
      const drift = reduced ? 0 : t;
      camera.position.set(Math.sin(drift * 0.045) * 0.55 + pointer.x * 0.35, 1.55 - pointer.y * 0.06, 12.5 - 1.6 * intro + Math.sin(drift * 0.03) * 0.5);
      look.set(camera.position.x * 0.35, 1.5, -12);
      camera.lookAt(look);

      if (!reduced) ring.rotation.y = t * 0.18;
      composer.render();

      // qualidade adaptativa: se o computador não acompanha, alivia os efeitos
      if (last) {
        const dt = now - last;
        frames++;
        if (frames > 30 && dt > 34) slowFrames++;
        if (frames > 30 && frames <= 90) fastSum += dt;
        if (frames === 90 && fastSum / 60 < 14 && quality === 1) {
          quality = 2; // computador com folga: liga as sombras de contato
          gtao.enabled = true;
        }
        if (frames % 90 === 0) {
          if (slowFrames > 45 && quality > 0) {
            quality--;
            if (quality === 1) gtao.enabled = false;
            else {
              pixelRatio = Math.min(pixelRatio, 0.85);
              resize();
            }
          }
          slowFrames = 0;
        }
      }
      last = now;
      if (!reduced || t < 0.1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onVisibility = () => {
      cancelAnimationFrame(raf);
      last = 0;
      if (!document.hidden) raf = requestAnimationFrame(frame);
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVisibility);
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      textures.forEach((t) => t.dispose());
      reflector.dispose();
      envTex.dispose();
      pmrem.dispose();
      gtao.dispose();
      composer.dispose();
      target.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={host} className="lux-canvas" aria-hidden="true" />;
}
