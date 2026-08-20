// L'Agent Augmenté — confirmation messaging via Brevo.
// Sends the double opt-in email + SMS when BREVO_API_KEY is set; otherwise
// simulates by logging to the console so the app still runs end to end.

async function sendConfirmation(lead, confirmUrl) {
  const key = process.env.BREVO_API_KEY;
  const out = { email: false, sms: false, simulated: !key };

  if (!key) {
    console.log('[SIMULATED CONFIRMATION]', lead.name, lead.phone, '->', confirmUrl);
    return out;
  }

  // --- Email (transactional) ---
  if (lead.email) {
    try {
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { name: process.env.BREVO_SENDER_NAME || 'MandIMMO', email: process.env.BREVO_SENDER_EMAIL || 'no-reply@example.fr' },
          to: [{ email: lead.email, name: lead.name }],
          subject: 'Confirmez votre demande d’estimation',
          htmlContent:
            `<p>Bonjour ${lead.name},</p>` +
            `<p>${lead.consent_text}</p>` +
            `<p><a href="${confirmUrl}" style="background:#2E8B57;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Confirmer — Oui, vous pouvez m’appeler</a></p>` +
            `<p style="color:#888;font-size:12px">Vous pouvez retirer ce consentement à tout moment.</p>`
        })
      });
      out.email = r.ok;
      if (!r.ok) console.error('[Brevo email]', r.status, await r.text());
    } catch (e) { console.error('[Brevo email failed]', e.message); }
  }

  // --- SMS (transactional) ---
  if (lead.phone) {
    try {
      const recipient = lead.phone.replace(/\D/g, '').replace(/^0/, '33'); // FR international format
      const r = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
        method: 'POST',
        headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: process.env.BREVO_SMS_SENDER || 'MandIMMO',
          recipient,
          content: `Bonjour ${lead.name}, confirmez que ${lead.agent || 'votre agent'} (${process.env.AGENCY_NAME || 'votre agence'}) peut vous appeler: ${confirmUrl} - STOP pour refuser`
        })
      });
      out.sms = r.ok;
      if (!r.ok) console.error('[Brevo SMS]', r.status, await r.text());
    } catch (e) { console.error('[Brevo SMS failed]', e.message); }
  }

  return out;
}

// Password reset email (agent-facing). Returns { sent: bool, simulated: bool }.
async function sendPasswordReset(email, name, resetUrl) {
  const key = process.env.BREVO_API_KEY;
  if (!key) { console.log('[SIMULATED RESET]', email, '->', resetUrl); return { sent: false, simulated: true }; }
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: process.env.BREVO_SENDER_NAME || 'MandIMMO', email: process.env.BREVO_SENDER_EMAIL || 'no-reply@example.fr' },
        to: [{ email, name: name || email }],
        subject: 'Réinitialisation de votre mot de passe MandIMMO',
        htmlContent:
          `<p>Bonjour,</p>` +
          `<p>Vous avez demandé à réinitialiser votre mot de passe MandIMMO. Cliquez sur le bouton ci-dessous (lien valable 1 heure) :</p>` +
          `<p><a href="${resetUrl}" style="background:#2E8B57;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Choisir un nouveau mot de passe</a></p>` +
          `<p style="color:#888;font-size:12px">Si vous n'êtes pas à l'origine de cette demande, ignorez cet email — votre mot de passe reste inchangé.</p>`
      })
    });
    if (!r.ok) console.error('[Brevo reset]', r.status, await r.text());
    return { sent: r.ok, simulated: false };
  } catch (e) { console.error('[Brevo reset failed]', e.message); return { sent: false, simulated: false }; }
}

module.exports = { sendConfirmation, sendPasswordReset };
