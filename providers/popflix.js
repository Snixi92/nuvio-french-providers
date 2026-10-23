// ==============================================================================
// Provider Nuvio : PopFlix (Films & Séries VF - MP4 Directs 1080p Haute Vitesse)
// Compatible QuickJS (Mobile) & Node.js (CommonJS / Vercel Serverless)
// Catalogue : +7 800 Films & +840 Séries indexés directement par TMDB ID
// Domaines : https://popflix.fr / Miroir de secours : https://popflix.space
// ==============================================================================

var DOMAINS = ['https://popflix.fr', 'https://popflix.space'];
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

var cachedToken = null;
var tokenTime = 0;

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
 * Obtient ou renouvelle automatiquement un jeton invité sur PopFlix
 * @returns {Promise<string|null>} Token JWT d'accès
 */
async function getAccessToken() {
  if (cachedToken && (Date.now() - tokenTime) < 3600000) {
    return cachedToken;
  }

  for (var i = 0; i < DOMAINS.length; i++) {
    var base = DOMAINS[i];
    try {
      var rand = Math.random().toString(36).slice(2, 6);
      var now = Date.now();
      var email = 'nuvio_' + now + rand + '@gmail.com';
      var username = 'nuvio_' + now.toString(36).slice(2, 8);
      var password = 'NuvioPass123!#' + now;

      var res = await fetchWithTimeout(base + '/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': UA,
          'Referer': base + '/inscription'
        },
        body: JSON.stringify({ email: email, username: username, password: password })
      }, 5000);

      if (res.ok) {
        var data = await res.json();
        if (data && data.accessToken) {
          cachedToken = data.accessToken;
          tokenTime = Date.now();
          return cachedToken;
        }
      }
    } catch (_) {}
  }

  return cachedToken;
}

/**
 * Résout une redirection éventuelle (301/302) vers le stockage direct (S3/CDN)
 * @param {string} url - URL brute de la source
 * @returns {Promise<string>} URL finale
 */
async function resolveDirectVideoUrl(url) {
  if (!url || !url.startsWith('http')) return url;
  try {
    var res = await fetchWithTimeout(url, {
      method: 'HEAD',
      headers: { 'User-Agent': UA, 'Referer': 'https://popflix.fr/' },
      redirect: 'manual'
    }, 3000);
    if ([301, 302, 307, 308].includes(res.status)) {
      var loc = res.headers.get('location');
      if (loc && loc.startsWith('http')) return loc;
    }
  } catch (_) {}
  return url;
}

/**
 * Récupère les flux vidéo PopFlix pour un film ou un épisode de série
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
  var querySeason = s;
  var queryEpisode = e;
  if (id === '96677') {
    if (s === 4) { querySeason = 3; }
    else if (s === 3) { querySeason = 2; }
    else if (s === 2) { querySeason = 1; queryEpisode = e + 5; }
  }

  if (!id) return [];

  var token = await getAccessToken();
  if (!token) return [];

  for (var i = 0; i < DOMAINS.length; i++) {
    var base = DOMAINS[i];
    try {
      var endpoint = isMovie
        ? base + '/api/catalogue/films/' + id
        : base + '/api/catalogue/series/' + id;

      var res = await fetchWithTimeout(endpoint, {
        headers: {
          'Authorization': 'Bearer ' + token,
          'User-Agent': UA,
          'Referer': base + '/'
        }
      }, 5000);

      if (!res.ok) continue;
      var data = await res.json();

      if (isMovie && data && data.film) {
        var film = data.film;
        var sourceUrl = (film.source && film.source.url) ? film.source.url : film.player;
        if (sourceUrl) {
          var directUrl = await resolveDirectVideoUrl(sourceUrl);
          var qual = (film.source && film.source.quality && film.source.quality !== 'Unknown')
            ? film.source.quality
            : '1080p';
          var size = (film.source && film.source.size) ? ' (' + film.source.size + ')' : '';

          var streamUrl = directUrl;
          if (streamUrl && !streamUrl.includes('.mp4') && !streamUrl.includes('.m3u8')) {
            streamUrl += '#video.mp4';
          }

          streams.push({
            name: 'PopFlix',
            title: '🇫🇷 [VF] ' + (film.title || 'Film') + ' [MP4 Direct] - ' + qual + size,
            url: streamUrl,
            quality: qual,
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
        }
        break;
      } else if (!isMovie && data && data.serie) {
        var serie = data.serie;
        var episodes = serie.episodes || [];
        var ep = null;

        for (var j = 0; j < episodes.length; j++) {
          var item = episodes[j];
          var epNum = parseInt(item.episode_number, 10);
          var sMatch = String(item.season || '').match(/\d+/);
          var sNum = sMatch ? parseInt(sMatch[0], 10) : 1;
          if (sNum === querySeason && epNum === queryEpisode) {
            ep = item;
            break;
          }
        }

        // Fallback CDN si l'épisode est déjà encodé sur le stockage mais pas encore indexé en base
        if (!ep && serie && serie.series_name) {
          var cleanName = serie.series_name.replace(/[^a-zA-Z0-9]/g, '');
          var sPad = querySeason < 10 ? '0' + querySeason : querySeason;
          var ePad = queryEpisode < 10 ? '0' + queryEpisode : queryEpisode;
          var fallbackPath = '/series/VF/' + cleanName + '/S' + sPad + '/' + cleanName + '-S' + sPad + '-E' + ePad + '.mp4';
          var fallbackUrl = 'https://falzey.lol/api/video_proxy.php?file=' + fallbackPath + '&cdn=cdn';
          try {
            var checkRes = await fetchWithTimeout(fallbackUrl, {
              headers: { 'User-Agent': UA, 'Referer': 'https://popflix.fr/', 'Range': 'bytes=0-100' }
            }, 3000);
            if (checkRes && (checkRes.status === 200 || checkRes.status === 206)) {
              ep = { url: fallbackUrl };
            }
          } catch (_) {}
        }

        if (ep && (ep.url || ep.player)) {
          var rawUrl = ep.url || ep.player;
          var directEpUrl = await resolveDirectVideoUrl(rawUrl);
          var epSize = ep.size ? ' (' + ep.size + ')' : '';
          var epTag = 'S' + (s < 10 ? '0' + s : s) + 'E' + (e < 10 ? '0' + e : e);

          var epStreamUrl = directEpUrl;
          if (epStreamUrl && !epStreamUrl.includes('.mp4') && !epStreamUrl.includes('.m3u8')) {
            epStreamUrl += '#video.mp4';
          }

          streams.push({
            name: 'PopFlix',
            title: '🇫🇷 [VF] ' + (serie.series_name || 'Série') + ' ' + epTag + ' [MP4 Direct] - 1080p' + epSize,
            url: epStreamUrl,
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
        }
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
