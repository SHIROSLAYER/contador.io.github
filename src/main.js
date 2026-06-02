/**
 * main.js — Entry point Vite
 *
 * Responsabilidades:
 *  1. Inicializa Three.js na constelação (substitui Canvas 2D)
 *  2. Expõe constInit / constStop no window (a navegação goTo() chama essas funções)
 *  3. No futuro: migrar módulos restantes aqui
 */

import { init as constInit3D, cleanup as constCleanup3D } from './modules/constellation-3d.js'

/* ─────────────────────────────────────────────
   Constelação Three.js
   Mantém a mesma API que o código legado espera:
     window.constInit()  — chamado por goTo('pg-constellation')
     window.constStop()  — chamado ao sair da página
───────────────────────────────────────────── */

/**
 * Dados padrão das estrelas (coração de 10 pontos).
 * O código legado em index.html usa _constDefStars e _constStarData.
 * Lemos esses valores do window quando disponíveis.
 */
function getStarData() {
  return (window._constStarData && window._constStarData.length > 0)
    ? window._constStarData
    : (window._constDefStars || _fallbackStars())
}

/** Fallback caso o código legado ainda não tenha carregado. */
function _fallbackStars() {
  return [
    { x:.50, y:.26, label:'Nosso Começo',     date:'04/09/2024', text:'O dia em que tudo mudou para sempre.' },
    { x:.32, y:.23, label:'O Primeiro Olhar', date:'',           text:'Aquele momento que o coração acelerou.' },
    { x:.19, y:.38, label:'Nos Conhecemos',   date:'',           text:'Os primeiros momentos juntos.' },
    { x:.17, y:.57, label:'Primeiro Beijo',   date:'',           text:'O beijo que selou tudo entre nós.' },
    { x:.32, y:.74, label:'Crescendo Juntos', date:'',           text:'Cada dia aprendendo mais sobre o amor.' },
    { x:.50, y:.83, label:'Steven & Vitória', date:'',           text:'Dois corações que se escolheram.' },
    { x:.68, y:.74, label:'Nossa Força',      date:'',           text:'Juntos somos mais.' },
    { x:.83, y:.57, label:'A Promessa',       date:'',           text:'Prometemos estar um para o outro.' },
    { x:.81, y:.38, label:'Noivamos',         date:'',           text:'O dia em que tornamos o amor oficial.' },
    { x:.68, y:.23, label:'Para Sempre',      date:'',           text:'E assim começa o resto das nossas vidas.' },
  ]
}

/**
 * Callback chamado pelo Three.js ao clicar numa estrela.
 * Delega para as funções de UI do código legado.
 */
function handleStarClick(idx) {
  if (idx === -1) {
    if (typeof window.constCloseCard === 'function') window.constCloseCard()
    return
  }
  if (typeof window.constOpenCard === 'function') window.constOpenCard(idx)
}

/* Sobrescreve constInit e constStop para usar Three.js */
window.constInit = function () {
  /* Aguarda o código legado carregar os dados do Supabase */
  const tryInit = (attempts = 0) => {
    const stars = getStarData()
    if (stars.length > 0 || attempts > 12) {
      constInit3D(stars, handleStarClick)
    } else {
      setTimeout(() => tryInit(attempts + 1), 150)
    }
  }
  /* Pequeno delay para garantir que _constLoadStars() do legado termine */
  setTimeout(() => tryInit(), 300)
}

window.constStop = function () {
  constCleanup3D()
}

/* ─────────────────────────────────────────────
   Registro do Service Worker
───────────────────────────────────────────── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .catch(() => {}) /* Falha silenciosa em dev */
  })
}
