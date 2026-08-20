// L'Agent Augmenté — minimal auth (zero dependencies).
// MVP-grade: hashed passwords + signed session cookie. For production,
// prefer Supabase Auth; this proves the flow.
const crypto = require('crypto');
// Never sign sessions with a known/guessable default. If SESSION_SECRET is unset
// (or left at the dev placeholder), generate a strong random secret at startup so
// session cookies can never be forged. Set SESSION_SECRET in the environment for
// stable sessions across restarts (otherwise users are logged out on each restart).
let SECRET = process.env.SESSION_SECRET;
if (!SECRET || SECRET === 'dev-secret-change-me') {
  SECRET = crypto.randomBytes(48).toString('hex');
  console.warn('[auth] SESSION_SECRET not set — using a random ephemeral secret. Set SESSION_SECRET for stable sessions.');
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const h = crypto.scryptSync(pw, salt, 64).toString('hex');
  return h.length === hash.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(hash));
}

function signToken(id) {
  const sig = crypto.createHmac('sha256', SECRET).update(id).digest('hex');
  return Buffer.from(id).toString('base64') + '.' + sig;
}

function verifyToken(tok) {
  if (!tok || !tok.includes('.')) return null;
  const [b, sig] = tok.split('.');
  let id;
  try { id = Buffer.from(b, 'base64').toString('utf8'); } catch (e) { return null; }
  const exp = crypto.createHmac('sha256', SECRET).update(id).digest('hex');
  if (sig.length === exp.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return id;
  return null;
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const i = c.indexOf('=');
    if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, parseCookies };
