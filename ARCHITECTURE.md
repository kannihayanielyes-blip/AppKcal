# AppKcal — Architecture

## Table des matières

1. [Structure des dossiers](#1-structure-des-dossiers)
2. [Routes API](#2-routes-api)
3. [Flux d'authentification](#3-flux-dauthentification)
4. [Communication Frontend ↔ Backend](#4-communication-frontend--backend)
5. [Dépendances externes](#5-dépendances-externes)

---

## 1. Structure des dossiers

```
appkcal/
├── backend/
│   ├── controllers/          # Logique métier
│   │   ├── adminController.js      # Gestion admin (stats, users, invites, recettes)
│   │   ├── authController.js       # Register, login, logout, onboarding, forgot-password
│   │   ├── inviteController.js     # Validation des codes d'invitation
│   │   ├── nutritionController.js  # Logs alimentaires, suggestions, recettes
│   │   ├── photoController.js      # Analyse photo via OpenAI GPT-4o
│   │   ├── sportController.js      # Programmes, séances, historique
│   │   └── userController.js       # Profil, avatar, streak, poids
│   ├── middleware/
│   │   ├── auth.js           # requireAuth — vérifie le JWT dans Authorization header
│   │   └── admin.js          # requireAdmin — vérifie isAdmin dans le payload JWT
│   ├── routes/               # Définition des routes Express
│   │   ├── admin.js
│   │   ├── auth.js
│   │   ├── invite.js
│   │   ├── nutrition.js
│   │   ├── photo.js
│   │   ├── sport.js
│   │   └── user.js
│   └── server.js             # Point d'entrée Express : CORS, rate-limit, montage des routes
│
├── config/
│   ├── supabase.js           # Initialise deux clients Supabase (public + admin)
│   ├── supabase-schema-final.sql  # Schéma complet de la base de données
│   └── .env.example          # Variables d'environnement requises
│
├── frontend/
│   ├── css/
│   │   ├── main.css          # Styles globaux, design system (variables CSS, composants)
│   │   ├── auth.css          # Styles spécifiques login/register/onboarding
│   │   └── dashboard.css     # Styles spécifiques au dashboard
│   ├── js/
│   │   ├── api.js            # Client API central — toutes les requêtes passent ici
│   │   ├── auth.js           # Gestion login/register/forgot-password côté frontend
│   │   └── dashboard.js      # Logique du dashboard (graphiques, logs du jour)
│   ├── pages/
│   │   ├── login.html        # Connexion + mot de passe oublié
│   │   ├── register.html     # Inscription (avec code d'invitation)
│   │   ├── onboarding.html   # Profil initial (objectifs, morphologie, activité)
│   │   ├── dashboard.html    # Page principale — résumé nutritionnel du jour
│   │   ├── photo.html        # Analyse photo d'un repas par IA
│   │   ├── sport.html        # Programmes d'entraînement + suivi des séances
│   │   ├── profile.html      # Profil utilisateur, poids, streak
│   │   ├── calendar.html     # Vue kanban hebdomadaire des repas
│   │   ├── feed.html         # Feed communautaire (placeholder)
│   │   └── admin.html        # Panel d'administration
│   └── index.html            # Redirection vers login ou dashboard
│
├── vercel.json               # Configuration déploiement Vercel (builds, routes, headers)
├── package.json              # Dépendances Node.js
└── .env                      # Variables d'environnement locales (non versionné)
```

---

## 2. Routes API

Base URL : `/api`

Toutes les routes protégées nécessitent le header : `Authorization: Bearer <token>`

### Auth — `/api/auth`

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| POST | `/auth/register` | — | Crée un compte (nécessite un code d'invitation valide) |
| POST | `/auth/login` | — | Connexion — retourne `session.access_token` + profil |
| POST | `/auth/logout` | — | Déconnexion Supabase |
| POST | `/auth/onboarding` | ✓ | Sauvegarde le profil complet + calcule `daily_kcal_target` |
| POST | `/auth/forgot-password` | — | Envoie un email de réinitialisation (vérifie l'email en base) |

### Utilisateur — `/api/user`

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | `/user/profile` | ✓ | Retourne le profil complet de l'utilisateur |
| PATCH | `/user/profile` | ✓ | Met à jour les champs du profil |
| POST | `/user/avatar` | ✓ | Upload photo de profil → Supabase Storage bucket `avatars` |
| GET | `/user/streak` | ✓ | Calcule le streak de logs consécutifs |
| GET | `/user/weight` | ✓ | Historique de poids (`?limit=N`) |
| POST | `/user/weight` | ✓ | Enregistre le poids du jour |

### Nutrition — `/api/nutrition`

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | `/nutrition/today` | ✓ | Logs alimentaires du jour + totaux macros |
| GET | `/nutrition/week` | ✓ | Résumé nutritionnel sur 7 jours (`?start=YYYY-MM-DD`) |
| GET | `/nutrition/suggestions` | ✓ | Suggestions d'aliments fréquents |
| GET | `/nutrition/smart-suggestions` | ✓ | Suggestions intelligentes basées sur l'historique |
| GET | `/nutrition/recipes` | ✓ | Recettes disponibles (`?category=...`) |
| POST | `/nutrition/log` | ✓ | Ajoute un log alimentaire |
| PUT | `/nutrition/log/:id` | ✓ | Modifie un log existant |
| DELETE | `/nutrition/log/:id` | ✓ | Supprime un log |

### Photo IA — `/api/photo`

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| POST | `/photo/analyze` | ✓ | Envoie une image à GPT-4o → retourne `{aliments[], total{}}` |

Accepte : multipart (`photo`) ou JSON (`image_base64`, `mime_type`). Champs optionnels : `description`, `weight_g`.

### Sport — `/api/sport`

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | `/sport/programmes` | ✓ | Liste les programmes de l'utilisateur |
| GET | `/sport/programmes/:id` | ✓ | Détail d'un programme avec ses séances |
| POST | `/sport/programmes` | ✓ | Crée un programme (prédéfini ou custom) |
| DELETE | `/sport/programmes/:id` | ✓ | Supprime un programme |
| GET | `/sport/exercices` | ✓ | Liste statique de 47 exercices classés par groupe musculaire |
| PATCH | `/sport/exercices/:id` | ✓ | Met à jour poids/reps/séries d'un exercice en séance |
| POST | `/sport/historique` | ✓ | Sauvegarde une séance terminée |
| GET | `/sport/historique/last` | ✓ | Dernière séance d'un type (`?seance_nom=...`) |

### Invitation — `/api/invite`

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| POST | `/invite/validate` | — | Vérifie qu'un code d'invitation est valide et non utilisé |

### Admin — `/api/admin`

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | `/admin/stats` | Admin | Statistiques globales de l'app |
| GET | `/admin/users` | Admin | Liste tous les utilisateurs |
| DELETE | `/admin/users/:id` | Admin | Supprime un utilisateur |
| GET | `/admin/invites` | Admin | Liste les codes d'invitation |
| POST | `/admin/invites` | Admin | Génère un nouveau code d'invitation |
| DELETE | `/admin/invites/:id` | Admin | Supprime un code d'invitation |
| GET | `/admin/recipes` | Admin | Liste toutes les recettes |
| POST | `/admin/recipes` | Admin | Crée une recette |
| PUT | `/admin/recipes/:id` | Admin | Modifie une recette |
| PATCH | `/admin/recipes/:id/visibility` | Admin | Active/désactive une recette |
| DELETE | `/admin/recipes/:id` | Admin | Supprime une recette |

### Système

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/health` | Healthcheck — retourne `{ status: 'ok' }` |

---

## 3. Flux d'authentification

### Inscription

```
register.html
  → saisie email + password + invite_code
  → POST /api/invite/validate (vérification code)
  → POST /api/auth/register
      ├── normalize invite_code (toUpperCase)
      ├── vérifie invite_codes WHERE code=X AND used=false
      ├── marque invite_code.used = true
      ├── supabase.auth.signUp(email, password)
      ├── INSERT INTO profiles (id, email, onboarding_done: false)
      └── retourne { user, session }
  → stocke token dans localStorage (clé: appkcal_session)
  → redirect → onboarding.html
```

### Connexion

```
login.html
  → saisie email + password
  → POST /api/auth/login
      ├── [hardcoded accounts] check ADMIN_EMAIL / TEST_EMAIL / TEST_ONBOARDING_EMAIL
      │     → génère JWT signé avec JWT_SECRET
      ├── [compte normal]
      │   ├── vérifie email dans profiles (→ 401 email_not_found si absent)
      │   ├── supabase.auth.signInWithPassword(email, password)
      │   └── retourne session Supabase + profil (onboarding_done, username, avatar_url)
      └── retourne { session: { access_token }, user }
  → stocke token + user dans localStorage
  → si onboarding_done: false → redirect onboarding.html
  → sinon → redirect dashboard.html
```

### Requêtes authentifiées

```
frontend (api.js)
  → lit access_token depuis localStorage
  → envoie header Authorization: Bearer <token>

backend (middleware/auth.js)
  → jwt.verify(token, JWT_SECRET)
  → attach req.user = { id, email, isAdmin }
  → [admin routes] middleware/admin.js vérifie req.user.isAdmin === true
```

### Mot de passe oublié

```
login.html (panel forgot)
  → saisie email
  → POST /api/auth/forgot-password
      ├── vérifie email dans profiles (→ 404 email_not_found si absent)
      └── supabase.auth.resetPasswordForEmail(email)
  → affiche panel succès avec l'email
```

---

## 4. Communication Frontend ↔ Backend

### Client API centralisé (`frontend/js/api.js`)

Toutes les pages utilisent un objet `API` global défini dans `api.js` (chargé via `<script src="/js/api.js">`).

```
Page HTML
  └── <script src="/js/api.js">    ← définit API, requireAuth(), toast(), getUser()...
  └── <script>
        await API.nutrition.today()     ← appel typique
        await API.user.profile()
        await API.photo.analyze(formData)
```

**Fonctionnement interne de `api.js` :**

1. `request(method, path, body)` — fonction centrale :
   - Lit `appkcal_session` dans localStorage pour récupérer le token
   - Ajoute `Authorization: Bearer <token>`
   - Détecte si `body` est `FormData` (pas de `Content-Type` manuel pour multipart)
   - Gère les erreurs HTTP et lance une exception avec `error.message`

2. **Mode test** — si `localStorage.getItem('appkcal_test_mode') === 'true'` :
   - Les appels retournent des données fictives depuis localStorage
   - Utilisé pour démo sans backend

3. **Helpers globaux :**
   - `requireAuth()` — redirige vers login si pas de session
   - `getUser()` / `setUser()` / `clearSession()` — gestion localStorage
   - `toast(msg, type)` — notifications UI
   - `setLoading(btn, bool)` — état de chargement des boutons
   - `formatDate(d)` — formatage dates

### Flux d'une requête typique

```
dashboard.html
  → DOMContentLoaded
  → requireAuth()               ← vérifie token en localStorage
  → API.nutrition.today()
      → request('GET', '/nutrition/today')
          → fetch('/api/nutrition/today', { headers: { Authorization: Bearer ... } })
          → backend: requireAuth middleware → nutritionController.getToday
          → SELECT FROM nutrition_logs WHERE user_id=X AND date=today
          → retourne { logs: [...], total: { calories, proteines_g, glucides_g, lipides_g } }
  → render UI
```

### Upload de fichiers

Deux cas de figure dans l'app :

| Page | Endpoint | Champ multer | Limite |
|------|----------|--------------|--------|
| `photo.html` | POST `/api/photo/analyze` | `photo` | 5 MB |
| `profile.html` | POST `/api/user/avatar` | `avatar` | 2 MB |

Les deux utilisent `FormData` côté frontend — `api.js` détecte automatiquement et n'ajoute pas de `Content-Type` (laissé au navigateur pour le boundary multipart).

### Pages sans backend (mode statique)

- `feed.html` — placeholder, juste `requireAuth()`
- `index.html` — redirection pure JS vers login ou dashboard

---

## 5. Dépendances externes

### Backend

| Package | Version | Usage |
|---------|---------|-------|
| `express` | ^4.18 | Framework HTTP, routing, middleware |
| `@supabase/supabase-js` | ^2.39 | Client Supabase (auth + database + storage) |
| `jsonwebtoken` | ^9.0 | Génération et vérification des JWT |
| `openai` | ^4.24 | Analyse photo via GPT-4o (vision) |
| `multer` | ^1.4.5 | Upload de fichiers en mémoire (memoryStorage) |
| `cors` | ^2.8 | Headers CORS pour autoriser le frontend |
| `express-rate-limit` | ^7.1 | Rate limiting (200 req/15min global, 20 auth) |
| `dotenv` | ^16.3 | Chargement des variables d'environnement |
| `nodemon` | ^3.0 | Rechargement auto en développement |

### Services externes

#### Supabase
- **Base de données** : PostgreSQL hébergé — toutes les données (profiles, nutrition_logs, sport, etc.)
- **Auth** : `supabase.auth` pour signUp / signInWithPassword / resetPasswordForEmail
- **Storage** : bucket `avatars` (public) pour les photos de profil
- **Deux clients** :
  - `supabase` — client public, respecte les RLS policies
  - `supabaseAdmin` — client service role, bypass RLS (opérations admin back-end)

#### OpenAI
- Modèle : **GPT-4o** (vision)
- Usage : analyse d'une photo de repas → identification des aliments, grammes, calories, macros
- Réponse : JSON structuré `{ items: [...], total: {...} }`

#### Vercel
- Hébergement production
- Build : `@vercel/node` pour le backend Express, `@vercel/static` pour le frontend
- Variables d'env à définir dans Dashboard → Settings → Environment Variables

### Variables d'environnement requises

```env
# Supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...

# JWT
JWT_SECRET=minimum_32_chars_random_string

# OpenAI
OPENAI_API_KEY=sk-...

# Comptes hardcodés (lus depuis process.env)
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=...
TEST_EMAIL=test@example.com
TEST_PASSWORD=...
TEST_ONBOARDING_EMAIL=onboarding@example.com
TEST_ONBOARDING_PASSWORD=...

# Serveur
PORT=3000
NODE_ENV=production
```

### Tables Supabase principales

| Table | Description |
|-------|-------------|
| `profiles` | Profil utilisateur (morphologie, objectifs, daily_kcal_target) |
| `nutrition_logs` | Entrées alimentaires journalières |
| `weight_logs` | Historique du poids |
| `programmes` | Programmes d'entraînement |
| `seances` | Séances dans un programme |
| `exercices_seance` | Exercices dans une séance |
| `sport_historique` | Historique des séances effectuées |
| `invite_codes` | Codes d'invitation (used, used_at) |
| `recipes` | Recettes créées par l'admin |
| `storage.buckets` | Bucket `avatars` pour les photos de profil |
