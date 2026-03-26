const { supabaseAdmin } = require('../../config/supabase');

const HARDCODED_IDS = [
  '00000000-0000-0000-0000-000000000001', // admin
  '00000000-0000-0000-0000-000000000002', // test user
  '00000000-0000-0000-0000-000000000003', // test onboarding
];

// GET /api/nutrition/today
async function getToday(req, res) {
  try {
    if (HARDCODED_IDS.includes(req.user.id)) {
      return res.json({ logs: [], totals: { kcal: 0, protein: 0, carbs: 0, fat: 0 }, date: new Date().toISOString().split('T')[0] });
    }

    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await supabaseAdmin
      .from('nutrition_logs')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('date', today)
      .order('created_at', { ascending: true });

    if (error) return res.status(400).json({ error: error.message });

    const totals = (data || []).reduce((acc, log) => {
      acc.kcal += log.kcal || 0;
      acc.protein += log.protein_g || 0;
      acc.carbs += log.carbs_g || 0;
      acc.fat += log.fat_g || 0;
      return acc;
    }, { kcal: 0, protein: 0, carbs: 0, fat: 0 });

    res.json({ logs: data, totals, date: today });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// GET /api/nutrition/week
async function getWeek(req, res) {
  try {
    if (HARDCODED_IDS.includes(req.user.id)) {
      const monday = req.query.start || getMonday();
      const byDate = {};
      for (let i = 0; i < 7; i++) byDate[addDays(monday, i)] = [];
      return res.json({ byDate, week_start: monday, week_end: addDays(monday, 6) });
    }

    const { start } = req.query; // YYYY-MM-DD of Monday
    const monday = start || getMonday();
    const sunday = addDays(monday, 6);

    const { data, error } = await supabaseAdmin
      .from('nutrition_logs')
      .select('*')
      .eq('user_id', req.user.id)
      .gte('date', monday)
      .lte('date', sunday)
      .order('date', { ascending: true });

    if (error) return res.status(400).json({ error: error.message });

    // Group by date
    const byDate = {};
    for (let i = 0; i < 7; i++) {
      byDate[addDays(monday, i)] = [];
    }
    (data || []).forEach(log => {
      if (byDate[log.date]) byDate[log.date].push(log);
    });

    res.json({ byDate, week_start: monday, week_end: sunday });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// POST /api/nutrition/log
async function addLog(req, res) {
  try {
    const { name, kcal, protein_g, carbs_g, fat_g, meal_type, date, quantity_g, photo_url } = req.body;

    if (!name || !kcal) {
      return res.status(400).json({ error: 'Nom et kcal requis' });
    }

    const { data, error } = await supabaseAdmin
      .from('nutrition_logs')
      .insert({
        user_id: req.user.id,
        name,
        kcal: Number(kcal),
        protein_g: Number(protein_g) || 0,
        carbs_g: Number(carbs_g) || 0,
        fat_g: Number(fat_g) || 0,
        meal_type: meal_type || 'snack',
        date: date || new Date().toISOString().split('T')[0],
        quantity_g: quantity_g ? Number(quantity_g) : null,
        photo_url: photo_url || null,
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

// DELETE /api/nutrition/log/:id
async function deleteLog(req, res) {
  try {
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from('nutrition_logs')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id); // security: own rows only

    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Entrée supprimée' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// PUT /api/nutrition/log/:id
async function updateLog(req, res) {
  try {
    const { id } = req.params;
    const { name, kcal, protein_g, carbs_g, fat_g, meal_type, quantity_g } = req.body;

    const { data, error } = await supabaseAdmin
      .from('nutrition_logs')
      .update({ name, kcal, protein_g, carbs_g, fat_g, meal_type, quantity_g })
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// GET /api/nutrition/suggestions
async function getSuggestions(req, res) {
  try {
    // Most logged foods for this user
    const { data } = await supabaseAdmin
      .from('nutrition_logs')
      .select('name, kcal, protein_g, carbs_g, fat_g')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (!data) return res.json([]);

    // Count frequency
    const freq = {};
    data.forEach(log => {
      const key = log.name.toLowerCase();
      if (!freq[key]) freq[key] = { ...log, count: 0 };
      freq[key].count++;
    });

    const suggestions = Object.values(freq)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    res.json(suggestions);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// ── Helpers ───────────────────────────────────────────────────
function getMonday() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff)).toISOString().split('T')[0];
}

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

// GET /api/nutrition/recipes
async function getRecipes(req, res) {
  try {
    const { category } = req.query;
    console.log('[getRecipes] category:', category, '| user:', req.user?.id);

    let query = supabaseAdmin
      .from('recettes')
      .select('*')
      .order('nom', { ascending: true });

    if (category && category !== 'all') {
      query = query.eq('categorie', category);
    }
    query = query.eq('is_visible', true);

    const { data, error } = await query;
    console.log('[getRecipes] rows:', data?.length ?? 'null', '| error:', error?.message ?? 'none');
    if (error) return res.status(400).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    console.error('[getRecipes]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// GET /api/nutrition/smart-suggestions
async function getSmartSuggestions(req, res) {
  try {
    const userId = req.user.id;

    // Kcal consommées aujourd'hui
    const today = new Date().toISOString().split('T')[0];
    const { data: logs } = await supabaseAdmin
      .from('nutrition_logs')
      .select('kcal')
      .eq('user_id', userId)
      .eq('date', today);

    const consumed = (logs || []).reduce((sum, l) => sum + (l.kcal || 0), 0);

    // Objectif kcal depuis le profil
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('daily_kcal_target')
      .eq('id', userId)
      .single();

    const target = profile?.daily_kcal_target || 2000;
    const remaining = target - consumed;

    // Moins de 50% consommés → mode général
    if (consumed < target * 0.5 || remaining <= 0) {
      return res.json({ mode: 'general', consumed, target, remaining });
    }

    // Récupérer les recettes visibles
    const { data: recipes } = await supabaseAdmin
      .from('recettes')
      .select('id, nom, calories_total, proteines_total, glucides_total, lipides_total, categorie, photo_url')
      .eq('is_visible', true);

    if (!recipes || recipes.length === 0) {
      return res.json({ mode: 'general', consumed, target, remaining });
    }

    // Meilleure recette unique (la plus proche des kcal restantes)
    const best_single = recipes.reduce((best, r) => {
      const diff = Math.abs(r.calories_total - remaining);
      return diff < Math.abs(best.calories_total - remaining) ? r : best;
    });

    // Meilleure paire (somme la plus proche des kcal restantes)
    let best_pair = null;
    let bestPairDiff = Infinity;

    for (let i = 0; i < recipes.length; i++) {
      for (let j = i + 1; j < recipes.length; j++) {
        const sum = recipes[i].calories_total + recipes[j].calories_total;
        const diff = Math.abs(sum - remaining);
        if (diff < bestPairDiff) {
          bestPairDiff = diff;
          best_pair = [recipes[i], recipes[j]];
        }
      }
    }

    res.json({
      mode: 'smart',
      consumed: Math.round(consumed),
      target,
      remaining: Math.round(remaining),
      best_single,
      best_pair,
      best_pair_sum: best_pair ? best_pair[0].calories_total + best_pair[1].calories_total : null
    });
  } catch (err) {
    console.error('[getSmartSuggestions]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

module.exports = { getToday, getWeek, addLog, deleteLog, updateLog, getSuggestions, getRecipes, getSmartSuggestions };
