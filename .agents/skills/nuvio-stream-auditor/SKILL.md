---
name: nuvio-stream-auditor
description: >-
  Protocole de diagnostic, audit de performance et détection de pannes sur les providers
  de streaming Nuvio et Stremio. À activer dès que l'utilisateur signale des flux lents,
  des liens morts, ou pour valider l'intégrité du système après modification.
---

# Nuvio Stream Auditor (Protocole d'Audit)

Ce skill décrit la procédure standardisée pour auditer l'ensemble des scrapers et vérifier la validité des flux vidéo sans passer par l'application cliente.

---

## 1. La Suite de Tests Étalons (Benchmarks)

Trois œuvres de référence doivent toujours être testées pour couvrir tous les cas d'usage :

| Type | Œuvre | TMDB ID | Paramètres | Critère de validation |
|---|---|---|---|---|
| **Film classique** | *Inception* | `27205` | `mediaType: 'movie'` | Au moins 2 flux VF / MULTI |
| **Série VF** | *Lupin* | `96677` | `mediaType: 'tv', season: 1, episode: 1` | Au moins 2 flux 1080p ou 720p VF |
| **Anime** | *L'Attaque des Titans* | `1429` | `mediaType: 'tv', season: 1, episode: 1` | Flux VOSTFR et VF |

---

## 2. Exécution du Banc d'Essai

Pour exécuter le banc d'essai complet en local :

```bash
npm test
```
*(ou `node scripts/test-providers.js`)*

### Analyse des codes de retour :
* **`✅ Succès (< 3000ms)` :** Scraper performant et stable.
* **`⚠️ 0 flux` :** Le scraper a fonctionné mais n'a trouvé aucun lien (recherche de titre à affiner ou site vide).
* **`❌ ERREUR / TIMEOUT` :** Blocage réseau, domaine mort ou changement de structure HTML.

---

## 3. Sondage HTTP des Flux (Vérification LinkCheck)

Pour vérifier qu'un lien retourné par un provider est vivant sans le télécharger :

```bash
curl -s -I -m 5 -H "Referer: <REFERER_DU_FLUX>" "<URL_DU_FLUX>"
```

* **`HTTP/1.1 200 OK` avec `Content-Type: application/vnd.apple.mpegurl` :** Flux HLS parfait.
* **`HTTP/1.1 200 OK` avec `Content-Type: video/mp4` :** Fichier vidéo direct parfait.
* **`302 Found` :** Attention aux fausses redirections publicitaires (Telegram, pubs). Vérifier l'en-tête `Location:`.
* **`403 / 404` :** Lien mort à éliminer via `filterDeadStreams()`.
