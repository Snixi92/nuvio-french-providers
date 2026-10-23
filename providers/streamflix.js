// ==============================================================================
// Provider Nuvio : StreamFlix (Films & Séries VF - MP4 Directs 1080p Haute Vitesse)
// Compatible QuickJS (Mobile) & Node.js (CommonJS / Vercel Serverless)
// Catalogue : +7 880 Films & +850 Séries indexés directement par TMDB ID
// Domaines : https://stream-flix.lol / Miroir : https://streamflix.mom
// ==============================================================================

var DOMAINS = ['https://stream-flix.lol', 'https://streamflix.mom'];
var CDN_HOST = 'cdn78.vida-loka.store';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function fetchWithTimeout(url, options, timeoutMs) {
  var ms = timeoutMs || 5000;
  var timer = null;
  var timeoutPromise = new Promise(function(_, reject) {
    timer = setTimeout(function() {
      reject(new Error('Timeout ' + ms + 'ms sur ' + url));
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

/**
 * Réécrit les domaines de stockage temporaires vers le CDN direct haute vitesse
 * @param {string} rawUrl - URL brute retournée par l'API
 * @returns {string} URL réécrite et optimisée
 */
function normalizeCdnUrl(rawUrl) {
  if (!rawUrl || !rawUrl.startsWith('http')) return rawUrl;
  try {
    var u = new URL(rawUrl);
    var host = u.hostname.toLowerCase();
    var targets = [
      'zen-blk.store',
      'fastflux.xyz',
      'fastflux.top',
      'deliciouss.lol',
      'drinkoflix.lol',
      'edge-n2.site',
      'blink-n3.site',
      'frederic-ntgm.site',
      'vida-loka.store',
      'embedo.lol'
    ];
    var isTarget = targets.some(function(t) { return host === t || host.endsWith('.' + t); });
    if (isTarget) {
      return 'https://' + CDN_HOST + u.pathname + u.search + u.hash;
    }
  } catch (_) {}
  return rawUrl;
}

/**
 * Récupère les flux vidéo StreamFlix pour un film ou une série
 * @param {string|number} tmdbId - Identifiant TMDB
 * @param {string} mediaType - 'movie' ou 'tv'/'series'
 * @param {number} [season=1] - Numéro de saison
 * @param {number} [episode=1] - Numéro d'épisode
 * @param {object} [options] - Options supplémentaires
 * @returns {Promise<Array>} Liste des flux vidéo
 */
async function getStreams(tmdbId, mediaType, season, episode, options) {
  var id = String(tmdbId || '').trim();
  var isMovie = (mediaType === 'movie' || mediaType === 'film');
  var s = parseInt(season, 10) || 1;
  var e = parseInt(episode, 10) || 1;
  var streams = [];

  // Correction de correspondance de saison (ex: Lupin TMDB 96677)
  // Sur TMDB / CDN, la Partie 4 sortie aujourd'hui est répertoriée en Saison 3 (8 épisodes)
  // car TMDB a regroupé les Parties 1 & 2 dans la Saison 1.
  var querySeason = s;
  var queryEpisode = e;
  if (id === '96677') {
    if (s === 4) { querySeason = 3; }
    else if (s === 3) { querySeason = 2; }
    else if (s === 2) { querySeason = 1; queryEpisode = e + 5; }
  }

  if (!id) return [];

  var sessionId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'sf_' + Date.now() + Math.random().toString(36).slice(2, 10);

  for (var i = 0; i < DOMAINS.length; i++) {
    var base = DOMAINS[i];
    try {
      var endpoint = isMovie
        ? base + '/api/movies/' + id + '/video-url'
        : base + '/api/series/' + id + '/season/' + querySeason + '/episode/' + queryEpisode + '/video-url';

      var res = await fetchWithTimeout(endpoint, {
        headers: {
          'User-Agent': UA,
          'Referer': base + '/',
          'Origin': base,
          'X-Play-Session': sessionId
        }
      }, 5000);

      if (!res.ok) continue;
      var data = await res.json();
      var rawUrl = data.directUrl || data.url;

      if (rawUrl && typeof rawUrl === 'string' && rawUrl.startsWith('http')) {
        // Ignorer les partenaires avec clé manquante si besoin
        if (rawUrl.includes('watch.scoope.fr') && !rawUrl.includes('api_key=')) {
          continue;
        }

        var finalUrl = normalizeCdnUrl(rawUrl);
        if (!finalUrl.includes('.mp4') && !finalUrl.includes('.m3u8')) {
          finalUrl += '#video.mp4';
        }

        // Vérification immédiate que le fichier existe bien sur le CDN (évite les fausses URLs 404 sur saisons non uploadées)
        try {
          var probeRes = await fetchWithTimeout(finalUrl, {
            method: 'HEAD',
            headers: {
              'User-Agent': UA,
              'Referer': base + '/'
            }
          }, 3000);
          if (probeRes && (probeRes.status === 404 || probeRes.status === 403 || probeRes.status === 410)) {
            console.log('[StreamFlix] Fichier non disponible sur CDN (HTTP ' + probeRes.status + ') : ' + finalUrl.slice(0, 60));
            continue;
          }
        } catch (probeErr) {
          console.log('[StreamFlix] Échec vérification CDN (' + probeErr.message + ') : ' + finalUrl.slice(0, 60));
          continue;
        }

        var epTag = isMovie ? 'Film' : ('S' + (s < 10 ? '0' + s : s) + 'E' + (e < 10 ? '0' + e : e));

        streams.push({
          name: 'StreamFlix',
          title: '🇫🇷 [VF] ' + epTag + ' [MP4 Direct] - 1080p',
          url: finalUrl,
          quality: '1080p',
          language: 'fr',
          type: 'mp4',
          headers: {
            'User-Agent': UA,
            'Referer': base + '/'
          },
          behaviorHints: {
            proxyHeaders: {
              request: {
                'User-Agent': UA,
                'Referer': base + '/'
              }
            }
          }
        });
        break;
      }
    } catch (_) {}
  }

  return streams;
}

// ── Export Universel (QuickJS & Node.js) ───────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getStreams: getStreams
  };
} else {
  if (typeof globalThis !== 'undefined') globalThis.getStreams = getStreams;
  if (typeof global !== 'undefined') global.getStreams = getStreams;
}
