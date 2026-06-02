/**
 * letters-3d.js — Caixa de Cartas 3D
 *
 * Mesa realista com velinha que tremeluz e ilumina as cartas.
 * As cartas usam MeshStandardMaterial (desktop) / MeshLambertMaterial (mobile)
 * para reagir à luz dinâmica da vela.
 */

import * as THREE from 'three'

const isMobile = () =>
  window.innerWidth < 768 || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)

/* ── Estado global ── */
let scene, camera, renderer, clock
let letterObjs   = []
let hoveredIdx   = -1
let animId       = null
let onOpen       = null
let mobile       = false
let _targetMs    = 1000 / 60
let _lastFrame   = 0

/* ── Vela: referências para animação ── */
let candleLight      = null   /* PointLight principal da vela */
let candleLight2     = null   /* glow secundário na superfície */
let candleFlame      = null   /* cone externo laranja */
let candleFlameCore  = null   /* cone interno amarelo/branco */
let candleGlow       = null   /* sprite de glow aditivo */
let candleEmbers     = null   /* partículas de brasa subindo */
let candleEmbersPos  = null
const CANDLE = { x: -4.1, y: -0.32, z: -3.0 }  /* posição na mesa */

/* ── Paleta dos envelopes ── */
const COLORS = {
  rose:   { body:0x220c14, flap:0x2e1020, seal:0xd4889a, emissive:0x5a1a30 },
  violet: { body:0x12082a, flap:0x1a0c38, seal:0xb464ff, emissive:0x3a1a5a },
  gold:   { body:0x1e1408, flap:0x281c08, seal:0xc4a850, emissive:0x5a3a10 },
  teal:   { body:0x081818, flap:0x0c2020, seal:0x4bb9b9, emissive:0x0a3838 },
  blue:   { body:0x080c20, flap:0x0c1030, seal:0x6491dc, emissive:0x101840 },
}

/* ── Layout na mesa ── */
const TABLE_POS = [
  { x:-3.5, z:-1.6 }, { x:0,    z:-1.9 }, { x:3.5,  z:-1.6 },
  { x:-3.8, z: 0.6 }, { x:0,    z: 0.8 }, { x:3.8,  z: 0.6 },
  { x:-2.2, z: 2.8 }, { x:1.6,  z: 2.9 }, { x:-3.8, z: 2.5 }, { x:3.6,  z: 2.6 },
]
const TABLE_ROT = [-0.12, 0.07, -0.06, 0.14, -0.09, 0.11, -0.05, 0.08, 0.13, -0.10]

/* ═══════════════════════════════════════
   API pública
═══════════════════════════════════════ */

export function init(letterData, openCb) {
  cleanup()
  mobile    = isMobile()
  _targetMs = mobile ? 1000 / 30 : 1000 / 60
  _lastFrame = 0
  onOpen    = openCb

  const canvas = document.getElementById('letters-canvas')
  if (!canvas) return

  const W = canvas.clientWidth  || window.innerWidth
  const H = canvas.clientHeight || window.innerHeight

  /* Cena */
  scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x01000a, 0.025)
  clock = new THREE.Clock()

  /* Câmera inclinada sobre a mesa */
  camera = new THREE.PerspectiveCamera(44, W / H, 0.1, 80)
  camera.position.set(0, 7.2, 10.5)
  camera.lookAt(0, -0.2, 0)

  /* Renderer */
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias:       !mobile,
    powerPreference: 'high-performance',
    precision:       mobile ? 'lowp' : 'highp',
  })
  renderer.setSize(W, H)
  renderer.setPixelRatio(mobile ? 1 : Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x01000a)
  if (!mobile) {
    renderer.shadowMap.enabled  = true
    renderer.shadowMap.type     = THREE.PCFSoftShadowMap
    renderer.toneMapping        = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.15
  }

  /* ── ILUMINAÇÃO — dominada pela vela ── */

  /* Ambiente muito escuro — vela é a principal fonte */
  scene.add(new THREE.AmbientLight(0x050018, mobile ? 0.7 : 0.45))

  /* Fill frio no lado oposto à vela (muito sutil) */
  if (!mobile) {
    const fill = new THREE.DirectionalLight(0x1a1060, 0.2)
    fill.position.set(5, 3, 5)
    scene.add(fill)
  }

  /* ── Constrói cena ── */
  _buildTable()
  _buildCandle()
  _buildLetters(letterData)
  _bindEvents(canvas)
  _loop()

  window.addEventListener('resize', _onResize)
}

export function cleanup() {
  if (animId)   { cancelAnimationFrame(animId); animId = null }
  if (renderer) { renderer.dispose(); renderer = null }
  if (scene)    {
    scene.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose()
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose())
        else obj.material.dispose()
      }
    })
  }
  scene = null; camera = null; clock = null
  letterObjs = []; hoveredIdx = -1; _lastFrame = 0
  candleLight = candleLight2 = candleFlame = candleFlameCore = candleGlow = null
  candleEmbers = candleEmbersPos = null
  window.removeEventListener('resize', _onResize)
}

export function addLetterToScene(data, idx) {
  if (!scene) return
  const obj = _createLetterObj(data, idx)
  if (!obj) return
  letterObjs.push(obj)
  scene.add(obj.group)
  obj.group.position.y = obj.baseY + 10
  if (window.gsap) {
    gsap.to(obj.group.position, { y: obj.baseY, duration: 0.85, delay: 0.1, ease: 'bounce.out' })
  } else {
    obj.group.position.y = obj.baseY
  }
}

export function closeLetter(idx) {
  const lo = letterObjs.find(o => o && o.idx === idx)
  if (!lo) return
  const fp = lo.group.userData.flapPivot
  if (window.gsap) {
    gsap.to(fp.rotation,       { x: 0, duration: 0.45, ease: 'power2.inOut' })
    gsap.to(lo.group.position, { y: lo.baseY, duration: 0.5, delay: 0.38, ease: 'bounce.out' })
    gsap.to(lo.group.rotation, {
      x: -0.04, duration: 0.4, delay: 0.38, ease: 'power2.out',
      onComplete: () => { lo.group.userData.isOpen = false }
    })
  } else {
    fp.rotation.x = 0
    lo.group.position.y = lo.baseY
    lo.group.userData.isOpen = false
  }
}

/* ═══════════════════════════════════════
   Mesa
═══════════════════════════════════════ */

function _buildTable() {
  /* Superfície */
  const geo = new THREE.PlaneGeometry(26, 18)
  const mat = mobile
    ? new THREE.MeshLambertMaterial({ color: 0x0c0418 })
    : new THREE.MeshStandardMaterial({ color: 0x0c0418, roughness: 0.97, metalness: 0.02 })
  const table = new THREE.Mesh(geo, mat)
  table.rotation.x = -Math.PI / 2
  table.position.y = -0.32
  if (!mobile) table.receiveShadow = true
  scene.add(table)

  /* Borda da mesa (bordas decorativas) */
  if (!mobile) {
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x1a0a28, roughness: 0.9 })
    const edges = [
      { w:26.2, h:0.12, d:0.28, x:0,   z: 9.1 },
      { w:26.2, h:0.12, d:0.28, x:0,   z:-9.1 },
      { w:0.28, h:0.12, d:18.2, x: 13.1, z:0  },
      { w:0.28, h:0.12, d:18.2, x:-13.1, z:0  },
    ]
    edges.forEach(e => {
      const eg = new THREE.BoxGeometry(e.w, e.h, e.d)
      const em = new THREE.Mesh(eg, edgeMat)
      em.position.set(e.x, -0.38, e.z)
      em.receiveShadow = true
      scene.add(em)
    })
  }
}

/* ═══════════════════════════════════════
   Vela — objeto 3D + luz dinâmica
═══════════════════════════════════════ */

function _buildCandle() {
  const cx = CANDLE.x, cy = CANDLE.y, cz = CANDLE.z

  /* ── Prato / suporte ── */
  const plateGeo = new THREE.CylinderGeometry(0.24, 0.26, 0.045, 18)
  const plateMat = new THREE.MeshStandardMaterial({
    color: 0xb08030, metalness: 0.78, roughness: 0.28,
  })
  const plate = new THREE.Mesh(plateGeo, plateMat)
  plate.position.set(cx, cy + 0.022, cz)
  if (!mobile) { plate.castShadow = true; plate.receiveShadow = true }
  scene.add(plate)

  /* ── Corpo da vela ── */
  const bodyGeo = new THREE.CylinderGeometry(0.07, 0.082, 0.9, 14)
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xfff3e0, roughness: 0.72, metalness: 0.0,
    emissive: new THREE.Color(0x1a0800), emissiveIntensity: 0.4,
  })
  const body = new THREE.Mesh(bodyGeo, bodyMat)
  body.position.set(cx, cy + 0.045 + 0.45, cz)
  if (!mobile) { body.castShadow = true; body.receiveShadow = true }
  scene.add(body)

  /* ── Gotículas de cera (detalhes) ── */
  if (!mobile) {
    const dripMat = new THREE.MeshStandardMaterial({ color: 0xfff0d8, roughness: 0.65 })
    const dripData = [
      { rx:0.055, ry:-0.02, h:0.12, side: 0.6 },
      { rx:0.048, ry:-0.01, h:0.08, side: -1.1 },
      { rx:0.04,  ry:0.02,  h:0.06, side: 2.1 },
    ]
    dripData.forEach(d => {
      const dg = new THREE.CylinderGeometry(0.015, 0.025, d.h, 8)
      const dm = new THREE.Mesh(dg, dripMat)
      dm.position.set(cx + 0.065 * Math.cos(d.side), cy + 0.45 + d.ry, cz + 0.065 * Math.sin(d.side))
      dm.castShadow = true
      scene.add(dm)
    })
  }

  /* ── Piscina de cera no topo ── */
  const waxGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.012, 14)
  const waxMat = new THREE.MeshStandardMaterial({ color: 0xfff5e0, roughness: 0.55, transparent:true, opacity:0.92 })
  const wax = new THREE.Mesh(waxGeo, waxMat)
  wax.position.set(cx, cy + 0.945, cz)
  scene.add(wax)

  /* ── Pavio ── */
  const wickGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.045, 6)
  const wickMat = new THREE.MeshBasicMaterial({ color: 0x1a0e00 })
  const wick = new THREE.Mesh(wickGeo, wickMat)
  wick.position.set(cx, cy + 0.968, cz)
  scene.add(wick)

  /* ── Chama externa (cone laranja) ── */
  const flameGeo = new THREE.ConeGeometry(0.05, 0.20, 10)
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff6010, transparent: true, opacity: 0.85 })
  candleFlame = new THREE.Mesh(flameGeo, flameMat)
  candleFlame.rotation.x = Math.PI       /* ponta para cima */
  candleFlame.position.set(cx, cy + 0.99 + 0.10, cz)
  scene.add(candleFlame)

  /* ── Chama interna (cone brilhante) ── */
  const coreGeo = new THREE.ConeGeometry(0.028, 0.12, 8)
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff0a0, transparent: true, opacity: 0.96 })
  candleFlameCore = new THREE.Mesh(coreGeo, coreMat)
  candleFlameCore.rotation.x = Math.PI
  candleFlameCore.position.set(cx, cy + 0.99 + 0.07, cz)
  scene.add(candleFlameCore)

  /* ── Glow aditivo ao redor da chama ── */
  const glowCanvas = document.createElement('canvas')
  glowCanvas.width = glowCanvas.height = 64
  const gc = glowCanvas.getContext('2d')
  const gr = gc.createRadialGradient(32, 32, 0, 32, 32, 32)
  gr.addColorStop(0, 'rgba(255,180,60,1)')
  gr.addColorStop(0.35, 'rgba(255,100,20,0.6)')
  gr.addColorStop(1, 'rgba(255,60,0,0)')
  gc.fillStyle = gr; gc.fillRect(0, 0, 64, 64)
  const glowTex = new THREE.CanvasTexture(glowCanvas)
  const glowMat = new THREE.SpriteMaterial({
    map: glowTex, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
  candleGlow = new THREE.Sprite(glowMat)
  candleGlow.scale.set(0.85, 0.85, 1)
  candleGlow.position.set(cx, cy + 1.08, cz)
  scene.add(candleGlow)

  /* ── Luz da vela — PointLight quente que tremeluz ── */
  candleLight = new THREE.PointLight(0xffaa40, mobile ? 3.0 : 4.0, mobile ? 10 : 13, 1.5)
  candleLight.position.set(cx, cy + 1.1, cz)
  if (!mobile) candleLight.castShadow = true
  scene.add(candleLight)

  /* Segundo PointLight mais fraco na superfície da mesa (halo de cera) */
  candleLight2 = new THREE.PointLight(0xff7020, mobile ? 0.6 : 0.9, mobile ? 4 : 5, 2)
  candleLight2.position.set(cx, cy + 0.6, cz)
  scene.add(candleLight2)

  /* ── Partículas de brasa subindo ── */
  _buildEmbers(cx, cy + 1.1, cz)
}

function _buildEmbers(ex, ey, ez) {
  const N = mobile ? 8 : 18
  const pos = new Float32Array(N * 3)
  for (let i = 0; i < N; i++) {
    pos[i * 3    ] = ex + (Math.random() - 0.5) * 0.08
    pos[i * 3 + 1] = ey + Math.random() * 0.4
    pos[i * 3 + 2] = ez + (Math.random() - 0.5) * 0.08
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const mat = new THREE.PointsMaterial({
    size: 0.028, color: 0xff8020, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
  candleEmbers    = new THREE.Points(geo, mat)
  candleEmbersPos = pos
  scene.add(candleEmbers)
}

/* ═══════════════════════════════════════
   Cartas 3D
═══════════════════════════════════════ */

function _buildLetters(letterData) {
  letterObjs = []
  letterData.forEach((ld, idx) => {
    const obj = _createLetterObj(ld, idx)
    if (obj) { letterObjs.push(obj); scene.add(obj.group) }
  })
}

function _createLetterObj(ld, idx) {
  if (!scene) return null
  const col        = COLORS[ld.color_key] || COLORS.rose
  const isSurprise = !!ld.is_surprise
  const group      = new THREE.Group()

  /* Usa MeshLambertMaterial no mobile (reage à luz, mais leve que Standard) */
  function _mat(opts) {
    if (mobile) return new THREE.MeshLambertMaterial({ color: opts.color, emissive: new THREE.Color(opts.emissive || 0x000000) })
    return new THREE.MeshStandardMaterial({ ...opts, roughness: opts.roughness ?? 0.88, metalness: opts.metalness ?? 0.08 })
  }

  /* ── Corpo ── */
  const bodyGeo = new THREE.BoxGeometry(2.2, 1.55, 0.055)
  let bodyMat
  if (isSurprise && !mobile) {
    bodyMat = _buildHoloMat()
  } else {
    bodyMat = _mat({
      color: col.body, emissive: col.emissive,
      emissiveIntensity: isSurprise ? 0.35 : 0.07,
      metalness: isSurprise ? 0.45 : 0.08,
    })
  }
  const body = new THREE.Mesh(bodyGeo, bodyMat)
  if (!mobile) body.castShadow = true
  group.add(body)

  /* ── Flap com pivô no topo ── */
  const flapPivot = new THREE.Group()
  flapPivot.position.y = 0.775
  group.add(flapPivot)

  const flapGeo = new THREE.BoxGeometry(2.2, 0.78, 0.048)
  const flapMat = _mat({
    color: col.flap, emissive: col.emissive,
    emissiveIntensity: isSurprise ? 0.28 : 0.05,
    metalness: isSurprise ? 0.5 : 0.05,
  })
  const flap = new THREE.Mesh(flapGeo, flapMat)
  flap.position.y = -0.39
  if (!mobile) flap.castShadow = true
  flapPivot.add(flap)

  /* ── Cera / selo ── */
  const sealGeo = new THREE.SphereGeometry(mobile ? 0.1 : 0.13, 10, 8)
  const sealMat = mobile
    ? new THREE.MeshLambertMaterial({ color: col.seal, emissive: new THREE.Color(col.seal) })
    : new THREE.MeshStandardMaterial({
        color: col.seal, emissive: new THREE.Color(col.seal),
        emissiveIntensity: isSurprise ? 0.9 : 0.3, roughness: 0.5, metalness: 0.3,
      })
  const seal = new THREE.Mesh(sealGeo, sealMat)
  seal.position.set(0, -0.1, 0.04)
  group.add(seal)

  /* ── Anel rotativo nas surpresas ── */
  if (isSurprise && !mobile) {
    const ringGeo = new THREE.RingGeometry(0.18, 0.24, 28)
    const ringMat = new THREE.MeshBasicMaterial({
      color: col.seal, transparent: true, opacity: 0.65, side: THREE.DoubleSide,
    })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.position.set(0, -0.1, 0.046)
    group.add(ring)
    group.userData.ring = ring
  }

  /* ── Posição na mesa ── */
  const p   = TABLE_POS[idx % TABLE_POS.length]
  const rot = TABLE_ROT[idx % TABLE_ROT.length]
  group.position.set(p.x, -0.29, p.z)
  group.rotation.y = rot
  group.rotation.x = -0.04

  const baseY = -0.29
  group.userData = { flapPivot, seal, isSurprise, isOpen: false, idx }

  return { group, body, flapPivot, seal, data: ld, idx, baseY, isSurprise }
}

/* Shader holográfico para cartões surpresa */
function _buildHoloMat() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewPos;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 mvp = modelViewMatrix * vec4(position, 1.0);
        vViewPos = -mvp.xyz;
        gl_Position = projectionMatrix * mvp;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewPos;
      void main() {
        vec3 vd  = normalize(vViewPos);
        float fr = 1.0 - max(0.0, dot(vd, vNormal));
        float h  = vUv.x * 0.7 + vUv.y * 0.4 + uTime * 0.22 + fr * 0.65;
        vec3 col = 0.55 + 0.45 * cos(6.2832 * (h + vec3(0.0, 0.33, 0.67)));
        col = mix(vec3(0.06, 0.03, 0.12), col, fr * 0.78 + 0.22);
        col += vec3(0.12, 0.06, 0.20) * (1.0 - fr) * 0.45;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
}

/* ═══════════════════════════════════════
   Loop de animação — tremeluz da vela + reações
═══════════════════════════════════════ */

function _loop(ts = 0) {
  animId = requestAnimationFrame(_loop)
  if (mobile && ts - _lastFrame < _targetMs) return
  _lastFrame = ts

  const t = clock.getElapsedTime()

  /* ── Tremeluz da vela ── */
  if (candleLight) {
    /* Ruído de alta frequência simulando vento + chama viva */
    const noise = 0.22 * Math.sin(t * 11.3)
                + 0.09 * Math.sin(t * 29.7)
                + 0.05 * Math.sin(t * 67.1)
                + 0.03 * Math.sin(t * 113.4)
    const fi = Math.max(0.12, 1 + noise)

    candleLight.intensity  = (mobile ? 3.0 : 4.0) * fi
    candleLight2.intensity = (mobile ? 0.6 : 0.9) * fi

    /* Movimento da chama (oscillação natural) */
    const swX = 0.025 * Math.sin(t * 8.2) + 0.012 * Math.sin(t * 17.1)
    const swZ = 0.020 * Math.sin(t * 6.5) + 0.010 * Math.sin(t * 14.8)
    const scY = 1 + 0.14 * Math.sin(t * 13.7)

    if (candleFlame) {
      candleFlame.position.x  = CANDLE.x + swX
      candleFlame.position.z  = CANDLE.z + swZ
      candleFlame.scale.y     = scY
      candleFlame.scale.x     = 1 - 0.07 * Math.sin(t * 13.7)
      /* Cor varia: laranja ↔ amarelo */
      const flk = 0.4 + 0.35 * Math.sin(t * 19.8)
      candleFlame.material.color.setRGB(1, 0.22 + flk * 0.5, 0.02 + flk * 0.08)
      candleFlame.material.opacity = 0.72 + 0.24 * fi
    }
    if (candleFlameCore) {
      candleFlameCore.position.x = CANDLE.x + swX * 0.65
      candleFlameCore.position.z = CANDLE.z + swZ * 0.65
      candleFlameCore.scale.y    = scY * 0.88
      candleFlameCore.scale.x    = 1 - 0.04 * Math.sin(t * 13.7 + 0.4)
    }
    if (candleGlow) {
      candleGlow.position.x  = CANDLE.x + swX * 0.5
      candleGlow.position.z  = CANDLE.z + swZ * 0.5
      const gs = 0.62 + 0.28 * fi
      candleGlow.scale.set(gs, gs, 1)
      candleGlow.material.opacity = 0.32 * fi + 0.15
    }
    /* Light position oscila sutilmente */
    candleLight.position.x = CANDLE.x + swX * 0.4
    candleLight.position.z = CANDLE.z + swZ * 0.4
  }

  /* ── Partículas de brasa subindo ── */
  if (candleEmbers && candleEmbersPos) {
    const buf = candleEmbers.geometry.attributes.position
    const N   = candleEmbersPos.length / 3
    for (let i = 0; i < N; i++) {
      candleEmbersPos[i * 3 + 1] += 0.006 + 0.003 * Math.sin(t * 3 + i)
      candleEmbersPos[i * 3]     += 0.003 * Math.sin(t * 5.2 + i * 1.3)
      /* Reseta quando sai do topo da chama */
      if (candleEmbersPos[i * 3 + 1] > CANDLE.y + 1.8) {
        candleEmbersPos[i * 3    ] = CANDLE.x + (Math.random() - 0.5) * 0.07
        candleEmbersPos[i * 3 + 1] = CANDLE.y + 1.08
        candleEmbersPos[i * 3 + 2] = CANDLE.z + (Math.random() - 0.5) * 0.07
      }
    }
    buf.array.set(candleEmbersPos)
    buf.needsUpdate = true
  }

  /* ── Cartas: reações ao ambiente ── */
  letterObjs.forEach(lo => {
    if (!lo) return
    /* Holographic time */
    if (lo.body.material?.uniforms?.uTime) lo.body.material.uniforms.uTime.value = t
    /* Surprise ring */
    if (lo.group.userData.ring) lo.group.userData.ring.rotation.z = t * 1.5
    /* Hover float */
    if (hoveredIdx === lo.idx && !lo.group.userData.isOpen) {
      lo.group.position.y = lo.baseY + 0.18 + Math.sin(t * 3.2) * 0.04
    }
    /* Selo de cartas surpresa pulsa */
    if (lo.isSurprise && lo.seal.material) {
      const sp = 1 + 0.1 * Math.sin(t * 2.5 + lo.idx)
      lo.seal.scale.setScalar(sp)
      if (lo.seal.material.emissiveIntensity !== undefined) {
        lo.seal.material.emissiveIntensity = 0.7 + 0.3 * Math.sin(t * 2.5 + lo.idx)
      }
    }
  })

  renderer.render(scene, camera)
}

/* ═══════════════════════════════════════
   Eventos — raycasting
═══════════════════════════════════════ */

function _bindEvents(canvas) {
  const raycaster = new THREE.Raycaster()
  const pointer   = new THREE.Vector2()
  let   tapStart  = { x: 0, y: 0 }

  function _hit(cx, cy) {
    const r = canvas.getBoundingClientRect()
    pointer.x =  ((cx - r.left) / r.width)  * 2 - 1
    pointer.y = -((cy - r.top)  / r.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    const targets = letterObjs.flatMap(o => o
      ? [o.body, o.flapPivot?.children[0], o.seal].filter(Boolean) : [])
    return raycaster.intersectObjects(targets, false)
  }

  function _find(mesh) {
    return letterObjs.find(o => o &&
      (o.body === mesh || o.seal === mesh || o.flapPivot?.children[0] === mesh))
  }

  canvas.addEventListener('mousemove', e => {
    const hits = _hit(e.clientX, e.clientY)
    if (hits.length > 0) {
      const lo = _find(hits[0].object)
      if (lo) {
        canvas.style.cursor = 'pointer'
        if (hoveredIdx !== lo.idx) {
          if (hoveredIdx >= 0) _unhover(hoveredIdx)
          hoveredIdx = lo.idx; _hover(lo)
        }
        return
      }
    }
    if (hoveredIdx >= 0) { _unhover(hoveredIdx); hoveredIdx = -1 }
    canvas.style.cursor = 'default'
  })
  canvas.addEventListener('mouseleave', () => {
    if (hoveredIdx >= 0) { _unhover(hoveredIdx); hoveredIdx = -1 }
  })

  canvas.addEventListener('mousedown', e => { tapStart = { x: e.clientX, y: e.clientY } })
  canvas.addEventListener('mouseup',   e => {
    if (Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) > 6) return
    const hits = _hit(e.clientX, e.clientY)
    if (hits.length > 0) {
      const lo = _find(hits[0].object)
      if (lo && !lo.group.userData.isOpen) _openLetter(lo)
    }
  })
  canvas.addEventListener('touchstart', e => {
    tapStart = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }, { passive: true })
  canvas.addEventListener('touchend', e => {
    const t = e.changedTouches[0]
    if (Math.hypot(t.clientX - tapStart.x, t.clientY - tapStart.y) > 12) return
    const hits = _hit(t.clientX, t.clientY)
    if (hits.length > 0) {
      const lo = _find(hits[0].object)
      if (lo && !lo.group.userData.isOpen) _openLetter(lo)
    }
  })
}

function _hover(lo) {
  if (!window.gsap || lo.group.userData.isOpen) return
  gsap.to(lo.group.position, { y: lo.baseY + 0.22, duration: 0.32, ease: 'power2.out' })
  gsap.to(lo.group.rotation, { x: -0.09, duration: 0.32, ease: 'power2.out' })
}

function _unhover(idx) {
  const lo = letterObjs.find(o => o && o.idx === idx)
  if (!lo || lo.group.userData.isOpen) return
  if (window.gsap) {
    gsap.to(lo.group.position, { y: lo.baseY, duration: 0.4, ease: 'power2.out' })
    gsap.to(lo.group.rotation, { x: -0.04,   duration: 0.4, ease: 'power2.out' })
  }
}

function _openLetter(lo) {
  if (!window.gsap || lo.group.userData.isOpen) return
  lo.group.userData.isOpen = true; hoveredIdx = -1

  const fp = lo.group.userData.flapPivot
  gsap.to(lo.group.position, { y: lo.baseY + 2.0, duration: 0.48, ease: 'power3.out' })
  gsap.to(lo.group.rotation, { x: -0.24, duration: 0.48, ease: 'power2.out' })
  gsap.to(fp.rotation, {
    x: -Math.PI * 0.88,
    duration: 0.55, delay: 0.42, ease: 'power2.inOut',
    onComplete: () => { if (onOpen) onOpen(lo.idx) }
  })
}

function _onResize() {
  const canvas = document.getElementById('letters-canvas')
  if (!canvas || !renderer || !camera) return
  const W = canvas.clientWidth, H = canvas.clientHeight
  camera.aspect = W / H
  camera.updateProjectionMatrix()
  renderer.setSize(W, H)
}
