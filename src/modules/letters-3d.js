/**
 * letters-3d.js — Caixa de Cartas 3D
 *
 * Mesa 3D com envelopes interativos.
 * Mobile-adaptive: materiais simples, sem sombras, 30fps
 */

import * as THREE from 'three'

const isMobile = () =>
  window.innerWidth < 768 || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)

/* ── Estado ── */
let scene, camera, renderer, clock
let letterObjs = []        /* [{group, body, flapPivot, seal, data, idx, baseY, isSurprise}] */
let hoveredIdx = -1
let animId     = null
let onOpen     = null
let mobile     = false
let _targetMs  = 1000 / 60
let _lastFrame = 0

/* ── Paleta de cores ── */
const COLORS = {
  rose:   { body:0x220c14, flap:0x2e1020, seal:0xd4889a, emissive:0x5a1a30 },
  violet: { body:0x12082a, flap:0x1a0c38, seal:0xb464ff, emissive:0x3a1a5a },
  gold:   { body:0x1e1408, flap:0x281c08, seal:0xc4a850, emissive:0x5a3a10 },
  teal:   { body:0x081818, flap:0x0c2020, seal:0x4bb9b9, emissive:0x0a3838 },
  blue:   { body:0x080c20, flap:0x0c1030, seal:0x6491dc, emissive:0x101840 },
}

/* ── Posições na mesa (até 10 cartas) ── */
const TABLE_POS = [
  { x:-3.5, z:-1.6 }, { x:0,    z:-1.9 }, { x:3.5,  z:-1.6 },
  { x:-4.0, z: 0.6 }, { x:0,    z: 0.8 }, { x:4.0,  z: 0.6 },
  { x:-2.2, z: 2.8 }, { x:1.6,  z: 2.9 }, { x:-3.8, z: 2.5 }, { x:3.6, z:2.6 },
]
const TABLE_ROT = [-0.12, 0.07, -0.06, 0.14, -0.09, 0.11, -0.05, 0.08, 0.13, -0.10]

/* ═══════════════════════════════════
   API pública
═══════════════════════════════════ */

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
  scene.fog = new THREE.FogExp2(0x02000a, 0.022)
  clock = new THREE.Clock()

  /* Câmera — olha levemente para baixo na mesa */
  camera = new THREE.PerspectiveCamera(44, W / H, 0.1, 80)
  camera.position.set(0, 7, 10)
  camera.lookAt(0, -0.3, 0)

  /* Renderer */
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias:       !mobile,
    powerPreference: 'high-performance',
    precision:       mobile ? 'lowp' : 'highp',
  })
  renderer.setSize(W, H)
  renderer.setPixelRatio(mobile ? 1 : Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x020008)
  if (!mobile) {
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type    = THREE.PCFSoftShadowMap
  }

  /* Iluminação */
  scene.add(new THREE.AmbientLight(0x1a1030, mobile ? 2.4 : 1.4))
  if (!mobile) {
    const main = new THREE.PointLight(0xfff0e8, 3, 22)
    main.position.set(0, 8, 3); main.castShadow = true
    scene.add(main)

    const rim = new THREE.PointLight(0xd0b0ff, 1.4, 16)
    rim.position.set(-6, 4, -2); scene.add(rim)

    const rose = new THREE.PointLight(0xff5070, 0.9, 14)
    rose.position.set(5, 2, 5); scene.add(rose)
  } else {
    const dir = new THREE.DirectionalLight(0xfff0e8, 2.2)
    dir.position.set(2, 6, 4); scene.add(dir)
  }

  /* Mesa + objetos */
  _buildTable()
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
  window.removeEventListener('resize', _onResize)
}

export function addLetterToScene(data, idx) {
  if (!scene) return
  const obj = _createLetterObj(data, idx)
  if (!obj) return
  letterObjs.push(obj)
  scene.add(obj.group)
  /* Drop-in animation */
  obj.group.position.y = obj.baseY + 10
  if (window.gsap) {
    gsap.to(obj.group.position, { y: obj.baseY, duration: 0.8, delay: 0.1, ease: 'bounce.out' })
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

/* ═══════════════════════════════════
   Construção da cena
═══════════════════════════════════ */

function _buildTable() {
  /* Superfície */
  const geo = new THREE.PlaneGeometry(26, 18)
  const mat = mobile
    ? new THREE.MeshBasicMaterial({ color: 0x0c0418 })
    : new THREE.MeshStandardMaterial({ color: 0x0c0418, roughness: 0.96, metalness: 0.04 })
  const table = new THREE.Mesh(geo, mat)
  table.rotation.x = -Math.PI / 2
  table.position.y = -0.32
  if (!mobile) table.receiveShadow = true
  scene.add(table)

  /* Grade sutil de fundo (apenas desktop) */
  if (!mobile) {
    const gmat = new THREE.LineBasicMaterial({ color: 0x2a1040, transparent: true, opacity: 0.16 })
    for (let i = -6; i <= 6; i++) {
      const h = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-13, -0.31, i * 1.5),
        new THREE.Vector3( 13, -0.31, i * 1.5),
      ])
      const v = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(i * 2, -0.31, -9),
        new THREE.Vector3(i * 2, -0.31,  9),
      ])
      scene.add(new THREE.Line(h, gmat))
      scene.add(new THREE.Line(v, gmat))
    }
  }
}

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

  /* ── Corpo ── */
  const bodyGeo = new THREE.BoxGeometry(2.2, 1.55, 0.055)
  let bodyMat
  if (isSurprise && !mobile) {
    bodyMat = _buildHoloMat()
  } else if (mobile) {
    bodyMat = new THREE.MeshBasicMaterial({ color: col.body })
  } else {
    bodyMat = new THREE.MeshStandardMaterial({
      color: col.body, roughness: 0.88, metalness: isSurprise ? 0.45 : 0.08,
      emissive: new THREE.Color(col.emissive), emissiveIntensity: isSurprise ? 0.35 : 0.08,
    })
  }
  const body = new THREE.Mesh(bodyGeo, bodyMat)
  if (!mobile) body.castShadow = true
  group.add(body)

  /* ── Flap (pivô no topo) ── */
  const flapPivot = new THREE.Group()
  flapPivot.position.y = 0.775   /* borda superior do corpo */
  group.add(flapPivot)

  const flapGeo = new THREE.BoxGeometry(2.2, 0.78, 0.048)
  const flapMat = mobile
    ? new THREE.MeshBasicMaterial({ color: col.flap })
    : new THREE.MeshStandardMaterial({
        color: col.flap, roughness: 0.85, metalness: isSurprise ? 0.5 : 0.05,
        emissive: new THREE.Color(col.emissive), emissiveIntensity: isSurprise ? 0.3 : 0.05,
      })
  const flap = new THREE.Mesh(flapGeo, flapMat)
  flap.position.y = -0.39   /* pendurado abaixo do pivô */
  flapPivot.add(flap)

  /* ── Cera do envelope ── */
  const sealGeo = new THREE.SphereGeometry(mobile ? 0.1 : 0.13, 10, 8)
  const sealMat = new THREE.MeshStandardMaterial({
    color:   col.seal, emissive: new THREE.Color(col.seal),
    emissiveIntensity: isSurprise ? 0.9 : 0.3, roughness: 0.5, metalness: 0.3,
  })
  const seal = new THREE.Mesh(sealGeo, sealMat)
  seal.position.set(0, -0.1, 0.04)
  group.add(seal)

  /* ── Anel brilhante em cartas surpresa ── */
  if (isSurprise && !mobile) {
    const ringGeo = new THREE.RingGeometry(0.18, 0.24, 28)
    const ringMat = new THREE.MeshBasicMaterial({
      color: col.seal, transparent: true, opacity: 0.7, side: THREE.DoubleSide,
    })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.position.set(0, -0.1, 0.045)
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

/* Shader holográfico para cartas surpresa */
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

/* ═══════════════════════════════════
   Loop de animação
═══════════════════════════════════ */

function _loop(ts = 0) {
  animId = requestAnimationFrame(_loop)
  if (mobile && ts - _lastFrame < _targetMs) return
  _lastFrame = ts

  const t = clock.getElapsedTime()

  letterObjs.forEach(lo => {
    if (!lo) return
    /* Holographic time */
    if (lo.body.material?.uniforms?.uTime) lo.body.material.uniforms.uTime.value = t
    /* Surprise ring */
    if (lo.group.userData.ring) lo.group.userData.ring.rotation.z = t * 1.5
    /* Hover pulse */
    if (hoveredIdx === lo.idx && !lo.group.userData.isOpen) {
      lo.group.position.y = lo.baseY + 0.18 + Math.sin(t * 3.2) * 0.04
    }
    /* Seal pulse on surprise */
    if (lo.isSurprise) {
      const s = 1 + 0.1 * Math.sin(t * 2.5 + lo.idx)
      lo.seal.scale.setScalar(s)
      if (lo.seal.material?.emissiveIntensity !== undefined) {
        lo.seal.material.emissiveIntensity = 0.7 + 0.3 * Math.sin(t * 2.5 + lo.idx)
      }
    }
  })

  renderer.render(scene, camera)
}

/* ═══════════════════════════════════
   Eventos (raycasting)
═══════════════════════════════════ */

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
      ? [o.body, o.flapPivot?.children[0], o.seal].filter(Boolean)
      : [])
    return raycaster.intersectObjects(targets, false)
  }

  function _find(mesh) {
    return letterObjs.find(o => o &&
      (o.body === mesh || o.seal === mesh || o.flapPivot?.children[0] === mesh)
    )
  }

  /* Hover */
  canvas.addEventListener('mousemove', e => {
    const hits = _hit(e.clientX, e.clientY)
    if (hits.length > 0) {
      const lo = _find(hits[0].object)
      if (lo) {
        canvas.style.cursor = 'pointer'
        if (hoveredIdx !== lo.idx) {
          if (hoveredIdx >= 0) _unhover(hoveredIdx)
          hoveredIdx = lo.idx
          _hover(lo)
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

  /* Click */
  canvas.addEventListener('mousedown', e => { tapStart = { x: e.clientX, y: e.clientY } })
  canvas.addEventListener('mouseup',   e => {
    if (Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) > 6) return
    const hits = _hit(e.clientX, e.clientY)
    if (hits.length > 0) {
      const lo = _find(hits[0].object)
      if (lo && !lo.group.userData.isOpen) _openLetter(lo)
    }
  })

  /* Touch */
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
  lo.group.userData.isOpen = true
  hoveredIdx = -1

  const fp = lo.group.userData.flapPivot

  /* 1 — Carta levanta da mesa */
  gsap.to(lo.group.position, { y: lo.baseY + 2.0, duration: 0.48, ease: 'power3.out' })
  gsap.to(lo.group.rotation, { x: -0.24, duration: 0.48, ease: 'power2.out' })

  /* 2 — Flap abre girando 160° em torno do pivô */
  gsap.to(fp.rotation, {
    x: -Math.PI * 0.88,
    duration: 0.55,
    delay: 0.42,
    ease: 'power2.inOut',
    onComplete: () => { if (onOpen) onOpen(lo.idx) }
  })
}

/* ═══════════════════════════════════
   Utilitários
═══════════════════════════════════ */

function _onResize() {
  const canvas = document.getElementById('letters-canvas')
  if (!canvas || !renderer || !camera) return
  const W = canvas.clientWidth, H = canvas.clientHeight
  camera.aspect = W / H
  camera.updateProjectionMatrix()
  renderer.setSize(W, H)
}
