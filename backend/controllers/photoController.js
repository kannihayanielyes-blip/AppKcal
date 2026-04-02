const OpenAI = require('openai');
const { supabaseAdmin } = require('../../config/supabase');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// POST /api/photo/analyze
async function analyzePhoto(req, res) {
  try {
    if (!req.file && !req.body.image_base64) {
      return res.status(400).json({ error: 'Image requise' });
    }

    let imageData;
    if (req.body.image_base64) {
      // Base64 from frontend — limit to ~4MB (4*1024*1024 chars ≈ 3MB binary)
      if (req.body.image_base64.length > 4 * 1024 * 1024) {
        return res.status(413).json({ error: 'Image trop volumineuse (max 3 MB)' });
      }
      imageData = req.body.image_base64;
    } else {
      // Buffer from multer
      imageData = req.file.buffer.toString('base64');
    }

    const mimeType = req.body.mime_type || req.file?.mimetype || 'image/jpeg';

    const description = req.body.description || '';
    const weight_g    = req.body.weight_g    || '';

    // ── Vérification quota photo ──────────────────────────────────────────
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('is_premium, photo_quota_daily')
      .eq('id', req.user.id)
      .single();

    if (profileErr) {
      console.error('[photoAnalyze] profile fetch error:', profileErr.message);
      return res.status(500).json({ error: 'Erreur lors de la vérification du quota' });
    }

    if (!profile.is_premium) {
      const today = new Date().toISOString().slice(0, 10);
      const quota = profile.photo_quota_daily ?? 3;

      const { data: usage } = await supabaseAdmin
        .from('photo_usage')
        .select('count')
        .eq('user_id', req.user.id)
        .eq('date', today)
        .single();

      const used = usage?.count ?? 0;

      if (used >= quota) {
        return res.status(429).json({
          error: 'Quota journalier atteint',
          message: 'Tu as utilisé tes 3 analyses photo du jour. Reviens demain ou passe en premium.',
          quota,
          used,
        });
      }

      await supabaseAdmin
        .from('photo_usage')
        .upsert(
          { user_id: req.user.id, date: today, count: used + 1 },
          { onConflict: 'user_id,date' }
        );
    }
    // ─────────────────────────────────────────────────────────────────────

    let prompt = `Avant tout, regarde si l'image contient un code-barres ou un QR code bien visible. Si oui, réponds UNIQUEMENT avec : {"type":"barcode","barcode":"XXXXXXXXX"} (remplace XXXXXXXXX par la valeur du code).
Si c'est de la nourriture sans code-barres visible, tu es un expert en nutrition. Analyse cette photo de repas avec précision.
Réponds uniquement en français. Les noms des aliments doivent être en français (ex: 'Poulet' pas 'Chicken', 'Saumon' pas 'Salmon', 'Haricots verts' pas 'Green beans').`;
    if (description) prompt += `\nL'utilisateur précise : ${description}`;
    if (weight_g)    prompt += `\nLe poids total de l'assiette est d'environ ${weight_g}g`;
    prompt += `
Identifie chaque aliment séparément. Utilise des noms simples et génériques sans adjectifs (ex: 'Poulet' pas 'Poulet grillé', 'Riz' pas 'Riz safrané', 'Haricots verts' pas 'Haricots verts à l'ail').
Pour chaque aliment, estime la quantité avec soin en tenant compte de la taille de l'assiette visible. En cas de doute, légèrement surestimer plutôt que sous-estimer.
Estime également les macronutriments pour chaque aliment.
Retourne UNIQUEMENT du JSON valide : {"type":"food","items":[{"name":"...","quantity_g":0,"kcal":0,"proteines_g":0,"lipides_g":0,"glucides_g":0,"fibres_g":0}]}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${imageData}` }
            }
          ]
        }
      ]
    });

    const content = response.choices[0]?.message?.content?.trim();

    let nutrition;
    try {
      // Strip markdown code fences (avec ou sans \n après les backticks)
      let clean = content
        .replace(/^```[a-z]*\s*/i, '')  // ```json\n ou ```\n au début
        .replace(/\s*```\s*$/,'')        // ``` (avec espaces/newlines) à la fin
        .trim();

      // Si GPT a mis du texte avant/après le JSON, extraire juste l'objet JSON
      const jsonStart = clean.indexOf('{');
      const jsonEnd   = clean.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        clean = clean.slice(jsonStart, jsonEnd + 1);
      }

      nutrition = JSON.parse(clean);
    } catch (parseErr) {
      console.error('[photoAnalyze] JSON parse failed:', parseErr.message);
      console.error('[photoAnalyze] Content that failed:', content);
      return res.status(422).json({
        error: 'Impossible d\'analyser l\'image',
        raw: content
      });
    }

    // ── Code-barres détecté par GPT ───────────────────────────────────────
    if (nutrition.type === 'barcode') {
      const barcode = String(nutrition.barcode || '').trim();
      if (!barcode) {
        return res.status(422).json({ error: 'Code-barres non lisible' });
      }
      try {
        const offRes  = await fetch(`https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(barcode)}.json`);
        const offData = await offRes.json();

        if (offData.status === 0) {
          return res.json({ type: 'barcode_not_found', barcode });
        }

        const p = offData.product   || {};
        const n = p.nutriments      || {};
        return res.json({
          type: 'barcode',
          product: {
            name:             p.product_name_fr || p.product_name || 'Produit inconnu',
            kcal_per_100g:    n['energy-kcal_100g']   ?? null,
            protein_per_100g: n['proteins_100g']       ?? null,
            carbs_per_100g:   n['carbohydrates_100g']  ?? null,
            fat_per_100g:     n['fat_100g']             ?? null,
            nutriscore:       p.nutriscore_grade        ?? null,
            image_url:        p.image_url               ?? null,
            barcode,
          },
        });
      } catch (offErr) {
        console.error('[photoAnalyze] OpenFoodFacts error:', offErr.message);
        return res.status(502).json({ error: 'Impossible de récupérer les infos produit' });
      }
    }
    // ─────────────────────────────────────────────────────────────────────

    // ── BDD lookup + macro calculation ────────────────────────────────────
    const rawItems = nutrition.items || nutrition.aliments || nutrition.foods || [];

    /** Extract keywords: split on spaces, keep words > 3 chars */
    function keywords(str) {
      return str.split(/\s+/).filter(w => w.length > 3);
    }

    const CULINARY_ADJECTIVES = new Set([
      'grilled','fried','baked','roasted','boiled','steamed','turmeric',
      'yellow','white','brown','fresh','raw','cooked','spicy','garlic',
      'crispy','creamy','seasoned','marinated','sauteed','stir-fried',
      'smoked','curried','buttered',
    ]);
    const LINK_WORDS = new Set(['with','and','in','on','de','au','à','aux']);

    /**
     * Normalize a GPT food name before BDD lookup:
     * lowercase → strip culinary adjectives & link words → trim.
     * Returns up to 2 meaningful words (e.g. "green beans"), or 1.
     */
    function normalizeNom(nom) {
      const words = nom.toLowerCase().split(/\s+/);
      const kept = words.filter(w => !CULINARY_ADJECTIVES.has(w) && !LINK_WORDS.has(w));
      // Keep at most 2 meaningful words so the ILIKE stays specific enough
      return kept.slice(0, 2).join(' ').trim() || nom.toLowerCase().trim();
    }

    /**
     * Search aliments_bruts via RPC (ORDER BY LENGTH — prioritise short/simple names).
     * Falls back to JS chained query for aliments_prepares.
     */
    async function searchBruts(keyword) {
      const { data, error } = await supabaseAdmin.rpc('search_aliment', { keyword });
      if (error) {
        console.warn('[photoAnalyze] rpc search_aliment error:', error.message);
        return null;
      }
      return data && data.length > 0 ? data[0] : null;
    }

    async function searchPrepares(nom) {
      const cols = 'nom, kcal_100g, proteines_100g, glucides_100g, lipides_100g';

      const { data: full } = await supabaseAdmin
        .from('aliments_prepares')
        .select(cols)
        .ilike('nom', `%${nom}%`)
        .limit(1);
      if (full && full.length > 0) return full[0];

      const kws = keywords(nom);
      for (const kw of kws) {
        const { data: kwr } = await supabaseAdmin
          .from('aliments_prepares')
          .select(cols)
          .ilike('nom', `%${kw}%`)
          .limit(1);
        if (kwr && kwr.length > 0) return kwr[0];
      }
      return null;
    }

    /** Search bruts via RPC (full name then keywords), then prepares fallback */
    async function searchTable(_, nom) {
      // Pass 1: full name via RPC
      let match = await searchBruts(nom);
      if (match) return match;

      // Pass 2: keyword-by-keyword via RPC
      const kws = keywords(nom);
      for (const kw of kws) {
        match = await searchBruts(kw);
        if (match) return match;
      }

      return null;
    }

    const enrichedItems = await Promise.all(rawItems.map(async (item) => {
      const nom        = item.name || item.nom || 'Aliment';
      const quantite_g = item.quantity_g || item.quantite_g || item.weight_g || item.poids_g || 100;
      const ratio      = quantite_g / 100;

      const nomNorm = normalizeNom(nom);

      // 1. Search aliments_bruts via RPC (ORDER BY LENGTH, filters applied server-side)
      let match = await searchTable(null, nomNorm);

      // 2. Fallback: search aliments_prepares
      if (!match) {
        match = await searchPrepares(nomNorm);
      }

      if (match) {
        return {
          nom,
          quantite_g,
          calories:    Math.round(match.kcal_100g      * ratio),
          proteines_g: Math.round(match.proteines_100g * ratio * 10) / 10,
          glucides_g:  Math.round(match.glucides_100g  * ratio * 10) / 10,
          lipides_g:   Math.round(match.lipides_100g   * ratio * 10) / 10,
          source: 'bdd',
        };
      }

      // 3. Fallback: use GPT estimation values if present, else zeros
      return {
        nom,
        quantite_g,
        calories:    item.calories  || item.kcal  || 0,
        proteines_g: item.protein_g || item.proteins_g || item.proteines_g || 0,
        glucides_g:  item.carbs_g   || item.carbohydrates_g || item.glucides_g || 0,
        lipides_g:   item.fat_g     || item.fats_g || item.lipides_g || 0,
        source: 'estimation_ia',
      };
    }));

    // ── Compute totals from enriched items ────────────────────────────────
    const total = enrichedItems.reduce(
      (acc, it) => ({
        calories:    acc.calories    + (it.calories    || 0),
        proteines_g: acc.proteines_g + (it.proteines_g || 0),
        glucides_g:  acc.glucides_g  + (it.glucides_g  || 0),
        lipides_g:   acc.lipides_g   + (it.lipides_g   || 0),
      }),
      { calories: 0, proteines_g: 0, glucides_g: 0, lipides_g: 0 }
    );

    const normalized = { aliments: enrichedItems, total };

    res.json(normalized);
  } catch (err) {
    console.error('[photoAnalyze]', err);
    if (err.code === 'insufficient_quota') {
      return res.status(402).json({ error: 'Quota OpenAI dépassé' });
    }
    res.status(500).json({ error: 'Erreur lors de l\'analyse photo' });
  }
}

// GET /api/photo/quota
async function getPhotoQuota(req, res) {
  try {
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('is_premium, photo_quota_daily')
      .eq('id', req.user.id)
      .single();

    if (error) return res.status(500).json({ error: 'Erreur profil' });

    const quota = profile.photo_quota_daily ?? 3;
    const isPremium = profile.is_premium ?? false;

    if (isPremium) return res.json({ is_premium: true, quota: null, used: 0 });

    const today = new Date().toISOString().slice(0, 10);
    const { data: usage } = await supabaseAdmin
      .from('photo_usage')
      .select('count')
      .eq('user_id', req.user.id)
      .eq('date', today)
      .single();

    res.json({ is_premium: false, quota, used: usage?.count ?? 0 });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

module.exports = { analyzePhoto, getPhotoQuota };
