// Tiny .env loader (zero dependencies). Reads ../.env into process.env.
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const f = path.join(__dirname, '.env');
  try {
    fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    });
  } catch (e) { /* no .env file — fine, we fall back to simulation */ }
}

module.exports = { loadEnv };
