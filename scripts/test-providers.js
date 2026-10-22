const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..');
const configPath = path.join(rootDir, 'config.json');
let config = { providers: {} };
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
  console.warn('[Test] config.json missing, defaulting');
}

const providerDir = path.join(rootDir, 'providers');
const testCases = [
  { tmdbId: '27205', type: 'movie', label: 'Film: Inception (TMDB 27205)' },
  { tmdbId: '96677', type: 'tv', season: 1, episode: 1, label: 'Série VF: Lupin S1E1 (TMDB 96677)' },
  { tmdbId: '1429', type: 'tv', season: 1, episode: 1, label: 'Anime: L\'Attaque des Titans S1E1 (TMDB 1429)' },
  { tmdbId: '2190', type: 'tv', season: 1, episode: 1, label: 'Série Culte: South Park S1E1 (TMDB 2190)' }
];

async function run() {
  console.log('====================================================');
  console.log('🎬 NUVIO FRENCH PROVIDERS — AUDIT & HEALTH CHECK');
  console.log('====================================================\n');

  const files = fs.readdirSync(providerDir).filter(f => f.endsWith('.js'));
  const activeProviders = files
    .map(f => f.replace('.js', ''))
    .filter(name => config.providers[name]?.enabled !== false);

  console.log(`Found ${files.length} total providers | ${activeProviders.length} active in config.json\n`);

  for (const name of activeProviders) {
    console.log(`----------------------------------------------------`);
    console.log(`🔍 Testing Provider: [${name.toUpperCase()}]`);
    console.log(`----------------------------------------------------`);

    let mod;
    try {
      mod = require(path.join(providerDir, name + '.js'));
    } catch (e) {
      console.log(`❌ FAILED TO LOAD: ${e.message}\n`);
      continue;
    }

    if (typeof mod.getStreams !== 'function') {
      console.log(`❌ NO getStreams() EXPORT\n`);
      continue;
    }

    for (const tc of testCases) {
      const t0 = Date.now();
      try {
        const streams = await Promise.race([
          mod.getStreams(tc.tmdbId, tc.type, tc.season || 1, tc.episode || 1),
          new Promise((_, r) => setTimeout(() => r(new Error('TIMEOUT (12s)')), 12000))
        ]);

        const count = Array.isArray(streams) ? streams.length : 0;
        const ms = Date.now() - t0;

        if (count > 0) {
          console.log(`  ✅ ${tc.label} -> ${count} flux (${ms}ms)`);
          const s = streams[0];
          console.log(`     Sample: ${s.name} | ${s.quality || 'HD'} | ${s.title ? s.title.replace(/\n/g, ' ') : ''}`);
          console.log(`     URL:    ${(s.url || '').slice(0, 85)}...`);
        } else {
          console.log(`  ⚠️ ${tc.label} -> 0 flux (${ms}ms)`);
        }
      } catch (err) {
        console.log(`  ❌ ${tc.label} -> ERREUR: ${err.message} (${Date.now() - t0}ms)`);
      }
    }
    console.log('');
  }

  console.log('====================================================');
  console.log('Audit terminé.');
  console.log('====================================================');
}

run();
