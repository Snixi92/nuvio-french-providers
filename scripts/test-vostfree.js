const vostfree = require('../providers/vostfree');

async function runTest() {
  console.log('Testing VostFree provider on One Piece (TMDB 37854 S01E01)...');
  const start = Date.now();
  const streams = await vostfree.getStreams('37854', 'tv', 1, 1);
  const elapsed = Date.now() - start;

  console.log(`Resolved ${streams.length} streams in ${elapsed}ms:`);
  streams.forEach((s, idx) => {
    console.log(` [${idx + 1}] ${s.name} - ${s.title}`);
    console.log(`     URL: ${s.url}`);
    console.log(`     Quality: ${s.quality}`);
  });

  if (streams.length > 0) {
    console.log('\n✅ VostFree test PASSED!');
    process.exit(0);
  } else {
    console.error('\n❌ VostFree test FAILED: 0 streams returned');
    process.exit(1);
  }
}

runTest();
