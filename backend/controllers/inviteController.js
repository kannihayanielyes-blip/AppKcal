const { supabaseAdmin } = require('../../config/supabase');

// POST /api/invite/validate
async function validateCode(req, res) {
  try {
    const { code } = req.body;
    console.log('[invite/validate] code reçu :', JSON.stringify(code));

    if (!code) return res.status(400).json({ valid: false, error: 'Code requis' });

    const normalized = String(code).toUpperCase().trim();
    console.log('[invite/validate] normalized :', normalized);

    // Vérifier en base uniquement
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
