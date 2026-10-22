---
name: video-hoster-resolvers
description: >-
  Bibliothèque de déballage, décryptage et résolution des hébergeurs vidéo de streaming
  (VOE, FSVID, Uqload, Vidmoly, Sibnet, Filemoon, Streamtape, Dood). À activer chaque
  fois qu'un scraper extrait une URL d'embed vidéo et doit la transformer en flux .m3u8
  ou .mp4 direct.
---

# Video Hoster Resolvers (Livre de Recettes)

Ce skill regroupe les techniques de reverse engineering pour extraire le fichier vidéo sous-jacent (`.m3u8` ou `.mp4`) à partir des pages d'embeds des hébergeurs vidéo gratuits.

---

## 1. Déballeur Universel `p,a,c,k,e,d` (Dean Edwards Packer)

La plupart des hébergeurs obfusquent leur code JavaScript source via `eval(function(p,a,c,k,e,d)...)`. Voici la fonction de décryptage standard :

```javascript
function unpack(packed) {
  try {
    if (!packed.includes("eval(function(p,a,c,k,e,d)")) return packed;
    const match = packed.match(/}\s*\('(.*)',\s*(\d+),\s*(\d+),\s*'(.*)'\.split\('\|'\)/s);
    if (!match) return packed;
    let [_, p, a, c, kStr] = match;
    a = parseInt(a, 10);
    c = parseInt(c, 10);
    const k = kStr.split('|');
    const e = (c) => (c < a ? '' : e(Math.floor(c / a))) + ((c = c % a) > 35 ? String.fromCharCode(c + 29) : c.toString(36));
    while (c--) {
      if (k[c]) p = p.replace(new RegExp('\\b' + e(c) + '\\b', 'g'), k[c]);
    }
    return p;
  } catch (err) {
    return packed;
  }
}
```

---

## 2. Recettes par Hébergeur

### 🎥 VOE (`voe.sx`)
* **Méthode :** Télécharger la page embed, repérer la redirection ou le script contenant `'hls': '...'` ou `var sources = { 'hls': '...' }`.
* **Décryptage :** Si la chaîne est encodée en base64, faire `atob(hls.split(',')[1] || hls)`.
* **Headers requis :** `Referer: https://voe.sx/`

### ⚡ FSVID (`fsvid.lol`)
* **Méthode :** Requêter l'URL `https://fsvid.lol/embed-<id>.html`.
* **Déballage :** Passer le HTML dans `unpack()`.
* **Regex flux :** `sources:\s*\[["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']\]`
* **Headers requis :** `Referer: https://fsvid.lol/`

### 📦 Uqload (`uqload.co` / `uqload.cx`)
* **Méthode :** Requêter l'URL embed avec `Referer: https://uqload.co/`.
* **Regex flux :** `sources:\s*\[["']([^"']+\.(?:mp4|m3u8))["']\]` ou `file:\s*["']([^"']+\.(?:mp4|m3u8))["']`.
* **Headers requis pour la lecture :** `Referer: https://uqload.co/`

### 🎞️ Vidmoly (`vidmoly.to` / `vidmoly.me`)
* **Méthode :** Requêter avec `Referer: https://vidmoly.to/`.
* **Déballage :** Exécuter `unpack()` sur le code JavaScript.
* **Regex flux :** `file\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']`
* **Headers requis :** `Referer: https://vidmoly.to/`

### 🇷🇺 Sibnet (`video.sibnet.ru`)
* **Méthode :** Requêter `https://video.sibnet.ru/shell.php?videoid=<id>` avec `Referer: https://video.sibnet.ru/`.
* **Regex flux :** `file\s*:\s*["']([^"']*\.mp4[^"']*)['"]`
* **Headers requis :** `Referer: https://video.sibnet.ru/` (Très rapide et stable).

### 🌙 Filemoon (`filemoon.sx`)
* **Méthode :** Requêter la page embed, dépacker le JavaScript `p,a,c,k,e,d`.
* **Regex flux :** `file\s*:\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']`
* **Headers requis :** `Referer: https://filemoon.sx/`
