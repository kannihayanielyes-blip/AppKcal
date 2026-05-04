const { supabaseAdmin } = require('../../config/supabase');

// GET /api/user/profile
async function getProfile(req, res) {
  try {
    // Comptes hardcodés : pas de row en DB
    const HARDCODED_IDS = ['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003'];
    if (HARDCODED_IDS.includes(req.user.id)) {
      return res.json({
        id: req.user.id,
        email: req.user.email,
        username: req.user.id === '00000000-0000-0000-0000-000000000001' ? 'Admin' : 'User Test',
        isAdmin: req.user.isAdmin || false,
        onboarding_done: true,
        daily_kcal_target: 2000,
        weight_kg: null,
        height_cm: null,
        goal: 'maintain',
        activity_level: 'moderate'
      });
    }

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', req.user.id)
      .single();

    if (error) return res.status(404).json({ error: 'Profil introuvable' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// PATCH /api/user/profile
async function updateProfile(req, res) {
  try {
    const allowed = [
      'username', 'avatar_url', 'birthdate', 'gender',
      'height_cm', 'weight_kg', 'goal', 'activity_level',
      'allergies', 'diet_type', 'daily_kcal_target'
    ];

    const updates = {};
    allowed.forEach(key => {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    });
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', req.user.id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// GET /api/user/streak
async function getStreak(req, res) {
  try {
    if (['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003'].includes(req.user.id)) {
      return res.json({ streak: 0, longest: 0 });
    }

    const { data: logs } = await supabaseAdmin
      .from('nutrition_logs')
      .select('date')
      .eq('user_id', req.user.id)
      .order('date', { ascending: false });

    if (!logs || logs.length === 0) return res.json({ streak: 0, longest: 0 });

    const dates = [...new Set(logs.map(l => l.date))].sort().reverse();
    let streak = 0;
    let longest = 0;
    let current = 0;
    const today = new Date().toISOString().split('T')[0];

    let prev = today;
    for (const d of dates) {
      const diff = dayDiff(prev, d);
      if (diff <= 1) {
        current++;
        if (streak === 0) streak = current;
      } else {
        if (current > longest) longest = current;
        current = 1;
        if (streak === 0 && diff > 1) streak = 0;
      }
      prev = d;
    }
    if (current > longest) longest = current;

    res.json({ streak, longest });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// GET /api/user/weight-history
async function getWeightHistory(req, res) {
  try {
    if (['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003'].includes(req.user.id)) {
      return res.json([]);
    }

    const { limit = 30 } = req.query;
    const { data, error } = await supabaseAdmin
      .from('weight_logs')
      .select('weight_kg, date')
      .eq('user_id', req.user.id)
      .order('date', { ascending: true })
      .limit(Number(limit));

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// POST /api/user/weight
async function logWeight(req, res) {
  try {
    const { weight_kg, date } = req.body;
    if (!weight_kg || Number(weight_kg) <= 0 || isNaN(Number(weight_kg))) {
      return res.status(400).json({ error: 'Poids invalide' });
    }
    const logDate = date || new Date().toISOString().split('T')[0];

    const { data, error } = await supabaseAdmin
      .from('weight_logs')
      .upsert({
        user_id: req.user.id,
        weight_kg: Number(weight_kg),
        date: logDate
      }, { onConflict: 'user_id,date' })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Also update profile current weight
    await supabaseAdmin
      .from('profiles')
      .update({ weight_kg: Number(weight_kg) })
      .eq('id', req.user.id);

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// POST /api/user/avatar
async function uploadAvatar(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });

    const ext  = req.file.mimetype === 'image/png' ? 'png'
               : req.file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    const path = `${req.user.id}/${Date.now()}.${ext}`;

    const { error: upErr } = await supabaseAdmin.storage
      .from('avatars')
      .upload(path, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true
      });

    if (upErr) return res.status(500).json({ error: upErr.message });

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('avatars')
      .getPublicUrl(path);

    await supabaseAdmin
      .from('profiles')
      .update({ avatar_url: publicUrl, updated_at: new Date().toISOString() })
      .eq('id', req.user.id);

    res.json({ avatar_url: publicUrl });
  } catch (err) {
    console.error('[uploadAvatar]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

function dayDiff(a, b) {
  return Math.abs((new Date(a) - new Date(b)) / 86400000);
}

module.exports = { getProfile, updateProfile, getStreak, getWeightHistory, logWeight, uploadAvatar };
