// ============================================================================
// Provider Nuvio : French Anime (french-anime.com)
// Spécialité : Animés en VF & VOSTFR (Hébergeur principal : Sibnet)
// Compatibilité : QuickJS (Nuvio Mobile) & Node.js CommonJS (Express Addon)
// ============================================================================

var BASE_URL = 'https://french-anime.com';
var TMDB_KEY = 'f3d757824f08ea2cff45eb8f47ca3a1e';
var TMDB_BASE = 'https://api.themoviedb.org/3';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

var STEALTH_HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'max-age=0'
};

// ── Utilitaires Réseau avec Timeout ──────────────────────────────────────────

function fetchWithTimeout(url, options, timeoutMs) {
  var ms = timeoutMs || 10000;
  var timer = null;
  var timeoutPromise = new Promise(function(_, reject) {
    timer = setTimeout(function() {
      reject(new Error('Timeout ' + ms + 'ms exceeded for ' + url));
    }, ms);
  });

  var opts = options || {};
  if (typeof AbortController !== 'undefined') {
    var controller = new AbortController();
    opts.signal = controller.signal;
    var origReject = timeoutPromise;
    timeoutPromise = new Promise(function(_, reject) {
      origReject.catch(function(err) {
        try { controller.abort(); } catch (_) {}
        reject(err);
      });
    });
  }

  return Promise.race([
    fetch(url, opts),
    timeoutPromise
  ]).finally(function() {
    if (timer) clearTimeout(timer);
  });
}

// ── Nettoyage et Normalisation de Chaînes ─────────────────────────────────────

function normalizeText(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanQuery(str) {
  if (!str) return '';
  return str
    .replace(/\s+(?:Season|Saison|Part|Cour|Arc)\s+\d+.*$/i, '')
    .replace(/\s+S\d+.*$/i, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Métadonnées TMDB ─────────────────────────────────────────────────────────

async function getTmdbTitles(tmdbId, mediaType) {
  var titles = [];
  var type = mediaType === 'movie' ? 'movie' : 'tv';
  
  try {
    var urlFr = TMDB_BASE + '/' + type + '/' + tmdbId + '?api_key=' + TMDB_KEY + '&language=fr-FR';
    var resFr = await fetchWithTimeout(urlFr, { headers: { 'User-Agent': UA } }, 5000);
    if (resFr.ok) {
      var dataFr = await resFr.json();
      var frTitle = (dataFr.title || dataFr.name || '').trim();
      var origTitle = (dataFr.original_title || dataFr.original_name || '').trim();
      if (frTitle) titles.push(frTitle);
      if (origTitle && !titles.includes(origTitle)) titles.push(origTitle);
    }
  } catch (e) {
    // TMDB fallback silencieux
  }

  try {
    var urlEn = TMDB_BASE + '/' + type + '/' + tmdbId + '?api_key=' + TMDB_KEY + '&language=en-US';
    var resEn = await fetchWithTimeout(urlEn, { headers: { 'User-Agent': UA } }, 4000);
    if (resEn.ok) {
      var dataEn = await resEn.json();
      var enTitle = (dataEn.title || dataEn.name || '').trim();
      if (enTitle && !titles.includes(enTitle)) titles.push(enTitle);
    }
  } catch (e) {}

  return titles.length > 0 ? titles : ['Anime'];
}

// ── Moteur de Recherche DLE French Anime ──────────────────────────────────────

async function searchFrenchAnime(query) {
  var clean = cleanQuery(query);
  if (!clean) return [];

  var results = [];
  var seenUrls = new Set();

  function addResult(title, href) {
    if (!href) return;
    var fullUrl = href.startsWith('http') ? href : BASE_URL + (href.startsWith('/') ? '' : '/') + href;
    if (seenUrls.has(fullUrl)) return;
    seenUrls.add(fullUrl);
    
    var cleanT = title.replace(/<[^>]+>/g, '').trim();
    var isVf = /\bvf\b/i.test(cleanT);
    var isVostfr = /\bvostfr\b/i.test(cleanT);
    var lang = isVf && !isVostfr ? 'vf' : isVostfr && !isVf ? 'vostfr' : 'multi';

    results.push({
      title: cleanT,
      url: fullUrl,
      lang: lang
    });
  }

  // 1. Recherche DLE POST standard
  try {
    var postUrl = BASE_URL + '/index.php?do=search';
    var postBody = 'do=search&subaction=search&search_start=0&full_search=0&result_from=1&story=' + encodeURIComponent(clean);
    var resPost = await fetchWithTimeout(postUrl, {
      method: 'POST',
      headers: Object.assign({}, STEALTH_HEADERS, {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': BASE_URL + '/',
        'Origin': BASE_URL
      }),
      body: postBody
    }, 6000);

    if (resPost.ok) {
      var html = await resPost.text();
      parseDleSearchResults(html, addResult);
    }
  } catch (err) {}

  // 2. Recherche DLE GET fallback si peu de résultats
  if (results.length === 0) {
    try {
      var getUrl = BASE_URL + '/index.php?do=search&subaction=search&story=' + encodeURIComponent(clean);
      var resGet = await fetchWithTimeout(getUrl, {
        headers: Object.assign({}, STEALTH_HEADERS, { 'Referer': BASE_URL + '/' })
      }, 5000);

      if (resGet.ok) {
        var htmlGet = await resGet.text();
        parseDleSearchResults(htmlGet, addResult);
      }
    } catch (err) {}
  }

  // 3. Recherche Live / Ajax DLE
  if (results.length === 0) {
    try {
      var ajaxUrl = BASE_URL + '/engine/ajax/controller.php?mod=search&query=' + encodeURIComponent(clean);
      var resAjax = await fetchWithTimeout(ajaxUrl, {
        headers: Object.assign({}, STEALTH_HEADERS, {
          'Referer': BASE_URL + '/',
          'X-Requested-With': 'XMLHttpRequest'
        })
      }, 4000);

      if (resAjax.ok) {
        var ajaxHtml = await resAjax.text();
        parseDleSearchResults(ajaxHtml, addResult);
      }
    } catch (err) {}
  }

  return results;
}

function parseDleSearchResults(html, addResult) {
  if (!html) return;
  var seen = new Set();

  function safeAdd(title, href) {
    if (!href) return;
    var normHref = href.toLowerCase();
    if (seen.has(normHref)) return;
    seen.add(normHref);
    addResult(title, href);
  }

  // 1. Articles dans short-title ou h2
  var regexItem = /<div class=["'][^"']*(?:short-title|title|news-title)[^"']*["'][^>]*>\s*<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = regexItem.exec(html)) !== null) {
    var t = m[2].replace(/<[^>]+>/g, '').trim();
    safeAdd(t, m[1]);
  }

  // 2. Liens vers fiches articles DLE (ex: /exclue/975--1onfepiefcffezzfafghb.html ou /anime/...)
  var regexLink = /<a[^>]+href=["']((?:https?:\/\/[^"'>]+)?(?:\/[^"'>]+)?\/\d+--?[^"'>]+\.html)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = regexLink.exec(html)) !== null) {
    var href = m[1];
    var title = m[2].replace(/<[^>]+>/g, '').trim();
    if (title && title.length > 2 && !title.toLowerCase().includes('lire la suite')) {
      safeAdd(title, href);
    }
  }
}

// ── Score de Correspondance ──────────────────────────────────────────────────

function scoreMatch(ficheTitle, searchTitle, season) {
  var fNorm = normalizeText(ficheTitle);
  var sNorm = normalizeText(searchTitle);
  if (!fNorm || !sNorm) return 0;
  if (!fNorm.includes(sNorm)) return 0;

  var score = 50;
  if (fNorm.startsWith(sNorm)) score += 20;

  // Prise en compte de la saison
  if (season && season > 1) {
    var seasonPattern = new RegExp('(?:saison|season|s)\\s*0*' + season + '\\b', 'i');
    if (seasonPattern.test(ficheTitle)) score += 30;
    else score -= 20;
  } else if (season === 1) {
    if (/\b(?:saison|season|s)\s*0*1\b/i.test(ficheTitle)) score += 15;
    if (!/\b(?:saison|season|s)\s*[2-9]\b/i.test(ficheTitle)) score += 10;
  }

  return score;
}

// ── Extraction des Liens d'Épisodes & Sibnet sur une Fiche ───────────────────

function extractEpisodeSibnetUrls(html, targetEpisode) {
  if (!html) return [];
  var candidates = [];
  var epNum = parseInt(targetEpisode, 10) || 1;
  var seenVideoIds = new Set();

  function addCandidate(videoId, ep) {
    if (!videoId || seenVideoIds.has(videoId)) return;
    seenVideoIds.add(videoId);
    candidates.push({
      videoId: videoId,
      url: 'https://video.sibnet.ru/shell.php?videoid=' + videoId,
      ep: ep
    });
  }

  function parseEpNum(text) {
    if (!text) return null;
    var m = text.match(/(?:episode|épisode|ep)\s*0*(\d+)/i) || text.match(/^\s*0*(\d+)\s*$/);
    return m ? parseInt(m[1], 10) : null;
  }

  // 1. Analyse balise par balise : <a>, <button>, <option>
  var tagRegex = /<(a|button|option)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  var tm;
  while ((tm = tagRegex.exec(html)) !== null) {
    var attrs = tm[2];
    var content = tm[3].replace(/<[^>]+>/g, '').trim();
    var sibMatch = (attrs + ' ' + content).match(/(?:video\.)?sibnet\.ru\/shell\.php\?videoid=(\d+)/i);
    if (!sibMatch) continue;
    var vid = sibMatch[1];
    var epParsed = parseEpNum(content) || parseEpNum(attrs);
    if (epParsed === epNum) {
      addCandidate(vid, epParsed);
    }
  }

  // 2. Cas des listes séquentielles d'IDs Sibnet (One Piece / animés fleuves)
  if (candidates.length === 0) {
    var allSibnetIds = [];
    var regexAll = /(?:video\.)?sibnet\.ru\/shell\.php\?videoid=(\d+)/gi;
    var sm;
    var seenSeq = new Set();
    while ((sm = regexAll.exec(html)) !== null) {
      var id = sm[1];
      if (!seenSeq.has(id)) {
        seenSeq.add(id);
        allSibnetIds.push(id);
      }
    }

    var targetIdx = epNum - 1;
    if (allSibnetIds.length > 0 && targetIdx >= 0 && targetIdx < allSibnetIds.length) {
      addCandidate(allSibnetIds[targetIdx], epNum);
    }
  }

  return candidates;
}

// ── Résolveur Sibnet (video.sibnet.ru -> Direct MP4) ─────────────────────────

async function resolveSibnet(sibnetUrlOrId) {
  var url = sibnetUrlOrId;
  if (/^\d+$/.test(sibnetUrlOrId)) {
    url = 'https://video.sibnet.ru/shell.php?videoid=' + sibnetUrlOrId;
  } else if (url.startsWith('//')) {
    url = 'https:' + url;
  }

  try {
    var res = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': UA,
        'Referer': 'https://video.sibnet.ru/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    }, 6000);

    if (res && res.ok) {
      var html = await res.text();
      // Extraction souple et robuste de l'URL du fichier MP4
      var match = html.match(/["']?file["']?\s*:\s*["']([^"']*\.mp4[^"']*)["']/i)
               || html.match(/["']?src["']?\s*:\s*["']([^"']*\.mp4[^"']*)["']/i)
               || html.match(/player\.src\(\s*\[\s*\{[^}]*?["']?src["']?\s*:\s*["']([^"']+\.mp4[^"']*)["']/i)
               || html.match(/["']((?:https?:)?(?:\/[^"'\s]+)?\/videocdn\/[^"'\s]+\.mp4[^"'\s]*)["']/i)
               || html.match(/["']((?:https?:)?\/\/[^"'\s]+\.mp4[^"'\s]*)["']/i);

      if (match) {
        var directUrl = match[1];
        if (directUrl.startsWith('//')) directUrl = 'https:' + directUrl;
        else if (directUrl.startsWith('/')) directUrl = 'https://video.sibnet.ru' + directUrl;

        return {
          url: directUrl,
          headers: {
            'Referer': 'https://video.sibnet.ru/',
            'User-Agent': UA
          },
          isDirect: true
        };
      }
    }
  } catch (err) {}

  // Fallback si la résolution directe est bloquée ou échoue
  return {
    url: url,
    headers: {
      'Referer': 'https://video.sibnet.ru/',
      'User-Agent': UA
    },
    isDirect: false
  };
}

// ── Construction des StreamObjects ───────────────────────────────────────────

function createStreamObject(animeTitle, season, episode, lang, quality, resolved) {
  var langUpper = (lang || 'VF').toUpperCase();
  var langIcon = langUpper.includes('VOST') ? '🔡' : '🇫🇷';
  var langTag = langUpper.includes('VOST') ? 'VOSTFR' : 'VF';
  var qual = quality || '720p';

  var epLabel = 'S' + (season < 10 ? '0' + season : season) + 'E' + (episode < 10 ? '0' + episode : episode);
  var streamTitle = langIcon + ' [' + langTag + '] ' + animeTitle + ' ' + epLabel + ' [Sibnet] - ' + qual;

  return {
    name: 'French Anime (' + langTag + ')',
    title: streamTitle,
    url: resolved.url,
    quality: qual,
    language: langUpper.includes('VOST') ? 'fr' : 'fr',
    type: 'mp4',
    headers: resolved.headers || {
      'Referer': 'https://video.sibnet.ru/',
      'User-Agent': UA
    }
  };
}

// ── Contrat d'Interface getStreams ───────────────────────────────────────────

/**
 * Recherche et résout les flux vidéo d'animés pour Nuvio / Stremio.
 * @param {string|number} tmdbId - Identifiant TMDB de l'animé (ex: 37854 pour One Piece)
 * @param {'movie'|'tv'} mediaType - Type de média ('tv' pour série, 'movie' pour film)
 * @param {number} [season=1] - Numéro de la saison
 * @param {number} [episode=1] - Numéro de l'épisode
 * @returns {Promise<Array<StreamObject>>}
 */
async function getStreams(tmdbId, mediaType, season, episode) {
  var s = parseInt(season, 10) || 1;
  var e = parseInt(episode, 10) || 1;
  var type = mediaType === 'movie' ? 'movie' : 'tv';

  try {
    // 1. Récupération des titres TMDB (Français & Original)
    var titles = await getTmdbTitles(tmdbId, type);
    var mainTitle = titles[0] || 'Anime';

    // 2. Recherche sur French Anime pour chaque titre identifié
    var searchPromises = titles.map(function(t) { return searchFrenchAnime(t); });
    var searchSettled = await Promise.allSettled(searchPromises);

    var allResults = [];
    var seenFicheUrls = new Set();
    for (var i = 0; i < searchSettled.length; i++) {
      if (searchSettled[i].status === 'fulfilled') {
        var batch = searchSettled[i].value;
        for (var j = 0; j < batch.length; j++) {
          var item = batch[j];
          if (!seenFicheUrls.has(item.url)) {
            seenFicheUrls.add(item.url);
            item.score = scoreMatch(item.title, titles[i], s);
            allResults.push(item);
          }
        }
      }
    }

    if (allResults.length === 0) return [];

    // Trier les fiches candidates par score décroissant
    allResults.sort(function(a, b) { return b.score - a.score; });
    var topFiches = allResults.slice(0, 3);

    // 3. Scraping des fiches candidates pour extraire les embeds Sibnet
    var streams = [];
    var seenStreamUrls = new Set();

    for (var f = 0; f < topFiches.length; f++) {
      var fiche = topFiches[f];
      try {
        var resFiche = await fetchWithTimeout(fiche.url, {
          headers: Object.assign({}, STEALTH_HEADERS, { 'Referer': BASE_URL + '/' })
        }, 6000);

        if (!resFiche.ok) continue;
        var ficheHtml = await resFiche.text();

        var epCandidates = extractEpisodeSibnetUrls(ficheHtml, e);
        if (epCandidates.length === 0) continue;

        // Déterminer la langue de la fiche (VF ou VOSTFR)
        var ficheLang = fiche.lang;
        if (ficheLang === 'multi') {
          if (/\bvf\b/i.test(fiche.title)) ficheLang = 'vf';
          else if (/\bvostfr\b/i.test(fiche.title)) ficheLang = 'vostfr';
          else ficheLang = 'vf';
        }

        // 4. Résolution Sibnet en parallèle
        var resolvePromises = epCandidates.map(function(c) { return resolveSibnet(c.url); });
        var resolvedResults = await Promise.allSettled(resolvePromises);

        for (var r = 0; r < resolvedResults.length; r++) {
          if (resolvedResults[r].status === 'fulfilled') {
            var resObj = resolvedResults[r].value;
            if (resObj && resObj.url && !seenStreamUrls.has(resObj.url)) {
              seenStreamUrls.add(resObj.url);
              var streamObj = createStreamObject(mainTitle, s, e, ficheLang, '720p', resObj);
              streams.push(streamObj);
            }
          }
        }

        // Si on a trouvé des flux sur la meilleure fiche, on s'arrête
        if (streams.length > 0) break;
      } catch (err) {}
    }

    return streams;
  } catch (globalErr) {
    console.error('[French-Anime] getStreams error:', globalErr.message || globalErr);
    return [];
  }
}

// ── Export Universel QuickJS & Node.js CommonJS ──────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getStreams: getStreams,
    _extractEpisodeSibnetUrls: extractEpisodeSibnetUrls,
    _resolveSibnet: resolveSibnet,
    _scoreMatch: scoreMatch,
    _parseDleSearchResults: parseDleSearchResults
  };
} else {
  if (typeof globalThis !== 'undefined') globalThis.getStreams = getStreams;
  if (typeof global !== 'undefined') global.getStreams = getStreams;
}
