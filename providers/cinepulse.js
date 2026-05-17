// =============================================================
// Provider Nuvio : Cinepulse.vc (VF/VOSTFR/MULTI)
// Version : 1.0.0 — API native + obfuscation répliquée depuis le bundle client
// =============================================================

var https = require('https');
var zlib = require('zlib');

var CP_API_HOST = 'apiapi.cinepulse.vc';
var CP_REFERER = 'https://cinepulse.vc/';
var CP_ORIGIN = 'https://cinepulse.vc';
var CP_VERSION = '3.5.2';
var CP_SCREEN = Buffer.from('1920x1080').toString('base64');
var CP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

var REFRESH_TOKEN = process.env.CINEPULSE_REFRESH_TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI5MzE3NWNjOS01MWQ5LTQzZDAtOTJiOS0xNGI1NjY1OTJmNmUiLCJzZXNzaW9uSWQiOiIyNzM4ZDgwYS04YTIyLTQ4M2EtYjlhNy0yZWVlYWQ0N2UxODgiLCJpYXQiOjE3NzkwNTY2NDAsImV4cCI6MTc4MTY0ODY0MCwiYXVkIjoiY2luZXB1bHNlLWZyb250ZW5kIiwiaXNzIjoiY2luZXB1bHNlLWJhY2tlbmQtYXBpIn0.RkMsnWwXhDC-_X4p95OVXeKdbAqXCo2R3dVhrPXHhyc';

var _accessToken = null;
var _tokenExpiry = 0;
var _profileId = null;

// ── Obfuscation (répliquée exactement depuis le bundle client v3.5.2) ──────────
function generateRandomKey(len) {
  len = len || 8;
  var chars = 'abceghjklmnopqrtuvwxyzABCEGHIJKLMNOPQRTUVWXYZ0123456789';
  var s = '';
  for (var r = 0; r < len; r++) s += chars.charAt(Math.floor(55 * Math.random()));
  return s;
}

function encodeValue(val, type) {
  var s = String(val);
  if (type === 'id') {
    var e = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      e += /\d/.test(c) ? ((parseInt(c, 10) + 7) % 10).toString() : c;
    }
    return 'c' + Buffer.from(e).toString('base64');
  }
  if (type === 'type') {
    var e = '';
    for (var r = 0; r < s.length; r++) e += String.fromCharCode(s.charCodeAt(r) ^ 107);
    return 't' + Buffer.from(e).toString('base64');
  }
  if (type === 'season') {
    var n = parseInt(s, 10);
    var t2 = String(n + 5);
    var r2 = '';
    for (var i = 0; i < t2.length; i++) r2 += ((parseInt(t2.charAt(i), 10) + 3) % 10).toString();
    return 's' + r2;
  }
  if (type === 'episode') {
    var n = parseInt(s, 10);
    var t2 = String(n + 9);
    var r2 = '';
    for (var i = 0; i < t2.length; i++) r2 += ((parseInt(t2.charAt(i), 10) + 4) % 10).toString();
    return 'e' + r2;
  }
  if (type === 'exp') {
    var hex = s.split('').map(function(c) { return c.charCodeAt(0).toString(16); }).join('');
    return 'x' + Buffer.from(hex).toString('base64');
  }
  return 'd' + Buffer.from(s).toString('base64');
}

function obfuscateParams(params) {
  var t = {};
  t[generateRandomKey()] = encodeValue(Date.now() + 60000, 'exp');
  var km = { tmdbId: 'id', type: 'type', season: 'season', episode: 'episode', sessionId: 'sid' };
  var keys = Object.keys(params);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (params[key] == null) continue;
    t[generateRandomKey()] = encodeValue(params[key], km[key] || key.substring(0, 2));
  }
  var nc = ['q', 'w', 'p', 'z', 'h', 'j'];
  var n = 10 + Math.floor(10 * Math.random());
  for (var a = 0; a < n; a++) {
    t[generateRandomKey()] = nc[Math.floor(Math.random() * nc.length)] +
      Buffer.from(generateRandomKey(8 + Math.floor(8 * Math.random()))).toString('base64');
  }
  return t;
}

// ── Requête HTTPS JSON (http/1.1, compatible Node.js natif) ─────────────────────
function httpsRequest(method, path, extraHeaders, body) {
  return new Promise(function(resolve, reject) {
    var bodyStr = body ? JSON.stringify(body) : null;
    var options = {
      hostname: CP_API_HOST,
      path: path,
      method: method,
      headers: Object.assign({
        'User-Agent': CP_UA,
        'Referer': CP_REFERER,
        'Origin': CP_ORIGIN,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Host': CP_API_HOST
      }, extraHeaders || {}, bodyStr ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      } : {})
    };
    var req = https.request(options, function(res) {
      var chunks = [];
      var enc = res.headers['content-encoding'] || '';
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        var buf = Buffer.concat(chunks);
        function parse(b) {
          try { resolve(JSON.parse(b.toString('utf8'))); }
          catch(e) { reject(new Error('bad JSON: ' + b.toString('utf8').slice(0, 100))); }
        }
        if (enc === 'gzip') zlib.gunzip(buf, function(e, d) { e ? reject(e) : parse(d); });
        else if (enc === 'br') zlib.brotliDecompress(buf, function(e, d) { e ? reject(e) : parse(d); });
        else if (enc === 'deflate') zlib.inflate(buf, function(e, d) { e ? reject(e) : parse(d); });
        else parse(buf);
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, function() { req.destroy(new Error('timeout')); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Gestion du token d'accès (auto-refresh) ─────────────────────────────────────
function getAccessToken() {
  var now = Date.now();
  if (_accessToken && now < _tokenExpiry - 30000) return Promise.resolve(_accessToken);
  return httpsRequest('POST', '/api/v2/auth/refresh-auth-token', {}, { refreshToken: REFRESH_TOKEN })
    .then(function(data) {
      if (data.type !== 'success' || !data.data) throw new Error('token refresh failed: ' + JSON.stringify(data).slice(0, 100));
      _accessToken = data.data.items.accessToken;
      _tokenExpiry = Date.now() + 870000;
      return _accessToken;
    });
}

function getProfileId(accessToken) {
  if (_profileId) return Promise.resolve(_profileId);
  return httpsRequest('GET', '/api/v2/profiles', { 'Authorization': 'Bearer ' + accessToken })
    .then(function(data) {
      var profiles = data.data && data.data.items && data.data.items.profiles;
      if (!profiles || !profiles.length) throw new Error('aucun profil trouvé');
      _profileId = profiles[0].id;
      return _profileId;
    });
}

// ── Récupération des streams ─────────────────────────────────────────────────────
function getStreams(tmdbId, mediaType, season, episode) {
  return getAccessToken().then(function(token) {
    return getProfileId(token).then(function(profileId) {
      var params = { tmdbId: tmdbId, type: mediaType === 'tv' ? 'tv' : 'movie' };
      if (mediaType === 'tv' && season != null) params.season = season;
      if (mediaType === 'tv' && episode != null) params.episode = episode;

      var obf = obfuscateParams(params);
      var qs = Object.keys(obf).map(function(k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(obf[k]);
      }).join('&');

      return httpsRequest('GET', '/watch/sources?' + qs, {
        'Authorization': 'Bearer ' + token,
        'X-Profile-Id': profileId,
        'X-Client-Version': CP_VERSION,
        'X-Screen-Size': CP_SCREEN,
        'X-Request-Time': String(Date.now())
      });
    });
  }).then(function(data) {
    if (data.type !== 'success' || !data.data || !Array.isArray(data.data.items)) return [];
    var results = [];
    var items = data.data.items;
    for (var i = 0; i < items.length; i++) {
      var s = items[i];
      if (!s.url) continue;
      var lang = (s.language || '').toUpperCase();
      var quality = s.quality || 'HD';
      var langIcon = lang === 'VF' ? '🇫🇷' : lang === 'VOSTFR' ? '🔡' : lang === 'MULTI' ? '🌐' : '🎬';
      results.push({
        name: 'Cinepulse \u2022 ' + quality,
        title: langIcon + ' ' + lang + ' | \uD83D\uDCFA ' + quality + ' | ' + (s.type || 'hls').toUpperCase(),
        url: s.url
      });
    }
    return results;
  }).catch(function() { return []; });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
}
