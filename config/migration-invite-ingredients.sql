-- ══════════════════════════════════════════════════════════════════════
-- AppKcal — Migration : invite_codes + table ingredients
-- À coller dans Supabase SQL Editor et exécuter avec « Run »
-- Idempotent : peut être rejoué sans risque sur une BDD existante.
-- ══════════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────────
-- 1. TABLE invite_codes — ajout colonnes + suppression used / used_at
-- ────────────────────────────────────────────────────────────────────

ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS max_uses   INTEGER     DEFAULT NULL;
ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS use_count  INTEGER     NOT NULL DEFAULT 0;
ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE invite_codes DROP COLUMN IF EXISTS used;
ALTER TABLE invite_codes DROP COLUMN IF EXISTS used_at;


-- ────────────────────────────────────────────────────────────────────
-- 2. TABLE ingredients — création
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ingredients (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  nom        TEXT    NOT NULL UNIQUE,
  categorie  TEXT    NOT NULL
             CHECK (categorie IN ('viande', 'poisson', 'feculents',
             'legumes', 'fruits', 'laitiers', 'graisses', 'autres')),
  calories   NUMERIC DEFAULT 0,
  proteines  NUMERIC DEFAULT 0,
  glucides   NUMERIC DEFAULT 0,
  lipides    NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ingredients ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "ingredients_select"
  ON ingredients FOR SELECT
  TO authenticated USING (true);

CREATE POLICY IF NOT EXISTS "ingredients_service"
  ON ingredients FOR ALL USING (true);

CREATE INDEX IF NOT EXISTS idx_ingredients_categorie ON ingredients(categorie);


-- ────────────────────────────────────────────────────────────────────
-- 3. TABLE recettes — ajout colonne ingredient_ids
-- ────────────────────────────────────────────────────────────────────

ALTER TABLE recettes ADD COLUMN IF NOT EXISTS ingredient_ids UUID[] DEFAULT '{}';
