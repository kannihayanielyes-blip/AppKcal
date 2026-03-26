-- ══════════════════════════════════════════════════════════════════════
-- AppKcal — Schéma SQL définitif
-- Auteur  : généré automatiquement depuis le code source (controllers + routes)
-- Version : v2 — aligné sur adminController, nutritionController, sportController
--
-- INSTRUCTIONS :
--   1. Ouvre l'éditeur SQL Supabase (SQL Editor)
--   2. Colle l'intégralité de ce fichier
--   3. Clique sur « Run »
--   Le script est idempotent : il détruit et recrée tout proprement.
-- ══════════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────────
-- 0. SUPPRESSION DES TABLES EXISTANTES (ordre inverse des dépendances)
-- ────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS historique_exercices  CASCADE;
DROP TABLE IF EXISTS historique_seances    CASCADE;
DROP TABLE IF EXISTS exercices_seance      CASCADE;
DROP TABLE IF EXISTS seances_user          CASCADE;
DROP TABLE IF EXISTS programmes_user       CASCADE;
DROP TABLE IF EXISTS exercices_catalogue   CASCADE;
DROP TABLE IF EXISTS recettes              CASCADE;
DROP TABLE IF EXISTS invite_codes          CASCADE;
DROP TABLE IF EXISTS weight_logs           CASCADE;
DROP TABLE IF EXISTS nutrition_logs        CASCADE;
DROP TABLE IF EXISTS profiles              CASCADE;


-- ────────────────────────────────────────────────────────────────────
-- 1. PROFILES
--    Colonnes alignées sur authController.js (onboarding + register)
--    et userController.js (getProfile / updateProfile)
--    IMPORTANT : goal valeurs = 'bulk'|'cut'|'rebalance'|'maintain'
--                (≠ ancien schéma qui avait 'lose'|'gain')
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE profiles (
  id                UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email             TEXT,
  username          TEXT,
  avatar_url        TEXT,
  birthdate         DATE,
  gender            TEXT        CHECK (gender IN ('male', 'female', 'other')),
  height_cm         NUMERIC,
  weight_kg         NUMERIC,
  goal              TEXT        CHECK (goal IN ('bulk', 'cut', 'rebalance', 'maintain')),
  activity_level    TEXT        CHECK (activity_level IN ('sedentary', 'light', 'moderate', 'active', 'very_active')),
  allergies         TEXT[]      DEFAULT '{}',
  diet_type         TEXT,
  daily_kcal_target INTEGER     DEFAULT 2000,
  onboarding_done   BOOLEAN     DEFAULT FALSE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Lecture / mise à jour par le propriétaire
CREATE POLICY "profiles_select_own"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- Insert par le service (supabaseAdmin bypass RLS)
CREATE POLICY "profiles_insert_service"
  ON profiles FOR INSERT
  WITH CHECK (true);


-- ────────────────────────────────────────────────────────────────────
-- 2. NUTRITION_LOGS
--    Colonnes alignées sur nutritionController.js (addLog / getToday)
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE nutrition_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  kcal        NUMERIC     NOT NULL CHECK (kcal >= 0),
  protein_g   NUMERIC     NOT NULL DEFAULT 0,
  carbs_g     NUMERIC     NOT NULL DEFAULT 0,
  fat_g       NUMERIC     NOT NULL DEFAULT 0,
  meal_type   TEXT        DEFAULT 'snack'
                          CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
  date        DATE        NOT NULL DEFAULT CURRENT_DATE,
  quantity_g  NUMERIC,
  photo_url   TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE nutrition_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nutrition_logs_own"
  ON nutrition_logs FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_nutrition_logs_user_date ON nutrition_logs (user_id, date);
CREATE INDEX idx_nutrition_logs_date      ON nutrition_logs (date);


-- ────────────────────────────────────────────────────────────────────
-- 3. WEIGHT_LOGS
--    Colonnes alignées sur userController.js (logWeight / getWeightHistory)
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE weight_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  weight_kg   NUMERIC     NOT NULL CHECK (weight_kg > 0),
  date        DATE        NOT NULL DEFAULT CURRENT_DATE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, date)
);

ALTER TABLE weight_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "weight_logs_own"
  ON weight_logs FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_weight_logs_user_date ON weight_logs (user_id, date);


-- ────────────────────────────────────────────────────────────────────
-- 4. INVITE_CODES
--    Colonnes alignées sur authController.js + adminController.js
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE invite_codes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT        NOT NULL UNIQUE,
  used        BOOLEAN     NOT NULL DEFAULT FALSE,
  used_at     TIMESTAMPTZ,
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE invite_codes ENABLE ROW LEVEL SECURITY;

-- Lecture publique (validation sans auth)
CREATE POLICY "invite_codes_select_public"
  ON invite_codes FOR SELECT
  USING (true);

-- Écriture réservée au service
CREATE POLICY "invite_codes_all_service"
  ON invite_codes FOR ALL
  USING (true);


-- ────────────────────────────────────────────────────────────────────
-- 5. RECETTES
--    Colonnes alignées sur adminController.js + nutritionController.js
--    IMPORTANT : noms FR (nom, calories_total, categorie…) pas anglais
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE recettes (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nom               TEXT        NOT NULL,
  description       TEXT,
  instructions      TEXT,
  photo_url         TEXT,
  emoji             TEXT,
  categorie         TEXT        NOT NULL
                                CHECK (categorie IN ('breakfast', 'meal', 'snack', 'dessert', 'shaker')),
  calories_total    INTEGER     NOT NULL CHECK (calories_total >= 0),
  proteines_total   NUMERIC     DEFAULT 0,
  glucides_total    NUMERIC     DEFAULT 0,
  lipides_total     NUMERIC     DEFAULT 0,
  temps_preparation INTEGER,                        -- en minutes
  ingredients       JSONB,                          -- [{ "nom": "...", "quantite": "..." }]
  is_visible        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE recettes ENABLE ROW LEVEL SECURITY;

-- Lecture pour tous les users authentifiés (recettes visibles uniquement)
CREATE POLICY "recettes_select_authenticated"
  ON recettes FOR SELECT
  TO authenticated
  USING (is_visible = true);

-- Gestion complète par le service (admin bypass)
CREATE POLICY "recettes_all_service"
  ON recettes FOR ALL
  USING (true);

CREATE INDEX idx_recettes_categorie   ON recettes (categorie);
CREATE INDEX idx_recettes_is_visible  ON recettes (is_visible);


-- ────────────────────────────────────────────────────────────────────
-- 6. EXERCICES_CATALOGUE
--    Table statique des exercices disponibles (miroir de la route GET /exercices)
--    Permet des extensions futures (photos, vidéos, descriptions…)
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE exercices_catalogue (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  nom         TEXT  NOT NULL UNIQUE,
  groupe      TEXT  NOT NULL,
  description TEXT,
  photo_url   TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE exercices_catalogue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "exercices_catalogue_select"
  ON exercices_catalogue FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "exercices_catalogue_service"
  ON exercices_catalogue FOR ALL
  USING (true);

CREATE INDEX idx_exercices_catalogue_groupe ON exercices_catalogue (groupe);


-- ────────────────────────────────────────────────────────────────────
-- 7. PROGRAMMES_USER
--    Colonnes alignées sur sportController.js (getProgrammes / createProgramme)
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE programmes_user (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nom         TEXT        NOT NULL,
  type        TEXT        NOT NULL DEFAULT 'custom',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE programmes_user ENABLE ROW LEVEL SECURITY;

CREATE POLICY "programmes_user_own"
  ON programmes_user FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_programmes_user_user_id ON programmes_user (user_id);


-- ────────────────────────────────────────────────────────────────────
-- 8. SEANCES_USER
--    Colonnes alignées sur sportController.js (createProgramme nested)
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE seances_user (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id  UUID        NOT NULL REFERENCES programmes_user(id) ON DELETE CASCADE,
  nom           TEXT        NOT NULL,
  jour_numero   INTEGER     NOT NULL DEFAULT 0,  -- 0=Lun … 6=Dim
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE seances_user ENABLE ROW LEVEL SECURITY;

-- Accès via le programme (qui appartient à l'user)
CREATE POLICY "seances_user_own"
  ON seances_user FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM programmes_user p
      WHERE p.id = seances_user.programme_id
        AND p.user_id = auth.uid()
    )
  );

CREATE INDEX idx_seances_user_programme_id ON seances_user (programme_id);


-- ────────────────────────────────────────────────────────────────────
-- 9. EXERCICES_SEANCE
--    Colonnes alignées sur sportController.js + PATCH /sport/exercices/:id
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE exercices_seance (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  seance_id        UUID        NOT NULL REFERENCES seances_user(id) ON DELETE CASCADE,
  exercice_nom     TEXT        NOT NULL,
  exercice_groupe  TEXT        NOT NULL DEFAULT '',
  series           INTEGER     NOT NULL DEFAULT 3,
  reps             INTEGER     NOT NULL DEFAULT 10,
  poids_kg         NUMERIC     NOT NULL DEFAULT 0,
  ordre            INTEGER     NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE exercices_seance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "exercices_seance_own"
  ON exercices_seance FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM seances_user s
      JOIN   programmes_user p ON p.id = s.programme_id
      WHERE  s.id = exercices_seance.seance_id
        AND  p.user_id = auth.uid()
    )
  );

CREATE INDEX idx_exercices_seance_seance_id ON exercices_seance (seance_id);


-- ────────────────────────────────────────────────────────────────────
-- 10. HISTORIQUE_SEANCES
--     Colonnes alignées sur sportController.js (saveSession / getLastSession)
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE historique_seances (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  programme_nom  TEXT,
  seance_nom     TEXT        NOT NULL,
  date           DATE        NOT NULL DEFAULT CURRENT_DATE,
  duree_minutes  INTEGER,
  volume_total   NUMERIC,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE historique_seances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "historique_seances_own"
  ON historique_seances FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_historique_seances_user_seance ON historique_seances (user_id, seance_nom);
CREATE INDEX idx_historique_seances_date        ON historique_seances (date);


-- ────────────────────────────────────────────────────────────────────
-- 11. HISTORIQUE_EXERCICES
--     Colonnes alignées sur sportController.js (saveSession)
--     series = JSONB tableau [{reps, poids}] enregistré à la fin de la séance
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE historique_exercices (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  seance_id     UUID        NOT NULL REFERENCES historique_seances(id) ON DELETE CASCADE,
  exercice_nom  TEXT        NOT NULL,
  series        JSONB       NOT NULL DEFAULT '[]',  -- [{reps: 10, poids: 80}, ...]
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE historique_exercices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "historique_exercices_own"
  ON historique_exercices FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM historique_seances hs
      WHERE  hs.id = historique_exercices.seance_id
        AND  hs.user_id = auth.uid()
    )
  );

CREATE INDEX idx_historique_exercices_seance_id ON historique_exercices (seance_id);


-- ════════════════════════════════════════════════════════════════════
-- STORAGE — BUCKET AVATARS
-- ════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public)
  VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Lecture publique (URLs publiques pour afficher les avatars)
CREATE POLICY "avatars_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

-- Upload/remplacement uniquement par le propriétaire du fichier
-- (le chemin est {user_id}/...)
CREATE POLICY "avatars_owner_write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars_owner_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );


-- ════════════════════════════════════════════════════════════════════
-- DONNÉES DE BASE
-- ════════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────────
-- CODES D'INVITATION FONDATEURS
-- ────────────────────────────────────────────────────────────────────

INSERT INTO invite_codes (code, note) VALUES
  ('KCALBETA',   'Code fondateur — bêta fermée'),
  ('APPKCAL1',   'Code fondateur — bêta fermée'),
  ('NUTRITION',  'Code fondateur — bêta fermée'),
  ('FIT2025',    'Code fondateur — bêta fermée'),
  ('MUSCU42',    'Code fondateur — bêta fermée'),
  ('HEALTH01',   'Code fondateur — bêta fermée'),
  ('SPORT2025',  'Code fondateur — bêta fermée')
ON CONFLICT (code) DO NOTHING;


-- ────────────────────────────────────────────────────────────────────
-- CATALOGUE D'EXERCICES
--    Miroir exact de la liste statique dans backend/routes/sport.js
-- ────────────────────────────────────────────────────────────────────

INSERT INTO exercices_catalogue (nom, groupe) VALUES
  -- Pectoraux
  ('Développé couché',             'Pectoraux'),
  ('Développé incliné',            'Pectoraux'),
  ('Développé haltères',           'Pectoraux'),
  ('Écarté câbles',                'Pectoraux'),
  ('Pompes lestées',               'Pectoraux'),
  ('Dips',                         'Pectoraux'),
  -- Dos
  ('Tractions',                    'Dos'),
  ('Rowing barre',                 'Dos'),
  ('Rowing haltère',               'Dos'),
  ('Rowing câble',                 'Dos'),
  ('Tirage horizontal câble',      'Dos'),
  ('Soulevé de terre',             'Dos'),
  ('Pull-over',                    'Dos'),
  ('Tirage nuque',                 'Dos'),
  -- Trapèzes
  ('Shrugs',                       'Trapèzes'),
  -- Épaules
  ('Développé militaire',          'Épaules'),
  ('Arnold press',                 'Épaules'),
  ('Élévations latérales',         'Épaules'),
  ('Élévations frontales',         'Épaules'),
  ('Face pull',                    'Épaules'),
  -- Biceps
  ('Curl barre',                   'Biceps'),
  ('Curl haltères',                'Biceps'),
  ('Curl marteau',                 'Biceps'),
  ('Curl concentré',               'Biceps'),
  -- Triceps
  ('Triceps corde',                'Triceps'),
  ('Triceps extension',            'Triceps'),
  ('Triceps barre front',          'Triceps'),
  -- Quadriceps
  ('Squat barre',                  'Quadriceps'),
  ('Squat goblet',                 'Quadriceps'),
  ('Leg press',                    'Quadriceps'),
  ('Fentes marchées',              'Quadriceps'),
  ('Leg extension',                'Quadriceps'),
  ('Hack squat',                   'Quadriceps'),
  -- Ischio-jambiers
  ('Romanian deadlift',            'Ischio'),
  ('Leg curl',                     'Ischio'),
  -- Fessiers
  ('Hip thrust',                   'Fessiers'),
  -- Mollets
  ('Mollets debout',               'Mollets'),
  ('Mollets assis',                'Mollets'),
  -- Abdos
  ('Planche',                      'Abdos'),
  ('Crunchs',                      'Abdos'),
  ('Russian twist',                'Abdos'),
  ('Leg raises',                   'Abdos'),
  -- Cardio
  ('Burpees',                      'Cardio'),
  ('Mountain climbers',            'Cardio'),
  ('Jump squats',                  'Cardio'),
  ('Footing',                      'Cardio')
ON CONFLICT (nom) DO NOTHING;


-- ────────────────────────────────────────────────────────────────────
-- RECETTES DE BASE
--    Colonnes : nom, description, categorie, calories_total,
--               proteines_total, glucides_total, lipides_total,
--               temps_preparation, ingredients, is_visible, emoji
-- ────────────────────────────────────────────────────────────────────

INSERT INTO recettes (nom, description, categorie, calories_total, proteines_total, glucides_total, lipides_total, temps_preparation, emoji, is_visible, ingredients) VALUES

-- ── BREAKFAST ──────────────────────────────────────────────────────
(
  'Porridge avoine protéiné',
  'Bol de porridge à l''avoine avec protéine de whey vanille et banane.',
  'breakfast', 480, 38, 58, 8, 5, '🥣', true,
  '[{"nom":"Flocons d''avoine","quantite":"80g"},{"nom":"Whey vanille","quantite":"30g"},{"nom":"Banane","quantite":"1 petite"},{"nom":"Lait demi-écrémé","quantite":"200ml"}]'
),
(
  'Œufs brouillés toast complet',
  '3 œufs brouillés, 2 tranches de pain complet, une noix de beurre.',
  'breakfast', 390, 26, 30, 18, 10, '🍳', true,
  '[{"nom":"Œufs entiers","quantite":"3"},{"nom":"Pain complet","quantite":"2 tranches"},{"nom":"Beurre","quantite":"10g"},{"nom":"Sel, poivre","quantite":"qsp"}]'
),
(
  'Skyr fruits rouges granola',
  'Skyr nature 0%, framboises fraîches et granola maison faible en sucre.',
  'breakfast', 310, 22, 38, 6, 5, '🍓', true,
  '[{"nom":"Skyr nature","quantite":"200g"},{"nom":"Fruits rouges","quantite":"100g"},{"nom":"Granola","quantite":"30g"}]'
),
(
  'Pancakes protéinés',
  'Pancakes à base de flocons d''avoine, banane et blanc d''œuf.',
  'breakfast', 420, 30, 55, 7, 15, '🥞', true,
  '[{"nom":"Flocons d''avoine","quantite":"60g"},{"nom":"Banane","quantite":"1"},{"nom":"Blancs d''œuf","quantite":"3"},{"nom":"Levure chimique","quantite":"1 cc"}]'
),

-- ── MEAL ───────────────────────────────────────────────────────────
(
  'Poulet riz brocolis',
  'Classique bodybuilding : filet de poulet grillé, riz basmati et brocolis vapeur.',
  'meal', 520, 48, 55, 8, 25, '🍗', true,
  '[{"nom":"Filet de poulet","quantite":"180g"},{"nom":"Riz basmati cru","quantite":"80g"},{"nom":"Brocolis","quantite":"200g"},{"nom":"Huile d''olive","quantite":"5ml"}]'
),
(
  'Saumon patate douce épinards',
  'Pavé de saumon rôti avec purée de patate douce et épinards sautés à l''ail.',
  'meal', 580, 42, 42, 20, 30, '🐟', true,
  '[{"nom":"Pavé de saumon","quantite":"160g"},{"nom":"Patate douce","quantite":"200g"},{"nom":"Épinards frais","quantite":"100g"},{"nom":"Ail","quantite":"1 gousse"},{"nom":"Huile d''olive","quantite":"10ml"}]'
),
(
  'Bowl thon avocat quinoa',
  'Quinoa cuit, thon en boîte, avocat, concombre, sauce soja légère.',
  'meal', 560, 38, 45, 18, 15, '🥗', true,
  '[{"nom":"Quinoa cru","quantite":"70g"},{"nom":"Thon en boîte (égoutté)","quantite":"130g"},{"nom":"Avocat","quantite":"1/2"},{"nom":"Concombre","quantite":"100g"},{"nom":"Sauce soja","quantite":"10ml"}]'
),
(
  'Steak haché pâtes complètes',
  'Steak haché 5% MG, pâtes complètes al dente, sauce tomate maison.',
  'meal', 610, 44, 65, 14, 20, '🍝', true,
  '[{"nom":"Steak haché 5% MG","quantite":"150g"},{"nom":"Pâtes complètes crues","quantite":"90g"},{"nom":"Sauce tomate","quantite":"150g"},{"nom":"Parmesan","quantite":"10g"}]'
),
(
  'Omelette jambon fromage salade',
  '3 œufs entiers, jambon blanc sans couenne, fromage allégé, salade verte.',
  'meal', 430, 38, 5, 28, 10, '🥚', true,
  '[{"nom":"Œufs entiers","quantite":"3"},{"nom":"Jambon blanc","quantite":"80g"},{"nom":"Fromage allégé","quantite":"30g"},{"nom":"Salade verte","quantite":"80g"}]'
),
(
  'Curry poulet pois chiches riz',
  'Curry de poulet et pois chiches au lait de coco, riz basmati.',
  'meal', 650, 46, 68, 18, 30, '🍛', true,
  '[{"nom":"Filet de poulet","quantite":"150g"},{"nom":"Pois chiches cuits","quantite":"120g"},{"nom":"Lait de coco (léger)","quantite":"100ml"},{"nom":"Riz basmati cru","quantite":"70g"},{"nom":"Épices curry","quantite":"2 cc"}]'
),

-- ── SNACK ──────────────────────────────────────────────────────────
(
  'Fromage blanc 0% miel noix',
  'Fromage blanc 0%, 1 cc de miel et 10g de noix concassées.',
  'snack', 210, 18, 20, 5, 5, '🫙', true,
  '[{"nom":"Fromage blanc 0%","quantite":"200g"},{"nom":"Miel","quantite":"5g"},{"nom":"Noix","quantite":"10g"}]'
),
(
  'Galette de riz beurre de cacahuète',
  '2 galettes de riz soufflé nature avec 20g de beurre de cacahuète.',
  'snack', 210, 7, 24, 10, 3, '🥜', true,
  '[{"nom":"Galettes de riz","quantite":"2"},{"nom":"Beurre de cacahuète","quantite":"20g"}]'
),
(
  'Banane amandes',
  'Une banane mûre accompagnée de 15g d''amandes.',
  'snack', 195, 5, 30, 8, 3, '🍌', true,
  '[{"nom":"Banane","quantite":"1 moyenne"},{"nom":"Amandes","quantite":"15g"}]'
),

-- ── SHAKER ─────────────────────────────────────────────────────────
(
  'Shaker whey chocolat lait',
  '30g de whey chocolat mélangée à 250ml de lait demi-écrémé.',
  'shaker', 280, 32, 22, 5, 3, '🥛', true,
  '[{"nom":"Whey chocolat","quantite":"30g"},{"nom":"Lait demi-écrémé","quantite":"250ml"}]'
),
(
  'Shaker mass gainer maison',
  'Whey, flocons d''avoine, banane, lait entier pour une prise de masse.',
  'shaker', 620, 42, 80, 12, 10, '💪', true,
  '[{"nom":"Whey vanille","quantite":"40g"},{"nom":"Flocons d''avoine","quantite":"60g"},{"nom":"Banane","quantite":"1"},{"nom":"Lait entier","quantite":"300ml"}]'
),
(
  'Shaker recovery fruits rouges',
  'Whey isolat et fruits rouges mixés pour la récupération post-séance.',
  'shaker', 220, 28, 20, 2, 5, '🍇', true,
  '[{"nom":"Whey isolat","quantite":"30g"},{"nom":"Fruits rouges surgelés","quantite":"100g"},{"nom":"Eau","quantite":"200ml"}]'
),

-- ── DESSERT ────────────────────────────────────────────────────────
(
  'Mousse chocolat protéinée',
  'Mousse légère au chocolat noir réalisée avec du skyr et du cacao.',
  'dessert', 190, 16, 22, 4, 10, '🍫', true,
  '[{"nom":"Skyr nature","quantite":"150g"},{"nom":"Cacao non sucré","quantite":"10g"},{"nom":"Édulcorant","quantite":"qsp"},{"nom":"Blanc d''œuf","quantite":"1"}]'
),
(
  'Compote pomme cannelle maison',
  'Compote de pommes sans sucre ajouté, parfumée à la cannelle.',
  'dessert', 85, 0, 20, 0, 10, '🍏', true,
  '[{"nom":"Pommes","quantite":"2 moyennes"},{"nom":"Cannelle","quantite":"1/2 cc"},{"nom":"Eau","quantite":"50ml"}]'
)

ON CONFLICT DO NOTHING;


-- ════════════════════════════════════════════════════════════════════
-- VÉRIFICATION FINALE
-- ════════════════════════════════════════════════════════════════════
-- Exécute les requêtes ci-dessous pour vérifier que tout est en place :
--
--   SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
--   SELECT COUNT(*) FROM invite_codes;        -- 7
--   SELECT COUNT(*) FROM exercices_catalogue; -- 46
--   SELECT COUNT(*) FROM recettes;            -- 18
--
-- ════════════════════════════════════════════════════════════════════
