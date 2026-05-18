const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || 'Snixi92/nuvio-french-providers';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '';
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL || '';

// ── Cache ───────────────────────────────────────────────────────────────────────
const TMDB_CACHE_TTL   = 60 * 60 * 1000;
const STREAM_CACHE_TTL = 5 * 60 * 1000;
const LINK_CHECK_TIMEOUT = 4000;
const tmdbCache   = new Map();
const streamCache = new Map();

// ── Adaptive Timeout ────────────────────────────────────────────────────────────
// Tracks last 20 response times per provider, uses p90*1.5 as timeout (6s–25s)
const providerLatencyHistory = {};

function getAdaptiveTimeout(name) {
  const h = providerLatencyHistory[name];
  if (!h || h.length < 3) return 12000;
  const sorted = [...h].sort((a, b) => a - b);
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  return Math.max(6000, Math.min(25000, Math.ceil(p90 * 1.6)));
}

function recordLatency(name, ms) {
  if (!providerLatencyHistory[name]) providerLatencyHistory[name] = [];
  providerLatencyHistory[name].push(ms);
  if (providerLatencyHistory[name].length > 20) providerLatencyHistory[name].shift();
}

// ── Circuit Breaker ─────────────────────────────────────────────────────────────
// Opens after 5 consecutive zero-stream results, stays open 20min, then half-open
const circuitBreakers = {};
const CB_THRESHOLD = 5;
const CB_OPEN_MS   = 20 * 60 * 1000;

function isCircuitOpen(name) {
  const cb = circuitBreakers[name];
  if (!cb) return false;
  if (cb.openUntil && Date.now() < cb.openUntil) return true;
  if (cb.openUntil && Date.now() >= cb.openUntil) {
    console.log(`[CircuitBreaker] ${name} HALF-OPEN — test en cours`);
    cb.openUntil = 0;
  }
  return false;
}

function recordProviderResult(name, ms, count) {
  recordLatency(name, ms);
  if (!circuitBreakers[name]) circuitBreakers[name] = { failures: 0, openUntil: 0, lastSuccess: null, totalCalls: 0, totalStreams: 0 };
  const cb = circuitBreakers[name];
  cb.totalCalls++;
  cb.totalStreams += count;
  if (count === 0) {
    cb.failures++;
    if (cb.failures >= CB_THRESHOLD && !cb.openUntil) {
      cb.openUntil = Date.now() + CB_OPEN_MS;
      const msg = `Provider **${name}** désactivé automatiquement : ${cb.failures} appels consécutifs sans résultat (circuit ouvert ${CB_OPEN_MS / 60000}min)`;
      console.warn(`[CircuitBreaker] ${name} OUVERT`);
      sendDiscordAlert(msg);
    }
  } else {
    cb.failures = 0;
    cb.openUntil = 0;
    cb.lastSuccess = Date.now();
  }
}

function sendDiscordAlert(msg) {
  if (!DISCORD_WEBHOOK) return;
  fetch(DISCORD_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: `🚨 **Addon Alert** : ${msg}` })
  }).catch(() => {});
}

// ── Concurrency Limiter (Workers/Queue) ─────────────────────────────────────────
// Prevents simultaneous provider explosions under high load
function createSemaphore(max) {
  let active = 0;
  const queue = [];
  return function run(fn) {
    return new Promise((resolve, reject) => {
      const attempt = () => {
        if (active < max) {
          active++;
          Promise.resolve().then(fn).then(r => { active--; next(); resolve(r); }, e => { active--; next(); reject(e); });
        } else {
          queue.push(attempt);
        }
      };
      const next = () => { if (queue.length) queue.shift()(); };
      attempt();
    });
  };
}
const providerSemaphore = createSemaphore(6); // max 6 parallel provider calls

// ── withTimeout ─────────────────────────────────────────────────────────────────
function withTimeout(promise, ms, name) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`[${name}] Timeout ${ms}ms`)), ms))
  ]);
}

// ── Stream Sort + Dedup ─────────────────────────────────────────────────────────
const LANG_SCORE = { VF: 0, FRENCH: 0, FR: 0, MULTI: 1, MULTi: 1, VOSTFR: 2, VOSTA: 2, VOSTA$: 2, VO: 3, ENG: 4, EN: 4 };
const QUAL_SCORE = { '4K': 0, '2160P': 0, '1080P': 1, 'FHD': 1, '720P': 2, 'HD': 3, '480P': 4, '360P': 5, 'SD': 5 };

function streamScore(s) {
  const text = ((s.title || '') + ' ' + (s.name || '')).toUpperCase();
  let lang = 9, qual = 9;
  for (const [k, v] of Object.entries(LANG_SCORE)) { if (text.includes(k)) { lang = Math.min(lang, v); } }
  for (const [k, v] of Object.entries(QUAL_SCORE)) { if (text.includes(k)) { qual = Math.min(qual, v); } }
  return lang * 10 + qual;
}

function sortAndDeduplicateStreams(streams) {
  const seen = new Map(); // url -> index in result
  const result = [];
  for (const s of streams) {
    if (!s.url) continue;
    const key = s.url.split('?')[0];
    if (seen.has(key)) {
      // Merge provider prefix into existing stream's name so user sees both
      const idx = seen.get(key);
      const newPfx = (s.name || '').replace(/\s*[-–—].*/, '').trim();
      if (newPfx && !result[idx].name.includes(newPfx)) {
        result[idx].name = result[idx].name + ' + ' + newPfx;
      }
    } else {
      seen.set(key, result.length);
      result.push({ ...s });
    }
  }
  return result.sort((a, b) => streamScore(a) - streamScore(b));
}

// ── Label Enrichment ────────────────────────────────────────────────────────────
function enrichStream(s) {
  const text = ((s.title || '') + ' ' + (s.name || '')).toUpperCase();
  if (!s.title) return s;
  // Add quality badge if missing
  const hasQual = /1080|720|480|4K|2160|HD|SD|FHD/.test(text);
  const hasLang = /\bVF\b|\bMULTI\b|\bVOSTFR\b|\bVO\b/.test(text);
  // Ensure consistent lang icon
  const enriched = { ...s };
  if (hasLang && !s.title.match(/[🇫🇷🌐🔡🎬]/u)) {
    if (text.includes('VF') || text.includes('FRENCH')) enriched.title = '🇫🇷 ' + s.title;
    else if (text.includes('MULTI')) enriched.title = '🌐 ' + s.title;
    else if (text.includes('VOSTFR') || text.includes('VOSTA')) enriched.title = '🔡 ' + s.title;
    else if (text.includes(' VO') || text.includes('ENG')) enriched.title = '🇬🇧 ' + s.title;
  }
  return enriched;
}

// ── Middlewares ──────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json());

// ── Config ───────────────────────────────────────────────────────────────────────
let config = { providers: {} };
try { config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')); }
catch (e) { console.log('[Config] Pas de config.json, valeurs par défaut'); }

// ── Providers ────────────────────────────────────────────────────────────────────
const providers = {};
const providerDir = path.join(__dirname, 'providers');
try {
  const files = fs.readdirSync(providerDir).filter(f => f.endsWith('.js'));
  for (const file of files) {
    const name = path.basename(file, '.js');
    try {
      providers[name] = require(path.join(providerDir, file));
      if (!config.providers[name]) config.providers[name] = { enabled: true };
      console.log('[Server] ✓ Provider :', name);
    } catch (e) { console.warn('[Server] ✗ Provider', name, ':', e.message); }
  }
} catch (e) { console.error('[Server] Impossible de lire /providers :', e.message); }

const manifest = require('./manifest.json');

// ── GitHub API ───────────────────────────────────────────────────────────────────
async function githubGetFile(filePath) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' }
  });
  return res.json();
}
async function githubPush(filePath, content, message) {
  const existing = await githubGetFile(filePath).catch(() => null);
  const sha = existing?.sha;
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: Buffer.from(content).toString('base64'), ...(sha ? { sha } : {}) })
  });
  const data = await res.json();
  if (!data.content) throw new Error(data.message || 'GitHub push échoué');
  return data;
}
async function saveConfig() {
  await githubPush('config.json', JSON.stringify(config, null, 2), 'chore: update config depuis dashboard');
}

// ── Auth dashboard ────────────────────────────────────────────────────────────────
function dashboardAuth(req, res, next) {
  if (!DASHBOARD_PASSWORD) return next();
  const pwd = req.headers['x-dashboard-password'] || req.query.pwd;
  if (pwd !== DASHBOARD_PASSWORD) return res.status(401).json({ error: 'Mot de passe incorrect' });
  next();
}

// ── Link check ────────────────────────────────────────────────────────────────────
async function isLinkAlive(stream) {
  const url = stream.url;
  if (!url || !url.startsWith('http')) return false;
  if (url.includes('.m3u8') || url.includes('m3u8')) return true;
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), LINK_CHECK_TIMEOUT);
    const resp = await fetch(url, { method: 'HEAD', headers: stream.headers || {}, signal: controller.signal, redirect: 'follow' });
    clearTimeout(tid);
    if ([403, 404, 410, 451].includes(resp.status)) { console.log(`[LinkCheck] ✗ ${resp.status} → ${url.slice(0, 80)}`); return false; }
    return true;
  } catch { return true; }
}
async function filterDeadStreams(streams) {
  if (!streams || streams.length === 0) return [];
  const mp4 = streams.filter(s => !s.url?.includes('.m3u8'));
  const hls = streams.filter(s => s.url?.includes('.m3u8'));
  if (mp4.length === 0) return streams;
  const checks = await Promise.allSettled(mp4.map(s => isLinkAlive(s).then(ok => ok ? s : null)));
  const validMp4 = checks.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
  const removed = mp4.length - validMp4.length;
  if (removed > 0) console.log(`[LinkCheck] ${removed} lien(s) mort(s) filtré(s)`);
  return [...hls, ...validMp4];
}

// ── Routes Stremio ────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/manifest.json'));
app.get('/manifest.json', (req, res) => res.json(manifest));

// ── /healthz ─────────────────────────────────────────────────────────────────────
app.get('/healthz', (req, res) => {
  const active = Object.keys(providers).filter(n => config.providers[n]?.enabled !== false && !isCircuitOpen(n));
  res.json({
    status: 'ok',
    providers: { active, total: Object.keys(providers).length },
    cache: { tmdb: tmdbCache.size, streams: streamCache.size },
    uptime: Math.round(process.uptime())
  });
});

// ── /status page ─────────────────────────────────────────────────────────────────
app.get('/status', (req, res) => {
  const rows = Object.keys(providers).map(name => {
    const enabled = config.providers[name]?.enabled !== false;
    const cb = circuitBreakers[name] || {};
    const h = providerLatencyHistory[name] || [];
    const avg = h.length ? Math.round(h.reduce((a, b) => a + b, 0) / h.length) : null;
    const isOpen = cb.openUntil && Date.now() < cb.openUntil;
    const openRemain = isOpen ? Math.ceil((cb.openUntil - Date.now()) / 60000) : 0;
    const lastOk = cb.lastSuccess ? new Date(cb.lastSuccess).toLocaleTimeString('fr-FR') : '—';
    const statusBadge = !enabled ? '⚫ Désactivé' : isOpen ? `🔴 Circuit ouvert (${openRemain}min)` : cb.failures > 0 ? `🟡 ${cb.failures} échec(s)` : '🟢 OK';
    return `<tr>
      <td><strong>${name}</strong></td>
      <td>${statusBadge}</td>
      <td>${avg != null ? avg + 'ms' : '—'}</td>
      <td>${h.length} appels</td>
      <td>${cb.totalStreams || 0} streams</td>
      <td>${lastOk}</td>
    </tr>`;
  }).join('');
  res.send(`<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><title>Addon Status</title>
<meta http-equiv="refresh" content="30">
<style>body{font-family:sans-serif;background:#0f0f0f;color:#eee;padding:2rem}
h1{color:#a78bfa}table{width:100%;border-collapse:collapse;margin-top:1rem}
th,td{padding:.6rem 1rem;border:1px solid #333;text-align:left}
th{background:#1e1e2e;color:#a78bfa}tr:hover{background:#1a1a2e}
.meta{color:#888;font-size:.85rem;margin-bottom:1.5rem}</style></head>
<body>
<h1>🎬 French Providers — Status</h1>
<p class="meta">Mise à jour automatique toutes les 30s | Uptime : ${Math.round(process.uptime() / 60)} min | Cache : ${streamCache.size} entrées</p>
<table>
<thead><tr><th>Provider</th><th>Statut</th><th>Latence moy.</th><th>Appels</th><th>Streams totaux</th><th>Dernier succès</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</body></html>`);
});

// ── Dashboard ─────────────────────────────────────────────────────────────────────
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));

app.get('/api/dashboard/status', (req, res) => {
  const status = {};
  for (const name of Object.keys(providers))
    status[name] = { enabled: config.providers[name]?.enabled !== false };
  for (const name of Object.keys(config.providers))
    if (!status[name]) status[name] = { enabled: config.providers[name]?.enabled !== false, pending: true };
  res.json({ providers: status, hasGithub: !!GITHUB_TOKEN, passwordRequired: !!DASHBOARD_PASSWORD });
});

app.post('/api/dashboard/toggle/:name', async (req, res) => {
  const { name } = req.params;
  if (!providers[name] && !config.providers[name]) return res.status(404).json({ error: 'Provider introuvable' });
  if (!config.providers[name]) config.providers[name] = {};
  config.providers[name].enabled = !(config.providers[name].enabled !== false);
  // Reset circuit breaker when manually toggled
  if (circuitBreakers[name]) circuitBreakers[name].openUntil = 0;
  res.json({ name, enabled: config.providers[name].enabled });
  streamCache.clear();
  saveConfig().catch(e => console.error('[Config]', e.message));
});

const TEST_MOVIE_TMDB = '27205';
const TEST_TV_TMDB    = '1396';

app.get('/api/dashboard/test/:name', async (req, res) => {
  const { name } = req.params;
  const provider = providers[name];
  if (!provider) return res.status(404).json({ error: 'Provider introuvable ou non chargé' });
  const mode = (req.query.mode === 'tv') ? 'tv' : 'movie';
  const tmdbId = mode === 'tv' ? TEST_TV_TMDB : TEST_MOVIE_TMDB;
  const season = parseInt(req.query.season) || 1;
  const episode = parseInt(req.query.episode) || 1;
  const label = mode === 'tv' ? `Breaking Bad S${season}E${episode}` : 'Inception';
  const t0 = Date.now();
  try {
    const streams = await withTimeout(Promise.resolve().then(() => provider.getStreams(tmdbId, mode, season, episode)), 25000, name);
    res.json({ provider: name, test: label, elapsed: Date.now() - t0, count: streams.length, streams });
  } catch (e) {
    res.status(500).json({ provider: name, test: label, elapsed: Date.now() - t0, error: e.message, streams: [] });
  }
});

// Reset circuit breaker manually
app.post('/api/dashboard/reset-circuit/:name', (req, res) => {
  const { name } = req.params;
  if (circuitBreakers[name]) { circuitBreakers[name].openUntil = 0; circuitBreakers[name].failures = 0; }
  res.json({ name, reset: true });
});

app.post('/api/dashboard/provider/add', async (req, res) => {
  const { url, name } = req.body;
  if (!url) return res.status(400).json({ error: 'URL requise' });
  if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN non configuré' });
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const code = await resp.text();
    if (!code || code.length < 10) throw new Error('Fichier vide ou invalide');
    const pName = (name || url.split('/').pop().replace(/\.js$/i, '')).replace(/[^a-z0-9_-]/gi, '_');
    await githubPush(`providers/${pName}.js`, code, `feat: add/update provider "${pName}" via dashboard`);
    if (!config.providers[pName]) config.providers[pName] = { enabled: true };
    await saveConfig();
    res.json({ success: true, name: pName, message: `Provider "${pName}" ajouté. Redéploiement en cours (~2 min).` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── TMDB lookup ───────────────────────────────────────────────────────────────────
const TMDB_KEY = '8265bd1679663a7ea12ac168da84d2e8';

async function getTmdbId(imdbId, mediaType) {
  const key = `${mediaType}:${imdbId}`;
  const cached = tmdbCache.get(key);
  if (cached && Date.now() - cached.ts < TMDB_CACHE_TTL) return cached.id;
  try {
    const resp = await withTimeout(
      fetch(`https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id`), 5000, 'TMDB');
    const data = await resp.json();
    const results = mediaType === 'movie' ? data.movie_results : data.tv_results;
    if (results?.length > 0) { const id = String(results[0].id); tmdbCache.set(key, { id, ts: Date.now() }); return id; }
  } catch (e) { console.error('[TMDB]', e.message); }
  return null;
}

// ── /stream endpoint ──────────────────────────────────────────────────────────────
app.get('/stream/:type/:id.json', async (req, res) => {
  const { type, id } = req.params;
  const parts = id.split(':');
  let tmdbId, season = 1, episode = 1;
  const mediaType = type === 'series' ? 'tv' : 'movie';

  if (parts[0] === 'tmdb') {
    tmdbId = parts[1];
    if (parts.length >= 4) { season = parseInt(parts[2]) || 1; episode = parseInt(parts[3]) || 1; }
  } else {
    const imdbId = parts[0];
    if (parts.length >= 3) { season = parseInt(parts[1]) || 1; episode = parseInt(parts[2]) || 1; }
    tmdbId = await getTmdbId(imdbId, mediaType);
    if (!tmdbId) { console.warn('[Stream] TMDB lookup échoué pour', imdbId); return res.json({ streams: [] }); }
  }

  const cacheKey = `${mediaType}:${tmdbId}:${season}:${episode}`;
  const cached = streamCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < STREAM_CACHE_TTL) {
    console.log(`[Stream] Cache hit: ${cacheKey} (${cached.streams.length} streams)`);
    return res.json({ streams: cached.streams });
  }

  console.log(`[Stream] ${mediaType} tmdb=${tmdbId} S${season}E${episode}`);
  const t0 = Date.now();

  // Active providers: enabled AND circuit not open
  const active = Object.entries(providers).filter(([n]) =>
    config.providers[n]?.enabled !== false && !isCircuitOpen(n)
  );

  const skipped = Object.keys(providers).filter(n => isCircuitOpen(n));
  if (skipped.length) console.log(`[CircuitBreaker] Skipped: ${skipped.join(', ')}`);

  // Run providers with individual adaptive timeouts via semaphore
  const results = await Promise.allSettled(
    active.map(([name, p]) =>
      providerSemaphore(() => {
        const timeout = getAdaptiveTimeout(name);
        const pt = Date.now();
        return withTimeout(
          Promise.resolve().then(() => p.getStreams(tmdbId, mediaType, season, episode)),
          timeout, name
        ).then(streams => {
          const ms = Date.now() - pt;
          const count = Array.isArray(streams) ? streams.length : 0;
          recordProviderResult(name, ms, count);
          console.log(`[${name}] ${count} stream(s) en ${ms}ms (timeout=${timeout}ms)`);
          return Array.isArray(streams) ? streams : [];
        }).catch(err => {
          const ms = Date.now() - pt;
          recordProviderResult(name, ms, 0);
          console.warn(`[${name}] ${err.message} (${ms}ms)`);
          return [];
        });
      })
    )
  );

  const rawStreams = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  console.log(`[Stream] ${rawStreams.length} streams bruts en ${Date.now() - t0}ms`);

  // Enrich labels
  const enriched = rawStreams.map(enrichStream);

  // Filter dead links
  const alive = await filterDeadStreams(enriched);

  // Sort (VF > MULTI > VOSTFR) + deduplicate
  const streams = sortAndDeduplicateStreams(alive);

  console.log(`[Stream] Total final: ${streams.length} streams (${Date.now() - t0}ms)`);
  if (streams.length > 0) streamCache.set(cacheKey, { streams, ts: Date.now() });
  res.json({ streams });
});

// ── Keep-alive ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[Server] Port ${PORT} | ${Object.keys(providers).length} providers chargés`);
  if (process.env.NODE_ENV === 'production' && process.env.RENDER_EXTERNAL_URL) {
    const pingUrl = process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '') + '/healthz';
    console.log(`[Keep-alive] → ${pingUrl} toutes les 10 min`);
    setInterval(async () => {
      try { const r = await fetch(pingUrl, { signal: AbortSignal.timeout(10000) }); console.log(`[Keep-alive] OK ${r.status}`); }
      catch (e) { console.warn('[Keep-alive]', e.message); }
    }, 10 * 60 * 1000);
  }
});
