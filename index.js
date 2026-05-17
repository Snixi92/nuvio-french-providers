const express = require('express');
  const path = require('path');
  const fs = require('fs');

  const app = express();
  const PORT = process.env.PORT || 3000;
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_REPO = process.env.GITHUB_REPO || 'Snixi92/nuvio-french-providers';
  const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '';

  // ─── Optimisation : timeout et cache ────────────────────────────────────────
  const PROVIDER_TIMEOUT_MS = 8000;
  const TMDB_CACHE_TTL  = 60 * 60 * 1000;
  const STREAM_CACHE_TTL = 5 * 60 * 1000;
  const LINK_CHECK_TIMEOUT = 4000; // 4s max pour la vérif HEAD

  const tmdbCache  = new Map();
  const streamCache = new Map();

  function withTimeout(promise, ms, name) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`[${name}] Timeout ${ms}ms`)), ms)
      )
    ]);
  }

  // ─── Middlewares ─────────────────────────────────────────────────────────────
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });
  app.use(express.json());

  // ─── Config ──────────────────────────────────────────────────────────────────
  let config = { providers: {} };
  try {
    config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  } catch (e) {
    console.log('[Config] Pas de config.json, valeurs par défaut');
  }

  // ─── Providers ───────────────────────────────────────────────────────────────
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
      } catch (e) {
        console.warn('[Server] ✗ Provider', name, ':', e.message);
      }
    }
  } catch (e) {
    console.error('[Server] Impossible de lire /providers :', e.message);
  }

  const manifest = require('./manifest.json');

  // ─── GitHub API ───────────────────────────────────────────────────────────────
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

  // ─── Auth dashboard ───────────────────────────────────────────────────────────
  function dashboardAuth(req, res, next) {
    if (!DASHBOARD_PASSWORD) return next();
    const pwd = req.headers['x-dashboard-password'] || req.query.pwd;
    if (pwd !== DASHBOARD_PASSWORD) return res.status(401).json({ error: 'Mot de passe incorrect' });
    next();
  }

  // ─── Étape C : Vérification de validité d'un lien (HEAD request) ─────────────
  async function isLinkAlive(stream) {
    const url = stream.url;
    if (!url || !url.startsWith('http')) return false;
    // Les m3u8 sont souvent protégés contre HEAD, on les garde par défaut
    if (url.includes('.m3u8') || url.includes('m3u8')) return true;
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), LINK_CHECK_TIMEOUT);
      const headers = stream.headers ? { ...stream.headers } : {};
      // HEAD request
      const resp = await fetch(url, {
        method: 'HEAD',
        headers,
        signal: controller.signal,
        redirect: 'follow'
      });
      clearTimeout(tid);
      // 403, 404, 410 = lien mort
      const dead = [403, 404, 410, 451];
      if (dead.includes(resp.status)) {
        console.log(`[LinkCheck] ✗ ${resp.status} → ${url.slice(0, 80)}`);
        return false;
      }
      console.log(`[LinkCheck] ✓ ${resp.status} → ${url.slice(0, 80)}`);
      return true;
    } catch (e) {
      // Timeout ou erreur réseau : on garde le lien par défaut (évite faux positifs)
      console.log(`[LinkCheck] ? timeout/erreur → ${url.slice(0, 80)}`);
      return true;
    }
  }

  async function filterDeadStreams(streams) {
    if (!streams || streams.length === 0) return [];
    // On ne vérifie que les MP4 directs (les m3u8 passent automatiquement)
    const mp4Streams = streams.filter(s => !s.url?.includes('.m3u8') && !s.url?.includes('m3u8'));
    const m3u8Streams = streams.filter(s => s.url?.includes('.m3u8') || s.url?.includes('m3u8'));
    
    if (mp4Streams.length === 0) return streams;
    
    const checks = await Promise.allSettled(
      mp4Streams.map(s => isLinkAlive(s).then(alive => alive ? s : null))
    );
    const validMp4 = checks
      .filter(r => r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value);
    
    const total = streams.length;
    const removed = total - validMp4.length - m3u8Streams.length;
    if (removed > 0) console.log(`[LinkCheck] ${removed} lien(s) mort(s) filtré(s) sur ${total}`);
    
    return [...m3u8Streams, ...validMp4];
  }

  // ─── Routes Stremio ───────────────────────────────────────────────────────────
  app.get('/', (req, res) => res.redirect('/manifest.json'));
  app.get('/manifest.json', (req, res) => res.json(manifest));
  app.get('/healthz', (req, res) => res.json({
    status: 'ok',
    providers: Object.keys(providers).filter(n => config.providers[n]?.enabled !== false),
    cache: { tmdb: tmdbCache.size, streams: streamCache.size }
  }));

  // ─── Dashboard ────────────────────────────────────────────────────────────────
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
    res.json({ name, enabled: config.providers[name].enabled });
    streamCache.clear();
    saveConfig().catch(e => console.error('[Config]', e.message));
  });

  // ─── Test provider (dashboard) ────────────────────────────────────────────
  // Lance une recherche test sur un film populaire et renvoie les streams trouvés
  const TEST_MOVIE_TMDB = '27205'; // Inception (tmdbId)
  const TEST_TV_TMDB    = '1396';  // Breaking Bad

  app.get('/api/dashboard/test/:name', async (req, res) => {
    const { name } = req.params;
    const provider = providers[name];
    if (!provider) return res.status(404).json({ error: 'Provider introuvable ou non chargé' });

    const mode = (req.query.mode === 'tv') ? 'tv' : 'movie';
    const tmdbId = mode === 'tv' ? TEST_TV_TMDB : TEST_MOVIE_TMDB;
    const season  = parseInt(req.query.season)  || 1;
    const episode = parseInt(req.query.episode) || 1;
    const testLabel = mode === 'tv'
      ? `Breaking Bad S${season}E${episode} (TMDB ${tmdbId})`
      : `Inception (TMDB ${tmdbId})`;

    console.log(`[Test] ${name} → ${testLabel}`);
    const t0 = Date.now();
    try {
      const streams = await withTimeout(
        Promise.resolve().then(() => provider.getStreams(tmdbId, mode, season, episode)),
        20000,
        name
      );
      const elapsed = Date.now() - t0;
      console.log(`[Test] ${name} → ${streams.length} stream(s) en ${elapsed}ms`);
      res.json({ provider: name, test: testLabel, elapsed, count: streams.length, streams });
    } catch (e) {
      const elapsed = Date.now() - t0;
      console.warn(`[Test] ${name} erreur (${elapsed}ms):`, e.message);
      res.status(500).json({ provider: name, test: testLabel, elapsed, error: e.message, streams: [] });
    }
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
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── TMDB lookup (avec cache) ─────────────────────────────────────────────────
  const TMDB_KEY = '8265bd1679663a7ea12ac168da84d2e8';

  async function getTmdbId(imdbId, mediaType) {
    const key = `${mediaType}:${imdbId}`;
    const cached = tmdbCache.get(key);
    if (cached && Date.now() - cached.ts < TMDB_CACHE_TTL) {
      console.log(`[TMDB] Cache hit: ${imdbId} → ${cached.id}`);
      return cached.id;
    }
    try {
      const resp = await withTimeout(
        fetch(`https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id`),
        5000, 'TMDB'
      );
      const data = await resp.json();
      const results = mediaType === 'movie' ? data.movie_results : data.tv_results;
      if (results && results.length > 0) {
        const id = String(results[0].id);
        tmdbCache.set(key, { id, ts: Date.now() });
        return id;
      }
    } catch (e) { console.error('[TMDB]', e.message); }
    return null;
  }

  // ─── Stream endpoint (avec cache + timeout par provider + LinkCheck) ──────────
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

    const active = Object.entries(providers).filter(([n]) => config.providers[n]?.enabled !== false);

    const results = await Promise.allSettled(
      active.map(([name, p]) => {
        const pt = Date.now();
        return withTimeout(
          Promise.resolve().then(() => p.getStreams(tmdbId, mediaType, season, episode)),
          PROVIDER_TIMEOUT_MS,
          name
        ).then(streams => {
          console.log(`[${name}] ${streams.length} stream(s) en ${Date.now() - pt}ms`);
          return streams;
        }).catch(err => {
          console.warn(`[${name}] ${err.message} (${Date.now() - pt}ms)`);
          return [];
        });
      })
    );

    const rawStreams = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    console.log(`[Stream] ${rawStreams.length} streams bruts en ${Date.now() - t0}ms — vérif des liens...`);

    // Étape C : filtrage des liens morts
    const streams = await filterDeadStreams(rawStreams);
    console.log(`[Stream] Total final: ${streams.length} streams valides en ${Date.now() - t0}ms`);

    if (streams.length > 0) streamCache.set(cacheKey, { streams, ts: Date.now() });

    res.json({ streams });
  });

  // ─── Keep-alive ────────────────────────────────────────────────────────────────
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