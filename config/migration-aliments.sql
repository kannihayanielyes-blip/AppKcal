-- ============================================================
-- migration-aliments.sql
-- Crée les tables aliments_bruts et aliments_prepares
-- avec RLS et index associés.
--
-- → Coller dans : Supabase Dashboard > SQL Editor > New query
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. ALIMENTS_BRUTS
--    Aliments de base (CIQUAL / USDA) avec valeurs /100g
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS aliments_bruts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nom             TEXT        NOT NULL UNIQUE,
  nom_en          TEXT,
  categorie       TEXT        CHECK (categorie IN (
                                'viande', 'poisson', 'fruit', 'legume',
                                'feculent', 'legumineuse', 'produit_laitier',
                                'oeuf', 'oleagineux', 'huile', 'autre'
                              )),
  kcal_100g       NUMERIC     NOT NULL CHECK (kcal_100g >= 0),
  proteines_100g  NUMERIC     NOT NULL DEFAULT 0,
  glucides_100g   NUMERIC     NOT NULL DEFAULT 0,
  lipides_100g    NUMERIC     NOT NULL DEFAULT 0,
  fibres_100g     NUMERIC     DEFAULT 0,
  sucres_100g     NUMERIC     DEFAULT 0,
  sel_100g        NUMERIC     DEFAULT 0,
  source          TEXT        CHECK (source IN ('ciqual', 'usda')),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE aliments_bruts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "aliments_bruts_select_authenticated"
  ON aliments_bruts FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "aliments_bruts_all_service"
  ON aliments_bruts FOR ALL
  USING (true);

CREATE INDEX IF NOT EXISTS idx_aliments_bruts_nom       ON aliments_bruts (nom);
CREATE INDEX IF NOT EXISTS idx_aliments_bruts_categorie ON aliments_bruts (categorie);


-- ────────────────────────────────────────────────────────────
-- 2. ALIMENTS_PREPARES
--    Produits transformés / plats (Open Food Facts + maison)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS aliments_prepares (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nom             TEXT        NOT NULL,
  categorie       TEXT        CHECK (categorie IN (
                                'plat', 'sauce', 'snack', 'boisson',
                                'fast_food', 'smoothie', 'autre'
                              )),
  barcode         TEXT        UNIQUE,
  kcal_100g       NUMERIC     NOT NULL CHECK (kcal_100g >= 0),
  proteines_100g  NUMERIC     NOT NULL DEFAULT 0,
  glucides_100g   NUMERIC     NOT NULL DEFAULT 0,
  lipides_100g    NUMERIC     NOT NULL DEFAULT 0,
  fibres_100g     NUMERIC     DEFAULT 0,
  sucres_100g     NUMERIC     DEFAULT 0,
  sel_100g        NUMERIC     DEFAULT 0,
  portion_g       NUMERIC     DEFAULT 100,
  source          TEXT        CHECK (source IN ('maison', 'open_food_facts')),
  is_visible      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE aliments_prepares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "aliments_prepares_select_authenticated"
  ON aliments_prepares FOR SELECT
  TO authenticated
  USING (is_visible = true);

CREATE POLICY "aliments_prepares_all_service"
  ON aliments_prepares FOR ALL
  USING (true);

CREATE INDEX IF NOT EXISTS idx_aliments_prepares_nom       ON aliments_prepares (nom);
CREATE INDEX IF NOT EXISTS idx_aliments_prepares_categorie ON aliments_prepares (categorie);
CREATE INDEX IF NOT EXISTS idx_aliments_prepares_barcode   ON aliments_prepares (barcode)
  WHERE barcode IS NOT NULL;
