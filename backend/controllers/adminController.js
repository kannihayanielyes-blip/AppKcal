const { supabaseAdmin } = require('../../config/supabase');

// GET /api/admin/stats
async function getStats(req, res) {
  try {
    const [users, logs, invites] = await Promise.all([
      supabaseAdmin.from('profiles').select('id, email, created_at, onboarding_done', { count: 'exact' }),
      supabaseAdmin.from('nutrition_logs').select('id', { count: 'exact' }),
      supabaseAdmin.from('invite_codes').select('*')
    ]);

    const today = new Date().toISOString().split('T')[0];
    const activeToday = await supabaseAdmin
      .from('nutrition_logs')
      .select('user_id', { count: 'exact' })
      .eq('date', today);

    res.json({
      total_users: users.count,
      total_logs: logs.count,
      active_today: activeToday.count,
      invite_codes: {
        total: invites.data?.length || 0,
        used: invites.data?.filter(i => i.used).length || 0,
        available: invites.data?.filter(i => !i.used).length || 0
      },
      recent_users: users.data?.slice(-10).reverse() || []
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// GET /api/admin/users
async function getUsers(req, res) {
  try {
    const { page = 1, limit = 20 } = req.query;
    const from = (page - 1) * limit;
    const to = from + Number(limit) - 1;

    const { data, count, error } = await supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ users: data, total: count, page: Number(page), limit: Number(limit) });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// DELETE /api/admin/users/:id
async function deleteUser(req, res) {
  try {
    const { id } = req.params;
    const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Utilisateur supprimé' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// GET /api/admin/invites
async function getInvites(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('invite_codes')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// POST /api/admin/invites
async function createInvite(req, res) {
  try {
    const { count = 1, note } = req.body;
    const codes = [];

    for (let i = 0; i < Math.min(count, 50); i++) {
      codes.push({
        code: generateCode(),
        note: note || null,
        used: false,
        created_at: new Date().toISOString()
      });
    }

    const { data, error } = await supabaseAdmin
      .from('invite_codes')
      .insert(codes)
      .select();

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// DELETE /api/admin/invites/:id
async function deleteInvite(req, res) {
  try {
    const { error } = await supabaseAdmin
      .from('invite_codes')
      .delete()
      .eq('id', req.params.id);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Code supprimé' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// ── Recettes ──────────────────────────────────────────────────

// GET /api/admin/recipes
async function getRecipes(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('recettes')
      .select('*')
      .order('nom', { ascending: true });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// POST /api/admin/recipes
async function createRecipe(req, res) {
  try {
    const { nom, description, instructions, calories_total, proteines_total, glucides_total, lipides_total, categorie, temps_preparation, ingredients } = req.body;
    if (!nom || !calories_total || !categorie) {
      return res.status(400).json({ error: 'nom, calories_total et categorie sont requis' });
    }
    const { data, error } = await supabaseAdmin
      .from('recettes')
      .insert({
        nom, description, instructions,
        calories_total: Number(calories_total),
        proteines_total: proteines_total ? Number(proteines_total) : null,
        glucides_total: glucides_total ? Number(glucides_total) : null,
        lipides_total: lipides_total ? Number(lipides_total) : null,
        categorie,
        temps_preparation: temps_preparation ? Number(temps_preparation) : null,
        ingredients: ingredients || null,
        is_visible: true,
        created_at: new Date().toISOString()
      })
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// PUT /api/admin/recipes/:id
async function updateRecipe(req, res) {
  try {
    const { id } = req.params;
    const { nom, description, instructions, calories_total, proteines_total, glucides_total, lipides_total, categorie, temps_preparation, ingredients } = req.body;
    const { data, error } = await supabaseAdmin
      .from('recettes')
      .update({
        nom, description, instructions,
        calories_total: calories_total ? Number(calories_total) : undefined,
        proteines_total: proteines_total !== undefined ? Number(proteines_total) : undefined,
        glucides_total: glucides_total !== undefined ? Number(glucides_total) : undefined,
        lipides_total: lipides_total !== undefined ? Number(lipides_total) : undefined,
        categorie, temps_preparation: temps_preparation ? Number(temps_preparation) : null,
        ingredients: ingredients || null
      })
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// PATCH /api/admin/recipes/:id/visibility
async function toggleRecipeVisibility(req, res) {
  try {
    const { id } = req.params;
    const { is_visible } = req.body;
    const { error } = await supabaseAdmin
      .from('recettes')
      .update({ is_visible })
      .eq('id', id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Visibilité mise à jour' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// DELETE /api/admin/recipes/:id
async function deleteRecipe(req, res) {
  try {
    const { error } = await supabaseAdmin
      .from('recettes')
      .delete()
      .eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Recette supprimée' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

module.exports = { getStats, getUsers, deleteUser, getInvites, createInvite, deleteInvite, getRecipes, createRecipe, updateRecipe, toggleRecipeVisibility, deleteRecipe };
