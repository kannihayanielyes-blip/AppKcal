const { supabaseAdmin } = require('../../config/supabase');

async function uploadRecipesPhoto(file) {
  const storagePath = `admin/${Date.now()}.jpg`;
  const { error } = await supabaseAdmin.storage
    .from('recipes')
    .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: true });
  if (error) throw new Error(error.message);
  const { data } = supabaseAdmin.storage.from('recipes').getPublicUrl(storagePath);
  return data.publicUrl;
}

// GET /api/admin/stats
async function getStats(req, res) {
  try {
    const today   = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const [usersRes, logsRes, invitesRes, todayLogsRes, weekLogsRes] = await Promise.all([
      supabaseAdmin.from('profiles').select('id, email, created_at, onboarding_done', { count: 'exact' }),
      supabaseAdmin.from('nutrition_logs').select('id', { count: 'exact' }),
      supabaseAdmin.from('invite_codes').select('*'),
      supabaseAdmin.from('nutrition_logs').select('user_id').eq('date', today),
      supabaseAdmin.from('nutrition_logs').select('user_id').gte('date', weekAgo)
    ]);

    const total_users           = usersRes.count || 0;
    const onboarding_done_count = usersRes.data?.filter(u => u.onboarding_done).length || 0;
    const onboarding_percent    = total_users > 0 ? Math.round((onboarding_done_count / total_users) * 100) : 0;
    const active_today          = new Set(todayLogsRes.data?.map(l => l.user_id) || []).size;
    const active_week           = new Set(weekLogsRes.data?.map(l => l.user_id) || []).size;

    const now = new Date();
    const activeInvites = invitesRes.data?.filter(i =>
      (i.max_uses === null || i.use_count < i.max_uses) &&
      (i.expires_at === null || new Date(i.expires_at) > now)
    ) || [];

    res.json({
      total_users,
      total_logs: logsRes.count,
      onboarding_done_count,
      onboarding_percent,
      active_today,
      active_week,
      invite_codes: {
        total:     invitesRes.data?.length || 0,
        active:    activeInvites.length,
        exhausted: (invitesRes.data?.length || 0) - activeInvites.length
      },
      recent_users: usersRes.data?.slice(-10).reverse() || []
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

const USER_FIELDS = 'id, email, username, avatar_url, goal, daily_kcal_target, liked_foods, disliked_foods, onboarding_done, created_at';

// GET /api/admin/users
async function getUsers(req, res) {
  try {
    const { page = 1, limit = 20 } = req.query;
    const from = (page - 1) * limit;
    const to = from + Number(limit) - 1;

    const { data, count, error } = await supabaseAdmin
      .from('profiles')
      .select(USER_FIELDS, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ users: data, total: count, page: Number(page), limit: Number(limit) });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// GET /api/admin/users/search?q=
async function searchUsers(req, res) {
  try {
    let { q } = req.query;
    if (!q || !q.trim()) return res.status(400).json({ error: 'Paramètre q requis' });

    q = q.replace(/[,().]/g, '').trim().slice(0, 50);

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select(USER_FIELDS)
      .or(`username.ilike.%${q}%,email.ilike.%${q}%`)
      .order('created_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });
    res.json({ users: data || [] });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// GET /api/admin/users/:id/full
async function getUserFull(req, res) {
  try {
    const { id } = req.params;

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', id)
      .single();

    if (profileErr || !profile) return res.status(404).json({ error: 'Utilisateur introuvable' });

    const [recettesRes, weightRes, nutritionRes] = await Promise.all([
      supabaseAdmin.from('recettes').select('*').eq('user_id', id),
      supabaseAdmin.from('weight_logs').select('*').eq('user_id', id).order('date', { ascending: false }).limit(10),
      supabaseAdmin.from('nutrition_logs').select('*').eq('user_id', id).gte('date', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
    ]);

    res.json({
      profile,
      recettes:       recettesRes.data  || [],
      weight_logs:    weightRes.data    || [],
      nutrition_logs: nutritionRes.data || []
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// PATCH /api/admin/users/:id
async function patchUser(req, res) {
  try {
    const { id } = req.params;
    const { username } = req.body;
    if (!username || typeof username !== 'string') {
      return res.status(400).json({ error: 'Username requis' });
    }
    const trimmed = username.trim();
    if (trimmed.length < 3 || trimmed.length > 30) {
      return res.status(400).json({ error: 'Username doit faire entre 3 et 30 caractères' });
    }
    if (!/^[a-zA-Z0-9_\-. ]+$/.test(trimmed)) {
      return res.status(400).json({ error: 'Username contient des caractères non autorisés' });
    }
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ username: trimmed, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, username: trimmed });
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
      .select('id, code, max_uses, use_count, expires_at, note, created_at')
      .order('created_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });

    const now = new Date();
    const result = (data || []).map(i => ({
      ...i,
      is_active: (i.max_uses === null || i.use_count < i.max_uses) &&
                 (i.expires_at === null || new Date(i.expires_at) > now)
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// POST /api/admin/invites
async function createInvite(req, res) {
  try {
    const { code, note, max_uses, expires_in_days } = req.body;
    if (!code) return res.status(400).json({ error: 'code est requis' });

    const normalizedCode = String(code).toUpperCase().trim();

    const { data: existing } = await supabaseAdmin
      .from('invite_codes')
      .select('id')
      .eq('code', normalizedCode)
      .maybeSingle();

    if (existing) return res.status(409).json({ error: 'Ce code existe déjà' });

    const expires_at = expires_in_days
      ? new Date(Date.now() + Number(expires_in_days) * 86400000).toISOString()
      : null;

    const { data, error } = await supabaseAdmin
      .from('invite_codes')
      .insert({
        code:      normalizedCode,
        note:      note     || null,
        max_uses:  max_uses != null ? Number(max_uses) : null,
        use_count: 0,
        expires_at
      })
      .select()
      .single();

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

async function validateIngredientIds(ingredient_ids) {
  if (!Array.isArray(ingredient_ids) || ingredient_ids.length === 0) return null;
  const { data } = await supabaseAdmin.from('ingredients').select('id').in('id', ingredient_ids);
  const foundIds = (data || []).map(r => r.id);
  const unknown = ingredient_ids.filter(id => !foundIds.includes(id));
  return unknown.length > 0 ? unknown : null;
}

// GET /api/admin/recipes
async function getRecipes(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('recettes')
      .select('id, nom, description, instructions, calories_total, proteines_total, glucides_total, lipides_total, categorie, temps_preparation, ingredients, ingredient_ids, emoji, is_visible, user_id, created_at')
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
    const { nom, description, instructions, calories_total, proteines_total, glucides_total, lipides_total, categorie, temps_preparation, ingredients, ingredient_ids } = req.body;
    if (!nom || !calories_total || !categorie) {
      return res.status(400).json({ error: 'nom, calories_total et categorie sont requis' });
    }
    if (ingredient_ids !== undefined) {
      const unknownIds = await validateIngredientIds(ingredient_ids);
      if (unknownIds) return res.status(400).json({ error: 'Ingrédient inconnu', ids_inconnus: unknownIds });
    }
    let photo_url = null;
    if (req.file) {
      try { photo_url = await uploadRecipesPhoto(req.file); }
      catch (e) { return res.status(400).json({ error: e.message }); }
    }
    const { data, error } = await supabaseAdmin
      .from('recettes')
      .insert({
        nom, description, instructions,
        calories_total:  Number(calories_total),
        proteines_total: proteines_total ? Number(proteines_total) : null,
        glucides_total:  glucides_total  ? Number(glucides_total)  : null,
        lipides_total:   lipides_total   ? Number(lipides_total)   : null,
        categorie,
        temps_preparation: temps_preparation ? Number(temps_preparation) : null,
        ingredients:    ingredients    || null,
        ingredient_ids: ingredient_ids || [],
        photo_url,
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
    const { nom, description, instructions, calories_total, proteines_total, glucides_total, lipides_total, categorie, temps_preparation, ingredients, ingredient_ids } = req.body;
    if (ingredient_ids !== undefined) {
      const unknownIds = await validateIngredientIds(ingredient_ids);
      if (unknownIds) return res.status(400).json({ error: 'Ingrédient inconnu', ids_inconnus: unknownIds });
    }
    const update = {
      nom, description, instructions,
      calories_total:  calories_total  !== undefined ? Number(calories_total)  : undefined,
      proteines_total: proteines_total !== undefined ? Number(proteines_total) : undefined,
      glucides_total:  glucides_total  !== undefined ? Number(glucides_total)  : undefined,
      lipides_total:   lipides_total   !== undefined ? Number(lipides_total)   : undefined,
      categorie,
      temps_preparation: temps_preparation ? Number(temps_preparation) : null,
      ingredients: ingredients || null
    };
    if (ingredient_ids !== undefined) update.ingredient_ids = ingredient_ids;
    if (req.file) {
      try { update.photo_url = await uploadRecipesPhoto(req.file); }
      catch (e) { return res.status(400).json({ error: e.message }); }
    } else if (req.body.photo_url === null || req.body.photo_url === 'null') {
      update.photo_url = null;
    }
    const { data, error } = await supabaseAdmin
      .from('recettes')
      .update(update)
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

// ── Ingredients ───────────────────────────────────────────────

// GET /api/admin/ingredients
async function getIngredients(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('ingredients')
      .select('*')
      .order('nom', { ascending: true });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// POST /api/admin/ingredients
async function createIngredient(req, res) {
  try {
    const { nom, categorie, calories, proteines, glucides, lipides } = req.body;
    if (!nom || !categorie) return res.status(400).json({ error: 'nom et categorie sont requis' });
    const { data, error } = await supabaseAdmin
      .from('ingredients')
      .insert({
        nom, categorie,
        calories:  calories  != null ? Number(calories)  : 0,
        proteines: proteines != null ? Number(proteines) : 0,
        glucides:  glucides  != null ? Number(glucides)  : 0,
        lipides:   lipides   != null ? Number(lipides)   : 0
      })
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// PUT /api/admin/ingredients/:id
async function updateIngredient(req, res) {
  try {
    const { id } = req.params;
    const { nom, categorie, calories, proteines, glucides, lipides } = req.body;
    const { data, error } = await supabaseAdmin
      .from('ingredients')
      .update({ nom, categorie, calories, proteines, glucides, lipides })
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// DELETE /api/admin/ingredients/:id
async function deleteIngredient(req, res) {
  try {
    const { error } = await supabaseAdmin
      .from('ingredients')
      .delete()
      .eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Ingrédient supprimé' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

module.exports = {
  getStats, getUsers, searchUsers, getUserFull, patchUser, deleteUser,
  getInvites, createInvite, deleteInvite,
  getRecipes, createRecipe, updateRecipe, toggleRecipeVisibility, deleteRecipe,
  getIngredients, createIngredient, updateIngredient, deleteIngredient
};
