-- ══════════════════════════════════════════════════════════════
-- AppKcal — Supabase Schema
-- Run this in your Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════

-- ── Profiles ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id                UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email             TEXT,
  username          TEXT,
  avatar_url        TEXT,
  birthdate         DATE,
  gender            TEXT CHECK (gender IN ('male','female','other')),
  height_cm         NUMERIC,
  weight_kg         NUMERIC,
  goal              TEXT CHECK (goal IN ('lose','maintain','gain')),
  activity_level    TEXT CHECK (activity_level IN ('sedentary','light','moderate','active','very_active')),
  allergies         TEXT[],
  diet_type         TEXT,
  daily_kcal_target INTEGER DEFAULT 2000,
  onboarding_done   BOOLEAN DEFAULT FALSE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own profile"   ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Service can insert profiles"  ON profiles FOR INSERT WITH CHECK (true);

-- ── Nutrition Logs ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nutrition_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  kcal        NUMERIC NOT NULL,
  protein_g   NUMERIC DEFAULT 0,
  carbs_g     NUMERIC DEFAULT 0,
  fat_g       NUMERIC DEFAULT 0,
  meal_type   TEXT CHECK (meal_type IN ('breakfast','lunch','dinner','snack')) DEFAULT 'snack',
  date        DATE NOT NULL DEFAULT CURRENT_DATE,
  quantity_g  NUMERIC,
  photo_url   TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE nutrition_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own logs" ON nutrition_logs
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_nutrition_logs_user_date ON nutrition_logs(user_id, date);

-- ── Weight Logs ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS weight_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  weight_kg   NUMERIC NOT NULL,
  date        DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

ALTER TABLE weight_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own weight logs" ON weight_logs
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── Invite Codes ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invite_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  used        BOOLEAN DEFAULT FALSE,
  used_at     TIMESTAMPTZ,
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Public read for validation (no auth needed)
ALTER TABLE invite_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read invite codes" ON invite_codes FOR SELECT USING (true);
CREATE POLICY "Service manages invite codes" ON invite_codes FOR ALL USING (true);

-- ── Recettes ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recettes (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name           TEXT NOT NULL,
  photo_url      TEXT,
  emoji          TEXT,
  category       TEXT NOT NULL CHECK (category IN ('breakfast','meal','snack','dessert','shaker')),
  kcal           INTEGER NOT NULL,
  protein_g      NUMERIC,
  carbs_g        NUMERIC,
  fat_g          NUMERIC,
  ingredients    JSONB,   -- [{ "name": "...", "quantity": "...", "unit": "..." }]
  instructions   TEXT,
  prep_time_min  INTEGER,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- Lecture publique pour tous les users authentifiés, écriture réservée au service
ALTER TABLE recettes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read recipes" ON recettes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service manages recipes" ON recettes FOR ALL USING (true);

-- ── Insert a few starter invite codes ────────────────────────
INSERT INTO invite_codes (code, note) VALUES
  ('KCALBETA', 'Code fondateur'),
  ('APPKCAL1', 'Code fondateur'),
  ('NUTRITION', 'Code fondateur')
ON CONFLICT DO NOTHING;
