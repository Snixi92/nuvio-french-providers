const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || 'Snixi92/nuvio-french-providers';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '';

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json());

// --- Config ---
let config = { providers: {} };
try {
  config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
} catch (e) {
  console.log('[Config] config.json absent, utilisation des valeurs par défaut');
}

// --- Chargement des providers ---
const providers = {};
const providerDir = path.join(__dirname, 'providers');
try {
  const files = fs.readdirSync(providerDir).filter(f => f.endsWith('.js'));
  for (const file of files) {
    const name = path.basename(file, '.js');
    try {
      providers[name] = require(path.join(providerDir, file));
      if (!config.providers[name]) config.providers[name] = { enabled: true };
      console.log('[Server] Provider chargé :', name);
    } catch (e) {
      console.warn('[Server] Erreur provider', name, ':', e.message);
    }
  }
} catch (e) {
  console.error('[Server] Impossible de lire le dossier providers :', e.message);
}

const manifest = require('./manifest.json');

// --- GitHub API ---
async function githubGetFile(filePath) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' }
  });
  return await res.json();
}

async function githubPush(filePath, content, message) {
  const existing = await githubGetFile(filePath).catch(() => null);
  const sha = existing && existing.sha ? existing.sha : undefined;
  const body = {
    message,
    content: Buffer.from(content).toString('base64'),
    ...(sha ? { sha } : {})
  };
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!data.content) throw new Error(data.message || 'GitHub push échoué');
  return data;
}

async function saveConfig() {
  await githubPush('config.json', JSON.stringify(config, null, 2), 'chore: mise à jour config depuis dashboard');
}

// --- Auth middleware pour le dashboard ---
function dashboardAuth(req, res, next) {
  if (!DASHBOARD_PASSWORD) return next();
  const pwd = req.headers['x-dashboard-password'] || req.query.pwd;
  if (pwd !== DASHBOARD_PASSWORD) return res.status(401).json({ error: 'Mot de passe incorrect' });
  next();
}

// --- Routes Stremio ---
app.get('/', (req, res) => res.redirect('/manifest.json'));
app.get('/manifest.json', (req, res) => res.json(manifest));
app.get('/healthz', (req, res) => {
  res.json({ status: 'ok', providers: Object.keys(providers).filter(n => config.providers[n]?.enabled !== false) });
});

// --- Dashboard HTML ---
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// --- API Dashboard ---

// Statut de tous les providers
app.get('/api/dashboard/status', dashboardAuth, (req, res) => {
  const status = {};
  for (const name of Object.keys(providers)) {
    status[name] = { enabled: config.providers[name]?.enabled !== false };
  }
  // Providers dans config mais pas encore chargés (ajoutés, en attente de redéploiement)
  for (const name of Object.keys(config.providers)) {
    if (!status[name]) status[name] = { enabled: config.providers[name]?.enabled !== false, pending: true };
  }
  res.json({ providers: status, hasGithub: !!GITHUB_TOKEN, passwordRequired: !!DASHBOARD_PASSWORD });
});

// Toggle activer/désactiver un provider
app.post('/api/dashboard/toggle/:name', dashboardAuth, async (req, res) => {
  const { name } = req.params;
  if (!providers[name] && !config.providers[name]) return res.status(404).json({ error: 'Provider introuvable' });
  if (!config.providers[name]) config.providers[name] = {};
  config.providers[name].enabled = !(config.providers[name].enabled !== false);
  const enabled = config.providers[name].enabled;
  res.json({ name, enabled });
  saveConfig().catch(e => console.error('[Config] Sauvegarde échouée:', e.message));
});

// Ajouter ou remplacer un provider depuis une URL
app.post('/api/dashboard/provider/add', dashboardAuth, async (req, res) => {
  const { url, name } = req.body;
  if (!url) return res.status(400).json({ error: 'URL requise' });
  if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN non configuré sur Render' });

  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} lors du téléchargement`);
    const code = await resp.text();
    if (!code || code.length < 10) throw new Error('Fichier vide ou invalide');

    const providerName = (name || url.split('/').pop().replace(/\.js$/i, '')).replace(/[^a-z0-9_-]/gi, '_');
    await githubPush(`providers/${providerName}.js`, code, `feat: add/update provider "${providerName}" via dashboard`);

    if (!config.providers[providerName]) config.providers[providerName] = { enabled: true };
    await saveConfig();

    res.json({ success: true, name: providerName, message: `Provider "${providerName}" ajouté. Redéploiement Render en cours (~2 min).` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Stremio stream endpoint ---
const TMDB_KEY = '8265bd1679663a7ea12ac168da84d2e8';

async function getTmdbId(imdbId, mediaType) {
  try {
    const resp = await fetch(`https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id`);
    const data = await resp.json();
    const results = mediaType === 'movie' ? data.movie_results : data.tv_results;
    if (results && results.length > 0) return String(results[0].id);
  } catch (e) { console.error('[TMDB]', e.message); }
  return null;
}

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

  console.log(`[Stream] ${mediaType} tmdb=${tmdbId} S${season}E${episode}`);
  const active = Object.entries(providers).filter(([n]) => config.providers[n]?.enabled !== false);
  const results = await Promise.allSettled(
    active.map(([n, p]) =>
      Promise.resolve().then(() => p.getStreams(tmdbId, mediaType, season, episode))
        .then(s => { console.log(`[${n}] ${s.length} stream(s)`); return s; })
        .catch(e => { console.error(`[${n}]`, e.message); return []; })
    )
  );
  res.json({ streams: results.flatMap(r => r.status === 'fulfilled' ? r.value : []) });
});

// --- Démarrage ---
app.listen(PORT, () => {
  console.log(`[Server] Port ${PORT}`);
  if (process.env.NODE_ENV === 'production' && process.env.RENDER_EXTERNAL_URL) {
    const pingUrl = process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '') + '/healthz';
    console.log(`[Keep-alive] → ${pingUrl}`);
    setInterval(async () => {
      try { const r = await fetch(pingUrl, { signal: AbortSignal.timeout(10000) }); console.log(`[Keep-alive] OK ${r.status}`); }
      catch (e) { console.warn('[Keep-alive] Échec:', e.message); }
    }, 10 * 60 * 1000);
  }
});
