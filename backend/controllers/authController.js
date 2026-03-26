const { supabase, supabaseAdmin } = require('../../config/supabase');
const jwt = require('jsonwebtoken');

const ADMIN_EMAIL    = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const TEST_EMAIL    = process.env.TEST_EMAIL;
const TEST_PASSWORD = process.env.TEST_PASSWORD;

const TEST_ONBOARDING_EMAIL    = process.env.TEST_ONBOARDING_EMAIL;
const TEST_ONBOARDING_PASSWORD = process.env.TEST_ONBOARDING_PASSWORD;

// POST /api/auth/register
async function register(req, res) {
  try {
    const { email, password, invite_code } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis' });
    }

    // Validate invite code (obligatoire)
    console.log('[register] invite_code reçu :', JSON.stringify(invite_code));

    if (!invite_code) {
      return res.status(400).json({ error: 'Code d\'invitation requis' });
    }

    const normalizedCode = String(invite_code).toUpperCase().trim();
    const HARDCODED_INVITE = '0203';

    console.log('[register] normalizedCode :', normalizedCode, '| match hardcoded :', normalizedCode === HARDCODED_INVITE);

    if (normalizedCode === HARDCODED_INVITE) {
      // Code de test — autorisé directement
      console.log('[register] Code hardcodé accepté, création du compte...');
    } else {
      // Vérifier en base
      const { data: invite, error: inviteErr } = await supabaseAdmin
        .from('invite_codes')
        .select('*')
        .eq('code', normalizedCode)
        .eq('used', false)
        .single();

      console.log('[register] DB invite :', invite, '| error :', inviteErr?.message);

      if (inviteErr || !invite) {
        return res.status(400).json({ error: 'Code d\'invitation invalide ou déjà utilisé' });
      }

      // Marquer comme utilisé
      await supabaseAdmin
        .from('invite_codes')
        .update({ used: true, used_at: new Date().toISOString() })
        .eq('id', invite.id);
    }

    // Create auth user
    const { data, error } = await supabase.auth.signUp({ email, password });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Create profile row
    if (data.user) {
      await supabaseAdmin.from('profiles').insert({
        id: data.user.id,
        email,
        onboarding_done: false,
        created_at: new Date().toISOString()
      });
    }

    return res.status(201).json({
      message: 'Compte créé. Vérifie ton email.',
      user: { id: data.user?.id, email: data.user?.email, onboarding_done: false },
      session: data.session
    });
  } catch (err) {
    console.error('[register]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// POST /api/auth/login
async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis' });
    }

    // ── Admin hardcodé ────────────────────────────────────────
    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      const adminToken = jwt.sign(
        { id: '00000000-0000-0000-0000-000000000001', email: ADMIN_EMAIL, isAdmin: true },
        process.env.JWT_SECRET,
        { expiresIn: '12h' }
      );
      return res.json({
        session: { access_token: adminToken },
        user: {
          id: '00000000-0000-0000-0000-000000000001',
          email: ADMIN_EMAIL,
          isAdmin: true,
          onboarding_done: true,
          username: 'Admin'
        }
      });
    }

    // ── Utilisateur test hardcodé ─────────────────────────────
    if (email === TEST_EMAIL && password === TEST_PASSWORD) {
      const testToken = jwt.sign(
        { id: '00000000-0000-0000-0000-000000000002', email: TEST_EMAIL, isAdmin: false },
        process.env.JWT_SECRET,
        { expiresIn: '12h' }
      );
      return res.json({
        session: { access_token: testToken },
        user: {
          id: '00000000-0000-0000-0000-000000000002',
          email: TEST_EMAIL,
          isAdmin: false,
          onboarding_done: true,
          username: 'User Test'
        }
      });
    }

    // ── Compte test onboarding ────────────────────────────────
    if (email === TEST_ONBOARDING_EMAIL && password === TEST_ONBOARDING_PASSWORD) {
      const testOnboardingToken = jwt.sign(
        { id: '00000000-0000-0000-0000-000000000003', email: TEST_ONBOARDING_EMAIL, isAdmin: false, isTest: true },
        process.env.JWT_SECRET,
        { expiresIn: '12h' }
      );
      return res.json({
        session: { access_token: testOnboardingToken },
        user: {
          id: '00000000-0000-0000-0000-000000000003',
          email: TEST_ONBOARDING_EMAIL,
          isAdmin: false,
          isTest: true,
          onboarding_done: false,
          username: 'Test Onboarding'
        }
      });
    }

    // ── Utilisateur normal via Supabase ───────────────────────
    // Vérifier d'abord si l'email existe en base
    const { data: existingUser } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (!existingUser) {
      return res.status(401).json({ error: 'email_not_found' });
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      return res.status(401).json({ error: 'wrong_password' });
    }

    // Fetch profile to know if onboarding is done
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('onboarding_done, username, avatar_url')
      .eq('id', data.user.id)
      .single();

    return res.json({
      session: data.session,
      user: {
        id: data.user.id,
        email: data.user.email,
        isAdmin: false,
        onboarding_done: profile?.onboarding_done ?? false,
        username: profile?.username,
        avatar_url: profile?.avatar_url
      }
    });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// POST /api/auth/logout
async function logout(req, res) {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Déconnecté' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// POST /api/auth/onboarding
async function onboarding(req, res) {
  try {
    const userId = req.user.id;
    const {
      username, avatar_url,
      birthdate, gender,
      height_cm, weight_kg,
      goal,
      activity_level,
      allergies, diet_type
    } = req.body;

    console.log('[onboarding] userId:', userId, '| body keys:', Object.keys(req.body));

    const daily_kcal_target = computeKcalTarget(req.body);

    const profileData = {
      id: userId,
      email: req.user.email || null,
      username:          username          || null,
      avatar_url:        avatar_url        || null,
      birthdate:         birthdate         || null,
      gender:            gender            || null,
      height_cm:         height_cm         ? Number(height_cm)  : null,
      weight_kg:         weight_kg         ? Number(weight_kg)  : null,
      goal:              goal              || null,
      activity_level:    activity_level    || null,
      allergies:         allergies         || [],
      diet_type:         diet_type         || null,
      daily_kcal_target: daily_kcal_target || 2000,
      onboarding_done:   true,
      updated_at:        new Date().toISOString()
    };

    console.log('[onboarding] upsert data:', profileData);

    // UPSERT : crée la row si elle n'existe pas, met à jour sinon
    const { error } = await supabaseAdmin
      .from('profiles')
      .upsert(profileData, { onConflict: 'id' });

    if (error) {
      console.error('[onboarding] Supabase error:', error.message, error.details);
      return res.status(400).json({ error: error.message });
    }

    console.log('[onboarding] Sauvegarde réussie pour', userId);
    res.json({ message: 'Profil enregistré', onboarding_done: true });
  } catch (err) {
    console.error('[onboarding]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// POST /api/auth/forgot-password
async function forgotPassword(req, res) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requis' });

    // Vérifier que l'email existe dans profiles avant d'envoyer
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (!profile) return res.status(404).json({ error: 'email_not_found' });

    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Email de réinitialisation envoyé' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// ── Helpers ───────────────────────────────────────────────────
function computeKcalTarget({ birthdate, gender, height_cm, weight_kg, activity_level, goal }) {
  if (!birthdate || !gender || !height_cm || !weight_kg) return 2000;

  const age = new Date().getFullYear() - new Date(birthdate).getFullYear();
  const h = Number(height_cm);
  const w = Number(weight_kg);

  // Mifflin-St Jeor
  let bmr = gender === 'male'
    ? 10 * w + 6.25 * h - 5 * age + 5
    : 10 * w + 6.25 * h - 5 * age - 161;

  const factors = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    very_active: 1.9
  };
  let tdee = bmr * (factors[activity_level] || 1.55);

  if (goal === 'bulk')      tdee += 200;
  if (goal === 'cut')       tdee -= 200;
  if (goal === 'rebalance') tdee -= 100;
  // 'maintain' → no adjustment

  return Math.round(tdee);
}

module.exports = { register, login, logout, onboarding, forgotPassword };
