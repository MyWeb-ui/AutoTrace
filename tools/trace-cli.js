#!/usr/bin/env node
/* node tools/trace-cli.js in.png out.svg ['{"colors":10}']  — jalankan engine tanpa server (untuk uji/diagnosa). */
'use strict';
const fs = require('fs'), path = require('path');
const { decodePNG } = require('../lib/png.js'), E = require('../lib/engine.js');
const [, , inp, outp, optj] = process.argv;
if (!inp) { console.error('pakai: node tools/trace-cli.js in.png out.svg [json-opts]'); process.exit(1); }
const img = decodePNG(fs.readFileSync(inp)), opts = optj ? JSON.parse(optj) : {};
const res = E.trace(img, opts);
fs.writeFileSync(outp || 'out.svg', E.toSVG(res, { bg: opts.previewBg }));
console.log(JSON.stringify(res.stats));
