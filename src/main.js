/**
 * main.js — Entry point Vite
 *
 * Módulos Three.js:
 *  1. Constelação (legado, mantido mas inativo)
 */

import { init as constInit3D, cleanup as constCleanup3D } from './modules/constellation-3d.js'

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
   Service Worker
───────────────────────────────────────────── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {})
  })
}
