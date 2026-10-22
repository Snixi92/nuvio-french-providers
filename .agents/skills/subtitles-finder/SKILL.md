---
name: subtitles-finder
description: >-
  Recherche, extraction et injection de sous-titres (VF, VOSTFR, EN) synchronisés via OpenSubtitles
  REST API v3, SubDL et convertisseurs SRT vers WebVTT pour les lecteurs Nuvio et Stremio.
---

# Subtitles Finder & Synchronizer Guide

Ce skill fournit les API et méthodes pour associer automatiquement des sous-titres français (`fra` / `fre`) ou multi-langues aux flux vidéo résolus par les providers Nuvio et Stremio.

---

## 1. Intégration OpenSubtitles REST API v3

L'API OpenSubtitles v3 permet de chercher des pistes de sous-titres précises par identifiant IMDB (`imdb_id` sans le préfixe `tt`) ou TMDB ID.

```javascript
/**
 * Recherche des sous-titres français sur OpenSubtitles v3
 * @param {string} imdbId - ex: 'tt2531336'
 * @param {number} [season] - optionnel pour séries
 * @param {number} [episode] - optionnel pour séries
 * @returns {Promise<Array<object>>} Liste d'objets sous-titres
 */
async function fetchOpenSubtitles(imdbId, season, episode) {
  const cleanImdb = imdbId ? imdbId.replace('tt', '') : null;
  if (!cleanImdb) return [];

  let url = `https://api.opensubtitles.com/api/v1/subtitles?imdb_id=${cleanImdb}&languages=fr`;
  if (season) url += `&season_number=${season}`;
  if (episode) url += `&episode_number=${episode}`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'NuvioStream v1.3.0',
        'Accept': 'application/json'
      }
    });

    if (!res.ok) return [];
    const data = await res.json();
    if (!data.data || !Array.isArray(data.data)) return [];

    return data.data.slice(0, 5).map(sub => ({
      id: String(sub.id),
      url: sub.attributes.files[0]?.file_id 
        ? `https://api.opensubtitles.com/api/v1/download/${sub.attributes.files[0].file_id}`
        : null,
      lang: 'fra',
      label: sub.attributes.release || 'Français'
    })).filter(s => s.url);
  } catch (err) {
    console.error('Error fetching OpenSubtitles:', err.message);
    return [];
  }
}
```

---

## 2. Intégration SubDL (Alternative Gratuite & Complète)

SubDL est souvent plus rapide et ne nécessite pas de jeton complexe pour les requêtes basiques.

```javascript
/**
 * Recherche des sous-titres FR via l'API SubDL
 * @param {string} imdbId - ex: 'tt2531336'
 * @param {number} [season]
 * @param {number} [episode]
 */
async function fetchSubDL(imdbId, season, episode) {
  try {
    let url = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&languages=FR`;
    if (season && episode) {
      url += `&season=${season}&episode=${episode}`;
    }

    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return [];
    const json = await res.json();
    if (!json.subtitles || !Array.isArray(json.subtitles)) return [];

    return json.subtitles.slice(0, 5).map((s, idx) => ({
      id: `subdl_${idx}`,
      url: `https://dl.subdl.com${s.url}`,
      lang: 'fra',
      label: s.release_name || 'Français (SubDL)'
    }));
  } catch (err) {
    return [];
  }
}
```

---

## 3. Formatage pour Stremio et Nuvio

Chaque objet `stream` renvoyé par un provider ou l'addon peut inclure le champ `subtitles` :

```javascript
{
  name: "Papadustream [1080p]",
  title: "Lupin S01E01 - 1080p HLS (VOSTFR)",
  url: "https://serveur.com/hls/master.m3u8",
  subtitles: [
    {
      id: "sub_fr_1",
      url: "https://.../subtitles.vtt",
      lang: "fra",
      label: "Français Complet"
    },
    {
      id: "sub_fr_forced",
      url: "https://.../forced.vtt",
      lang: "fra",
      label: "Français Forcé"
    }
  ]
}
```

---

## 4. Convertisseur Instantané SRT vers WebVTT (In-Memory)

Si la source de sous-titres est au format `.srt`, les navigateurs web et lecteurs modernes requièrent du `.vtt` (WebVTT) :

```javascript
/**
 * Convertit une chaîne de caractères SRT en WebVTT
 * @param {string} srtContent
 * @returns {string} vttContent
 */
function srtToVtt(srtContent) {
  let vtt = 'WEBVTT\n\n' + srtContent
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Remplacer les virgules de millisecondes (00:01:20,000) par des points (00:01:20.000)
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return vtt;
}
```
