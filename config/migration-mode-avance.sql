-- ══════════════════════════════════════════════════════════════════════
-- AppKcal — Migration : mode avancé (profiles)
-- À coller dans Supabase SQL Editor et exécuter avec « Run »
-- Idempotent : peut être rejoué sans risque sur une BDD existante.
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS mode             TEXT    CHECK (mode IN ('guided', 'advanced')) DEFAULT 'guided';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS weight_goal_kg   NUMERIC DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS kcal_current     INTEGER DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS protein_target_g NUMERIC DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS carbs_target_g   NUMERIC DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS fat_target_g     NUMERIC DEFAULT NULL;
