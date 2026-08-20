// L'Agent Augmenté — Stripe (REST, no SDK). Creates a subscription Checkout
// session when STRIPE_SECRET_KEY + a price id are set; otherwise simulates a
// successful checkout so the flow is testable.
const crypto = require('crypto');

async function createCheckoutSession({ agentId, email, priceId, successUrl, cancelUrl }) {
  const key = process.env.STRIPE_SECRET_KEY;
  // No Stripe key at all = free/launch mode (simulate a successful checkout).
  if (!key) {
    return { url: successUrl + (successUrl.includes('?') ? '&' : '?') + 'simulated=1', simulated: true };
  }
  // Key is set (billing ON) but the chosen plan has no price configured -> block, never grant free access.
  if (!priceId) {
    console.error('[Stripe] No price id for this plan. Set STRIPE_PRICE_SOLO / STRIPE_PRICE_TEAM / STRIPE_PRICE_AGENCY.');
    return { error: true };
  }
  const params = new URLSearchParams();
  params.append('mode', 'subscription');
  params.append('line_items[0][price]', priceId);
  params.append('line_items[0][quantity]', '1');
  params.append('success_url', successUrl);
  params.append('cancel_url', cancelUrl);
  params.append('customer_email', email);
  params.append('client_reference_id', agentId);
  params.append('subscription_data[trial_period_days]', '14'); // 14-day free trial: card saved, first charge after 14 days
  try {
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: params
    });
    const d = await r.json();
    if (!r.ok) { console.error('[Stripe]', d.error && d.error.message); return { error: true }; }
    return { url: d.url };
  } catch (e) { console.error('[Stripe failed]', e.message); return { error: true }; }
}

// Retrieve a Checkout Session (used to activate the account when the user returns from payment,
// so activation does not depend solely on the webhook being correctly configured).
async function retrieveCheckoutSession(id) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !id) return null;
  try {
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(id), {
      headers: { Authorization: `Bearer ${key}` }
    });
    const d = await r.json();
    if (!r.ok) { console.error('[Stripe retrieve]', d.error && d.error.message); return null; }
    return d; // { status, client_reference_id, customer_email, payment_status, ... }
  } catch (e) { console.error('[Stripe retrieve failed]', e.message); return null; }
}

// Verify a Stripe webhook signature (HMAC). Without a secret, parse directly (dev only).
function verifyWebhook(payload, sigHeader) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) { try { return JSON.parse(payload); } catch (e) { return null; } }
  try {
    const parts = Object.fromEntries(sigHeader.split(',').map(p => p.split('=')));
    const signed = `${parts.t}.${payload}`;
    const exp = crypto.createHmac('sha256', secret).update(signed).digest('hex');
    if (parts.v1 && parts.v1.length === exp.length && crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(parts.v1))) {
      return JSON.parse(payload);
    }
  } catch (e) { /* fall through */ }
  return null;
}

module.exports = { createCheckoutSession, retrieveCheckoutSession, verifyWebhook };
