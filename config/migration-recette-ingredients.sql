-- ============================================================
-- migration-recette-ingredients.sql
-- Table de liaison recettes ↔ aliments_bruts
--
-- → Coller dans : Supabase Dashboard > SQL Editor > New query
-- Prérequis : tables recettes et aliments_bruts doivent exister
-- ============================================================

CREATE TABLE IF NOT EXISTS recette_ingredients (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  recette_id    UUID        NOT NULL REFERENCES recettes(id) ON DELETE CASCADE,
  aliment_id    UUID        NOT NULL REFERENCES aliments_bruts(id) ON DELETE RESTRICT,
  quantite_g    NUMERIC     NOT NULL CHECK (quantite_g > 0),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE recette_ingredients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recette_ingredients_select"
  ON recette_ingredients FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "recette_ingredients_service"
  ON recette_ingredients FOR ALL USING (true);

CREATE INDEX IF NOT EXISTS idx_recette_ingredients_recette ON recette_ingredients(recette_id);
