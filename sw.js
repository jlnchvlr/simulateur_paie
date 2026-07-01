/**
 * Service Worker — Simulateur Paie ICNA
 *
 * Stratégie : Cache-First pour les assets statiques (offline d'abord),
 *             Network-First pour data.json (barème mis à jour périodiquement).
 *
 * Versioning : incrémenter CACHE_VERSION à chaque déploiement qui change
 * un asset statique. L'activation nettoie automatiquement les vieux caches.
 */

const CACHE_VERSION  = "icna-paie-v7";
const DATA_CACHE     = "icna-data-v1";

/** Assets mis en cache au premier chargement (install). */
const STATIC_ASSETS = [
  "./index.html",
  "./style.css",
  "./engine.js",
  "./manifest.json",
  "./favicon.svg",
  "./icon-192.png",
  "./icon-512.png",
];

/** data.json est servi séparément — Network-First avec fallback cache. */
const DATA_URL = "./data.json";

// ── Install — précache les assets statiques ──────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  // Prend le contrôle immédiatement (pas d'attente du prochain chargement)
  self.skipWaiting();
});

// ── Activate — supprime les anciens caches ───────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_VERSION && k !== DATA_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  // Prend le contrôle de tous les clients ouverts
  self.clients.claim();
});

// ── Fetch — routage des requêtes ─────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Ignore les requêtes non-GET et cross-origin
  if (event.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  // data.json — Network-First (barème peut être mis à jour)
  if (url.pathname.endsWith("data.json")) {
    event.respondWith(networkFirstDataJson(event.request));
    return;
  }

  // Assets statiques — Cache-First
  event.respondWith(cacheFirstStatic(event.request));
});

/**
 * Cache-First : sert depuis le cache si disponible, sinon réseau.
 * Met à jour le cache avec la réponse réseau.
 */
async function cacheFirstStatic(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline + pas de cache — retourne une réponse d'erreur sobre
    return new Response("Ressource non disponible hors ligne.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

/**
 * Network-First : tente le réseau, met à jour le cache data, 
 * retourne le cache en fallback si offline.
 */
async function networkFirstDataJson(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DATA_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request, { cacheName: DATA_CACHE });
    if (cached) return cached;

    return new Response(
      JSON.stringify({ error: "Barème non disponible hors ligne." }),
      {
        status: 503,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }
}
