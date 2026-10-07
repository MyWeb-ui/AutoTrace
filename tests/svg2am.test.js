const fs = require('fs'), assert = require('assert'), A = require('../src/svg2am.js');
const xml = fs.readFileSync(__dirname + '/fixtures/sample.xml', 'utf8');
const ds = [...xml.matchAll(/<path d="([^"]+)"/g)].map(m => m[1]);
ds.forEach((d, i) => assert.strictEqual(A.toAmPath(d), d, 'roundtrip path ' + i)); // path AM asli harus identik persis
assert.strictEqual(A.toAmPath('M0 0 Q 30 0 30 30 Z'), 'M 0.0 0.0C 20.0 0.0, 30.0 10.0, 30.0 30.0L 0.0 0.0');
assert.strictEqual(A.toAmPath('m10 10 l5 0 v5 h-5 z'), 'M 10.0 10.0L 15.0 10.0L 15.0 15.0L 10.0 15.0L 10.0 10.0');
assert.strictEqual(A.toArgb('rgb(255,68,68)'), '#ffff4444');
assert.strictEqual(A.toArgb('#fff', 0.5), '#80ffffff');
assert.strictEqual(A.toAmPath('M720 720L 820 720', { offX: 720, offY: 720 }), 'M 0.0 0.0L 100.0 0.0');
const sc = A.buildScene({ width: 1440, height: 1440, shapes: [{ fill: 'rgb(255,68,68)', d: 'M0 0L10 0L10 10Z' }] });
assert(sc.includes('value="720.000000,720.000000,0.000000"') && sc.includes('#ffff4444'));
console.log('OK:', ds.length, 'path roundtrip + uji parser/warna/offset/scene');
