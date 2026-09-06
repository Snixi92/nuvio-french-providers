// =============================================================
// Provider Nuvio : Purstream.ac (VF/VOSTFR/MULTI)
// Version : 5.3.0 — Fix status HTTP + Accept-Encoding sans brotli
//           + suppression mutation globale + detectDomain via httpsGetJson
// =============================================================

var https = require('https');
var zlib = require('zlib');

var DOMAINS_URL_HOST = 'raw.githubusercontent.com';
var DOMAINS_URL_PATH = '/Snixi92/nuvio-french-providers/main/domains.json';
var PURSTREAM_FALLBACK_TLD = 'ac';
var PURSTREAM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
var TMDB_KEY = 'f3d757824f08ea2cff45eb8f47ca3a1e';

var _cachedEndpoint = null;

// ── Helper : requête HTTPS via le module natif ─────────────────────────────
// FIX Bug 1 : res.statusCode est vérifié → rejet immédiat si ≠ 200
// FIX Bug 2 : Accept-Encoding sans 'br' → évite le brotli instable sur Render
function httpsGetJson(url, extraHeaders) {
  return new Promise(function(resolve, reject) {
    var u;
    try { u = new URL(url); } catch (e) { return reject(new Error('Invalid URL: ' + url)); }

    var referer = 'https://purstream.' + PURSTREAM_FALLBACK_TLD + '/';
    var origin = referer.replace(/\/$/, '');

    var options = {
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      method: 'GET',
      headers: Object.assign({
        'User-Agent': PURSTREAM_UA,
        'Referer': referer,
        'Origin': origin,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
        // FIX Bug 2 : 'br' retiré — brotli instable sur certaines versions Node de Render
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'Host': u.hostname
      }, extraHeaders || {})
    };

    var req = https.request(options, function(res) {
      var chunks = [];
      var encoding = (res.headers['content-encoding'] || '').toLowerCase();

      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        var buf = Buffer.concat(chunks);

        // FIX Bug 1 : vérification du status HTTP avant tout décodage
        if (res.statusCode !== 200) {
          var preview = '';
          try { preview = buf.toString('utf8').slice(0, 200); } catch (_) {}
          return reject(new Error(
            '[Purstream] HTTP ' + res.statusCode + ' sur ' + url + ' — ' + preview
          ));
        }

        function parseBody(body) {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error('[Purstream] JSON invalide: ' + body.slice(0, 120))); }
        }

        if (encoding === 'gzip') {
          zlib.gunzip(buf, function(err, decoded) {
            if (err) return reject(new Error('[Purstream] gzip decode error: ' + err.message));
            parseBody(decoded.toString('utf8'));
          });
        } else if (encoding === 'deflate') {
          zlib.inflate(buf, function(err, decoded) {
            if (err) return reject(new Error('[Purstream] deflate decode error: ' + err.message));
            parseBody(decoded.toString('utf8'));
          });
        } else {
          parseBody(buf.toString('utf8'));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, function() { req.destroy(new Error('[Purstream] timeout réseau')); });
    req.end();
  });
}

// ── Détection du domaine Purstream via httpsGetJson ────────────────────────
// FIX Bug 4 : utilise httpsGetJson (headers browser-like) au lieu de fetch()
//             pour que la requête GitHub ne soit pas bloquée côté Cloudflare
function detectPurstreamDomain() {
  if (_cachedEndpoint) return Promise.resolve(_cachedEndpoint);
  return httpsGetJson('https://' + DOMAINS_URL_HOST + DOMAINS_URL_PATH)
    .then(function(data) {
      var tld = (data && data.purstream) ? data.purstream : PURSTREAM_FALLBACK_TLD;
      _cachedEndpoint = {
        api: 'https://api.purstream.' + tld + '/api/v1',
        referer: 'https://purstream.' + tld + '/'
      };
      return _cachedEndpoint;
    })
    .catch(function(e) {
      console.warn('[Purstream] detectDomain fallback:', e.message);
      return {
        api: 'https://api.purstream.' + PURSTREAM_FALLBACK_TLD + '/api/v1',
        referer: 'https://purstream.' + PURSTREAM_FALLBACK_TLD + '/'
      };
    });
}

// ── Helpers TMDB (fetch global, pas derrière Cloudflare) ───────────────────
function getTmdbDetails(tmdbId, type) {
  var url = 'https://api.themoviedb.org/3/' + (type === 'tv' ? 'tv' : 'movie') + '/' + tmdbId + '?api_key=' + TMDB_KEY + '&language=en-US';
  return fetch(url).then(function(res) { return res.json(); }).then(function(data) {
    var date = data.release_date || data.first_air_date || '';
    return {
      enName: data.title || data.name || 'Purstream',
      year: date ? date.split('-')[0] : '',
      duration: (type === 'movie' && data.runtime) ? data.runtime + ' min'
        : (type === 'tv' && data.episode_run_time && data.episode_run_time.length > 0 ? data.episode_run_time[0] + ' min' : '')
    };
  }).catch(function() { return { enName: 'Purstream', year: '', duration: '' }; });
}

function getEpisodeInfo(tmdbId, season, episode) {
  if (!tmdbId || !season || !episode) return Promise.resolve(null);
  var url = 'https://api.themoviedb.org/3/tv/' + tmdbId + '/season/' + season + '/episode/' + episode + '?api_key=' + TMDB_KEY + '&language=en-US';
  return fetch(url).then(function(res) { return res.json(); }).then(function(data) {
    return { name: data.name || null, duration: data.runtime ? data.runtime + ' min' : null };
  }).catch(function() { return null; });
}

function getTmdbSearchMeta(tmdbId, mediaType) {
  var type = mediaType === 'tv' ? 'tv' : 'movie';
  var url = 'https://api.themoviedb.org/3/' + type + '/' + tmdbId + '?language=fr-FR&api_key=' + TMDB_KEY;
  return fetch(url).then(function(res) { return res.json(); }).then(function(data) {
    return {
      fr: data.title || data.name,
      orig: data.original_title || data.original_name,
      year: extractYear(data.release_date || data.first_air_date)
    };
  });
}

// ── Utilitaires ────────────────────────────────────────────────────────────
function buildPurstreamTitle(meta, res, lang, format, season, episode, epInfo) {
  var qIcon = (res.includes('2160') || res.includes('4K')) ? '💎' : '📺';
  var lIcon = '🇫🇷';
  var displayLang = 'VF';
  var check = (lang || '').toUpperCase();
  if (check.indexOf('MULTI') !== -1) { lIcon = '🌍'; displayLang = 'MULTI'; }
  else if (check.indexOf('VOST') !== -1) { lIcon = '🔡'; displayLang = 'VOSTFR'; }
  var line1 = '🎬 ';
  if (season && episode) {
    line1 += 'S' + String(season).padStart(2, '0') + ' E' + String(episode).padStart(2, '0') + (epInfo && epInfo.name ? ' - ' + epInfo.name : '') + ' | ' + meta.enName;
  } else {
    line1 += meta.enName + (meta.year ? ' - ' + meta.year : '');
  }
  var columns = [qIcon + ' ' + res, lIcon + ' ' + displayLang, '🎞️ ' + (format || 'M3U8').toUpperCase()];
  var finalDur = (epInfo && epInfo.duration) ? epInfo.duration : meta.duration;
  if (finalDur) columns.push('⏱️ ' + finalDur);
  return line1 + '\n' + columns.join(' | ');
}

function cleanTitle(s) {
  if (!s) return '';
  return s.toLowerCase()
    .replace(/[àáâãäå]/g, 'a').replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o').replace(/[ùúûü]/g, 'u')
    .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function extractYear(dateStr) {
  if (!dateStr) return null;
  var m = String(dateStr).match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}

// ── Recherche Purstream ─────────────────────────────────────────────────────
// FIX Bug 3 : endpoint passé en paramètre, plus de mutation de globales
function findPurstreamIdByTitle(title, mediaType, tmdbYear, endpoint) {
  var encoded = encodeURIComponent(title);
  return httpsGetJson(endpoint.api + '/search-bar/search/' + encoded, {
    'Referer': endpoint.referer,
    'Origin': endpoint.referer.replace(/\/$/, ''),
    'Host': new URL(endpoint.api).hostname
  }).then(function(data) {
    var items = data.data && data.data.items && data.data.items.movies && data.data.items.movies.items
      ? data.data.items.movies.items : [];
    if (items.length === 0) throw new Error('[Purstream] Not found: ' + title);
    var cleanTarget = cleanTitle(title);
    var match = items.find(function(item) {
      var purYear = extractYear(item.release_date);
      return cleanTitle(item.title) === cleanTarget && (Math.abs(tmdbYear - purYear) <= 1 || !tmdbYear);
    }) || items[0];
    return match.id;
  });
}

function fetchSheet(purstreamId, endpoint) {
  return httpsGetJson(endpoint.api + '/media/' + purstreamId + '/sheet', {
    'Referer': endpoint.referer,
    'Origin': endpoint.referer.replace(/\/$/, ''),
    'Host': new URL(endpoint.api).hostname
  }).then(function(data) {
    if (!data.data || !data.data.items) return [];
    return data.data.items.urls || [];
  });
}

function filterEpisodeUrls(urls, season, episode) {
  var s = parseInt(season, 10) || 1;
  var e = parseInt(episode, 10) || 1;
  var pattern = new RegExp('/S' + s + '/E' + e + '/', 'i');
  var filtered = urls.filter(function(item) { return item.url && pattern.test(item.url); });
  return filtered.length > 0 ? filtered : [];
}

function parseLang(name) {
  var n = (name || '').toUpperCase();
  if (n.indexOf('VOSTFR') !== -1) return 'VOSTFR';
  if (n.indexOf('VF') !== -1 && n.indexOf('MULTI') === -1) return 'VF';
  if (n.indexOf('MULTI') !== -1) return 'MULTI';
  return 'VF';
}

function parseQuality(name, url) {
  var n = (name || '').toUpperCase();
  var u = (url || '').toLowerCase();
  if (n.indexOf('4K') !== -1 || n.indexOf('2160') !== -1) return '4K';
  if (n.indexOf('1080') !== -1) return '1080p';
  if (n.indexOf('720') !== -1) return '720p';
  if (n.indexOf('480') !== -1) return '480p';
  if (u.indexOf('1080') !== -1) return '1080p';
  if (u.indexOf('720') !== -1) return '720p';
  if (n.indexOf('PREMIUM') !== -1 || u.indexOf('premium') !== -1) return '1080p';
  if (n.indexOf('FREE') !== -1 || u.indexOf('free') !== -1) return '720p';
  return 'HD';
}

function normalizeUrls(urls, meta, season, episode, epInfo, endpoint) {
  return urls
    .filter(function(item) { return item.url && (item.url.match(/\.m3u8/i) || item.url.match(/\.mp4/i)); })
    .map(function(item) {
      var q = parseQuality(item.name, item.url);
      var lang = parseLang(item.name);
      var fmt = item.url.match(/\.mp4/i) ? 'mp4' : 'm3u8';
      return {
        name: 'Purstream - ' + q + ' ' + lang,
        title: buildPurstreamTitle(meta, q, lang, fmt, season, episode, epInfo),
        url: item.url,
        quality: q,
        format: fmt,
        headers: { 'User-Agent': PURSTREAM_UA, 'Referer': endpoint.referer }
      };
    });
}

// ── Point d'entrée principal ────────────────────────────────────────────────
function getStreams(tmdbId, mediaType, season, episode) {
  return Promise.all([
    getTmdbDetails(tmdbId, mediaType),
    mediaType === 'tv' ? getEpisodeInfo(tmdbId, season, episode) : Promise.resolve(null),
    detectPurstreamDomain(),
    getTmdbSearchMeta(tmdbId, mediaType)
  ]).then(function(results) {
    var meta = results[0];
    var epInfo = results[1];
    var endpoint = results[2]; // FIX Bug 3 : endpoint local, plus de mutation globale
    var search = results[3];

    // Essai titre FR, puis titre original si introuvable
    return findPurstreamIdByTitle(search.fr, mediaType, search.year, endpoint)
      .catch(function() {
        return findPurstreamIdByTitle(search.orig, mediaType, search.year, endpoint);
      })
      .then(function(purstreamId) {
        return fetchSheet(purstreamId, endpoint).then(function(urls) {
          if (mediaType === 'tv') {
            var epUrls = filterEpisodeUrls(urls, season, episode);
            return normalizeUrls(epUrls, meta, season, episode, epInfo, endpoint);
          } else {
            return normalizeUrls(urls, meta, null, null, null, endpoint);
          }
        });
      });
  }).catch(function(e) {
    var msg = e && (e.message || String(e)) || 'unknown';
    console.warn('[Purstream] getStreams error:', msg);
    return [];
  });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { getStreams: getStreams };
else {
  if (typeof globalThis !== 'undefined') globalThis.getStreams = getStreams;
  if (typeof global !== 'undefined') global.getStreams = getStreams;
}
