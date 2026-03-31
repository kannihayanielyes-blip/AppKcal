-- ══════════════════════════════════════════════════════════════════════
-- AppKcal — Migration : préférences alimentaires (profiles)
-- À coller dans Supabase SQL Editor et exécuter avec « Run »
-- Idempotent : peut être rejoué sans risque sur une BDD existante.
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS liked_foods    TEXT[] DEFAULT '{}';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS disliked_foods TEXT[] DEFAULT '{}';
