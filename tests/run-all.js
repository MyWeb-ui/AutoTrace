'use strict';
const { execFileSync } = require('child_process'), path = require('path');
for (const t of ['svg2am.test.js', 'engine.test.js']) { process.stdout.write(t + ' → '); execFileSync(process.execPath, [path.join(__dirname, t)], { stdio: 'inherit' }); }
