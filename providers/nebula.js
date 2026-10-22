// ==============================================================================
// Provider Nuvio : Nebula (Films & Séries VF / VO - HLS Multi-Audio 1080p)
// Compatible QuickJS (Mobile) & Node.js (CommonJS / Vercel Serverless)
// Backend : Fluxora / Zenix Direct Embed API
// ==============================================================================

var BASE_EMBED = 'https://fluxora.sbs';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function fetchWithTimeout(url, options, timeoutMs) {
  var ms = timeoutMs || 7000;
  var timer = null;
  var timeoutPromise = new Promise(function(_, reject) {
    timer = setTimeout(function() {
      reject(new Error('Timeout de ' + ms + 'ms sur ' + url));
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

function decodeBase64(str) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'base64').toString('utf-8');
  }
  if (typeof atob !== 'undefined') {
    return atob(str);
  }
  return '';
}

/**
 * Récupère les flux vidéo pour un média donné
 * @param {string|number} tmdbId - Identifiant TMDB
 * @param {string} mediaType - 'movie' ou 'tv'/'series'
 * @param {number} [season=1] - Numéro de saison
 * @param {number} [episode=1] - Numéro d'épisode
 * @param {object} [options] - Options supplémentaires
 * @returns {Promise<Array>} Liste des flux vidéo
 */
async function getStreams(tmdbId, mediaType, season, episode, options) {
  var s = parseInt(season, 10) || 1;
  var e = parseInt(episode, 10) || 1;
  var isMovie = (mediaType === 'movie' || mediaType === 'film');
  var id = String(tmdbId || '').trim();

  if (!id) return [];

  var embedUrl = isMovie
    ? BASE_EMBED + '/embed/zenix?tmdb=' + id + '&type=movie'
    : BASE_EMBED + '/embed/zenix?tmdb=' + id + '&type=tv&season=' + s + '&episode=' + e;

  try {
    // 1. Appel du point d'entrée embed
    var embedRes = await fetchWithTimeout(embedUrl, {
      headers: {
        'User-Agent': UA,
        'Referer': 'https://nebulafr.site/'
      }
    }, 6000);

    console.log('[Nebula] Embed status:', embedRes.status);
    if (!embedRes.ok) {
      console.warn('[Nebula] Embed HTTP error:', embedRes.status);
      return [];
    }
    var embedHtml = await embedRes.text();

    // 2. Extraction du SID de session
    var sidMatch = embedHtml.match(/const\s+SID\s*=\s*["']([^"']+)["']/);
    if (!sidMatch || !sidMatch[1]) {
      console.warn('[Nebula] SID match failed, HTML len:', embedHtml.length, embedHtml.slice(0, 300));
      return [];
    }
    var sid = sidMatch[1];
    console.log('[Nebula] SID extracted:', sid);

    // 3. Appel API pour déclencher la lecture
    var playData = null;
    for (var attempt = 0; attempt < 2; attempt++) {
      var playRes = await fetchWithTimeout(BASE_EMBED + '/api/embed-player/play', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': UA,
          'Referer': embedUrl,
          'Origin': BASE_EMBED
        },
        body: JSON.stringify({
          sid: sid,
          lang: 'vf',
          embed_mobile: 0
        })
      }, 5000);

      console.log('[Nebula] Play status (attempt ' + attempt + '):', playRes.status);
      if (!playRes.ok) break;
      playData = await playRes.json();
      console.log('[Nebula] PlayData ok:', playData && playData.ok, 'error:', playData && playData.error);

      if (playData && playData.ok && playData.stream_url) {
        break;
      }

      // Si le serveur prépare le flux (warming), courte attente
      if (playData && playData.error === 'warming' && attempt === 0) {
        await new Promise(function(r) { setTimeout(r, 1200); });
      } else {
        break;
      }
    }

    if (!playData || !playData.ok || !playData.stream_url) {
      console.warn('[Nebula] Play failed or no stream_url:', JSON.stringify(playData));
      return [];
    }

    // 4. Récupération de la page de lecture et extraction du token HLS chiffré
    var streamRes = await fetchWithTimeout(playData.stream_url, {
      headers: {
        'User-Agent': UA,
        'Referer': BASE_EMBED + '/'
      }
    }, 6000);

    console.log('[Nebula] Stream page status:', streamRes.status);
    if (!streamRes.ok) {
      console.warn('[Nebula] Stream page failed:', streamRes.status);
      return [];
    }
    var streamHtml = await streamRes.text();

    var encMatch = streamHtml.match(/id=["']encrypted-source["'][^>]*value=["']([^"']+)["']/i)
      || streamHtml.match(/value=["']([^"']+)["'][^>]*id=["']encrypted-source["']/i);

    if (!encMatch || !encMatch[1]) {
      console.warn('[Nebula] Encrypted source not found in streamHtml (len ' + streamHtml.length + ')');
      return [];
    }
    var m3u8Url = decodeBase64(encMatch[1]);
    console.log('[Nebula] Decoded m3u8:', m3u8Url ? m3u8Url.slice(0, 50) : null);

    if (!m3u8Url || !m3u8Url.startsWith('http')) return [];

    var epTag = isMovie ? 'Film' : ('S' + s + 'E' + e);
    var hasVo = playData.availability && playData.availability.vo;

    var streams = [];

    // Flux Principal Multi-Audio (VF par défaut avec piste VO incluse dans le manifest HLS)
    streams.push({
      name: 'Nebula',
      title: '🇫🇷 [VF' + (hasVo ? '/VO Multi' : '') + '] ' + epTag + ' [HLS Multi-Audio] - 1080p',
      url: m3u8Url,
      quality: '1080p',
      language: 'fr',
      type: 'hls',
      headers: {
        'User-Agent': UA,
        'Referer': BASE_EMBED + '/'
      }
    });

    return streams;
  } catch (err) {
    return [];
  }
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
