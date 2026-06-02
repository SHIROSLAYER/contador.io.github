/**
 * constellation-3d.js — Nossa Constelação (Three.js WebGL)
 *
 * Adaptativo mobile/desktop:
 *  - Mobile  → 1 500 estrelas, PointsMaterial nativo, PR=1, sem antialiasing
 *  - Desktop → 6 000 estrelas, shader de twinkle, PR≤2
 */

import * as THREE from 'three'

/* ── Detecção de capacidade ── */
const isMobile = () =>
  window.innerWidth < 768 ||
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)

/* ── Estado do módulo ── */
let scene, camera, renderer, clock
let starPoints  = null
let memoryMeta  = []
let animId      = null
let isDragging  = false
let rotTarget   = { x: 0, y: 0 }
let rotCurrent  = { x: 0, y: 0 }
let lastDrag    = { x: 0, y: 0 }
let onOpenCard  = null
let mobile      = false

/* ─────────────────────────────────────────
   API pública
───────────────────────────────────────── */

export function init(starData, openCardCb) {
  cleanup()
  mobile     = isMobile()
  onOpenCard = openCardCb

  const canvas = document.getElementById('const-canvas')
  if (!canvas) return

  const W = canvas.clientWidth  || window.innerWidth
  const H = canvas.clientHeight || window.innerHeight

  scene  = new THREE.Scene()
  clock  = new THREE.Clock()

  camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 500)
  camera.position.z = 5

  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias:       !mobile,          // desliga antialiasing no mobile
    powerPreference: 'high-performance',
    precision:       mobile ? 'lowp' : 'highp',
  })
  renderer.setSize(W, H)
  renderer.setPixelRatio(mobile ? 1 : Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x02000a)

  _buildStarField()
  if (!mobile) _buildNebula()          // nebulosas só no desktop
  _buildMemoryStars(starData)
  _buildConstellationLines(starData)
  _bindEvents(canvas)
  _loop()

  window.addEventListener('resize', _onResize)
}

export function cleanup() {
  if (animId)    { cancelAnimationFrame(animId); animId = null }
  if (renderer)  { renderer.dispose(); renderer = null }
  if (scene)     {
    scene.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose()
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose())
        else obj.material.dispose()
      }
    })
  }
  scene = null; camera = null; clock = null
  starPoints = null; memoryMeta = []
  rotTarget = { x:0, y:0 }; rotCurrent = { x:0, y:0 }
  window.removeEventListener('resize', _onResize)
}

/* ─────────────────────────────────────────
   Construção da cena
───────────────────────────────────────── */

function _buildStarField() {
  const COUNT = mobile ? 1500 : 6000

  const positions = new Float32Array(COUNT * 3)
  const colors    = new Float32Array(COUNT * 3)
  const sizes     = new Float32Array(COUNT)

  for (let i = 0; i < COUNT; i++) {
    const theta = Math.random() * Math.PI * 2
    const phi   = Math.acos(2 * Math.random() - 1)
    const r     = 40 + Math.random() * 120

    positions[i*3]   = r * Math.sin(phi) * Math.cos(theta)
    positions[i*3+1] = r * Math.sin(phi) * Math.sin(theta)
    positions[i*3+2] = r * Math.cos(phi)

    const warm = Math.random() > 0.82
    colors[i*3]   = warm ? 1.0 : 0.82 + Math.random() * 0.18
    colors[i*3+1] = warm ? 0.88 : 0.84 + Math.random() * 0.16
    colors[i*3+2] = warm ? 0.72 : 0.92 + Math.random() * 0.08

    sizes[i] = mobile ? (0.6 + Math.random() * 2.0) : (0.8 + Math.random() * 3.2)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3))
  geo.setAttribute('size',     new THREE.BufferAttribute(sizes, 1))

  let mat

  if (mobile) {
    /* Mobile: PointsMaterial nativo — zero overhead de shader ── */
    mat = new THREE.PointsMaterial({
      size:             2.5,
      sizeAttenuation:  false,
      vertexColors:     true,
      transparent:      true,
      opacity:          0.75,
      blending:         THREE.AdditiveBlending,
      depthWrite:       false,
    })
  } else {
    /* Desktop: shader custom com twinkle ── */
    mat = new THREE.ShaderMaterial({
      uniforms:     { uTime: { value: 0 } },
      vertexColors: true,
      transparent:  true,
      depthWrite:   false,
      blending:     THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        attribute float size;
        varying vec3  vColor;
        uniform float uTime;
        void main() {
          vColor = color;
          gl_Position  = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          float t = 1.0 + 0.28 * sin(uTime * 2.2 + position.x * 0.1 + position.y * 0.08);
          gl_PointSize = size * t;
        }
      `,
      fragmentShader: /* glsl */`
        varying vec3 vColor;
        void main() {
          vec2  uv = gl_PointCoord - 0.5;
          float d  = length(uv);
          if (d > 0.5) discard;
          float a  = pow(1.0 - d * 2.0, 1.6);
          gl_FragColor = vec4(vColor, a * 0.88);
        }
      `,
    })
  }

  starPoints = new THREE.Points(geo, mat)
  scene.add(starPoints)
}

function _buildNebula() {
  /* Apenas desktop — blobs de luz suaves */
  const configs = [
    { pos: [-4,  2, -20], color: '#1a0545', size: 18, opacity: 0.07 },
    { pos: [ 5, -3, -25], color: '#45051a', size: 14, opacity: 0.06 },
    { pos: [ 0,  0, -30], color: '#05103a', size: 24, opacity: 0.05 },
  ]
  configs.forEach(cfg => {
    const tex = _radialGradTex(cfg.color, 128)
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: cfg.opacity,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
    const s = new THREE.Sprite(mat)
    s.position.set(...cfg.pos)
    s.scale.set(cfg.size, cfg.size, 1)
    scene.add(s)
  })
}

function _mapPos(x, y) {
  return new THREE.Vector3((x - 0.5) * 9, -(y - 0.5) * 7, 0)
}

function _buildMemoryStars(starData) {
  memoryMeta = []
  /* Tamanhos reduzidos no mobile para poupar GPU */
  const haloSize = mobile ? 0.55 : 0.8
  const texSize  = mobile ? 64   : 128

  starData.forEach((star, idx) => {
    const pos3      = _mapPos(star.x, star.y)
    const isSpecial = (idx === 5)
    const glowColor = isSpecial ? '#d4889a' : '#8855ff'

    const haloMat = new THREE.SpriteMaterial({
      map:         _radialGradTex(glowColor, texSize),
      transparent: true,
      opacity:     isSpecial ? 0.85 : 0.6,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
    })
    const halo = new THREE.Sprite(haloMat)
    halo.scale.set(haloSize, haloSize, 1)
    halo.position.copy(pos3)
    scene.add(halo)

    const coreGeo = new THREE.BufferGeometry()
    coreGeo.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([pos3.x, pos3.y, pos3.z]), 3
    ))
    const coreMat = new THREE.PointsMaterial({
      size:            isSpecial ? 7 : 5,
      sizeAttenuation: false,
      color:           isSpecial ? 0xffd0e0 : 0xd0c0ff,
      transparent:     true,
      blending:        THREE.AdditiveBlending,
      depthWrite:      false,
    })
    const core = new THREE.Points(coreGeo, coreMat)
    scene.add(core)

    memoryMeta.push({ halo, core, pos3: pos3.clone(), idx, star })
  })
}

function _buildConstellationLines(starData) {
  const pairs = [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,0]]
  pairs.forEach(([a, b]) => {
    if (!starData[a] || !starData[b]) return
    const geo = new THREE.BufferGeometry().setFromPoints([
      _mapPos(starData[a].x, starData[a].y),
      _mapPos(starData[b].x, starData[b].y),
    ])
    const mat = new THREE.LineBasicMaterial({
      color: 0x9955ff, transparent: true,
      opacity: mobile ? 0.28 : 0.22,
      blending: THREE.AdditiveBlending,
    })
    scene.add(new THREE.Line(geo, mat))
  })
}

/* ─────────────────────────────────────────
   Loop — throttle no mobile a ~30fps
───────────────────────────────────────── */

let _lastFrame = 0
const TARGET_MS = 1000 / (mobile ? 30 : 60)

function _loop(ts = 0) {
  animId = requestAnimationFrame(_loop)

  /* Throttle: pula frames para economizar bateria no mobile */
  if (mobile && ts - _lastFrame < TARGET_MS) return
  _lastFrame = ts

  const t = clock.getElapsedTime()

  /* Rotação lenta do campo estelar */
  if (starPoints) {
    if (!mobile && starPoints.material.uniforms) {
      starPoints.material.uniforms.uTime.value = t
    }
    starPoints.rotation.y += mobile ? 0.00008 : 0.00012
    starPoints.rotation.x += mobile ? 0.00003 : 0.00004
  }

  /* Lerp rotação por drag */
  rotCurrent.x += (rotTarget.x - rotCurrent.x) * 0.06
  rotCurrent.y += (rotTarget.y - rotCurrent.y) * 0.06
  if (scene) { scene.rotation.x = rotCurrent.x; scene.rotation.y = rotCurrent.y }

  /* Pulso das estrelas-memória — menos frequente no mobile */
  if (!mobile || Math.floor(t * 10) % 2 === 0) {
    memoryMeta.forEach((m, i) => {
      const p = 0.75 + Math.sin(t * 1.4 + i * 0.72) * 0.2
      m.halo.scale.set(p, p, 1)
    })
  }

  renderer.render(scene, camera)
}

/* ─────────────────────────────────────────
   Eventos (drag + tap)
───────────────────────────────────────── */

function _bindEvents(canvas) {
  canvas.addEventListener('mousedown', e => {
    isDragging = false; lastDrag = { x: e.clientX, y: e.clientY }
  })
  canvas.addEventListener('mousemove', e => {
    const dx = e.clientX - lastDrag.x, dy = e.clientY - lastDrag.y
    if (Math.hypot(dx, dy) > 3) isDragging = true
    if (!isDragging) return
    rotTarget.y += dx * 0.003; rotTarget.x += dy * 0.003
    rotTarget.x = Math.max(-0.55, Math.min(0.55, rotTarget.x))
    lastDrag = { x: e.clientX, y: e.clientY }
  })
  canvas.addEventListener('mouseup',    e => { if (!isDragging) _handleTap(e.clientX, e.clientY, canvas) })
  canvas.addEventListener('mouseleave', () => { isDragging = false })

  canvas.addEventListener('touchstart', e => {
    isDragging = false; lastDrag = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }, { passive: true })
  canvas.addEventListener('touchmove', e => {
    const t = e.touches[0]
    const dx = t.clientX - lastDrag.x, dy = t.clientY - lastDrag.y
    if (Math.hypot(dx, dy) > 6) isDragging = true
    if (!isDragging) return
    rotTarget.y += dx * 0.004; rotTarget.x += dy * 0.004
    rotTarget.x = Math.max(-0.55, Math.min(0.55, rotTarget.x))
    lastDrag = { x: t.clientX, y: t.clientY }
  }, { passive: true })
  canvas.addEventListener('touchend', e => {
    if (!isDragging) _handleTap(e.changedTouches[0].clientX, e.changedTouches[0].clientY, canvas)
    isDragging = false
  })
}

function _handleTap(clientX, clientY, canvas) {
  if (!camera || !renderer) return
  const rect = canvas.getBoundingClientRect()
  const cx = clientX - rect.left, cy = clientY - rect.top
  const HIT_R = mobile ? 42 : 35 /* raio maior no mobile */

  for (const m of memoryMeta) {
    const v = m.pos3.clone()
    v.applyEuler(new THREE.Euler(rotCurrent.x, rotCurrent.y, 0))
    v.project(camera)
    const sx = (v.x + 1) / 2 * rect.width
    const sy = (1 - v.y) / 2 * rect.height
    if (Math.hypot(cx - sx, cy - sy) < HIT_R) {
      if (onOpenCard) onOpenCard(m.idx)
      return
    }
  }
  if (onOpenCard) onOpenCard(-1)
}

/* ─────────────────────────────────────────
   Utilitários
───────────────────────────────────────── */

function _onResize() {
  const canvas = document.getElementById('const-canvas')
  if (!canvas || !renderer || !camera) return
  const W = canvas.clientWidth, H = canvas.clientHeight
  camera.aspect = W / H
  camera.updateProjectionMatrix()
  renderer.setSize(W, H)
}

function _radialGradTex(color, size = 128) {
  const c   = document.createElement('canvas')
  c.width   = c.height = size
  const ctx = c.getContext('2d')
  const g   = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2)
  g.addColorStop(0,   color)
  g.addColorStop(0.4, color + '88')
  g.addColorStop(1,   color + '00')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(c)
}
