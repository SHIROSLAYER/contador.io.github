/**
 * main.js — Entry point Vite
 *
 * A constelação usa implementação 2D Canvas nativa em index.html
 * (com interatividade completa: clicar estrelas, editar, adicionar, deletar).
 * O módulo Three.js foi removido para não sobrescrever window.constInit.
 */

/* ─────────────────────────────────────────────
   Service Worker
───────────────────────────────────────────── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {})
  })
}
