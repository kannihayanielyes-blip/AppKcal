const { supabaseAdmin } = require('../../config/supabase');
const OpenAI = require('openai');

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
    if (HARDCODED_IDS.includes(req.user.id)) {
      return res.status(201).json({ id: '00000000-0000-0000-0000-' + String(Date.now()).padStart(12, '0'), ...req.body, user_id: req.user.id });
    }

    const { name, kcal, protein_g, carbs_g, fat_g, meal_type, date, quantity_g, photo_url } = req.body;

    if (!name || !kcal) {
      return res.status(400).json({ error: 'Nom et kcal requis' });
    }
    if (Number(kcal) <= 0 || isNaN(Number(kcal))) {
      return res.status(400).json({ error: 'kcal doit être un nombre positif' });
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
    if (HARDCODED_IDS.includes(req.user.id)) {
      return res.status(200).json({ success: true });
    }

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
    if (HARDCODED_IDS.includes(req.user.id)) {
      return res.status(200).json({ id: req.params.id, ...req.body, user_id: req.user.id });
    }

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
    const userId = req.user?.id;
    // Recettes admin (user_id IS NULL et is_visible = true)
    let adminQuery = supabaseAdmin
      .from('recettes')
      .select('*')
      .is('user_id', null)
      .eq('is_visible', true);

    if (category && category !== 'all') {
      adminQuery = adminQuery.eq('categorie', category);
    }

    // Recettes de l'utilisateur connecté
    let userQuery = supabaseAdmin
      .from('recettes')
      .select('*')
      .eq('user_id', userId);

    if (category && category !== 'all') {
      userQuery = userQuery.eq('categorie', category);
    }

    const [{ data: adminData, error: adminError }, { data: userData, error: userError }] =
      await Promise.all([adminQuery, userQuery]);

    if (adminError) return res.status(400).json({ error: adminError.message });
    if (userError)  return res.status(400).json({ error: userError.message });

    const combined = [...(adminData || []), ...(userData || [])]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json(combined);
  } catch (err) {
    console.error('[getRecipes]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// GET /api/nutrition/recipes/mine
async function getUserRecipes(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('recettes')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });
    res.json({ recipes: data || [] });
  } catch (err) {
    console.error('[getUserRecipes]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// POST /api/nutrition/recipes
async function createUserRecipe(req, res) {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Utilisateur non authentifié' });
    }

    // Vérifie que l'user existe dans profiles (les comptes hardcodés n'ont pas de profil réel)
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('id', req.user.id)
      .maybeSingle();

    if (!profile) {
      return res.status(403).json({ error: 'Les comptes de test ne peuvent pas créer de recettes' });
    }

    const {
      nom, description, categorie, calories_total,
      proteines_total, glucides_total, lipides_total,
      temps_preparation, ingredients, emoji
    } = req.body;

    if (!nom || !categorie || calories_total === undefined) {
      return res.status(400).json({ error: 'nom, categorie et calories_total sont requis' });
    }

    const VALID_CATEGORIES = ['breakfast', 'meal', 'snack', 'dessert', 'shaker'];
    if (!VALID_CATEGORIES.includes(categorie)) {
      return res.status(400).json({ error: 'categorie invalide' });
    }

    const { data, error } = await supabaseAdmin
      .from('recettes')
      .insert({
        user_id:           req.user.id,
        nom,
        description:       description || null,
        categorie,
        calories_total:    Number(calories_total),
        proteines_total:   Number(proteines_total) || 0,
        glucides_total:    Number(glucides_total)  || 0,
        lipides_total:     Number(lipides_total)   || 0,
        temps_preparation: temps_preparation ? Number(temps_preparation) : null,
        ingredients:       ingredients || null,
        emoji:             emoji || null,
        is_visible:        false, // recette perso, non visible dans le feed admin
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    console.error('[createUserRecipe]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// DELETE /api/nutrition/recipes/:id
async function deleteUserRecipe(req, res) {
  try {
    const { id } = req.params;

    // Vérifie ownership avant suppression
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('recettes')
      .select('id, user_id')
      .eq('id', id)
      .single();

    if (fetchError || !existing) return res.status(404).json({ error: 'Recette introuvable' });
    if (existing.user_id !== req.user.id) return res.status(403).json({ error: 'Accès refusé' });

    const { error } = await supabaseAdmin
      .from('recettes')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id); // double sécurité

    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    console.error('[deleteUserRecipe]', err);
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

async function searchAliment(req, res) {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json([]);

  try {
    const { data, error } = await supabaseAdmin
      .from('aliments_bruts')
      .select('id, nom, kcal_100g, proteines_100g, glucides_100g, lipides_100g')
      .ilike('nom', `%${q}%`)
      .not('nom', 'ilike', '%babyfood%')
      .not('nom', 'ilike', '%APPLEBEE%')
      .not('nom', 'ilike', '%bologna%')
      .not('nom', 'ilike', '%alcoholic%')
      .not('nom', 'ilike', '%beverage%')
      .not('nom', 'ilike', '%restaurant%')
      .order('nom', { ascending: true })
      .limit(10);

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[searchAliment]', err.message);
    res.status(500).json({ error: 'Erreur recherche aliment' });
  }
}

// ── Génération de recettes personnalisées via GPT-4o ─────────────
async function generatePersonalizedRecipes(userId, profile) {
  try {
    // Guard : évite une double génération si l'onboarding est soumis deux fois
    const { count } = await supabaseAdmin
      .from('recettes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (count > 0) {
      console.log(`[generatePersonalizedRecipes] recettes déjà existantes pour user ${userId}, skip`);
      return;
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const kcal        = profile.daily_kcal_target || 2000;
    const goal        = profile.goal              || 'maintain';
    const allergies   = profile.allergies?.join(', ')    || 'aucune';
    const likedFoods  = profile.liked_foods?.join(', ')  || 'aucun';
    const dislikedFoods = profile.disliked_foods?.join(', ') || 'aucun';

    const systemPrompt = 'Tu es un nutritionniste expert. Tu réponds UNIQUEMENT en JSON valide, sans markdown, sans backticks, sans texte autour.';

    const userPrompt = `8 recettes pour: objectif=${goal}, ${kcal}kcal/j, allergies=${allergies}, aime=${likedFoods}, évite=${dislikedFoods}.
Répartition: 2 breakfast(~${Math.round(kcal*0.25)}kcal), 2 meal-déj(~${Math.round(kcal*0.35)}kcal), 2 meal-dîner(~${Math.round(kcal*0.30)}kcal), 2 snack(~${Math.round(kcal*0.10)}kcal).
Macros cohérentes (p×4+g×4+l×9=kcal). Noms courts. Ingrédients concis (max 5).
JSON uniquement: {"recettes":[{"nom":"","description":"","categorie":"breakfast|meal|snack","calories_total":0,"proteines_total":0,"glucides_total":0,"lipides_total":0,"temps_preparation":0,"emoji":"","ingredients":[{"nom":"","quantite":""}]}]}`;

    const response = await openai.chat.completions.create({
      model:       'gpt-4o',
      temperature: 0.7,
      max_tokens:  1500,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   }
      ]
    });

    const rawText = response.choices[0].message.content;

    // Strip éventuels backticks/markdown
    const cleanText = rawText.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleanText);
    } catch (parseErr) {
      console.error('[generatePersonalizedRecipes] JSON.parse failed:', parseErr.message);
      console.error('[generatePersonalizedRecipes] raw response:', rawText.slice(0, 200));
      return;
    }

    const recettes = parsed?.recettes;
    if (!Array.isArray(recettes) || recettes.length === 0) {
      console.error('[generatePersonalizedRecipes] tableau recettes vide ou absent');
      return;
    }
    if (recettes.length !== 8) {
      console.warn(`[generatePersonalizedRecipes] attendu 8 recettes, reçu ${recettes.length} — on continue`);
    }

    // Insert batch dans Supabase
    const rows = recettes.map(r => ({
      user_id:           userId,
      nom:               r.nom,
      description:       r.description       || null,
      categorie:         r.categorie,
      calories_total:    Number(r.calories_total)  || 0,
      proteines_total:   Number(r.proteines_total) || 0,
      glucides_total:    Number(r.glucides_total)  || 0,
      lipides_total:     Number(r.lipides_total)   || 0,
      temps_preparation: r.temps_preparation ? Number(r.temps_preparation) : null,
      emoji:             r.emoji             || null,
      ingredients:       Array.isArray(r.ingredients) ? r.ingredients : null,
      is_visible:        true,
    }));

    const { error: insertError } = await supabaseAdmin.from('recettes').insert(rows);
    if (insertError) {
      console.error('[generatePersonalizedRecipes] insert error:', insertError.message);
    }
  } catch (err) {
    console.error('[generatePersonalizedRecipes]', err.message);
  }
}

// GET /api/nutrition/ingredients (public)
async function getIngredients(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('ingredients')
      .select('nom, categorie')
      .not('categorie', 'in', '("autres","graisses")');

    if (error) return res.status(500).json({ error: 'Erreur serveur' });

    const ingredients = [...new Set((data || []).map(r => r.nom))]
      .sort((a, b) => a.localeCompare(b, 'fr'));
    res.json({ ingredients });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// GET /api/nutrition/ingredients/suggestions?selected=Poulet,Riz
async function getIngredientSuggestions(req, res) {
  try {
    const DEFAULTS = [
      'Poulet filet', 'Riz basmati cru', 'Œuf entier', 'Saumon',
      'Banane', 'Flocons avoine', 'Brocolis', 'Thon en boite',
      'Patate douce', 'Yaourt grec nature', 'Tomate', 'Avocat',
    ];

    const rawSelected = req.query.selected || '';
    const selected = rawSelected
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    if (!selected.length) {
      return res.json({ suggestions: DEFAULTS });
    }

    // Fetch all ingredients with categories
    const { data, error } = await supabaseAdmin
      .from('ingredients')
      .select('nom, categorie')
      .not('categorie', 'in', '("autres","graisses")');

    if (error) return res.status(500).json({ error: 'Erreur serveur' });

    const all = data || [];

    // Build a map nom→categorie (lowercase categorie for matching)
    const nomToCat = {};
    all.forEach(r => { nomToCat[r.nom] = (r.categorie || '').toLowerCase(); });

    // Determine the categories of selected ingredients
    const selectedCats = new Set(
      selected.map(n => nomToCat[n]).filter(Boolean)
    );

    // Category group helpers
    const isViande   = c => ['viandes', 'viande', 'poissons', 'poisson', 'proteines', 'protéines'].includes(c);
    const isFeculent = c => ['féculents', 'feculents', 'féculent', 'feculent', 'céréales', 'cereales'].includes(c);
    const isLegume   = c => ['légumes', 'legumes', 'légume', 'legume'].includes(c);
    const isFruit    = c => ['fruits', 'fruit'].includes(c);
    const isLaitier  = c => ['laitiers', 'laitier', 'produits laitiers', 'dairy'].includes(c);

    const hasViande   = [...selectedCats].some(isViande);
    const hasFeculent = [...selectedCats].some(isFeculent);
    const hasLaitier  = [...selectedCats].some(isLaitier);
    const hasFruit    = [...selectedCats].some(isFruit);

    // Build target categories based on co-selection rules
    const targetCats = new Set();

    if (hasViande) {
      // Viande → autres viandes + légumes + féculents
      all.forEach(r => { if (isViande(r.categorie?.toLowerCase()))   targetCats.add(r.nom); });
      all.forEach(r => { if (isLegume(r.categorie?.toLowerCase()))   targetCats.add(r.nom); });
      all.forEach(r => { if (isFeculent(r.categorie?.toLowerCase())) targetCats.add(r.nom); });
    }
    if (hasFeculent) {
      // Féculent → autres féculents + viandes + légumes
      all.forEach(r => { if (isFeculent(r.categorie?.toLowerCase())) targetCats.add(r.nom); });
      all.forEach(r => { if (isViande(r.categorie?.toLowerCase()))   targetCats.add(r.nom); });
      all.forEach(r => { if (isLegume(r.categorie?.toLowerCase()))   targetCats.add(r.nom); });
    }
    if (hasLaitier) {
      // Laitier → fruits
      all.forEach(r => { if (isFruit(r.categorie?.toLowerCase()))   targetCats.add(r.nom); });
    }
    if (hasFruit) {
      // Fruit → autres fruits
      all.forEach(r => { if (isFruit(r.categorie?.toLowerCase()))   targetCats.add(r.nom); });
    }

    // Fallback : same categories as selected if no rule matched
    if (!targetCats.size) {
      selectedCats.forEach(cat => {
        all.forEach(r => {
          if ((r.categorie || '').toLowerCase() === cat) targetCats.add(r.nom);
        });
      });
    }

    // Exclude already selected, deduplicate, shuffle slightly, cap at 6
    const suggestions = [...targetCats]
      .filter(n => !selected.includes(n))
      .sort(() => Math.random() - 0.5)
      .slice(0, 6);

    res.json({ suggestions });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// POST /api/nutrition/recipes/:id/photo
async function uploadRecipePhoto(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Photo requise' });

    const { id } = req.params;
    const storagePath = `${id}/${Date.now()}.jpg`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from('recipes')
      .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype, upsert: true });

    if (uploadError) return res.status(400).json({ error: uploadError.message });

    const { data: urlData } = supabaseAdmin.storage.from('recipes').getPublicUrl(storagePath);
    const photo_url = urlData.publicUrl;

    const { error: updateError } = await supabaseAdmin
      .from('recettes')
      .update({ photo_url })
      .eq('id', id);

    if (updateError) return res.status(400).json({ error: updateError.message });

    res.json({ photo_url });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// POST /api/nutrition/log/meal
async function addMealLog(req, res) {
  try {
    const { name, items, meal_type } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items requis (tableau non vide)' });
    }

    // Somme des macros
    let totalKcal = 0, totalProt = 0, totalCarbs = 0, totalFat = 0, totalQty = 0;
    for (const it of items) {
      totalKcal  += Number(it.kcal)        || 0;
      totalProt  += Number(it.proteines_g) || 0;
      totalCarbs += Number(it.glucides_g)  || 0;
      totalFat   += Number(it.lipides_g)   || 0;
      totalQty   += Number(it.quantity_g)  || 0;
    }

    if (totalKcal <= 0) {
      return res.status(400).json({ error: 'Total kcal doit être positif' });
    }

    // Nom auto : préfixe fourni (ou "Repas") — liste des aliments
    const itemNames = items.map(it => it.name).filter(Boolean).join(', ');
    const mealName  = name
      ? `${name} — ${itemNames}`
      : itemNames || 'Repas';

    if (HARDCODED_IDS.includes(req.user.id)) {
      return res.status(201).json({
        id: '00000000-0000-0000-0000-' + String(Date.now()).padStart(12, '0'),
        user_id: req.user.id,
        name: mealName,
        kcal: Math.round(totalKcal),
        protein_g: Math.round(totalProt * 10) / 10,
        carbs_g:   Math.round(totalCarbs * 10) / 10,
        fat_g:     Math.round(totalFat   * 10) / 10,
        quantity_g: Math.round(totalQty),
        meal_type: meal_type || 'snack',
        date: new Date().toISOString().split('T')[0],
      });
    }

    const { data, error } = await supabaseAdmin
      .from('nutrition_logs')
      .insert({
        user_id:    req.user.id,
        name:       mealName,
        kcal:       Math.round(totalKcal),
        protein_g:  Math.round(totalProt  * 10) / 10,
        carbs_g:    Math.round(totalCarbs * 10) / 10,
        fat_g:      Math.round(totalFat   * 10) / 10,
        quantity_g: Math.round(totalQty),
        meal_type:  meal_type || 'snack',
        date:       new Date().toISOString().split('T')[0],
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

module.exports = { getToday, getWeek, addLog, addMealLog, deleteLog, updateLog, getSuggestions, getRecipes, getUserRecipes, createUserRecipe, deleteUserRecipe, getSmartSuggestions, searchAliment, generatePersonalizedRecipes, getIngredients, getIngredientSuggestions, uploadRecipePhoto };
