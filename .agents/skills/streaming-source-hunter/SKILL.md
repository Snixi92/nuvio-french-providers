---
name: streaming-source-hunter
description: >-
  Méthodologies d'OSINT, Google/Yandex Dorking, scraping de mégathreads (FMHY, Reddit, GitHub)
  et qualification automatisée pour découvrir, auditer et classifier de nouveaux sites de streaming.
---

# Streaming Source Hunter (Guide de Reconnaissance & Découverte)

Ce skill formalise les méthodes pour chasser, répertorier et qualifier de nouvelles sources et plateformes de streaming gratuites sur le web, tout en éliminant immédiatement le spam, les redirections publicitaires et les faux sites.

---

## 1. Les Mégathreads & Dépôts de Référence (Sources Primaires)

Ne jamais chercher "au hasard" sur Google (les résultats de la première page sont 99% du temps des blogs d'affiliation VPN obsolètes ou des scams). Toujours interroger les bases communautaires mises à jour en continu :

### A. FMHY (FreeMediaHeckBoy - Le plus grand registre mondial)
* **Dépôt GitHub / Markdown brut** :
  `https://raw.githubusercontent.com/fmhy/FMHYEdit/main/docs/videopiracyguide.md`
  *(Contient la section "French / Francophone" sous la section non-english)*.
* **Miroir Web** : `https://fmhy.net/videopiracyguide#french`

### B. Reddit Scrapes Ciblés (JSON API sans clé)
* `https://www.reddit.com/r/FREEMEDIAHECKBOARDS/search.json?q=french+streaming&sort=new`
* `https://www.reddit.com/r/StremioAddons/search.json?q=french+addon&sort=new`
* `https://www.reddit.com/r/Piracy/search.json?q=french+stream&sort=new`

### C. Dépôts GitHub Publics d'Addons / Scrapers
Rechercher sur GitHub via code search :
* `path:providers language:javascript "french" OR "vf"`
* `filename:papadustream OR filename:frenchstream OR filename:wookafr`

---

## 2. Dorking de Moteurs Non-Censurés (Yandex, SearXNG, Mojeek)

Google retire massivement les sites de streaming de son index via les requêtes DMCA Lumen Database. Pour trouver les clones et les nouveaux noms de domaine actifs :

### Moteurs à privilégier :
1. **Yandex** (indexe les domaines sans filtrage ARCOM / DMCA)
2. **Mojeek / SearXNG** (moteurs indépendants sans bulle de filtrage)
3. **DuckDuckGo** (avec restriction géographique désactivée)

### Requêtes Dorking Recommandées :
* **Recherche de CMS Dooplay / WordPress de streaming :**
  ```text
  "regarder en streaming vf" intitle:"film complet" inurl:streaming
  "lecteur 1" "lecteur 2" "vostfr" inurl:serie
  inurl:/episodes/ "saison 1" "vf" "lecteur"
  ```
* **Recherche par hébergeurs vidéo caractéristiques :**
  ```text
  "fsvid" OR "vidmoly" OR "sibnet" "vf" "streaming" -site:youtube.com
  "uqload.to/embed-" OR "voe.sx/e/" "french"
  ```
* **Recherche de nouveaux TLD actifs :**
  ```text
  "french-stream" OR "wiflix" OR "papadustream" (site:.ac OR site:.sx OR site:.re OR site:.pm OR site:.wf)
  ```

---

## 3. Matrice de Qualification & Élimination Automatique

Avant de retenir un site découvert pour en faire un provider, lui faire passer ce crash-test en 4 étapes :

| Critère | Test | Résultat Requis |
| :--- | :--- | :--- |
| **1. Accessibilité** | `curl -I -L --max-redirs 3 <url>` | Réponse HTTP `200 OK` (pas de `survey-smiles.com`, pas de `404/521/523`) |
| **2. Pas de DDL pur** | Scan du code source HTML | Ne doit **PAS** être un forum de liens 1fichier/Rapidgator sans lecteur vidéo |
| **3. Lecteur Embarqué** | Recherche d'iframes dans le HTML | Présence de balises `<iframe>` vers des players reconnus (VOE, FSVID, Vidmoly...) |
| **4. Gratuité Réelle** | Pas de carte bancaire exigée | Si le site redirige vers `stream-register`, `ad-pay` ou demande une CB = **INTRUS** |

---

## 4. Script Automatique de Qualification d'URL (Node.js)

À lancer sur toute nouvelle URL candidate pour vérifier instantanément si elle est éligible :

```javascript
/**
 * Inspecte une URL candidate pour déterminer si c'est un vrai site de streaming exploitable.
 * @param {string} targetUrl 
 */
async function inspectStreamingCandidate(targetUrl) {
  try {
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'
      },
      redirect: 'follow'
    });

    const finalUrl = res.url;
    // Test redirection piège
    if (finalUrl.includes('survey-') || finalUrl.includes('parked') || finalUrl.includes('advertising')) {
      return { valid: false, reason: 'Redirection vers domaine parking/scam' };
    }

    const html = await res.text();

    // Détection de CMS de streaming
    const hasStreamingCMS = html.includes('dooplay') || html.includes('dle-theme') || html.includes('player-holder');
    
    // Détection d'hébergeurs vidéo dans les iframes
    const knownHosters = ['voe', 'fsvid', 'vidmoly', 'uqload', 'streamtape', 'dood', 'filemoon', 'sibnet'];
    const foundHosters = knownHosters.filter(h => html.toLowerCase().includes(h));

    if (foundHosters.length > 0 || hasStreamingCMS) {
      return {
        valid: true,
        finalUrl,
        hosters: foundHosters,
        cms: hasStreamingCMS ? 'Streaming Template Detecte' : 'Custom'
      };
    }

    return { valid: false, reason: 'Aucun player ni hébergeur vidéo identifié dans le DOM' };
  } catch (err) {
    return { valid: false, reason: `Erreur de connexion: ${err.message}` };
  }
}
```
