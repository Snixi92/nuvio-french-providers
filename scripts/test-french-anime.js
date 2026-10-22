const path = require('path');
const assert = require('assert');

// ── Chargement du Provider ───────────────────────────────────────────────────
const providerPath = path.join(__dirname, '..', 'providers', 'french-anime.js');
const frenchAnime = require(providerPath);

console.log('====================================================');
console.log('🧪 TEST SUITE: NUVIO PROVIDER "french-anime"');
console.log('====================================================\n');

async function runTests() {
  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
    }
  }

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
    }
  }

  // ── 1. Contrat d'interface ─────────────────────────────────────────────────
  test('Interface Contract: getStreams function is exported', () => {
    assert.strictEqual(typeof frenchAnime.getStreams, 'function', 'getStreams must be a function');
    assert.strictEqual(frenchAnime.getStreams.length, 4, 'getStreams must accept 4 arguments (tmdbId, mediaType, season, episode)');
  });

  // ── 2. Test du Scoring & Matching de Titres ───────────────────────────────
  test('Scoring: scoreMatch evaluates relevant anime fiches', () => {
    const s1 = frenchAnime._scoreMatch('One Piece VF', 'One Piece', 1);
    const s2 = frenchAnime._scoreMatch('Naruto Shippuden VF', 'One Piece', 1);
    const s3 = frenchAnime._scoreMatch('Bleach Saison 2 VF', 'Bleach', 2);
    const s4 = frenchAnime._scoreMatch('Bleach Saison 1 VF', 'Bleach', 2);

    assert(s1 > 50, `Expected s1 > 50, got ${s1}`);
    assert(s2 === 0, `Expected s2 === 0, got ${s2}`);
    assert(s3 > s4, `Expected season 2 fiche (${s3}) to score higher than season 1 (${s4}) for season 2 query`);
  });

  // ── 3. Test du Parsing des Résultats DLE ──────────────────────────────────
  test('DLE Search Parser: extracts article titles and links', () => {
    const sampleDleHtml = `
      <div class="short-story">
        <div class="short-title">
          <a href="https://french-anime.com/exclue/975--1onfepiefcffezzfafghb.html">One Piece VF</a>
        </div>
      </div>
      <div class="short-story">
        <a href="/anime/3421-one-piece-vostfr.html">One Piece VOSTFR</a>
      </div>
    `;

    const found = [];
    frenchAnime._parseDleSearchResults(sampleDleHtml, (title, url) => {
      found.push({ title, url });
    });

    assert.strictEqual(found.length, 2, 'Should extract 2 search results');
    assert.strictEqual(found[0].title, 'One Piece VF');
    assert.strictEqual(found[0].url, 'https://french-anime.com/exclue/975--1onfepiefcffezzfafghb.html');
    assert.strictEqual(found[1].title, 'One Piece VOSTFR');
  });

  // ── 4. Test d'Extraction des Épisodes Sibnet ───────────────────────────────
  test('Episode Extractor: handles numbered buttons / links', () => {
    const sampleFicheHtml = `
      <div class="episodes-list">
        <a href="https://video.sibnet.ru/shell.php?videoid=5000001">Épisode 1</a>
        <a href="https://video.sibnet.ru/shell.php?videoid=5000002">Épisode 2</a>
        <a href="https://video.sibnet.ru/shell.php?videoid=5000003">Épisode 3</a>
      </div>
    `;

    const ep1 = frenchAnime._extractEpisodeSibnetUrls(sampleFicheHtml, 1);
    const ep2 = frenchAnime._extractEpisodeSibnetUrls(sampleFicheHtml, 2);

    assert.strictEqual(ep1.length, 1);
    assert.strictEqual(ep1[0].videoId, '5000001');
    assert.strictEqual(ep2.length, 1);
    assert.strictEqual(ep2[0].videoId, '5000002');
  });

  test('Episode Extractor: handles sequential Sibnet IDs (One Piece fiche pattern)', () => {
    // Simule la fiche One Piece 'https://french-anime.com/exclue/975--1onfepiefcffezzfafghb.html'
    const sampleSequentialHtml = `
      <div class="player-container">
        <!-- Centaines d'IDs Sibnet dans l'ordre séquentiel des épisodes -->
        <iframe src="//video.sibnet.ru/shell.php?videoid=1001001"></iframe>
        <iframe src="//video.sibnet.ru/shell.php?videoid=1001002"></iframe>
        <iframe src="//video.sibnet.ru/shell.php?videoid=1001003"></iframe>
        <iframe src="//video.sibnet.ru/shell.php?videoid=1001004"></iframe>
      </div>
    `;

    const ep1 = frenchAnime._extractEpisodeSibnetUrls(sampleSequentialHtml, 1);
    const ep3 = frenchAnime._extractEpisodeSibnetUrls(sampleSequentialHtml, 3);

    assert.strictEqual(ep1.length, 1);
    assert.strictEqual(ep1[0].videoId, '1001001');
    assert.strictEqual(ep3.length, 1);
    assert.strictEqual(ep3[0].videoId, '1001003');
  });

  // ── 5. Test de Résolution Sibnet (Direct MP4 Extraction) ───────────────────
  await testAsync('Sibnet Resolver: decodes direct /videocdn/...mp4 from Sibnet HTML', async () => {
    // Mock fetch pour simuler le player Sibnet
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      if (url.includes('video.sibnet.ru/shell.php')) {
        return {
          ok: true,
          status: 200,
          text: async () => `
            <!DOCTYPE html>
            <html>
              <head><title>Sibnet Player</title></head>
              <body>
                <script>
                  player.src([{"src":"/videocdn/5471054/5471054.mp4","type":"video/mp4"}]);
                </script>
              </body>
            </html>
          `
        };
      }
      return originalFetch(url, opts);
    };

    try {
      const res = await frenchAnime._resolveSibnet('https://video.sibnet.ru/shell.php?videoid=5471054');
      assert.strictEqual(res.isDirect, true, 'isDirect should be true');
      assert.strictEqual(res.url, 'https://video.sibnet.ru/videocdn/5471054/5471054.mp4', 'URL must be full MP4');
      assert.strictEqual(res.headers.Referer, 'https://video.sibnet.ru/', 'Referer header must be video.sibnet.ru');
    } finally {
      global.fetch = originalFetch;
    }
  });

  // ── 6. Test End-to-End: getStreams (One Piece TMDB: 37854 S01E01) ──────────
  await testAsync('End-to-End: getStreams returns valid StreamObject for One Piece (TMDB 37854)', async () => {
    const originalFetch = global.fetch;
    const t0 = Date.now();

    // Mock intelligent : Intercepte french-anime.com et sibnet.ru tout en laissant TMDB actif
    global.fetch = async (url, opts) => {
      const urlStr = String(url);

      if (urlStr.includes('french-anime.com/index.php?do=search')) {
        return {
          ok: true,
          status: 200,
          text: async () => `
            <div class="short-story">
              <div class="short-title">
                <a href="https://french-anime.com/exclue/975--1onfepiefcffezzfafghb.html">One Piece VF</a>
              </div>
            </div>
            <div class="short-story">
              <div class="short-title">
                <a href="https://french-anime.com/anime/1020-one-piece-vostfr.html">One Piece VOSTFR</a>
              </div>
            </div>
          `
        };
      }

      if (urlStr.includes('french-anime.com/exclue/975--1onfepiefcffezzfafghb.html')) {
        return {
          ok: true,
          status: 200,
          text: async () => `
            <div class="full-story">
              <h1>One Piece VF Streaming</h1>
              <div class="episodes-links">
                <a href="https://video.sibnet.ru/shell.php?videoid=4729101">Épisode 1</a>
                <a href="https://video.sibnet.ru/shell.php?videoid=4729102">Épisode 2</a>
                <a href="https://video.sibnet.ru/shell.php?videoid=4729103">Épisode 3</a>
              </div>
            </div>
          `
        };
      }

      if (urlStr.includes('video.sibnet.ru/shell.php?videoid=4729101')) {
        return {
          ok: true,
          status: 200,
          text: async () => `
            <script>
              var player_params = { file: "/videocdn/4729101/onepiece_01.mp4" };
            </script>
          `
        };
      }

      // Requêtes réelles pour TMDB (ou autre)
      return originalFetch(url, opts);
    };

    try {
      const streams = await frenchAnime.getStreams('37854', 'tv', 1, 1);
      const elapsed = Date.now() - t0;

      assert(Array.isArray(streams), 'Streams must be an array');
      assert(streams.length > 0, 'Should find at least 1 stream');

      const s = streams[0];
      console.log(`     -> Found ${streams.length} stream(s) in ${elapsed}ms`);
      console.log(`     -> Sample Name:     ${s.name}`);
      console.log(`     -> Sample Title:    ${s.title}`);
      console.log(`     -> Sample URL:      ${s.url}`);
      console.log(`     -> Quality / Type:  ${s.quality} / ${s.type}`);
      console.log(`     -> Headers:         ${JSON.stringify(s.headers)}`);

      // Vérification des spécifications Nuvio StreamObject
      assert(s.name.includes('French Anime'), 'Stream name should identify provider');
      assert(s.title.includes('One Piece') && s.title.includes('S01E01'), 'Title should contain anime and episode');
      assert(s.url.startsWith('https://video.sibnet.ru/videocdn/'), 'Direct URL should point to Sibnet CDN');
      assert.strictEqual(s.type, 'mp4', 'Type must be mp4');
      assert.strictEqual(s.language, 'fr', 'Language must be fr');
      assert.strictEqual(s.headers.Referer, 'https://video.sibnet.ru/', 'Referer must be video.sibnet.ru');
      assert(elapsed < 3000, `Execution time must be < 3000ms (was ${elapsed}ms)`);
    } finally {
      global.fetch = originalFetch;
    }
  });

  // ── 7. Test End-to-End: Bleach (TMDB: 30984) ──────────────────────────────
  await testAsync('End-to-End: getStreams handles Bleach (TMDB 30984 S01E01)', async () => {
    const originalFetch = global.fetch;
    const t0 = Date.now();

    global.fetch = async (url, opts) => {
      const urlStr = String(url);

      if (urlStr.includes('french-anime.com/index.php?do=search')) {
        return {
          ok: true,
          status: 200,
          text: async () => `
            <div class="short-story">
              <a href="https://french-anime.com/anime/540-bleach-vf.html">Bleach VF</a>
            </div>
          `
        };
      }

      if (urlStr.includes('french-anime.com/anime/540-bleach-vf.html')) {
        return {
          ok: true,
          status: 200,
          text: async () => `
            <div class="full-story">
              <a href="https://video.sibnet.ru/shell.php?videoid=3124501">Épisode 1</a>
            </div>
          `
        };
      }

      if (urlStr.includes('video.sibnet.ru/shell.php?videoid=3124501')) {
        return {
          ok: true,
          status: 200,
          text: async () => `player.src([{"src":"/videocdn/3124501/bleach_01.mp4"}]);`
        };
      }

      return originalFetch(url, opts);
    };

    try {
      const streams = await frenchAnime.getStreams('30984', 'tv', 1, 1);
      const elapsed = Date.now() - t0;

      assert(Array.isArray(streams) && streams.length > 0, 'Should find streams for Bleach');
      assert(streams[0].title.includes('Bleach'), 'Title should mention Bleach');
      assert(elapsed < 3000, `Execution time should be fast (< 3000ms, took ${elapsed}ms)`);
    } finally {
      global.fetch = originalFetch;
    }
  });

  // ── Résumé ─────────────────────────────────────────────────────────────────
  console.log('\n====================================================');
  console.log(`📊 RÉSULTAT : ${passed} / ${total} tests réussis`);
  console.log('====================================================');

  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
