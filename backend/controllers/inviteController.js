const { supabaseAdmin } = require('../../config/supabase');

// POST /api/invite/validate
async function validateCode(req, res) {
  try {
    const { code } = req.body;

    if (!code) return res.status(400).json({ valid: false, error: 'Code requis' });

    const normalized = String(code).toUpperCase().trim();

    const { data, error } = await supabaseAdmin
      .from('invite_codes')
      .select('id, code, max_uses, use_count, expires_at')
      .eq('code', normalized)
      .single();

    if (error || !data) return res.status(404).json({ valid: false, error: 'Code d\'invitation invalide' });

    const now = new Date();
    const notExhausted = data.max_uses === null || data.use_count < data.max_uses;
    const notExpired   = data.expires_at === null || new Date(data.expires_at) > now;

    if (!notExhausted) return res.status(400).json({ valid: false, error: 'Code épuisé' });
    if (!notExpired)   return res.status(400).json({ valid: false, error: 'Code expiré' });

    res.json({ valid: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

module.exports = { validateCode };
