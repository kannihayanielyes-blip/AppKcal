-- ══════════════════════════════════════════════════════════════════════
-- AppKcal — Migration : schema coach (profils, clients, plans, etc.)
-- À coller dans Supabase SQL Editor et exécuter avec « Run »
-- Idempotent : DROP POLICY IF EXISTS avant chaque CREATE POLICY pour
-- permettre de rejouer le script sans erreur.
-- Pré-requis : la table publique `programmes_user` doit exister
-- (référencée par coach_programme_assignments).
-- ══════════════════════════════════════════════════════════════════════

-- ── 1. COLONNE is_coach dans profiles ──────────────────────────────
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS is_coach BOOLEAN DEFAULT FALSE;

-- ── 2. COACH PROFILES ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coach_profiles (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nom                     TEXT NOT NULL,
  prenom                  TEXT,
  bio                     TEXT,
  photo_url               TEXT,
  specialites             TEXT[] DEFAULT '{}',
  plan_type               TEXT CHECK (plan_type IN ('starter','pro','elite')),
  max_clients             INTEGER DEFAULT 5,
  stripe_customer_id      TEXT,
  stripe_subscription_id  TEXT,
  subscription_status     TEXT CHECK (subscription_status IN
                          ('active','cancelled','past_due','trialing')),
  is_visible_annuaire     BOOLEAN DEFAULT TRUE,
  note_moyenne            NUMERIC DEFAULT 0,
  trial_ends_at           TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE coach_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "coach_profiles_own" ON coach_profiles;
CREATE POLICY "coach_profiles_own" ON coach_profiles
  FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "coach_profiles_public_read" ON coach_profiles;
CREATE POLICY "coach_profiles_public_read" ON coach_profiles
  FOR SELECT USING (is_visible_annuaire = true);
CREATE INDEX IF NOT EXISTS idx_coach_profiles_user_id
  ON coach_profiles (user_id);

-- ── 3. COACH CLIENTS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coach_clients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id        UUID NOT NULL REFERENCES coach_profiles(id) ON DELETE CASCADE,
  client_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  coach_type      TEXT CHECK (coach_type IN ('nutrition','sport','both')),
  status          TEXT CHECK (status IN ('pending','active','paused','inactive'))
                  DEFAULT 'pending',
  pause_until     DATE,
  bilan_initial   JSONB,
  notes_internes  TEXT,
  invited_at      TIMESTAMPTZ DEFAULT NOW(),
  accepted_at     TIMESTAMPTZ,
  UNIQUE (coach_id, client_id)
);

ALTER TABLE coach_clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "coach_clients_coach" ON coach_clients;
CREATE POLICY "coach_clients_coach" ON coach_clients
  FOR ALL USING (
    EXISTS (SELECT 1 FROM coach_profiles cp
            WHERE cp.id = coach_clients.coach_id
            AND cp.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "coach_clients_client" ON coach_clients;
CREATE POLICY "coach_clients_client" ON coach_clients
  FOR SELECT USING (auth.uid() = client_id);
CREATE INDEX IF NOT EXISTS idx_coach_clients_coach_id
  ON coach_clients (coach_id);
CREATE INDEX IF NOT EXISTS idx_coach_clients_client_id
  ON coach_clients (client_id);

-- ── 4. COACH NUTRITION PLANS ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS coach_nutrition_plans (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id              UUID NOT NULL REFERENCES coach_profiles(id),
  client_id             UUID NOT NULL REFERENCES auth.users(id),
  nom                   TEXT NOT NULL,
  daily_kcal_target     INTEGER NOT NULL,
  proteines_target_g    NUMERIC DEFAULT 0,
  glucides_target_g     NUMERIC DEFAULT 0,
  lipides_target_g      NUMERIC DEFAULT 0,
  kcal_sport_day        INTEGER,
  kcal_rest_day         INTEGER,
  recettes_assignees    UUID[] DEFAULT '{}',
  notes                 TEXT,
  is_active             BOOLEAN DEFAULT TRUE,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE coach_nutrition_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "coach_nutrition_plans_coach" ON coach_nutrition_plans;
CREATE POLICY "coach_nutrition_plans_coach" ON coach_nutrition_plans
  FOR ALL USING (
    EXISTS (SELECT 1 FROM coach_profiles cp
            WHERE cp.id = coach_nutrition_plans.coach_id
            AND cp.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "coach_nutrition_plans_client" ON coach_nutrition_plans;
CREATE POLICY "coach_nutrition_plans_client" ON coach_nutrition_plans
  FOR SELECT USING (auth.uid() = client_id);
CREATE INDEX IF NOT EXISTS idx_coach_nutrition_plans_client
  ON coach_nutrition_plans (client_id);

-- ── 5. COACH PLAN TEMPLATES ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coach_plan_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id    UUID NOT NULL REFERENCES coach_profiles(id) ON DELETE CASCADE,
  nom         TEXT NOT NULL,
  objectif    TEXT,
  plan_data   JSONB NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE coach_plan_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "coach_plan_templates_own" ON coach_plan_templates;
CREATE POLICY "coach_plan_templates_own" ON coach_plan_templates
  FOR ALL USING (
    EXISTS (SELECT 1 FROM coach_profiles cp
            WHERE cp.id = coach_plan_templates.coach_id
            AND cp.user_id = auth.uid())
  );

-- ── 6. COACH PROGRAMME ASSIGNMENTS ────────────────────────────────
CREATE TABLE IF NOT EXISTS coach_programme_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id      UUID NOT NULL REFERENCES coach_profiles(id),
  client_id     UUID NOT NULL REFERENCES auth.users(id),
  programme_id  UUID REFERENCES programmes_user(id),
  notes         TEXT,
  assigned_at   TIMESTAMPTZ DEFAULT NOW(),
  is_active     BOOLEAN DEFAULT TRUE
);

ALTER TABLE coach_programme_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "coach_programme_assignments_coach" ON coach_programme_assignments;
CREATE POLICY "coach_programme_assignments_coach"
  ON coach_programme_assignments FOR ALL USING (
    EXISTS (SELECT 1 FROM coach_profiles cp
            WHERE cp.id = coach_programme_assignments.coach_id
            AND cp.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "coach_programme_assignments_client" ON coach_programme_assignments;
CREATE POLICY "coach_programme_assignments_client"
  ON coach_programme_assignments FOR SELECT
  USING (auth.uid() = client_id);

-- ── 7. COACH WEEKLY GOALS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coach_weekly_goals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id    UUID NOT NULL REFERENCES coach_profiles(id),
  client_id   UUID NOT NULL REFERENCES auth.users(id),
  week_start  DATE NOT NULL,
  goals       JSONB NOT NULL DEFAULT '[]',
  status      JSONB DEFAULT '[]',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE coach_weekly_goals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "coach_weekly_goals_coach" ON coach_weekly_goals;
CREATE POLICY "coach_weekly_goals_coach" ON coach_weekly_goals
  FOR ALL USING (
    EXISTS (SELECT 1 FROM coach_profiles cp
            WHERE cp.id = coach_weekly_goals.coach_id
            AND cp.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "coach_weekly_goals_client" ON coach_weekly_goals;
CREATE POLICY "coach_weekly_goals_client" ON coach_weekly_goals
  FOR SELECT USING (auth.uid() = client_id);

-- ── 8. COACH WEEKLY REVIEWS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coach_weekly_reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id        UUID NOT NULL REFERENCES coach_profiles(id),
  client_id       UUID NOT NULL REFERENCES auth.users(id),
  week_start      DATE NOT NULL,
  ia_draft        TEXT,
  coach_content   TEXT,
  adherence_pct   NUMERIC,
  sport_adherence NUMERIC,
  is_sent         BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE coach_weekly_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "coach_weekly_reviews_coach" ON coach_weekly_reviews;
CREATE POLICY "coach_weekly_reviews_coach" ON coach_weekly_reviews
  FOR ALL USING (
    EXISTS (SELECT 1 FROM coach_profiles cp
            WHERE cp.id = coach_weekly_reviews.coach_id
            AND cp.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "coach_weekly_reviews_client" ON coach_weekly_reviews;
CREATE POLICY "coach_weekly_reviews_client" ON coach_weekly_reviews
  FOR SELECT USING (auth.uid() = client_id AND is_sent = true);

-- ── 9. COACH MESSAGES ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coach_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id        UUID NOT NULL REFERENCES coach_profiles(id),
  client_id       UUID NOT NULL REFERENCES auth.users(id),
  sender_id       UUID NOT NULL REFERENCES auth.users(id),
  content         TEXT,
  attachment_type TEXT CHECK (attachment_type IN ('recette','seance','bilan')),
  attachment_id   UUID,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE coach_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "coach_messages_participants" ON coach_messages;
CREATE POLICY "coach_messages_participants" ON coach_messages
  FOR ALL USING (
    auth.uid() = client_id OR
    EXISTS (SELECT 1 FROM coach_profiles cp
            WHERE cp.id = coach_messages.coach_id
            AND cp.user_id = auth.uid())
  );
CREATE INDEX IF NOT EXISTS idx_coach_messages_coach_client
  ON coach_messages (coach_id, client_id);
CREATE INDEX IF NOT EXISTS idx_coach_messages_created_at
  ON coach_messages (created_at DESC);

-- ── 10. COACH SHARED NOTES ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coach_shared_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES auth.users(id),
  author_id   UUID NOT NULL REFERENCES coach_profiles(id),
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE coach_shared_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "coach_shared_notes_coaches" ON coach_shared_notes;
CREATE POLICY "coach_shared_notes_coaches" ON coach_shared_notes
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM coach_clients cc
      JOIN coach_profiles cp ON cp.id = cc.coach_id
      WHERE cc.client_id = coach_shared_notes.client_id
      AND cp.user_id = auth.uid()
      AND cc.status = 'active'
    )
  );

-- ── 11. COACH RATINGS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coach_ratings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id    UUID NOT NULL REFERENCES coach_profiles(id),
  client_id   UUID NOT NULL REFERENCES auth.users(id),
  note        INTEGER CHECK (note BETWEEN 1 AND 5),
  commentaire TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (coach_id, client_id)
);

ALTER TABLE coach_ratings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "coach_ratings_read" ON coach_ratings;
CREATE POLICY "coach_ratings_read" ON coach_ratings
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "coach_ratings_write" ON coach_ratings;
CREATE POLICY "coach_ratings_write" ON coach_ratings
  FOR INSERT WITH CHECK (auth.uid() = client_id);

-- ══════════════════════════════════════════════════════════════════════
-- Vérification : toutes les tables coach_ ont bien été créées.
-- Résultat attendu : 10 tables coach_.
-- ══════════════════════════════════════════════════════════════════════
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
AND tablename LIKE 'coach_%'
ORDER BY tablename;
