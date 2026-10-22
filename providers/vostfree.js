// ==============================================================================
// Provider Nuvio : VostFree (Animes VF & VOSTFR)
// Compatible QuickJS (Mobile) & Node.js (CommonJS)
// ==============================================================================

var BASE_URL = 'https://ipv4.vostfree.ws';
var TMDB_KEY = 'f3d757824f08ea2cff45eb8f47ca3a1e';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function fetchWithTimeout(url, options, timeoutMs) {
  var ms = timeoutMs || 7000;
  var timer = null;
  var timeoutPromise = new Promise(function(_, reject) {
    timer = setTimeout(function() {
      reject(new Error('Timeout de ' + ms + 'ms dépassé sur ' + url));
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

function normalize(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Résolution TMDB ──────────────────────────────────────────────────────────

async function getAnimeTitlesFromTMDB(tmdbId, mediaType) {
  var type = (mediaType === 'tv' || mediaType === 'serie' || mediaType === 'series') ? 'tv' : 'movie';
  var titles = [];

  try {
    var resFr = await fetchWithTimeout(
      'https://api.themoviedb.org/3/' + type + '/' + tmdbId + '?api_key=' + TMDB_KEY + '&language=fr-FR',
      null,
      4000
    );
    if (resFr && resFr.ok) {
      var dataFr = await resFr.json();
      var tFr = dataFr.name || dataFr.title;
      var oFr = dataFr.original_name || dataFr.original_title;
      if (tFr) titles.push(tFr);
      if (oFr && oFr !== tFr) titles.push(oFr);
    }
  } catch (_) {}

  if (titles.length === 0) {
    try {
      var resEn = await fetchWithTimeout(
        'https://api.themoviedb.org/3/' + type + '/' + tmdbId + '?api_key=' + TMDB_KEY + '&language=en-US',
        null,
        4000
      );
      if (resEn && resEn.ok) {
        var dataEn = await resEn.json();
        var tEn = dataEn.name || dataEn.title;
        if (tEn) titles.push(tEn);
      }
    } catch (_) {}
  }

  return [...new Set(titles)];
}

// ── Recherche sur VostFree ───────────────────────────────────────────────────

async function searchVostfree(query) {
  var clean = query.replace(/\s+(?:Season|Saison|Part|Cour|Arc)\s+\d+.*$/i, '').trim();
  var body = new URLSearchParams({
    do: 'search',
    subaction: 'search',
    story: clean,
    search_start: '1',
    full_search: '0',
    result_from: '1'
  });

  try {
    var res = await fetchWithTimeout(BASE_URL + '/index.php?do=search', {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': BASE_URL + '/'
      },
      body: body.toString()
    }, 6000);

    if (!res.ok) return [];
    var html = await res.text();

    var linkRegex = /<a[^>]+href="(https?:\/\/ipv4\.vostfree\.ws\/(\d+)-[^"]+\.html)"[^>]*>(.*?)<\/a>/gi;
    var results = [];
    var seen = new Set();
    var m;

    while ((m = linkRegex.exec(html)) !== null) {
      var url = m[1];
      var rawTitle = m[3].replace(/<[^>]+>/g, '').trim();
      if (!seen.has(url) && rawTitle.length > 2) {
        seen.add(url);
        var isVf = /FRENCH|VF\b/i.test(rawTitle);
        var isVostfr = /VOSTFR/i.test(rawTitle);
        results.push({
          url: url,
          title: rawTitle,
          lang: isVf ? 'VF' : (isVostfr ? 'VOSTFR' : 'MULTI')
        });
      }
    }

    return results;
  } catch (err) {
    return [];
  }
}

// ── Extraction des Players pour un Épisode ────────────────────────────────────

function extractEpisodePlayers(html, targetEpisode) {
  var epNum = parseInt(targetEpisode, 10) || 1;
  var boxTarget = 'id="buttons_' + epNum + '"';

  var idx = html.indexOf(boxTarget);
  if (idx === -1) {
    // Si boutons non trouvés par numéro, essayer le premier bouton (films / OAV)
    idx = html.indexOf('id="buttons_1"');
    if (idx === -1) return [];
  }

  // Extraire la boîte de boutons pour cet épisode
  var endBox = html.indexOf('</div>', idx);
  var boxContent = html.substring(idx, endBox + 500);

  // Trouver tous les player divs : id="player_X" class="new_player_..."
  var playerRegex = /id="(player_\d+)"[^>]*class="new_player_([^"]+)"[^>]*>([^<]*)</gi;
  var players = [];
  var m;

  while ((m = playerRegex.exec(boxContent)) !== null) {
    var pId = m[1];
    var pClass = m[2].toLowerCase();
    var pLabel = m[3].trim() || pClass;

    // Trouver le contenu correspondant dans le DOM : id="content_player_X" ... >VALEUR</div>
    var contentRegex = new RegExp('id="content_' + pId + '"[^>]*>([^<]+)<', 'i');
    var cMatch = html.match(contentRegex);
    if (cMatch && cMatch[1]) {
      var rawVal = cMatch[1].trim();
      players.push({
        type: pClass,
        label: pLabel,
        value: rawVal
      });
    }
  }

  return players;
}

// ── Point d'Entrée Principal ─────────────────────────────────────────────────

async function getStreams(tmdbId, mediaType, season, episode) {
  var s = parseInt(season, 10) || 1;
  var e = parseInt(episode, 10) || 1;

  var titles = await getAnimeTitlesFromTMDB(tmdbId, mediaType);
  if (titles.length === 0) titles = ['Anime ' + tmdbId];

  var allResults = [];
  for (var i = 0; i < titles.length; i++) {
    var res = await searchVostfree(titles[i]);
    if (res.length > 0) {
      allResults = res;
      break;
    }
  }

  if (allResults.length === 0) return [];

  var streams = [];
  var epTag = 'S' + (s < 10 ? '0' + s : s) + 'E' + (e < 10 ? '0' + e : e);

  // Parcourir les 2 meilleures fiches (ex: une en VF, une en VOSTFR)
  for (var j = 0; j < Math.min(allResults.length, 3); j++) {
    var post = allResults[j];

    try {
      var pRes = await fetchWithTimeout(post.url, { headers: { 'User-Agent': UA } }, 5000);
      if (!pRes.ok) continue;
      var pHtml = await pRes.text();

      var players = extractEpisodePlayers(pHtml, e);
      for (var k = 0; k < players.length; k++) {
        var pl = players[k];
        var streamUrl = null;
        var hoster = pl.label || pl.type;

        if (pl.type.includes('sibnet')) {
          streamUrl = 'https://video.sibnet.ru/shell.php?videoid=' + pl.value;
          hoster = 'Sibnet';
        } else if (pl.type.includes('uqload')) {
          streamUrl = pl.value.startsWith('http') ? pl.value : 'https://uqload.to/embed-' + pl.value + '.html';
          hoster = 'Uqload';
        } else if (pl.value.startsWith('http')) {
          streamUrl = pl.value;
        }

        if (streamUrl) {
          var langIcon = post.lang === 'VF' ? '🇫🇷' : '🔡';
          streams.push({
            name: 'VostFree (' + post.lang + ')',
            title: langIcon + ' [' + post.lang + '] ' + titles[0] + ' ' + epTag + ' [' + hoster + '] - 1080p',
            url: streamUrl,
            quality: '1080p',
            language: post.lang === 'VF' ? 'fr' : 'fr',
            type: 'mp4',
            headers: {
              'User-Agent': UA,
              'Referer': BASE_URL + '/'
            }
          });
        }
      }
    } catch (_) {}
  }

  return streams;
}

// ── Export Universel (QuickJS & Node.js) ───────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getStreams: getStreams,
    _searchVostfree: searchVostfree,
    _extractEpisodePlayers: extractEpisodePlayers
  };
} else {
  if (typeof globalThis !== 'undefined') globalThis.getStreams = getStreams;
  if (typeof global !== 'undefined') global.getStreams = getStreams;
}
