/**
 * import-aliments.js
 * Imports food data from CIQUAL (ANSES) and USDA FoodData Central
 * into the aliments_bruts table via Supabase.
 *
 * Usage: node backend/scripts/import-aliments.js
 */

require('dotenv').config();
const https = require('https');
const http = require('http');
const { createClient } = require('@supabase/supabase-js');

// ---------------------------------------------------------------------------
// Supabase admin client
// ---------------------------------------------------------------------------
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('[ERROR] SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize a name: lowercase, remove accents, trim */
function normalize(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/** Simple HTTP(S) GET returning a Buffer (single attempt) */
function fetchBufferOnce(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBufferOnce(res.headers.location).then(resolve).catch(reject);
      }
      // Consume body even on error to free the socket
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(Object.assign(new Error(`HTTP ${res.statusCode} for ${url}`), { status: res.statusCode }));
        }
        resolve(Buffer.concat(chunks));
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

/** Fetch with retry + exponential backoff on 429/503/5xx */
async function fetchBuffer(url, { retries = 4, baseDelay = 3000 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchBufferOnce(url);
    } catch (err) {
      const status = err.status;
      const retryable = status === 429 || status === 503 || (status >= 500 && status < 600);
      if (!retryable || attempt === retries) throw err;
      const wait = baseDelay * Math.pow(2, attempt); // 3s, 6s, 12s, 24s
      console.warn(`\n  [RETRY] HTTP ${status} — attente ${wait / 1000}s avant tentative ${attempt + 2}/${retries + 1}...`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

/** Simple HTTP(S) GET returning parsed JSON */
async function fetchJSON(url) {
  const buf = await fetchBuffer(url);
  return JSON.parse(buf.toString('utf8'));
}

/** Batch insert rows into Supabase, returns { inserted, errors } */
async function batchUpsert(rows, batchSize = 200) {
  let inserted = 0;
  let errors = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;

    // Try upsert first (requires UNIQUE on nom)
    const { error: upsertErr } = await supabaseAdmin
      .from('aliments_bruts')
      .upsert(batch, { onConflict: 'nom', ignoreDuplicates: true });

    if (!upsertErr) {
      inserted += batch.length;
      continue;
    }

    // Fallback: plain insert ignoring duplicates row by row
    if (upsertErr.message.includes('no unique or exclusion constraint')) {
      console.warn(`  [INFO] batch ${batchNum} — pas de contrainte UNIQUE sur nom, insertion directe...`);
      let batchOk = 0;
      for (const row of batch) {
        const { error: insErr } = await supabaseAdmin
          .from('aliments_bruts')
          .insert(row);
        if (!insErr) batchOk++;
        // Ignore duplicate key errors silently
      }
      inserted += batchOk;
    } else {
      console.error(`  [WARN] batch ${batchNum} error:`, upsertErr.message);
      errors += batch.length;
    }
  }
  return { inserted, errors };
}

// ---------------------------------------------------------------------------
// CIQUAL parser
// ---------------------------------------------------------------------------

/**
 * CIQUAL — we use the Open Food Facts API filtered to French raw/unprocessed
 * foods as a reliable JSON alternative to the ANSES XLS distribution.
 * Endpoint returns up to CIQUAL_PAGE_SIZE products per page.
 */
const OFF_BASE = 'https://world.openfoodfacts.org/cgi/search.pl';
const CIQUAL_PAGE_SIZE = 200;
const CIQUAL_MAX_PAGES = 10; // ~2000 French base foods

/** Map an Open Food Facts category tag to our categorie enum */
function offCategorie(tags) {
  if (!tags || !tags.length) return 'autre';
  const cats = tags.join(' ').toLowerCase();
  if (cats.includes('meat') || cats.includes('viande') || cats.includes('poultry') || cats.includes('volaille')) return 'viande';
  if (cats.includes('fish') || cats.includes('poisson') || cats.includes('seafood') || cats.includes('shellfish')) return 'poisson';
  if (cats.includes('fruit')) return 'fruit';
  if (cats.includes('vegetable') || cats.includes('legume') || cats.includes('légume')) return 'legume';
  if (cats.includes('cereal') || cats.includes('bread') || cats.includes('pasta') || cats.includes('rice') || cats.includes('grain')) return 'feculent';
  if (cats.includes('legume') || cats.includes('bean') || cats.includes('lentil') || cats.includes('pea')) return 'legumineuse';
  if (cats.includes('dairy') || cats.includes('milk') || cats.includes('cheese') || cats.includes('yogurt')) return 'produit_laitier';
  if (cats.includes('egg') || cats.includes('oeuf')) return 'oeuf';
  if (cats.includes('nut') || cats.includes('seed') || cats.includes('oleagineux')) return 'oleagineux';
  if (cats.includes('oil') || cats.includes('fat') || cats.includes('huile')) return 'huile';
  return 'autre';
}

async function importCiqual(seen) {
  console.log('[CIQUAL/OFF] Téléchargement via Open Food Facts (aliments français de base)...');
  const rows = [];

  for (let page = 1; page <= CIQUAL_MAX_PAGES; page++) {
    const url =
      `${OFF_BASE}?action=process&json=true` +
      `&sort_by=unique_scans_n` +
      `&page_size=${CIQUAL_PAGE_SIZE}&page=${page}` +
      `&fields=product_name,generic_name_fr,nutriments,categories_tags` +
      `&tagtype_0=countries&tag_contains_0=contains&tag_0=france` +
      `&tagtype_1=states&tag_contains_1=contains&tag_1=en%3Acomplete`;

    let data;
    try {
      data = await fetchJSON(url);
    } catch (err) {
      console.warn(`[CIQUAL/OFF] Erreur page ${page}:`, err.message);
      break;
    }

    const products = data.products || [];
    if (!products.length) break;

    for (const p of products) {
      const nom = p.generic_name_fr || p.product_name || '';
      if (!nom || nom.length < 2) continue;

      const n = p.nutriments || {};
      const kcal = n['energy-kcal_100g'] || n['energy_100g'] ? Math.round((n['energy_100g'] || 0) / 4.184) : (n['energy-kcal_100g'] || 0);

      // Skip if no nutritional data at all
      if (!kcal && !n['proteins_100g'] && !n['carbohydrates_100g']) continue;

      const key = normalize(nom);
      if (seen.has(key)) continue;
      seen.add(key);

      rows.push({
        nom,
        nom_en: p.product_name !== nom ? (p.product_name || null) : null,
        categorie: offCategorie(p.categories_tags),
        kcal_100g: n['energy-kcal_100g'] || kcal || 0,
        proteines_100g: n['proteins_100g'] || 0,
        glucides_100g: n['carbohydrates_100g'] || 0,
        lipides_100g: n['fat_100g'] || 0,
        fibres_100g: n['fiber_100g'] || 0,
        sucres_100g: n['sugars_100g'] || 0,
        sel_100g: n['salt_100g'] || 0,
        source: 'ciqual',
      });
    }

    process.stdout.write(`\r[CIQUAL/OFF] Page ${page}/${CIQUAL_MAX_PAGES} — ${rows.length} aliments collectés`);
    await new Promise((r) => setTimeout(r, 1000));
    if (products.length < CIQUAL_PAGE_SIZE) break;
  }

  console.log();
  console.log(`[CIQUAL/OFF] ${rows.length} aliments à insérer...`);
  const { inserted, errors } = await batchUpsert(rows);
  console.log(`[CIQUAL/OFF] ${inserted} entrées insérées${errors ? `, ${errors} erreurs` : ''}.`);
  return inserted;
}

// ---------------------------------------------------------------------------
// USDA FoodData Central parser
// ---------------------------------------------------------------------------

/**
 * USDA FoodData Central — free API, no auth needed with DEMO_KEY.
 * We paginate through /foods/list to get SR Legacy + Foundation foods.
 * Rate limit with DEMO_KEY: 30 req/min, 3000 req/day.
 */
const USDA_BASE = 'https://api.nal.usda.gov/fdc/v1';
const USDA_API_KEY = process.env.USDA_API_KEY || 'DEMO_KEY';
const USDA_PAGE_SIZE = 200;
const USDA_MAX_PAGES = 10; // ~2000 items with DEMO_KEY to stay within daily limit

/** Map USDA foodCategory to our categorie enum */
function usdaCategorie(cat) {
  if (!cat) return 'autre';
  const c = cat.toLowerCase();
  if (c.includes('beef') || c.includes('pork') || c.includes('lamb') || c.includes('poultry') || c.includes('chicken') || c.includes('turkey') || c.includes('veal') || c.includes('game')) return 'viande';
  if (c.includes('fish') || c.includes('seafood') || c.includes('shellfish')) return 'poisson';
  if (c.includes('fruit')) return 'fruit';
  if (c.includes('vegetable')) return 'legume';
  if (c.includes('grain') || c.includes('cereal') || c.includes('bread') || c.includes('pasta') || c.includes('rice')) return 'feculent';
  if (c.includes('legume') || c.includes('bean') || c.includes('lentil')) return 'legumineuse';
  if (c.includes('dairy') || c.includes('milk') || c.includes('cheese') || c.includes('yogurt')) return 'produit_laitier';
  if (c.includes('egg')) return 'oeuf';
  if (c.includes('nut') || c.includes('seed')) return 'oleagineux';
  if (c.includes('fat') || c.includes('oil')) return 'huile';
  return 'autre';
}

/** Get nutrient value by nutrient ID from USDA food nutrient array */
function getNutrient(nutrients, id) {
  const n = nutrients.find((x) => x.nutrientId === id || (x.nutrient && x.nutrient.id === id));
  return n ? (n.value || n.amount || 0) : 0;
}

async function importUSDA(seen) {
  console.log('[USDA] Téléchargement des données FoodData Central via /foods/search...');
  const rows = [];

  for (let page = 1; page <= USDA_MAX_PAGES; page++) {
    // /foods/search with format=abridged returns foodNutrients[] with values
    const url =
      `${USDA_BASE}/foods/search` +
      `?api_key=${USDA_API_KEY}` +
      `&query=*` +
      `&dataType=SR%20Legacy,Foundation` +
      `&pageSize=${USDA_PAGE_SIZE}` +
      `&pageNumber=${page}` +
      `&format=abridged`;

    let result;
    try {
      result = await fetchJSON(url);
    } catch (err) {
      console.warn(`[USDA] Erreur page ${page}:`, err.message);
      break;
    }

    const items = result.foods || [];
    if (!items.length) break;

    for (const item of items) {
      const nom = item.description || '';
      if (!nom) continue;

      const key = normalize(nom);
      if (seen.has(key)) continue;
      seen.add(key);

      const nutrients = item.foodNutrients || [];

      // /foods/search abridged: nutrientId field (not nested .nutrient.id)
      const kcal    = getNutrient(nutrients, 1008);
      const protein = getNutrient(nutrients, 1003);
      const carbs   = getNutrient(nutrients, 1005);
      const fat     = getNutrient(nutrients, 1004);
      const fiber   = getNutrient(nutrients, 1079);
      const sugars  = getNutrient(nutrients, 2000);
      const sodiumMg = getNutrient(nutrients, 1093);
      const sel = sodiumMg ? parseFloat((sodiumMg * 2.5 / 1000).toFixed(3)) : 0;

      rows.push({
        nom,
        nom_en: nom,
        categorie: usdaCategorie(item.foodCategory || item.foodCategoryLabel || ''),
        kcal_100g:      kcal,
        proteines_100g: protein,
        glucides_100g:  carbs,
        lipides_100g:   fat,
        fibres_100g:    fiber,
        sucres_100g:    sugars,
        sel_100g:       sel,
        source: 'usda',
      });
    }

    process.stdout.write(`\r[USDA] Page ${page}/${USDA_MAX_PAGES} — ${rows.length} aliments collectés`);

    // Delay to respect DEMO_KEY rate limit (30 req/hour)
    if (page < USDA_MAX_PAGES && items.length === USDA_PAGE_SIZE) {
      await new Promise((r) => setTimeout(r, 2500));
    } else {
      break;
    }
  }

  console.log(); // newline after progress
  console.log(`[USDA] ${rows.length} aliments à insérer...`);
  const { inserted, errors } = await batchUpsert(rows);
  console.log(`[USDA] ${inserted} entrées insérées${errors ? `, ${errors} erreurs` : ''}.`);
  return inserted;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== Import Aliments ===');
  console.log(`Supabase: ${supabaseUrl}`);
  console.log();

  // ── Vérification que les tables existent ──────────────────────────────
  const { error: tableCheck } = await supabaseAdmin
    .from('aliments_bruts')
    .select('id')
    .limit(1);

  if (tableCheck && tableCheck.message.includes('schema cache')) {
    console.error('[ERROR] La table "aliments_bruts" n\'existe pas dans Supabase.');
    console.error('[ERROR] Exécutez d\'abord le SQL suivant dans le SQL Editor de Supabase :');
    console.error('[ERROR] → https://supabase.com/dashboard → SQL Editor');
    console.error('[ERROR] → Copiez/collez le contenu de config/supabase-schema-final.sql');
    console.error('[ERROR] → (ou au minimum la section CREATE TABLE aliments_bruts + aliments_prepares)');
    process.exit(1);
  }

  // Shared deduplication set (normalized names already in DB + across sources)
  const seen = new Set();

  // Pre-load existing names to avoid redundant upserts on re-runs
  console.log('[DB] Chargement des noms existants...');
  const { data: existing } = await supabaseAdmin
    .from('aliments_bruts')
    .select('nom');
  if (existing) {
    for (const row of existing) seen.add(normalize(row.nom));
    console.log(`[DB] ${existing.length} aliments déjà présents.\n`);
  }

  const ciqualCount = await importCiqual(seen);
  console.log();
  const usdaCount = await importUSDA(seen);

  console.log();
  console.log('=== Résumé ===');
  console.log(`[CIQUAL] ${ciqualCount} entrées insérées`);
  console.log(`[USDA]   ${usdaCount} entrées insérées`);
  console.log(`[TOTAL]  ${ciqualCount + usdaCount} nouvelles entrées`);
}

main().catch((err) => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});
