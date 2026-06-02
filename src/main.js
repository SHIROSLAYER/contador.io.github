/**
 * main.js — Entry point Vite
 *
 * Módulos Three.js:
 *  1. Constelação (legado, mantido mas inativo)
 *  2. Caixa de Cartas 3D (ativo na 4ª página)
 */

import { init as constInit3D, cleanup as constCleanup3D } from './modules/constellation-3d.js'
import {
  init            as lettersInit3D,
  cleanup         as lettersCleanup3D,
  addLetterToScene,
  closeLetter     as closeLetterIn3D,
} from './modules/letters-3d.js'

/* ─────────────────────────────────────────────
   Constelação Three.js (legado — mantido)
───────────────────────────────────────────── */
function getStarData() {
  return (window._constStarData && window._constStarData.length > 0)
    ? window._constStarData
    : (window._constDefStars || [])
}

function handleStarClick(idx) {
  if (idx === -1) { if (typeof window.constCloseCard === 'function') window.constCloseCard(); return }
  if (typeof window.constOpenCard === 'function') window.constOpenCard(idx)
}

window.constInit = function () {
  const tryInit = (attempts = 0) => {
    const stars = getStarData()
    if (stars.length > 0 || attempts > 12) constInit3D(stars, handleStarClick)
    else setTimeout(() => tryInit(attempts + 1), 150)
  }
  setTimeout(() => tryInit(), 300)
}
window.constStop = function () { constCleanup3D() }

/* ─────────────────────────────────────────────
   Caixa de Cartas 3D
   API exposta ao código legado em index.html:
     window.letterSceneInit(data)   — inicia cena
     window.letterSceneStop()       — destroi cena
     window.letterSceneAdd(ld, idx) — adiciona carta à cena
     window.letterSceneClose(idx)   — fecha carta na cena
───────────────────────────────────────────── */
window.letterSceneInit = function (letterData) {
  lettersInit3D(letterData || [], function (idx) {
    /* Callback do Three.js quando o flap termina de abrir */
    if (typeof window.letterOpen3DCallback === 'function') window.letterOpen3DCallback(idx)
  })
}

window.letterSceneStop = function () {
  lettersCleanup3D()
}

window.letterSceneAdd = function (ld, idx) {
  addLetterToScene(ld, idx)
}

window.letterSceneClose = function (idx) {
  closeLetterIn3D(idx)
}

/* ─────────────────────────────────────────────
   Service Worker
───────────────────────────────────────────── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {})
  })
}
