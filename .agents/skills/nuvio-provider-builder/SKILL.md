---
name: nuvio-provider-builder
description: >-
  Guide de conception, d'échafaudage et d'implémentation de nouveaux fournisseurs (providers)
  de streaming francophones pour Nuvio et Stremio. À utiliser chaque fois qu'un utilisateur
  souhaite ajouter un nouveau site de streaming (WordPress, DLE, API custom) dans le dossier
  providers/.
---

# Nuvio Provider Builder (Guide de Création)

Ce skill détaille l'architecture et les spécifications obligatoires pour concevoir un provider Nuvio/Stremio robuste et compatible avec le moteur JavaScript embarqué **QuickJS** (Nuvio Mobile) et **Node.js** (Addon Render).

---

## 1. Contrat d'Interface Obligatoire

Chaque provider logé dans `providers/<nom>.js` doit impérativement exporter une fonction `getStreams` :

```javascript
/**
 * Recherche et résout les flux vidéo pour une œuvre.
 * @param {string|number} tmdbId - Identifiant TMDB du média (ex: '27205' ou '96677')
 * @param {'movie'|'tv'} mediaType - Type de média ('movie' pour film, 'tv' pour série)
 * @param {number} [season=1] - Numéro de la saison (pour séries)
 * @param {number} [episode=1] - Numéro de l'épisode (pour séries)
 * @returns {Promise<Array<StreamObject>>}
 */
async function getStreams(tmdbId, mediaType, season, episode) { ... }
```

### Double Export QuickJS & Node.js

Pour garantir la compatibilité universelle (App Mobile QuickJS et Serveur Express) :

```javascript
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  if (typeof globalThis !== 'undefined') globalThis.getStreams = getStreams;
  if (typeof global !== 'undefined') global.getStreams = getStreams;
}
```

---

## 2. Structure d'un `StreamObject`

Chaque flux retourné dans la liste doit respecter cette structure :

```javascript
{
  name: "NomProvider (VF)",       // Nom affiché dans la liste des serveurs
  title: "🇫🇷 [VF] Titre - 1080p", // Description riche affichée à l'écran
  url: "https://.../playlist.m3u8", // URL directe lisible (.m3u8 HLS ou .mp4)
  quality: "1080p",               // '4K', '1080p', '720p', '480p'
  language: "fr",                 // 'fr', 'multi', 'en'
  type: "hls",                    // 'hls' ou 'mp4'
  headers: {                      // Headers indispensables pour éviter les 403 Forbidden
    "Referer": "https://hebergeur.com/",
    "Origin": "https://hebergeur.com",
    "User-Agent": "Mozilla/5.0 ..."
  }
}
```

---

## 3. Workflow de Scraping recommandé

1. **Résolution TMDB → Titres Français :**
   Interroger l'API TMDB pour récupérer le titre français (`title` ou `name`) et l'année de sortie afin de maximiser le taux de correspondance lors de la recherche sur le site cible.
2. **Recherche sur le site cible :**
   * Formater le titre (sans caractères spéciaux ni accents).
   * Envoyer la requête de recherche au moteur du site (ex: `/index.php?do=search` pour DLE, ou `admin-ajax.php` pour WordPress).
3. **Extraction des lecteurs / Embeds :**
   * Récupérer les liens des embeds vidéo (VOE, FSVID, Uqload, Vidmoly, Sibnet, Filemoon).
4. **Résolution en flux direct :**
   * Passer l'URL embed au résolveur adéquat pour obtenir le fichier `.m3u8` ou `.mp4` décrypté.
5. **Filtrage et renvoi :**
   * Ne renvoyer que les flux ayant un format vidéo direct reconnu.
