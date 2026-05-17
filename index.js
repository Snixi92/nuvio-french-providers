const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS requis pour Stremio / Nuvio
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  next();
});

// Chargement des providers
const providers = {};
const providerNames = ['nakios', 'purstream', 'movix', 'toflix', 'frenchstream'];
for (const name of providerNames) {
  try {
    providers[name] = require('./providers/' + name);
    console.log('[Server] Provider chargé :', name);
  } catch (e) {
    console.warn('[Server] Provider introuvable :', name, e.message);
  }
}

const manifest = require('./manifest.json');

// --- Routes ---

app.get('/', (req, res) => {
  res.redirect('/manifest.json');
});

app.get('/manifest.json', (req, res) => {
  res.json(manifest);
});

app.get('/healthz', (req, res) => {
  res.json({ status: 'ok', providers: Object.keys(providers) });
});

// Conversion IMDB -> TMDB
const TMDB_KEY = '8265bd1679663a7ea12ac168da84d2e8';

async function getTmdbId(imdbId, mediaType) {
  try {
    const resp = await fetch(
      `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id`
    );
    const data = await resp.json();
    const results = mediaType === 'movie' ? data.movie_results : data.tv_results;
    if (results && results.length > 0) return String(results[0].id);
  } catch (e) {
    console.error('[TMDB] Lookup failed:', e.message);
  }
  return null;
}

// Stream endpoint
// Stremio envoie : /stream/movie/tt1234567.json
//                  /stream/series/tt1234567:1:1.json
//                  /stream/movie/tmdb:1234567.json
app.get('/stream/:type/:id.json', async (req, res) => {
  const { type, id } = req.params;
  const parts = id.split(':');

  let tmdbId, season = 1, episode = 1;
  const mediaType = type === 'series' ? 'tv' : 'movie';

  if (parts[0] === 'tmdb') {
    tmdbId = parts[1];
    if (parts.length >= 4) {
      season  = parseInt(parts[2]) || 1;
      episode = parseInt(parts[3]) || 1;
    }
  } else {
    // IMDB ID (tt...)
    const imdbId = parts[0];
    if (parts.length >= 3) {
      season  = parseInt(parts[1]) || 1;
      episode = parseInt(parts[2]) || 1;
    }
    tmdbId = await getTmdbId(imdbId, mediaType);
    if (!tmdbId) {
      console.warn('[Stream] TMDB lookup failed pour', imdbId);
      return res.json({ streams: [] });
    }
  }

  console.log(`[Stream] ${mediaType} tmdb=${tmdbId} S${season}E${episode}`);

  const results = await Promise.allSettled(
    Object.entries(providers).map(([name, p]) =>
      Promise.resolve()
        .then(() => p.getStreams(tmdbId, mediaType, season, episode))
        .then(streams => {
          console.log(`[${name}] ${streams.length} stream(s) trouvé(s)`);
          return streams;
        })
        .catch(err => {
          console.error(`[${name}] Erreur:`, err.message);
          return [];
        })
    )
  );

  const streams = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  console.log(`[Stream] Total : ${streams.length} stream(s)`);

  res.json({ streams });
});

// --- Démarrage ---

app.listen(PORT, () => {
  console.log(`[Server] En écoute sur le port ${PORT}`);

  // Keep-alive : se ping lui-même toutes les 10 min pour éviter la mise en veille (Render free tier)
  if (process.env.NODE_ENV === 'production' && process.env.RENDER_EXTERNAL_URL) {
    const pingUrl = process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '') + '/healthz';
    console.log(`[Keep-alive] Démarré → ${pingUrl} (toutes les 10 min)`);
    setInterval(async () => {
      try {
        const r = await fetch(pingUrl, { signal: AbortSignal.timeout(10000) });
        console.log(`[Keep-alive] Ping OK (${r.status})`);
      } catch (e) {
        console.warn('[Keep-alive] Ping échoué :', e.message);
      }
    }, 10 * 60 * 1000);
  }
});
