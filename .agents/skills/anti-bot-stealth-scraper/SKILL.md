---
name: anti-bot-stealth-scraper
description: >-
  Méthodologies, patterns et outils pour contourner les protections anti-bot (Cloudflare Turnstile,
  DDoS-Guard, IUAM 503/403, Datadome) et les blocages FAI (DNS poisoning). À activer lors du scraping
  de sites de streaming protégés ou censurés par les opérateurs français.
---

# Anti-Bot & Stealth Scraper Guide

Ce skill fournit les techniques avancées pour scraper les sites de streaming protégés par des systèmes anti-bot (Cloudflare, DDoS-Guard, etc.) ou bloqués par les résolveurs DNS menteurs des FAI français (Orange, SFR, Bouygues, Free).

---

## 1. Contournement du Blocage DNS FAI (Censure Arcom / FAI)

La quasi-totalité des sites de streaming français (`.sx`, `.ac`, `.to`, `.me`) sont bloqués par les FAI en France via empoisonnement DNS (renvoi vers 127.0.0.1 ou NXDOMAIN).

### Solution : Résolution DoH (DNS-over-HTTPS)
Ne jamais laisser l'OS résoudre directement les domaines sans fallback. Utiliser l'API DoH de Cloudflare ou Google :

```javascript
/**
 * Résout une IP réelle via Cloudflare DoH (bypass censure FAI)
 * @param {string} hostname - ex: 'french-stream.ac'
 * @returns {Promise<string>} IP résolue
 */
async function resolveDoH(hostname) {
  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`, {
      headers: { 'Accept': 'application/dns-json' }
    });
    const data = await res.json();
    if (data.Answer && data.Answer.length > 0) {
      return data.Answer[data.Answer.length - 1].data; // Dernière IP A valide
    }
  } catch (e) {
    console.error('DoH lookup failed:', e.message);
  }
  return null;
}
```

---

## 2. Empreinte HTTP & Headers Furtifs (Stealth Headers)

Les WAF modernes (Cloudflare / Datadome) bloquent les requêtes `curl`, `fetch` ou `axios` par défaut en analysant les headers `Sec-CH-UA`, `User-Agent` et la casse des en-têtes HTTP/2.

### Profil Chrome 130+ Complet :
```javascript
const STEALTH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br, zstd',
  'Sec-CH-UA': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  'Sec-CH-UA-Mobile': '?0',
  'Sec-CH-UA-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'max-age=0'
};
```

---

## 3. Gestion de Cloudflare Turnstile & IUAM

Si une page retourne un statut HTTP `403 Forbidden` ou `503 Service Unavailable` avec une page `Just a moment...` ou `Checking your browser` :

### Diagnostic :
1. **Cloudflare IUAM / Turnstile (WAF Challenge)** : Le site requiert l'exécution d'un token JS ou d'un cookie `cf_clearance`.
2. **DDoS-Guard** : Nécessite un cookie `__ddg2` ou `__ddg1` généré après une requête GET initiale.

### Architecture de Résolution Microservice (FlareSolverr) :
Pour les sites avec challenge lourd non résoluble en HTTP simple (ex: Wiflix, Darkiworld) :
- Déployer un conteneur **FlareSolverr** (port 8191) à côté du serveur.
- Faire transiter la requête par l'endpoint `/v1` :

```javascript
/**
 * Requête via FlareSolverr proxy local
 */
async function fetchViaFlareSolverr(targetUrl) {
  const solverUrl = process.env.FLARESOLVERR_URL || 'http://localhost:8191/v1';
  const response = await fetch(solverUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cmd: 'request.get',
      url: targetUrl,
      maxTimeout: 60000
    })
  });
  const data = await response.json();
  if (data.status === 'ok') {
    return {
      html: data.solution.response,
      cookies: data.solution.cookies,
      userAgent: data.solution.userAgent
    };
  }
  throw new Error(`FlareSolverr error: ${data.message}`);
}
```

---

## 4. Cache & Réutilisation de Cookies Anti-Bot

Ne jamais déclencher un challenge anti-bot à chaque requête d'utilisateur :
- Sauvegarder les cookies de session (`cf_clearance`, `session_id`) en mémoire vive pendant **25 minutes** (la durée de vie standard de Cloudflare étant de 30 min).
- Réutiliser le même `User-Agent` que celui ayant généré le `cf_clearance` (sinon Cloudflare invalide le cookie immédiatement).
