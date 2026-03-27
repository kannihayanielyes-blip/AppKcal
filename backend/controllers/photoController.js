const OpenAI = require('openai');
const { supabaseAdmin } = require('../../config/supabase');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// POST /api/photo/analyze
async function analyzePhoto(req, res) {
  try {
    // ── Debug : log ce qui arrive ──────────────────────────────
    console.log('[photoAnalyze] req.file :', req.file
      ? { fieldname: req.file.fieldname, mimetype: req.file.mimetype, size: req.file.size }
      : 'absent');
    console.log('[photoAnalyze] req.body keys:', Object.keys(req.body || {}));

    if (!req.file && !req.body.image_base64) {
      return res.status(400).json({ error: 'Image requise' });
    }

    let imageData;
    if (req.body.image_base64) {
      // Base64 from frontend
      imageData = req.body.image_base64;
    } else {
      // Buffer from multer
      imageData = req.file.buffer.toString('base64');
    }

    const mimeType = req.body.mime_type || req.file?.mimetype || 'image/jpeg';

    const description = req.body.description || '';
    const weight_g    = req.body.weight_g    || '';

    let prompt = `You are a nutrition expert. Analyze this meal photo precisely.`;
    if (description) prompt += `\nThe user says: ${description}`;
    if (weight_g)    prompt += `\nTotal plate weight is approximately ${weight_g}g`;
    prompt += `
Identify each food item separately. Estimate quantities in grams as accurately as possible. Calculate calories and macros for each item.
Return ONLY a valid JSON object (no markdown, no explanation, no extra text):
{"items":[{"name":"...","quantity_g":0,"calories":0,"protein_g":0,"carbs_g":0,"fat_g":0}],"total":{"calories":0,"protein_g":0,"carbs_g":0,"fat_g":0}}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 900,
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

    // ── Log AVANT le parsing pour voir ce que GPT retourne ────
    console.log('[photoAnalyze] RAW GPT content:', content);

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

      console.log('[photoAnalyze] Cleaned for parse:', clean.slice(0, 200));
      nutrition = JSON.parse(clean);
    } catch (parseErr) {
      console.error('[photoAnalyze] JSON parse failed:', parseErr.message);
      console.error('[photoAnalyze] Content that failed:', content);
      return res.status(422).json({
        error: 'Impossible d\'analyser l\'image',
        raw: content
      });
    }

    console.log('[photoAnalyze] Parsed JSON:', JSON.stringify(nutrition, null, 2));

    // Normalize to a stable schema regardless of what GPT returned
    const rawItems = nutrition.items || nutrition.aliments || nutrition.foods || [];
    const normalized = {
      aliments: rawItems.map(item => ({
        nom:         item.name  || item.nom  || 'Aliment',
        quantite_g:  item.quantity_g || item.quantite_g || item.weight_g || item.poids_g || 100,
        calories:    item.calories   || item.kcal       || item.energy   || 0,
        proteines_g: item.protein_g  || item.proteins_g || item.proteines_g || item.proteines || 0,
        glucides_g:  item.carbs_g    || item.carbohydrates_g || item.glucides_g || item.glucides  || 0,
        lipides_g:   item.fat_g      || item.fats_g     || item.lipides_g  || item.lipides   || 0,
      })),
      total: {
        calories:    (nutrition.total?.calories    || nutrition.total?.kcal      || 0),
        proteines_g: (nutrition.total?.protein_g   || nutrition.total?.proteines_g || 0),
        glucides_g:  (nutrition.total?.carbs_g     || nutrition.total?.glucides_g  || 0),
        lipides_g:   (nutrition.total?.fat_g       || nutrition.total?.lipides_g   || 0),
      }
    };

    // Schéma de sortie stable (aligné avec photo.html) :
    // { aliments:[{nom, quantite_g, calories, proteines_g, glucides_g, lipides_g}], total:{...} }
    console.log('[photoAnalyze] Normalized:', JSON.stringify(normalized, null, 2));
    res.json(normalized);
  } catch (err) {
    console.error('[photoAnalyze]', err);
    if (err.code === 'insufficient_quota') {
      return res.status(402).json({ error: 'Quota OpenAI dépassé' });
    }
    res.status(500).json({ error: 'Erreur lors de l\'analyse photo' });
  }
}

module.exports = { analyzePhoto };
