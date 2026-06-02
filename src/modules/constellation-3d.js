/**
 * constellation-3d.js
 * Nossa Constelação — renderização Three.js
 *
 * Substitui o canvas 2D por uma cena WebGL com:
 *  - 8 000 estrelas de fundo como particle system com shader de twinkle
 *  - Nebulosas volumétricas (sprites aditivos)
 *  - 10 estrelas-memória pulsantes formando um coração
 *  - Linhas da constelação
 *  - Drag para rotacionar o campo estelar
 *  - Projeção 3D → 2D para detecção de clique
 */

import * as THREE from 'three'

/* ── Estado do módulo ── */
let scene, camera, renderer, clock
let starPoints = null          // particle system background
let memoryGroup = null         // grupo das estrelas especiais
let memoryMeta  = []           // { mesh, pos3, idx }
let animId      = null
let isDragging  = false
let dragStart   = { x: 0, y: 0 }
let rotTarget   = { x: 0, y: 0 }
let rotCurrent  = { x: 0, y: 0 }
let onOpenCard  = null         // callback(idx) vindo do módulo de UI

const STAR_COUNT = 8000

/* ─────────────────────────────────────────
   API pública
───────────────────────────────────────── */

/**
 * Inicializa a cena Three.js no canvas #const-canvas.
 * @param {Array}    starData       — array de objetos {x,y,label,date,text}
 * @param {Function} openCardCb     — chamada com (idx) ao clicar numa estrela, (-1) para fechar
 */
export function init(starData, openCardCb) {
  cleanup()
  onOpenCard = openCardCb

  const canvas = document.getElementById('const-canvas')
  if (!canvas) return

  const W = canvas.clientWidth  || window.innerWidth
  const H = canvas.clientHeight || window.innerHeight

  /* Cena */
  scene  = new THREE.Scene()
  clock  = new THREE.Clock()

  /* Câmera */
  camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 500)
  camera.position.set(0, 0, 5)

  /* Renderer */
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
  renderer.setSize(W, H)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x02000a)

  _buildStarField()
  _buildNebula()
  _buildMemoryStars(starData)
  _buildConstellationLines(starData)
  _bindEvents(canvas)

  _loop()
  window.addEventListener('resize', _onResize)
}

/** Para o loop e libera recursos (chamado ao sair da página). */
export function cleanup() {
  if (animId) { cancelAnimationFrame(animId); animId = null }
  if (renderer) { renderer.dispose(); renderer = null }
  scene = null; camera = null; clock = null
  starPoints = null; memoryGroup = null; memoryMeta = []
  rotTarget = { x: 0, y: 0 }; rotCurrent = { x: 0, y: 0 }
  window.removeEventListener('resize', _onResize)
}

/* ─────────────────────────────────────────
   Construção da cena
───────────────────────────────────────── */

function _buildStarField() {
  const positions = new Float32Array(STAR_COUNT * 3)
  const colors    = new Float32Array(STAR_COUNT * 3)
  const sizes     = new Float32Array(STAR_COUNT)
  const phases    = new Float32Array(STAR_COUNT)

  for (let i = 0; i < STAR_COUNT; i++) {
    /* Distribui as estrelas numa esfera grande ao redor da câmera */
    const theta = Math.random() * Math.PI * 2
    const phi   = Math.acos(2 * Math.random() - 1)
    const r     = 40 + Math.random() * 120

    positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
    positions[i * 3 + 2] = r * Math.cos(phi)

    /* Cor: maioria branco-azulado, alguns mais quentes */
    const warm = Math.random() > 0.82
    colors[i * 3]     = warm ? 1.0 : 0.82 + Math.random() * 0.18
    colors[i * 3 + 1] = warm ? 0.88 : 0.84 + Math.random() * 0.16
    colors[i * 3 + 2] = warm ? 0.72 : 0.92 + Math.random() * 0.08

    sizes[i]  = 0.8 + Math.random() * 3.2
    phases[i] = Math.random() * Math.PI * 2
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3))
  geo.setAttribute('size',     new THREE.BufferAttribute(sizes, 1))
  geo.setAttribute('phase',    new THREE.BufferAttribute(phases, 1))

  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute float size;
      attribute float phase;
      varying vec3  vColor;
      varying float vPhase;
      uniform float uTime;
      void main() {
        vColor = color;
        vPhase = phase;
        gl_Position  = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        float twinkle = 1.0 + 0.28 * sin(uTime * 2.2 + phase);
        gl_PointSize  = size * twinkle;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3  vColor;
      varying float vPhase;
      void main() {
        vec2  uv   = gl_PointCoord - 0.5;
        float dist = length(uv);
        if (dist > 0.5) discard;
        float a = pow(1.0 - dist * 2.0, 1.6);
        gl_FragColor = vec4(vColor, a * 0.88);
      }
    `,
  })

  starPoints = new THREE.Points(geo, mat)
  scene.add(starPoints)
}

function _buildNebula() {
  /* Blobs de luz suaves como planos com textura radial */
  const configs = [
    { pos: [-4,  2, -20], color: '#1a0545', size: 18, opacity: 0.07 },
    { pos: [ 5, -3, -25], color: '#45051a', size: 14, opacity: 0.06 },
    { pos: [ 0,  0, -30], color: '#05103a', size: 24, opacity: 0.05 },
    { pos: [-2, -4, -18], color: '#200a45', size: 12, opacity: 0.08 },
  ]

  configs.forEach(cfg => {
    const tex = _radialGradientTexture(cfg.color, 256)
    const mat = new THREE.SpriteMaterial({
      map:         tex,
      transparent: true,
      opacity:     cfg.opacity,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
    })
    const sprite = new THREE.Sprite(mat)
    sprite.position.set(...cfg.pos)
    sprite.scale.set(cfg.size, cfg.size, 1)
    scene.add(sprite)
  })
}

/** Mapeia a posição normalizada (0-1) do coração para o espaço 3D. */
function _mapPos(x, y) {
  return new THREE.Vector3((x - 0.5) * 9, -(y - 0.5) * 7, 0)
}

function _buildMemoryStars(starData) {
  memoryGroup = new THREE.Group()
  memoryMeta  = []

  starData.forEach((star, idx) => {
    const pos3 = _mapPos(star.x, star.y)

    /* Halo brilhante (sprite) */
    const isSpecial = idx === 5 /* centro do coração = Steven & Vitória */
    const glowColor = isSpecial ? '#d4889a' : '#8855ff'
    const haloTex   = _radialGradientTexture(glowColor, 128)

    const haloMat = new THREE.SpriteMaterial({
      map:         haloTex,
      transparent: true,
      opacity:     isSpecial ? 0.9 : 0.65,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
    })
    const halo = new THREE.Sprite(haloMat)
    halo.scale.set(0.8, 0.8, 1)
    halo.position.copy(pos3)
    memoryGroup.add(halo)

    /* Núcleo pontual */
    const coreGeo = new THREE.BufferGeometry()
    coreGeo.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([pos3.x, pos3.y, pos3.z]), 3
    ))
    const coreMat = new THREE.PointsMaterial({
      size:          isSpecial ? 8 : 6,
      sizeAttenuation: false,
      color:         isSpecial ? 0xffd0e0 : 0xd0c0ff,
      transparent:   true,
      blending:      THREE.AdditiveBlending,
      depthWrite:    false,
    })
    const core = new THREE.Points(coreGeo, coreMat)
    memoryGroup.add(core)

    memoryMeta.push({ halo, core, pos3: pos3.clone(), idx, star })
  })

  scene.add(memoryGroup)
}

function _buildConstellationLines(starData) {
  const pairs = [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,0]]

  pairs.forEach(([a, b]) => {
    if (!starData[a] || !starData[b]) return
    const p1 = _mapPos(starData[a].x, starData[a].y)
    const p2 = _mapPos(starData[b].x, starData[b].y)

    const geo = new THREE.BufferGeometry().setFromPoints([p1, p2])
    const mat = new THREE.LineBasicMaterial({
      color:       0x9955ff,
      transparent: true,
      opacity:     0.22,
      blending:    THREE.AdditiveBlending,
    })
    const line = new THREE.Line(geo, mat)
    scene.add(line)
  })
}

/* ─────────────────────────────────────────
   Loop de animação
───────────────────────────────────────── */

function _loop() {
  animId = requestAnimationFrame(_loop)
  const t = clock.getElapsedTime()

  /* Twinkle do campo estelar */
  if (starPoints) {
    starPoints.material.uniforms.uTime.value = t
    starPoints.rotation.y += 0.00012
    starPoints.rotation.x += 0.00004
  }

  /* Rotação suave por drag */
  rotCurrent.x += (rotTarget.x - rotCurrent.x) * 0.06
  rotCurrent.y += (rotTarget.y - rotCurrent.y) * 0.06
  if (scene) {
    scene.rotation.x = rotCurrent.x
    scene.rotation.y = rotCurrent.y
  }

  /* Pulso das estrelas-memória */
  memoryMeta.forEach((m, i) => {
    const p = 0.75 + Math.sin(t * 1.4 + i * 0.72) * 0.2
    m.halo.scale.set(p, p, 1)
    m.halo.material.opacity = 0.45 + Math.sin(t * 1.1 + i * 0.6) * 0.2
  })

  renderer.render(scene, camera)
}

/* ─────────────────────────────────────────
   Eventos
───────────────────────────────────────── */

function _bindEvents(canvas) {
  let lastDrag = { x: 0, y: 0 }

  /* Mouse */
  canvas.addEventListener('mousedown', e => {
    isDragging = false
    dragStart = lastDrag = { x: e.clientX, y: e.clientY }
  })
  canvas.addEventListener('mousemove', e => {
    const dx = e.clientX - lastDrag.x, dy = e.clientY - lastDrag.y
    if (Math.hypot(dx, dy) > 3) isDragging = true
    if (!isDragging) return
    rotTarget.y += dx * 0.003
    rotTarget.x += dy * 0.003
    rotTarget.x  = Math.max(-0.55, Math.min(0.55, rotTarget.x))
    lastDrag = { x: e.clientX, y: e.clientY }
  })
  canvas.addEventListener('mouseup',   e => { if (!isDragging) _handleTap(e.clientX, e.clientY, canvas) })
  canvas.addEventListener('mouseleave', () => { isDragging = false })

  /* Touch */
  canvas.addEventListener('touchstart', e => {
    isDragging = false; dragStart = lastDrag = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }, { passive: true })
  canvas.addEventListener('touchmove', e => {
    const dx = e.touches[0].clientX - lastDrag.x, dy = e.touches[0].clientY - lastDrag.y
    if (Math.hypot(dx, dy) > 5) isDragging = true
    if (!isDragging) return
    rotTarget.y += dx * 0.004
    rotTarget.x += dy * 0.004
    rotTarget.x  = Math.max(-0.55, Math.min(0.55, rotTarget.x))
    lastDrag = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }, { passive: true })
  canvas.addEventListener('touchend', e => {
    if (!isDragging) _handleTap(e.changedTouches[0].clientX, e.changedTouches[0].clientY, canvas)
    isDragging = false
  })
}

/** Detecta qual estrela foi tocada projetando posições 3D → 2D. */
function _handleTap(clientX, clientY, canvas) {
  if (!camera || !renderer) return
  const rect = canvas.getBoundingClientRect()
  const cx = clientX - rect.left, cy = clientY - rect.top
  const HIT_R = 35 /* raio de acerto em pixels */

  for (const m of memoryMeta) {
    const v = m.pos3.clone()
    /* Aplica a rotação da cena ao ponto */
    v.applyEuler(new THREE.Euler(rotCurrent.x, rotCurrent.y, 0))
    v.project(camera)

    const sx = (v.x + 1) / 2 * rect.width
    const sy = (1 - v.y) / 2 * rect.height

    if (Math.hypot(cx - sx, cy - sy) < HIT_R) {
      if (onOpenCard) onOpenCard(m.idx)
      return
    }
  }
  /* Clique no vazio: fecha o card */
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

/** Cria uma textura canvas com gradiente radial (glow). */
function _radialGradientTexture(color, size = 128) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  const g   = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2)
  g.addColorStop(0,   color)
  g.addColorStop(0.4, color + '99')
  g.addColorStop(1,   color + '00')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(c)
}
