const { supabaseAdmin } = require('../../config/supabase');

const HARDCODED_INVITE = '0203';

// POST /api/invite/validate
async function validateCode(req, res) {
  try {
    const { code } = req.body;
    console.log('[invite/validate] code reçu :', JSON.stringify(code));

    if (!code) return res.status(400).json({ valid: false, error: 'Code requis' });

    const normalized = String(code).toUpperCase().trim();
    console.log('[invite/validate] normalized :', normalized, '| match :', normalized === HARDCODED_INVITE);

    // Code hardcodé de test
    if (normalized === HARDCODED_INVITE) {
      console.log('[invite/validate] Code hardcodé accepté');
      return res.json({ valid: true });
    }

    // Sinon vérifier en base
    const { data, error } = await supabaseAdmin
      .from('invite_codes')
      .select('id, code, used')
      .eq('code', normalized)
      .single();

    if (error || !data) return res.status(404).json({ valid: false, error: 'Code d\'invitation invalide' });
    if (data.used) return res.status(400).json({ valid: false, error: 'Code déjà utilisé' });

    res.json({ valid: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

module.exports = { validateCode };
