// =============================================================
  // Provider Nuvio : Vstream (VF / VOSTFR / MULTI)
  // Version : 2.0.0 — métadonnées enrichies (durée, nom épisode)
  // =============================================================

  var TMDB_KEY = 'f3d757824f08ea2cff45eb8f47ca3a1e';
  var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  var DOMAINS_URL = 'https://raw.githubusercontent.com/Snixi92/nuvio-french-providers/main/domains.json';
  var FALLBACK_TLD = 'to';
  var _cachedEndpoint = null;

  function detectEndpoint() {
    if (_cachedEndpoint) return Promise.resolve(_cachedEndpoint);
    return fetch(DOMAINS_URL)
      .then(function(r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function(d) {
        var tld = d.vstream || FALLBACK_TLD;
        _cachedEndpoint = { base: 'https://vstream.' + tld, api: 'https://api.vstream.' + tld + '/api', ref: 'https://vstream.' + tld + '/' };
        return _cachedEndpoint;
      })
      .catch(function() {
        _cachedEndpoint = { base: 'https://vstream.' + FALLBACK_TLD, api: 'https://api.vstream.' + FALLBACK_TLD + '/api', ref: 'https://vstream.' + FALLBACK_TLD + '/' };
        return _cachedEndpoint;
      });
  }

  function getTmdbMeta(tmdbId, type) {
    return fetch('https://api.themoviedb.org/3/' + (type === 'tv' ? 'tv' : 'movie') + '/' + tmdbId + '?api_key=' + TMDB_KEY + '&language=en-US')
      .then(function(r) { return r.json(); })
      .then(function(d) {
        var duration = '';
        if (type === 'movie' && d.runtime) duration = d.runtime + ' min';
        else if (type === 'tv' && d.episode_run_time && d.episode_run_time.length > 0) duration = d.episode_run_time[0] + ' min';
        return { name: d.title || d.name || 'Vstream', year: (d.release_date || d.first_air_date || '').split('-')[0], duration: duration };
      }).catch(function() { return { name: 'Vstream', year: '', duration: '' }; });
  }

  function getEpInfo(tmdbId, season, episode) {
    if (!season || !episode) return Promise.resolve(null);
    return fetch('https://api.themoviedb.org/3/tv/' + tmdbId + '/season/' + season + '/episode/' + episode + '?api_key=' + TMDB_KEY + '&language=en-US')
      .then(function(r) { return r.json(); })
      .then(function(d) { return { name: d.name || null, duration: d.runtime ? d.runtime + ' min' : null }; })
      .catch(function() { return null; });
  }

  function buildTitle(meta, lang, quality, season, episode, epInfo) {
    var l = (lang || '').toUpperCase();
    var icon = l.indexOf('MULTI') !== -1 ? '🌍' : l.indexOf('VOST') !== -1 ? '🔡' : '🇫🇷';
    var label = l.indexOf('MULTI') !== -1 ? 'MULTI' : l.indexOf('VOST') !== -1 ? 'VOSTFR' : 'VF';
    var line1 = '🎬 ';
    if (season && episode) {
      line1 += 'S' + season + 'E' + episode + (epInfo && epInfo.name ? ' — ' + epInfo.name : '') + ' | ' + meta.name;
    } else {
      line1 += meta.name + (meta.year ? ' (' + meta.year + ')' : '');
    }
    var specs = ['📺 ' + (quality || 'HD'), icon + ' ' + label, '🎞️ M3U8'];
    var finalDur = (epInfo && epInfo.duration) ? epInfo.duration : meta.duration;
    if (finalDur) specs.push('⏱️ ' + finalDur);
    specs.push('🌐 Vstream');
    return line1 + '\n' + specs.join(' | ');
  }

  function normalizeSources(sources, endpoint, meta, season, episode, epInfo) {
    var out = [];
    for (var i = 0; i < sources.length; i++) {
      var s = sources[i];
      if (!s || s.isEmbed) continue;
      var url = s.url || '';
      if (!url.startsWith('http')) {
        if (url.charAt(0) === '/') {
          var m = url.match(/[?&]url=([^&]+)/);
          if (!m) continue;
          try { url = decodeURIComponent(m[1]); } catch(e) { continue; }
        } else continue;
      }
      var quality = s.quality || 'HD';
      var ref = url.match(/^(https?:\/\/[^\/]+)/);
      out.push({
        name: 'Vstream',
        title: buildTitle(meta, s.lang || 'VF', quality, season, episode, epInfo),
        url: url,
        quality: quality,
        headers: { 'User-Agent': UA, 'Referer': ref ? ref[1] + '/' : endpoint.ref, 'Origin': ref ? ref[1] : endpoint.base }
      });
    }
    return out;
  }

  function getStreams(tmdbId, mediaType, season, episode) {
    return Promise.all([
      getTmdbMeta(tmdbId, mediaType),
      mediaType === 'tv' ? getEpInfo(tmdbId, season, episode) : Promise.resolve(null),
      detectEndpoint()
    ]).then(function(res) {
      var meta = res[0], epInfo = res[1], ep = res[2];
      var apiUrl = mediaType === 'tv'
        ? ep.api + '/sources/tv/' + tmdbId + '/' + (season || 1) + '/' + (episode || 1)
        : ep.api + '/sources/movie/' + tmdbId;
      return fetch(apiUrl, { headers: { 'User-Agent': UA, 'Referer': ep.ref } })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (!d || !d.sources) return [];
          return normalizeSources(d.sources, ep, meta, season, episode, epInfo);
        });
    }).catch(function(e) {
      console.error('[Vstream]', e.message || e);
      return [];
    });
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { getStreams: getStreams }; }
  else { if (typeof globalThis !== 'undefined') globalThis.getStreams = getStreams; if (typeof global !== 'undefined') global.getStreams = getStreams; }
  