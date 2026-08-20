// L'Agent Augmenté — MVP server (zero npm dependencies). Run: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadEnv } = require('./env');
loadEnv();
const { scoreProperties } = require('./score');
const { sendConfirmation, sendPasswordReset } = require('./notify');
const db = require('./db');
const auth = require('./auth');
const { createCheckoutSession, retrieveCheckoutSession, verifyWebhook } = require('./stripe');

const PLANS = path.join(__dirname, 'plans.json');
const BASE_URL = process.env.BASE_URL || 'http://localhost:' + (process.env.PORT || 3000);

const readJSON = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return fb; } };
const send = (res, code, obj, extraHeaders) => { res.writeHead(code, { 'Content-Type': 'application/json', ...(extraHeaders || {}) }); res.end(JSON.stringify(obj)); };
const html = (res, code, str) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(str); };
const body = (req) => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch (e) { r({}); } }); });
const rawBody = (req) => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); });
const priceFor = (plan) => process.env['STRIPE_PRICE_' + String(plan || '').toUpperCase()] || '';
// Returns the logged-in agent id from the session cookie, or null. Used to gate private data.
const sessionAgentId = (req) => auth.verifyToken(auth.parseCookies(req).sess);
// Comp list: emails that get free (active) access even when billing is on (Nathalie, owner, VIPs).
const COMP_EMAILS = (process.env.COMP_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
const isComped = (email) => COMP_EMAILS.includes(String(email || '').toLowerCase());
// Returns the full logged-in agent record (with status), or null.
const currentAgent = async (req) => { const id = sessionAgentId(req); return id ? await db.findAgentById(id) : null; };
const isActive = (a) => !!(a && a.status === 'active');
// Admin list: ONLY owner emails may view the signups/visits dashboard (never the comp list — comped users like Nathalie are not admins).
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'jollyshah100@gmail.com,jolly@vsimplifai.com').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
const isAdmin = (a) => !!(a && ADMIN_EMAILS.includes(String(a.email || '').toLowerCase()));
// Brute-force protection: throttle failed logins per IP.
const loginFails = new Map(); // ip -> { count, first }
const LOGIN_MAX = 10, LOGIN_WINDOW = 15 * 60 * 1000;
const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'unknown';
const loginBlocked = (ip) => { const r = loginFails.get(ip); return !!(r && (Date.now() - r.first <= LOGIN_WINDOW) && r.count >= LOGIN_MAX); };
const noteLoginFail = (ip) => { const now = Date.now(); const r = loginFails.get(ip); if (!r || now - r.first > LOGIN_WINDOW) loginFails.set(ip, { count: 1, first: now }); else r.count++; };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');

  if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
    const agent = await currentAgent(req);
    if (isActive(agent)) return html(res, 200, fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'));
    if (agent) { res.writeHead(302, { Location: '/login?pay=1' }); return res.end(); } // logged in but not active -> finish payment
    // anonymous visitor -> log the visit (privacy-friendly, non-blocking) and serve the public landing page
    db.logVisit({ path: u.pathname, referrer: req.headers['referer'] || '', ua: req.headers['user-agent'] || '' });
    return html(res, 200, fs.readFileSync(path.join(__dirname, 'landing.html'), 'utf8'));
  }

  // --- Admin dashboard (owner-only): signups + visitor stats ---
  if (req.method === 'GET' && u.pathname === '/admin') {
    if (!isAdmin(await currentAgent(req))) { res.writeHead(302, { Location: '/login' }); return res.end(); }
    return html(res, 200, fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8'));
  }
  if (req.method === 'GET' && u.pathname === '/api/admin/data') {
    if (!isAdmin(await currentAgent(req))) return send(res, 401, { error: 'not authorized' });
    const agents = (await db.listAgents()).map(a => ({ email: a.email, plan: a.plan, status: a.status, created_at: a.created_at }));
    const visits = await db.listVisits();
    return send(res, 200, { agents, visits });
  }
  if (req.method === 'GET' && u.pathname === '/login') {
    // After Stripe payment, the user returns here with ?session_id=... — activate the account
    // directly from the completed checkout session (reliable even if the webhook isn't set up).
    const sid = u.searchParams.get('session_id');
    if (sid) {
      try {
        const s = await retrieveCheckoutSession(sid);
        if (s && s.status === 'complete' && s.client_reference_id) {
          await db.updateAgent(s.client_reference_id, { status: 'active', stripe_customer_id: s.customer || null });
        }
      } catch (e) { console.error('[activate-on-return]', e.message); }
    }
    return html(res, 200, fs.readFileSync(path.join(__dirname, 'login.html'), 'utf8'));
  }
  // Prospect-facing capture page (the public landing the QR/links point to)
  if (req.method === 'GET' && u.pathname === '/capture') {
    return html(res, 200, fs.readFileSync(path.join(__dirname, 'capture.html'), 'utf8'));
  }
  // Unlisted document hosting (for the DREETS / déclaration d'activité) — public-by-link, specific files only
  const DOCS = { '/docs/deroule-pedagogique.pdf': 'deroule-pedagogique.pdf', '/docs/note-justificative.pdf': 'note-justificative.pdf' };
  if (req.method === 'GET' && DOCS[u.pathname]) {
    try {
      const buf = fs.readFileSync(path.join(__dirname, DOCS[u.pathname]));
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="' + DOCS[u.pathname] + '"' });
      return res.end(buf);
    } catch (e) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Document not found'); }
  }
  // Consent register export (server-side proof file) — PRIVATE: login required, scoped to this agent only
  if (req.method === 'GET' && u.pathname === '/api/export.csv') {
    const me = await currentAgent(req);
    if (!isActive(me)) { res.writeHead(302, { Location: '/login' }); return res.end(); }
    const leads = await db.listLeadsByAgent(me.id); // only this agent's own leads
    const cols = ['id', 'name', 'email', 'phone', 'magnet', 'consent_status', 'consent_text', 'consent_channel', 'created_at', 'confirmed_at', 'callable', 'source', 'agent'];
    const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
    let csv = cols.join(';') + '\n';
    leads.forEach(l => { csv += cols.map(c => esc(l[c])).join(';') + '\n'; });
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="registre_consentement_${Date.now()}.csv"` });
    return res.end('﻿' + csv);
  }

  // --- Sign up: create account + Stripe Checkout subscription ---
  if (req.method === 'POST' && u.pathname === '/api/signup') {
    const b = await body(req);
    if (!b.email || !b.password) return send(res, 400, { error: 'email and password required' });
    if (await db.findAgentByEmail(b.email)) return send(res, 400, { error: 'account already exists' });
    const id = 'A' + Date.now();
    const agent = { id, email: b.email, password: auth.hashPassword(b.password), plan: b.plan || 'solo', status: 'pending', created_at: new Date().toISOString() };
    // Comped accounts (Nathalie, owner, VIPs) skip payment entirely and are active immediately.
    if (isComped(b.email)) {
      agent.status = 'active';
      await db.insertAgent(agent);
      return send(res, 200, { ok: true, url: `${BASE_URL}/login?welcome=1&comp=1`, comped: true });
    }
    const session = await createCheckoutSession({
      agentId: id, email: b.email, priceId: priceFor(b.plan),
      successUrl: `${BASE_URL}/login?welcome=1&session_id={CHECKOUT_SESSION_ID}`, cancelUrl: `${BASE_URL}/login?canceled=1`
    });
    if (session.error) return send(res, 502, { error: 'payment setup failed' }); // misconfig: do NOT create a free account
    if (session.simulated) agent.status = 'active'; // no Stripe key: free launch mode
    await db.insertAgent(agent);
    return send(res, 200, { ok: true, url: session.url, simulated: !!session.simulated });
  }

  // --- Log in: set a session cookie ---
  if (req.method === 'POST' && u.pathname === '/api/login') {
    const ip = clientIp(req);
    if (loginBlocked(ip)) return send(res, 429, { error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
    const b = await body(req);
    const agent = await db.findAgentByEmail(b.email || '');
    if (!agent || !auth.verifyPassword(b.password || '', agent.password)) { noteLoginFail(ip); return send(res, 401, { error: 'invalid credentials' }); }
    const cookie = `sess=${auth.signToken(agent.id)}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax`;
    return send(res, 200, { ok: true, plan: agent.plan, status: agent.status }, { 'Set-Cookie': cookie });
  }

  // --- Who am I (from the cookie) ---
  if (req.method === 'GET' && u.pathname === '/api/me') {
    const id = auth.verifyToken(auth.parseCookies(req).sess);
    const agent = id && await db.findAgentById(id);
    if (!agent) return send(res, 401, { error: 'not logged in' });
    return send(res, 200, {
      id: agent.id, email: agent.email, plan: agent.plan, status: agent.status,
      display_name: agent.display_name || '', agency: agent.agency || '',
      captureUrl: `${BASE_URL}/capture?a=${encodeURIComponent(agent.id)}`
    });
  }

  // --- Update my profile (display name + agency, used on the capture page + consent text) ---
  if (req.method === 'POST' && u.pathname === '/api/profile') {
    const me = await currentAgent(req);
    if (!me) return send(res, 401, { error: 'not logged in' });
    const b = await body(req);
    const updated = await db.updateAgent(me.id, { display_name: (b.display_name || '').slice(0, 80), agency: (b.agency || '').slice(0, 80) });
    return send(res, 200, { ok: true, display_name: updated.display_name || '', agency: updated.agency || '' });
  }

  // --- Public: capture page asks for the agent's display name/agency to render its header ---
  if (req.method === 'GET' && u.pathname === '/api/capture-info') {
    const agent = await db.findAgentById(u.searchParams.get('a') || '');
    if (!agent) return send(res, 404, { error: 'unknown' });
    return send(res, 200, { display_name: agent.display_name || '', agency: agent.agency || '' });
  }

  if (req.method === 'POST' && u.pathname === '/api/logout') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'sess=; HttpOnly; Path=/; Max-Age=0' });
  }

  // --- Forgot password: issue a single-use, 1h reset token and email it (never reveals if the email exists) ---
  if (req.method === 'POST' && u.pathname === '/api/forgot') {
    const ip = clientIp(req);
    if (loginBlocked(ip)) return send(res, 429, { error: 'Trop de demandes. Réessayez dans quelques minutes.' });
    const b = await body(req);
    const email = String(b.email || '').trim();
    const agent = email ? await db.findAgentByEmail(email) : null;
    if (agent) {
      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await db.updateAgent(agent.id, { reset_token: token, reset_expires: expires });
      try { await sendPasswordReset(agent.email, agent.display_name || '', `${BASE_URL}/reset?token=${token}`); } catch (e) { console.error('[forgot]', e.message); }
    } else {
      noteLoginFail(ip); // throttle probing for accounts that don't exist
    }
    return send(res, 200, { ok: true, message: "Si un compte existe pour cet email, un lien de réinitialisation vient d'être envoyé." });
  }

  // --- Reset page (the email link lands here) ---
  if (req.method === 'GET' && u.pathname === '/reset') {
    return html(res, 200, fs.readFileSync(path.join(__dirname, 'reset.html'), 'utf8'));
  }

  // --- Set a new password from a valid, unexpired, single-use token ---
  if (req.method === 'POST' && u.pathname === '/api/reset') {
    const b = await body(req);
    const token = String(b.token || '').trim();
    const pw = String(b.password || '');
    if (!token || pw.length < 6) return send(res, 400, { error: 'Lien ou mot de passe invalide (6 caractères minimum).' });
    const agent = await db.findAgentByResetToken(token);
    if (!agent || !agent.reset_expires || new Date(agent.reset_expires).getTime() < Date.now()) {
      return send(res, 400, { error: 'Lien invalide ou expiré. Merci de refaire une demande.' });
    }
    await db.updateAgent(agent.id, { password: auth.hashPassword(pw), reset_token: null, reset_expires: null });
    return send(res, 200, { ok: true });
  }

  // --- Stripe webhook: keep account status in sync with the subscription ---
  if (req.method === 'POST' && u.pathname === '/api/stripe/webhook') {
    const raw = await rawBody(req);
    const event = verifyWebhook(raw, req.headers['stripe-signature']);
    if (!event) return send(res, 400, { error: 'invalid signature' });
    const obj = (event.data && event.data.object) || {};
    try {
      if (event.type === 'checkout.session.completed') {
        // Payment/trial started -> activate + remember the Stripe customer for later lifecycle events.
        if (obj.client_reference_id) await db.updateAgent(obj.client_reference_id, { status: 'active', stripe_customer_id: obj.customer || null });
      } else if (event.type === 'customer.subscription.deleted') {
        // Subscription ended -> cut access.
        const a = await db.findAgentByStripeCustomer(obj.customer);
        if (a) await db.updateAgent(a.id, { status: 'inactive' });
      } else if (event.type === 'customer.subscription.updated') {
        // Follow the subscription state: active/trialing keep access; anything else (canceled, unpaid, past_due) cuts it.
        const a = await db.findAgentByStripeCustomer(obj.customer);
        if (a) { const ok = (obj.status === 'active' || obj.status === 'trialing'); await db.updateAgent(a.id, { status: ok ? 'active' : 'inactive' }); }
      }
    } catch (e) { console.error('[stripe webhook]', e.message); }
    return send(res, 200, { received: true });
  }

  // Today's ranked properties — AI-scored if a key is set, else rules
  if (req.method === 'GET' && u.pathname === '/api/properties') {
    if (!isActive(await currentAgent(req))) return send(res, 401, { error: 'not active' });
    const scored = (await scoreProperties(await db.listProperties())).sort((a, b) => b.score - a.score);
    return send(res, 200, scored);
  }

  if (req.method === 'GET' && u.pathname === '/api/leads') {
    const me = await currentAgent(req);
    if (!isActive(me)) return send(res, 401, { error: 'not active' });
    return send(res, 200, await db.listLeadsByAgent(me.id)); // only this agent's own leads
  }

  if (req.method === 'GET' && u.pathname === '/api/plans') {
    return send(res, 200, readJSON(PLANS, []));
  }

  // Tells the signup page whether real billing is on (Stripe key present) or free (launch) mode
  if (req.method === 'GET' && u.pathname === '/api/config') {
    return send(res, 200, { billing: !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_SOLO) });
  }

  // Capture: prospect submits the form -> pending lead (tied to the capturing agent) + confirmation
  if (req.method === 'POST' && u.pathname === '/api/optin') {
    const b = await body(req);
    // Resolve the owning agent: from the capture link's agent_id, else the logged-in agent (in-app test).
    let owner = b.agent_id ? await db.findAgentById(b.agent_id) : null;
    if (!owner) owner = await currentAgent(req);
    const agentName = (owner && (owner.display_name || String(owner.email || '').split('@')[0])) || b.agent || "l'agent";
    const agencyName = (owner && owner.agency) || b.agency || process.env.AGENCY_NAME || 'votre agence';
    const id = 'L' + Date.now();
    const token = crypto.randomUUID();
    const consent_text = `J'accepte que ${agentName} (${agencyName}) me contacte par téléphone au sujet de ${b.magnet || 'mon estimation'}.`;
    const lead = {
      id, token, name: b.name || '', email: b.email || '', phone: b.phone || '',
      magnet: b.magnet || 'Estimation gratuite', source: b.source || 'landing',
      agent: agentName, agent_id: owner ? owner.id : null,
      consent_status: 'pending', consent_text, consent_channel: 'phone',
      intent: null, callable: false, created_at: new Date().toISOString(), confirmed_at: null
    };
    await db.insertLead(lead);
    const confirmUrl = `${BASE_URL}/confirm?token=${token}`;
    const result = await sendConfirmation(lead, confirmUrl);
    return send(res, 200, {
      ok: true, id,
      message: result.simulated
        ? 'Confirmation simulée (ajoutez BREVO_API_KEY pour un envoi réel). En attente de OUI.'
        : `Confirmation envoyée (email: ${result.email}, sms: ${result.sms}). En attente de OUI.`,
      confirmUrl
    });
  }

  // Real double opt-in: the email/SMS link lands here
  if (req.method === 'GET' && u.pathname === '/confirm') {
    const token = u.searchParams.get('token');
    const lead = token && await db.confirmLead(token);
    if (!lead) return html(res, 404, '<h2>Lien invalide ou expiré.</h2>');
    return html(res, 200,
      `<div style="font-family:Arial;max-width:480px;margin:60px auto;text-align:center">
        <h2 style="color:#2E8B57">Merci, ${lead.name} !</h2>
        <p>Votre accord est enregistré. ${lead.agent} pourra vous contacter au sujet de votre estimation.</p>
        <p style="color:#888;font-size:13px">Consentement confirmé le ${new Date(lead.confirmed_at).toLocaleString('fr-FR')}.</p>
      </div>`);
  }

  // Dashboard "Simuler OUI" (by id) — only on the agent's own leads
  if (req.method === 'POST' && u.pathname === '/api/confirm') {
    const me = await currentAgent(req);
    if (!isActive(me)) return send(res, 401, { error: 'not active' });
    const b = await body(req);
    const owned = (await db.listLeadsByAgent(me.id)).some(l => l.id === b.id);
    if (!owned) return send(res, 404, { error: 'not found' });
    const lead = await db.confirmLead(b.id, b.intent || 'seller');
    if (!lead) return send(res, 404, { error: 'not found' });
    return send(res, 200, { ok: true, lead });
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  const ai = process.env.ANTHROPIC_API_KEY ? 'ON' : 'OFF (rules)';
  const brevo = process.env.BREVO_API_KEY ? 'ON' : 'OFF (simulated)';
  const store = db.useSupabase ? 'Supabase (EU)' : 'JSON files (local)';
  const stripe = process.env.STRIPE_SECRET_KEY ? 'ON' : 'OFF (simulated)';
  console.log(`L'Agent Augmenté MVP -> ${BASE_URL}  | AI: ${ai} | Brevo: ${brevo} | Store: ${store} | Stripe: ${stripe}`);
});
