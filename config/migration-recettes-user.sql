-- ══════════════════════════════════════════════════════════════════════
-- AppKcal — Migration : recettes utilisateurs
-- À coller dans Supabase SQL Editor et exécuter avec « Run »
-- Idempotent : peut être rejoué sans risque sur une BDD existante.
-- ══════════════════════════════════════════════════════════════════════

-- 1. Ajoute la colonne user_id à la table recettes
--    NULL  → recette admin/partagée (comportement actuel inchangé)
--    UUID  → recette personnelle créée par un utilisateur
ALTER TABLE recettes
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT NULL;

-- Index pour les requêtes filtrées par user_id
CREATE INDEX IF NOT EXISTS idx_recettes_user_id ON recettes (user_id) WHERE user_id IS NOT NULL;

-- 2. Supprime l'ancienne policy SELECT et la remplace
DROP POLICY IF EXISTS "recettes_select_authenticated" ON recettes;

CREATE POLICY "recettes_select_authenticated"
  ON recettes FOR SELECT
  TO authenticated
  USING (
    (is_visible = true AND user_id IS NULL)
    OR user_id = auth.uid()
  );

-- 3. Policy INSERT — user peut créer ses propres recettes
CREATE POLICY "recettes_insert_own"
  ON recettes FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- 4. Policy DELETE — user peut supprimer uniquement ses recettes
CREATE POLICY "recettes_delete_own"
  ON recettes FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
