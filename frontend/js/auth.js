/* ══════════════════════════════════════
   AUTH PAGES LOGIC
   Handles login, register, onboarding
══════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.page;
  if (page === 'login')      initLogin();
  if (page === 'register')   initRegister();
  if (page === 'onboarding') initOnboarding();
});

// ── LOGIN ─────────────────────────────────────────────────────
function initLogin() {
  // Si déjà connecté, rediriger vers la bonne page
  const token = getToken();
  const u = getUser();
  if (token) {
    if (u?.isAdmin)           window.location.replace('/pages/admin.html');
    else if (u?.onboarding_done) window.location.replace('/pages/dashboard.html');
    else                      window.location.replace('/pages/onboarding.html');
    return;
  }

  const form = document.getElementById('login-form');
  const emailInput = document.getElementById('email');
  const passInput  = document.getElementById('password');
  const submitBtn  = document.getElementById('submit-btn');
  const togglePass = document.getElementById('toggle-password');
  const forgotLink = document.getElementById('forgot-link');

  togglePass?.addEventListener('click', () => {
    const show = passInput.type === 'password';
    passInput.type = show ? 'text' : 'password';
    togglePass.textContent = show ? '🙈' : '👁️';
  });

  forgotLink?.addEventListener('click', (e) => {
    e.preventDefault();
    showForgotPanel(emailInput.value.trim());
  });

  // Bouton envoi dans le panel forgot
  document.getElementById('forgot-submit-btn')?.addEventListener('click', sendForgotPassword);
  document.getElementById('forgot-email')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendForgotPassword(); }
  });

  // Retour depuis le panel
  document.getElementById('forgot-back-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    showLoginView();
  });

  // ── Helper : afficher erreur inline ──────────────────────
  function showLoginError(msg) {
    const box  = document.getElementById('login-error');
    const text = document.getElementById('login-error-text');
    if (!box || !text) return;

    text.textContent = msg;
    box.style.display = 'flex';

    // Bordure rouge sur le(s) champ(s) concerné(s)
    if (msg.toLowerCase().includes('email') || msg.toLowerCase().includes('compte')) {
      emailInput.style.borderColor = 'var(--danger)';
      passInput.style.borderColor  = '';
    } else if (msg.toLowerCase().includes('mot de passe')) {
      passInput.style.borderColor  = 'var(--danger)';
      emailInput.style.borderColor = '';
    } else {
      emailInput.style.borderColor = '';
      passInput.style.borderColor  = '';
    }
  }

  // Effacer l'erreur quand l'utilisateur retape
  [emailInput, passInput].forEach(input => {
    input.addEventListener('input', () => {
      document.getElementById('login-error').style.display = 'none';
      input.style.borderColor = '';
    });
  });

  // ── Forgot password helpers ───────────────────────────────
  function showForgotPanel(prefillEmail) {
    document.getElementById('login-view').style.display = 'none';
    document.getElementById('forgot-panel').style.display = '';
    document.getElementById('forgot-form-view').style.display = '';
    document.getElementById('forgot-success-view').style.display = 'none';
    document.getElementById('forgot-error').style.display = 'none';
    const fe = document.getElementById('forgot-email');
    if (fe) { fe.value = prefillEmail || ''; fe.focus(); }
  }

  function showLoginView() {
    document.getElementById('forgot-panel').style.display = 'none';
    document.getElementById('login-view').style.display = '';
  }

  async function sendForgotPassword() {
    const email   = (document.getElementById('forgot-email')?.value || '').trim();
    const errBox  = document.getElementById('forgot-error');
    const errText = document.getElementById('forgot-error-text');
    const btn     = document.getElementById('forgot-submit-btn');

    errBox.style.display = 'none';
    if (!email) {
      errBox.style.display = 'flex';
      errText.textContent = 'Entre ton adresse email.';
      document.getElementById('forgot-email')?.focus();
      return;
    }

    setLoading(btn, true);
    try {
      await API.auth.forgotPassword(email);
      document.getElementById('forgot-form-view').style.display = 'none';
      document.getElementById('forgot-success-msg').textContent =
        `Un email de réinitialisation a été envoyé à ${email}. Vérifie ta boîte mail.`;
      document.getElementById('forgot-success-view').style.display = '';
    } catch (err) {
      const msg = err.message === 'email_not_found'
        ? 'Aucun compte trouvé avec cet email.'
        : (err.message || 'Une erreur est survenue.');
      errBox.style.display = 'flex';
      errText.textContent = msg;
      setLoading(btn, false);
    }
  }

  // Map des codes d'erreur backend → messages lisibles
  const ERROR_MESSAGES = {
    'email_not_found': 'Aucun compte trouvé avec cet email.',
    'wrong_password':  'Mot de passe incorrect.',
  };

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email    = emailInput.value.trim();
    const password = passInput.value;

    if (!email || !password) {
      showLoginError('Veuillez remplir tous les champs.');
      return;
    }

    setLoading(submitBtn, true);
    try {
      const data = await API.auth.login({ email, password });
      setSession(data.session);
      setUser(data.user);

      if (data.user?.isAdmin) {
        window.location.href = '/pages/admin.html';
      } else if (!data.user?.onboarding_done) {
        window.location.href = '/pages/onboarding.html';
      } else {
        window.location.href = '/pages/dashboard.html';
      }
    } catch (err) {
      const msg = ERROR_MESSAGES[err.message]
        || (err.message?.includes('fetch') || err.message?.includes('network') || err.message?.includes('Failed')
            ? 'Problème de connexion, réessaie.'
            : err.message || 'Une erreur est survenue.');
      showLoginError(msg);
      setLoading(submitBtn, false);
    }
  });
}

// ── REGISTER ──────────────────────────────────────────────────
function initRegister() {
  if (getToken()) {
    window.location.href = '/pages/dashboard.html';
    return;
  }

  const form       = document.getElementById('register-form');
  const submitBtn  = document.getElementById('submit-btn');
  const passInput  = document.getElementById('password');
  const togglePass = document.getElementById('toggle-password');
  const inviteInput = document.getElementById('invite_code');

  togglePass?.addEventListener('click', () => {
    const show = passInput.type === 'password';
    passInput.type = show ? 'text' : 'password';
    togglePass.textContent = show ? '🙈' : '👁️';
  });

  const rgpdCheck = document.getElementById('rgpd-check');
  rgpdCheck?.addEventListener('change', () => {
    submitBtn.disabled = !rgpdCheck.checked;
  });

  const inviteError = document.getElementById('invite-error');
  const inviteHint  = document.getElementById('invite-hint');

  // Affichage feedback visuel uniquement (ne bloque pas le submit)
  inviteInput?.addEventListener('blur', async () => {
    const code = inviteInput.value.trim();
    if (!code) return;
    try {
      await API.invite.validate(code);
      inviteInput.style.borderColor = 'var(--success)';
      inviteError?.classList.add('hidden');
      if (inviteHint) inviteHint.textContent = '✅ Code valide';
    } catch (err) {
      inviteInput.style.borderColor = 'var(--danger)';
      if (inviteError) { inviteError.textContent = err.message || 'Code invalide'; inviteError.classList.remove('hidden'); }
      if (inviteHint) inviteHint.textContent = '';
    }
  });

  inviteInput?.addEventListener('input', () => {
    inviteInput.style.borderColor = '';
    inviteError?.classList.add('hidden');
    if (inviteHint) inviteHint.textContent = 'AppKcal est en accès beta privé';
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email       = document.getElementById('email').value.trim();
    const password    = passInput.value;
    const invite_code = inviteInput?.value.trim();

    console.log('[register submit] invite_code brut :', JSON.stringify(invite_code));

    if (!email || !password) { toast('Remplis tous les champs', 'error'); return; }
    if (password.length < 8) { toast('Mot de passe trop court (8 min)', 'error'); return; }
    if (!invite_code) { toast('Code d\'invitation requis', 'error'); inviteInput?.focus(); return; }

    // Valider le code directement au submit (source de vérité = backend)
    setLoading(submitBtn, true);
    try {
      await API.invite.validate(invite_code);
    } catch (err) {
      toast(err.message || 'Code d\'invitation invalide', 'error');
      inviteInput.style.borderColor = 'var(--danger)';
      if (inviteError) { inviteError.textContent = err.message || 'Code invalide'; inviteError.classList.remove('hidden'); }
      setLoading(submitBtn, false);
      return;
    }

    // Code validé → créer le compte
    try {
      const data = await API.auth.register({ email, password, invite_code });

      if (data.session) {
        setSession(data.session);
        setUser(data.user);
        window.location.href = '/pages/onboarding.html';
      } else {
        toast('Vérifie ton email pour confirmer ton compte', 'success', 5000);
        setTimeout(() => window.location.href = '/pages/login.html', 4000);
      }
    } catch (err) {
      toast(err.message, 'error');
      setLoading(submitBtn, false);
    }
  });
}

// ── ONBOARDING ────────────────────────────────────────────────
function initOnboarding() {
  if (!requireAuth()) return;

  const TOTAL_STEPS = 6;
  let currentStep = 1;
  const data = {};

  const dots = document.querySelectorAll('.onboarding-step-dot');
  const steps = document.querySelectorAll('.onboarding-step');
  const nextBtn = document.getElementById('next-btn');
  const backBtn = document.getElementById('back-btn');

  function updateDots() {
    dots.forEach((dot, i) => {
      dot.classList.remove('done', 'current');
      if (i + 1 < currentStep)       dot.classList.add('done');
      else if (i + 1 === currentStep) dot.classList.add('current');
    });
  }

  function showStep(n) {
    steps.forEach(s => s.classList.remove('active'));
    const el = document.querySelector(`.onboarding-step[data-step="${n}"]`);
    if (el) el.classList.add('active');

    backBtn.style.display = n === 1 ? 'none' : 'flex';
    nextBtn.textContent = n === TOTAL_STEPS ? 'Terminer 🎉' : 'Continuer';
    updateDots();
  }

  // Option cards selection
  document.querySelectorAll('.option-card').forEach(card => {
    card.addEventListener('click', () => {
      const group = card.dataset.group;
      document.querySelectorAll(`.option-card[data-group="${group}"]`).forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      data[group] = card.dataset.value;
    });
  });

  // Gender buttons
  document.querySelectorAll('.gender-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.gender-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      data.gender = btn.dataset.value;
    });
  });

  // Tag chips (allergies)
  document.querySelectorAll('.tag-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('selected');
      const group = chip.dataset.group;
      if (!data[group]) data[group] = [];
      const val = chip.dataset.value;
      const idx = data[group].indexOf(val);
      if (idx === -1) data[group].push(val);
      else data[group].splice(idx, 1);
    });
  });

  backBtn?.addEventListener('click', () => {
    if (currentStep > 1) { currentStep--; showStep(currentStep); }
  });

  nextBtn?.addEventListener('click', async () => {
    // ── Validation & collecte par étape ──────────────────────
    if (currentStep === 1) {
      data.username = document.getElementById('ob-username')?.value.trim();
      if (!data.username) { toast('Entre ton prénom', 'error'); return; }
    }
    if (currentStep === 2) {
      data.birthdate = document.getElementById('ob-birthdate')?.value;
      if (!data.birthdate) { toast('Entre ta date de naissance', 'error'); return; }
      if (!data.gender)    { toast('Sélectionne ton genre', 'error'); return; }
    }
    if (currentStep === 3) {
      data.height_cm = document.getElementById('ob-height')?.value;
      data.weight_kg = document.getElementById('ob-weight')?.value;
      if (!data.height_cm || !data.weight_kg) { toast('Entre ta taille et ton poids', 'error'); return; }
    }
    if (currentStep === 4 && !data.goal)          { toast('Choisis ton objectif', 'error'); return; }
    if (currentStep === 5 && !data.activity_level) { toast('Choisis ton niveau d\'activité', 'error'); return; }

    // ── Étape 6 : envoyer TOUTES les données en un seul appel ─
    if (currentStep === TOTAL_STEPS) {
      setLoading(nextBtn, true);
      try {
        console.log('[onboarding] Envoi données complètes:', data);
        await API.auth.onboarding(data);

        // Mettre à jour le localStorage
        const user = getUser();
        if (user) { user.onboarding_done = true; user.username = data.username; setUser(user); }

        toast('Profil créé !', 'success');
        window.location.href = '/pages/dashboard.html';
      } catch (err) {
        console.error('[onboarding] erreur:', err);
        toast(err.message, 'error');
        setLoading(nextBtn, false);
      }
      return;
    }

    // ── Étapes 1-5 : avancer localement, pas d'appel API ─────
    currentStep++;
    showStep(currentStep);
  });

  showStep(1);
}
