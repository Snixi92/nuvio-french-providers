// ==============================================================================
// Provider Nuvio : SouthTV (South Park VF & VO + Films & Spéciaux)
// Compatible QuickJS (Mobile) & Node.js (CommonJS / Vercel Serverless)
// Source : https://www.southtv.fr/
// ==============================================================================

var SOUTH_PARK_TMDB = '2190';
var AMERICAN_DAD_TMDB = '1433';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

var SPECIAL_FILMS = {
  '9473': { title: 'South Park, le film', vf: 'https://southtv.fr/films/Filmsouthpark.mp4', vo: 'https://southtv.info/films/Filmsouthpark.mp4' },
  '969686': { title: 'South Park: The Streaming Wars P1', vf: 'https://southtv.fr/films/streamwar1.mp4', vo: 'https://southtv.info/films/streamwar1.mp4' },
  '996821': { title: 'South Park: The Streaming Wars P2', vf: 'https://southtv.fr/films/streamwar2.mp4', vo: 'https://southtv.info/films/streamwar2.mp4' },
  '1189566': { title: 'South Park: Joining the Panderverse', vf: 'https://southtv.fr/films/pandav.mp4', vo: 'https://southtv.info/films/pandav.mp4' },
  '1289139': { title: 'South Park: The End of Obesity', vf: 'https://southtv.fr/films/obes.mp4', vo: 'https://southtv.info/films/obes.mp4' },
  '874984': { title: 'South Park: Post Covid P1', vf: 'https://southtv.fr/southpark/s24e3.mp4', vo: 'https://southtv.eu/southparkvo/s24e3.mp4' },
  '899082': { title: 'South Park: Post Covid P2', vf: 'https://southtv.fr/southpark/s24e4.mp4', vo: 'https://southtv.eu/southparkvo/s24e4.mp4' }
};

var EPISODES_PER_SEASON = [13,18,17,17,14,17,15,14,14,14,14,14,14,14,14,14,10,10,10,10,10,10,10,2,6,6,5,5,3];

function fetchWithTimeout(url, options, timeoutMs) {
  var ms = timeoutMs || 4000;
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

async function checkUrl(url) {
  try {
    var res = await fetchWithTimeout(url, {
      method: 'HEAD',
      headers: {
        'User-Agent': UA,
        'Referer': 'https://www.southtv.fr/'
      }
    }, 3000);
    console.log('[SouthTV] checkUrl ' + url + ' -> ' + res.status);
    return res.status >= 200 && res.status < 400;
  } catch (e) {
    console.warn('[SouthTV] checkUrl error on ' + url + ': ' + e.message);
    return false;
  }
}

/**
 * Récupère les flux vidéo SouthTV pour South Park et American Dad
 * @param {string|number} tmdbId - Identifiant TMDB
 * @param {string} mediaType - 'tv' ou 'movie'
 * @param {number} [season=1] - Numéro de saison
 * @param {number} [episode=1] - Numéro d'épisode
 * @param {object} [options] - Options supplémentaires
 * @returns {Promise<Array>} Liste des flux vidéo
 */
async function getStreams(tmdbId, mediaType, season, episode, options) {
  var id = String(tmdbId || '').trim();
  var s = parseInt(season, 10) || 1;
  var e = parseInt(episode, 10) || 1;
  var streams = [];

  // 1. Films et spéciaux South Park
  if (SPECIAL_FILMS[id]) {
    var film = SPECIAL_FILMS[id];
    streams.push({
      name: 'SouthTV (VF)',
      title: '🇫🇷 [VF] ' + film.title + ' [MP4 Direct] - 1080p',
      url: film.vf,
      quality: '1080p',
      language: 'fr',
      type: 'mp4',
      headers: { 'User-Agent': UA, 'Referer': 'https://www.southtv.fr/' }
    });

    if (film.vo) {
      streams.push({
        name: 'SouthTV (VO)',
        title: '🇬🇧 [VO] ' + film.title + ' [MP4 Direct] - 1080p',
        url: film.vo,
        quality: '1080p',
        language: 'en',
        type: 'mp4',
        headers: { 'User-Agent': UA, 'Referer': 'https://www.southtv.fr/' }
      });
    }

    return streams;
  }

  // 2. Épisodes de la série South Park (TMDB 2190)
  if (id === SOUTH_PARK_TMDB) {
    if (s >= 1 && s <= EPISODES_PER_SEASON.length && e >= 1 && e <= (EPISODES_PER_SEASON[s - 1] || 25)) {
      var epTag = 'S' + (s < 10 ? '0' + s : s) + 'E' + (e < 10 ? '0' + e : e);
      var vfEp = (s === 27 && e === 4) ? '04' : e;
      var vfUrl = 'https://southtv.fr/southpark/s' + s + 'e' + vfEp + '.mp4';
      var voUrl = 'https://southtv.eu/southparkvo/s' + s + 'e' + e + '.mp4';

      streams.push({
        name: 'SouthTV (VF)',
        title: '🇫🇷 [VF] South Park ' + epTag + ' [MP4 Direct] - 1080p',
        url: vfUrl,
        quality: '1080p',
        language: 'fr',
        type: 'mp4',
        headers: { 'User-Agent': UA, 'Referer': 'https://www.southtv.fr/' }
      });

      streams.push({
        name: 'SouthTV (VO)',
        title: '🇬🇧 [VO] South Park ' + epTag + ' [MP4 Direct] - 1080p',
        url: voUrl,
        quality: '1080p',
        language: 'en',
        type: 'mp4',
        headers: { 'User-Agent': UA, 'Referer': 'https://www.southtv.fr/' }
      });
    }

    return streams;
  }

  // 3. American Dad (TMDB 1433)
  if (id === AMERICAN_DAD_TMDB) {
    var adTag = 'S' + (s < 10 ? '0' + s : s) + 'E' + (e < 10 ? '0' + e : e);
    var adUrl = 'https://southtv.eu/americandad/a' + s + 'd' + e + '.mp4';

    streams.push({
      name: 'SouthTV (VF)',
      title: '🇫🇷 [VF] American Dad ' + adTag + ' [MP4 Direct] - 1080p',
      url: adUrl,
      quality: '1080p',
      language: 'fr',
      type: 'mp4',
      headers: { 'User-Agent': UA, 'Referer': 'https://www.southtv.fr/' }
    });

    return streams;
  }

  return [];
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
