// L'Agent Augmenté — data layer.
// Uses Supabase (EU) when SUPABASE_URL + SUPABASE_SERVICE_KEY are set;
// otherwise falls back to local JSON files so the app always runs.
const fs = require('fs');
const path = require('path');

const LEADS = path.join(__dirname, 'leads.json');
const PROPS = path.join(__dirname, 'properties.json');
const AGENTS = path.join(__dirname, 'agents.json');
const VISITS = path.join(__dirname, 'visits.json');
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const useSupabase = !!(URL && KEY);

const readJSON = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return fb; } };
const writeJSON = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

function sb(p, opts = {}) {
  return fetch(`${URL}/rest/v1/${p}`, {
    ...opts,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json', ...(opts.headers || {}) }
  });
}

async function listProperties() {
  if (useSupabase) { const r = await sb('properties?select=*'); return r.ok ? r.json() : []; }
  return readJSON(PROPS, []);
}

async function listLeads() {
  if (useSupabase) { const r = await sb('leads?select=*&order=created_at.desc'); return r.ok ? r.json() : []; }
  return readJSON(LEADS, []).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

// Multi-tenant: only the leads captured by this agent.
async function listLeadsByAgent(agentId) {
  if (!agentId) return [];
  if (useSupabase) { const r = await sb(`leads?agent_id=eq.${encodeURIComponent(agentId)}&select=*&order=created_at.desc`); return r.ok ? r.json() : []; }
  return readJSON(LEADS, []).filter(l => l.agent_id === agentId).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

async function insertLead(lead) {
  if (useSupabase) {
    const r = await sb('leads', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(lead) });
    const d = await r.json(); return Array.isArray(d) ? d[0] : d;
  }
  const leads = readJSON(LEADS, []); leads.push(lead); writeJSON(LEADS, leads); return lead;
}

// Confirm by token OR id (the dashboard uses id, the email/SMS link uses token)
async function confirmLead(value, intent) {
  if (useSupabase) {
    const patch = { consent_status: 'confirmed', confirmed_at: new Date().toISOString(), callable: true };
    if (intent) patch.intent = intent;
    const r = await sb(`leads?or=(token.eq.${value},id.eq.${value})`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch)
    });
    const d = await r.json(); return (Array.isArray(d) && d[0]) || null;
  }
  const leads = readJSON(LEADS, []);
  const lead = leads.find(l => l.token === value || l.id === value);
  if (!lead) return null;
  lead.consent_status = 'confirmed'; lead.confirmed_at = new Date().toISOString(); lead.callable = true;
  if (intent) lead.intent = intent;
  writeJSON(LEADS, leads); return lead;
}

// --- Agents (accounts) ---
async function findAgentByEmail(email) {
  if (useSupabase) {
    const r = await sb(`agents?email=eq.${encodeURIComponent(email)}&select=*`);
    const d = r.ok ? await r.json() : []; return d[0] || null;
  }
  return readJSON(AGENTS, []).find(a => a.email === email) || null;
}

async function findAgentById(id) {
  if (useSupabase) {
    const r = await sb(`agents?id=eq.${id}&select=*`);
    const d = r.ok ? await r.json() : []; return d[0] || null;
  }
  return readJSON(AGENTS, []).find(a => a.id === id) || null;
}

async function findAgentByResetToken(token) {
  if (!token) return null;
  if (useSupabase) {
    const r = await sb(`agents?reset_token=eq.${encodeURIComponent(token)}&select=*`);
    const d = r.ok ? await r.json() : []; return d[0] || null;
  }
  return readJSON(AGENTS, []).find(a => a.reset_token === token) || null;
}

async function findAgentByStripeCustomer(customerId) {
  if (!customerId) return null;
  if (useSupabase) {
    const r = await sb(`agents?stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=*`);
    const d = r.ok ? await r.json() : []; return d[0] || null;
  }
  return readJSON(AGENTS, []).find(a => a.stripe_customer_id === customerId) || null;
}

async function insertAgent(a) {
  if (useSupabase) {
    const r = await sb('agents', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(a) });
    const d = await r.json(); return Array.isArray(d) ? d[0] : d;
  }
  const ag = readJSON(AGENTS, []); ag.push(a); writeJSON(AGENTS, ag); return a;
}

async function updateAgent(id, patch) {
  if (useSupabase) {
    const r = await sb(`agents?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
    const d = await r.json(); return (Array.isArray(d) && d[0]) || null;
  }
  const ag = readJSON(AGENTS, []); const a = ag.find(x => x.id === id);
  if (!a) return null; Object.assign(a, patch); writeJSON(AGENTS, ag); return a;
}

// --- Admin: list all accounts ---
async function listAgents() {
  if (useSupabase) { const r = await sb('agents?select=*&order=created_at.desc'); return r.ok ? r.json() : []; }
  return readJSON(AGENTS, []).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

// --- Visit tracking (privacy-friendly: no cookies, no personal data) ---
async function logVisit(v) {
  const row = { path: v.path || '/', referrer: v.referrer || '', ua: v.ua || '' };
  if (useSupabase) { try { await sb('visits', { method: 'POST', body: JSON.stringify(row) }); } catch (e) { /* non-blocking */ } return; }
  try { const arr = readJSON(VISITS, []); arr.push({ ...row, created_at: new Date().toISOString() }); writeJSON(VISITS, arr); } catch (e) { /* non-blocking */ }
}

async function listVisits() {
  if (useSupabase) { const r = await sb('visits?select=*&order=created_at.desc&limit=2000'); return r.ok ? r.json() : []; }
  return readJSON(VISITS, []).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

module.exports = {
  listProperties, listLeads, listLeadsByAgent, insertLead, confirmLead,
  findAgentByEmail, findAgentById, findAgentByResetToken, findAgentByStripeCustomer, insertAgent, updateAgent,
  listAgents, logVisit, listVisits, useSupabase
};
