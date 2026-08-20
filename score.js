// L'Agent Augmenté — lead scoring.
// Uses real AI (Anthropic) when ANTHROPIC_API_KEY is set; otherwise falls back
// to the rule-based score so the app always runs.

// --- Rule-based fallback (propensity to list, 0-9) ---
function scoreProperty(p) {
  let s = 0;
  if (p.tenure_years >= 12) s += 3;
  else if (p.tenure_years >= 8) s += 2;
  else if (p.tenure_years >= 5) s += 1;
  if (p.recent_permit) s += 3;
  if (p.neighbor_sold) s += 2;
  if (p.listing_expired) s += 2;
  if (p.marketplace_activity) s += 1;
  return Math.min(s, 9);
}

// --- Real AI scoring (Anthropic Messages API) ---
async function scoreWithAI(properties) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const model = process.env.AI_MODEL || 'claude-3-5-sonnet-20241022';
  const slim = properties.map(({ id, tenure_years, recent_permit, neighbor_sold, listing_expired, marketplace_activity }) =>
    ({ id, tenure_years, recent_permit, neighbor_sold, listing_expired, marketplace_activity }));
  const prompt =
    "Tu es analyste de signaux immobiliers. Pour chaque bien, donne un score 0-9 de " +
    "probabilité de mise en vente sous 6 mois, à partir de signaux avancés (ancienneté, " +
    "permis récent, vente d'un voisin, annonce expirée, activité marketplace). " +
    "N'utilise et ne demande JAMAIS le nom du propriétaire. " +
    'Réponds UNIQUEMENT par un tableau JSON: [{"id": "...", "score": 0, "reason": "courte raison en français"}]. ' +
    "Biens: " + JSON.stringify(slim);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] })
    });
    const d = await r.json();
    const text = (d.content && d.content[0] && d.content[0].text) || '';
    const json = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
    return JSON.parse(json);
  } catch (e) {
    console.error('[AI scoring failed, using rules]', e.message);
    return null;
  }
}

// Score a list: AI if available, else rules. Always returns scored + sorted-ready array.
async function scoreProperties(properties) {
  const ai = await scoreWithAI(properties);
  if (ai && Array.isArray(ai)) {
    const map = {};
    ai.forEach(x => { map[x.id] = x; });
    return properties.map(p => ({
      ...p,
      score: map[p.id] ? Math.max(0, Math.min(9, Math.round(map[p.id].score))) : scoreProperty(p),
      reason: (map[p.id] && map[p.id].reason) || p.reason,
      scored_by: map[p.id] ? 'ai' : 'rules'
    }));
  }
  return properties.map(p => ({ ...p, score: scoreProperty(p), scored_by: 'rules' }));
}

module.exports = { scoreProperty, scoreWithAI, scoreProperties };
