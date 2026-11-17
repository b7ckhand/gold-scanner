'use strict';
const { run } = require('./run.js');
run({ env: process.env, fetchImpl: fetch, log: console.log })
  .then(r => { console.log('scan finished', JSON.stringify(r)); })
  .catch(e => { console.error('scan failed:', e.message); process.exit(e.fatal ? 1 : 0); });
