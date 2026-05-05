/* ══════════════════════════════════════
   API CLIENT
   Central fetch wrapper — handles auth tokens & errors
══════════════════════════════════════ */

const API_BASE = '/api';

function getToken() {
  const session = JSON.parse(localStorage.getItem('kcal_session') || 'null');
  return session?.access_token || null;
}

function setSession(session) {
  localStorage.setItem('kcal_session', JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem('kcal_session');
  localStorage.removeItem('kcal_user');
  // Nettoyer les données test (perdues à la déconnexion)
  localStorage.removeItem('kcal_test_logs');
  localStorage.removeItem('kcal_test_weights');
  localStorage.removeItem('kcal_test_profile');
}

// ── Test mode ─────────────────────────────────────────────────
function isTestMode() {
  return getUser()?.isTest === true;
}

function handleTestRequest(method, path, body) {
  const today = new Date().toISOString().split('T')[0];

  // Onboarding : persister le profil en localStorage, marquer done
  if (path === '/auth/onboarding') {
    const profile = { ...body, daily_kcal_target: _computeTestKcal(body) };
    localStorage.setItem('kcal_test_profile', JSON.stringify(profile));
    const user = getUser();
    if (user) { user.onboarding_done = true; user.username = body.username; setUser(user); }
    return { message: 'Profil enregistré', onboarding_done: true };
  }

  // Profil utilisateur
  if (path === '/user/profile') {
    const p = JSON.parse(localStorage.getItem('kcal_test_profile') || '{}');
    const user = getUser();
    return {
      username: p.username || user?.username || 'Test',
      email: user?.email || 'test@gmail.com',
      daily_kcal_target: p.daily_kcal_target || 2000,
      weight_kg: p.weight_kg || null,
      goal: p.goal || null,
      ...p
    };
  }

  // Streak
  if (path === '/user/streak') return { streak: 0 };

  // Historique poids
  if (path.startsWith('/user/weight') && method === 'GET') {
    return JSON.parse(localStorage.getItem('kcal_test_weights') || '[]');
  }

  // Enregistrer un poids
  if (path === '/user/weight' && method === 'POST') {
    const weights = JSON.parse(localStorage.getItem('kcal_test_weights') || '[]');
    const entry = { id: 'tw_' + Date.now(), weight_kg: body.weight_kg, date: today };
    const idx = weights.findIndex(w => w.date === today);
    if (idx >= 0) weights[idx] = entry; else weights.push(entry);
    localStorage.setItem('kcal_test_weights', JSON.stringify(weights));
    const p = JSON.parse(localStorage.getItem('kcal_test_profile') || '{}');
    p.weight_kg = body.weight_kg;
    localStorage.setItem('kcal_test_profile', JSON.stringify(p));
    return { message: 'ok' };
  }

  // Nutrition du jour
  if (path === '/nutrition/today') {
    const logs = JSON.parse(localStorage.getItem('kcal_test_logs') || '[]');
    const todayLogs = logs.filter(l => l.date === today);
    const totals = todayLogs.reduce(
      (acc, l) => ({ kcal: acc.kcal + (+l.kcal || 0), protein: acc.protein + (+l.protein_g || 0), carbs: acc.carbs + (+l.carbs_g || 0), fat: acc.fat + (+l.fat_g || 0) }),
      { kcal: 0, protein: 0, carbs: 0, fat: 0 }
    );
    return { logs: todayLogs, totals };
  }

  // Ajouter un log nutrition (single)
  if (path === '/nutrition/log' && method === 'POST') {
    const logs = JSON.parse(localStorage.getItem('kcal_test_logs') || '[]');
    const entry = { id: 'tl_' + Date.now(), date: today, ...body };
    logs.push(entry);
    localStorage.setItem('kcal_test_logs', JSON.stringify(logs));
    return entry;
  }

  // Ajouter un repas complet (meal log)
  if (path === '/nutrition/log/meal' && method === 'POST') {
    const logs  = JSON.parse(localStorage.getItem('kcal_test_logs') || '[]');
    const items = body.items || [];
    const total = items.reduce((a, it) => ({
      kcal: a.kcal + (it.kcal || 0),
      prot: a.prot + (it.proteines_g || 0),
      carbs: a.carbs + (it.glucides_g || 0),
      fat:  a.fat  + (it.lipides_g  || 0),
      qty:  a.qty  + (it.quantity_g || 0),
    }), { kcal: 0, prot: 0, carbs: 0, fat: 0, qty: 0 });
    const entry = {
      id: 'tl_' + Date.now(), date: today,
      name: body.name || 'Repas',
      kcal: Math.round(total.kcal),
      protein_g: Math.round(total.prot * 10) / 10,
      carbs_g:   Math.round(total.carbs * 10) / 10,
      fat_g:     Math.round(total.fat  * 10) / 10,
      quantity_g: Math.round(total.qty),
      meal_type: body.meal_type || 'snack',
    };
    logs.push(entry);
    localStorage.setItem('kcal_test_logs', JSON.stringify(logs));
    return entry;
  }

  // Supprimer un log nutrition
  if (path.startsWith('/nutrition/log/') && method === 'DELETE') {
    const id = path.split('/').pop();
    const logs = JSON.parse(localStorage.getItem('kcal_test_logs') || '[]');
    localStorage.setItem('kcal_test_logs', JSON.stringify(logs.filter(l => l.id !== id)));
    return { message: 'ok' };
  }

  // Semaine nutrition
  if (path.startsWith('/nutrition/week')) return { logs: [] };

  // Sport (test mode — données vides)
  if (path === '/sport/programmes' && method === 'GET') return [];
  if (path.startsWith('/sport/programmes/') && method === 'GET') return null;
  if (path === '/sport/programmes' && method === 'POST') return { id: 'ts_' + Date.now(), nom: body?.nom || 'Programme', type: body?.type || 'custom' };
  if (path.startsWith('/sport/programmes/') && method === 'DELETE') return { message: 'ok' };
  if (path === '/sport/exercices') return [];
  if (path === '/sport/historique' && method === 'POST') return { id: 'th_' + Date.now() };
  if (path.startsWith('/sport/historique/last')) return null;

  // Suggestions
  if (path === '/nutrition/suggestions') return { suggestions: [] };

  // Recettes : données globales non user-specific → laisser passer vers le vrai backend
  // (géré dans request() qui bypasse ce handler pour ce chemin)
  // if (path.startsWith('/nutrition/recipes')) return [];  // ← SUPPRIMÉ

  // Avatar upload (test mode — pas de stockage réel)
  if (path === '/user/avatar' && method === 'POST') return { avatar_url: null };

  // Smart suggestions → mode général en test
  if (path === '/nutrition/smart-suggestions') return { mode: 'general' };

  // Tout le reste → succès silencieux (ex: photo/analyze passe toujours)
  return { message: 'ok' };
}

// Calcul kcal côté client pour le mode test (miroir de computeKcalTarget backend)
function _computeTestKcal({ birthdate, gender, height_cm, weight_kg, activity_level, goal }) {
  if (!birthdate || !gender || !height_cm || !weight_kg) return 2000;
  const age = new Date().getFullYear() - new Date(birthdate).getFullYear();
  const h = Number(height_cm), w = Number(weight_kg);
  let bmr = gender === 'male' ? 10*w + 6.25*h - 5*age + 5 : 10*w + 6.25*h - 5*age - 161;
  const factors = { sedentary:1.2, light:1.375, moderate:1.55, active:1.725, very_active:1.9 };
  let tdee = bmr * (factors[activity_level] || 1.55);
  if (goal === 'bulk') tdee += 200;
  if (goal === 'cut')  tdee -= 200;
  if (goal === 'rebalance') tdee -= 100;
  return Math.round(tdee);
}

// ── Injection bulle user + badge test ─────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const path = window.location.pathname;
  const isAuthPage = ['/login', '/register', '/onboarding', '/admin']
    .some(p => path.includes(p));

  // ── Onglet Coach : afficher si is_coach ────────────────────
  if (getUser()?.is_coach) {
    const navCoach = document.getElementById('nav-coach');
    if (navCoach) navCoach.style.display = 'flex';
  }

  // ── Badge MODE TEST ────────────────────────────────────────
  if (isTestMode()) {
    const badge = document.createElement('div');
    badge.id = 'test-mode-badge';
    badge.textContent = '⚗️ MODE TEST — données non sauvegardées';
    badge.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#F59E0B;color:#fff;text-align:center;font-size:.68rem;font-weight:800;letter-spacing:.06em;padding:5px 8px;z-index:9999;pointer-events:none';
    document.body.prepend(badge);
  }

  // ── Bulle avatar user (toutes les pages sauf auth/admin) ───
  if (isAuthPage) return;
  if (document.querySelector('.dashboard-header')) return; // dashboard a son propre header

  const user = getUser();
  if (!user) return;

  const username = user.username || user.email?.split('@')[0] || '?';
  const initial  = username[0].toUpperCase();

  const bubble = document.createElement('a');
  bubble.href      = '/pages/profile.html';
  bubble.className = 'user-bubble';
  bubble.id        = 'user-bubble';

  const avatarDiv = document.createElement('div');
  avatarDiv.className = 'user-bubble__avatar';
  avatarDiv.id        = 'user-bubble-avatar';

  if (user.avatar_url) {
    avatarDiv.innerHTML = `<img src="${user.avatar_url}" alt="avatar">`;
  } else {
    avatarDiv.textContent = initial;
  }

  const nameSpan = document.createElement('span');
  nameSpan.className   = 'user-bubble__name';
  nameSpan.id          = 'user-bubble-name';
  nameSpan.textContent = username;

  bubble.appendChild(avatarDiv);
  bubble.appendChild(nameSpan);
  document.body.appendChild(bubble);
});

async function request(method, path, body = null, options = {}) {
  // Intercepter toutes les requêtes non-auth en mode test
  // Exceptions : auth, photo/analyze, et recettes (données globales, pas user-specific)
  if (isTestMode()
    && !path.startsWith('/auth/login')
    && !path.startsWith('/auth/register')
    && path !== '/photo/analyze'
    && !path.startsWith('/nutrition/recipes')
  ) {
    return handleTestRequest(method, path, body);
  }

  const token = getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (options.headers) Object.assign(headers, options.headers);

  const init = { method, headers };
  if (body && !(body instanceof FormData)) {
    init.body = JSON.stringify(body);
  } else if (body instanceof FormData) {
    delete headers['Content-Type']; // let browser set multipart boundary
    init.body = body;
  }

  const res = await fetch(`${API_BASE}${path}`, init);
  const data = await res.json().catch(() => ({}));

  if (res.status === 401 && !path.includes('/auth/login')) {
    clearSession();
    navigate('/pages/login.html');
    return;
  }

  if (!res.ok) {
    const err = new Error(data.error || `Erreur ${res.status}`);
    err.status = res.status;
    err.data   = data;
    throw err;
  }

  return data;
}

const API = {
  // Auth
  auth: {
    register: (body) => request('POST', '/auth/register', body),
    login:    (body) => request('POST', '/auth/login', body),
    logout:   ()     => request('POST', '/auth/logout'),
    onboarding: (body) => request('POST', '/auth/onboarding', body),
    forgotPassword: (email) => request('POST', '/auth/forgot-password', { email })
  },

  // User
  user: {
    profile:       () => request('GET', '/user/profile'),
    updateProfile: (body) => request('PATCH', '/user/profile', body),
    uploadAvatar:  (formData) => request('POST', '/user/avatar', formData),
    streak:        () => request('GET', '/user/streak'),
    weightHistory: (limit) => request('GET', `/user/weight?limit=${limit || 30}`),
    logWeight:     (body) => request('POST', '/user/weight', body)
  },

  // Nutrition
  nutrition: {
    today:       () => request('GET', '/nutrition/today'),
    week:        (start) => request('GET', `/nutrition/week${start ? '?start='+start : ''}`),
    suggestions: () => request('GET', '/nutrition/suggestions'),
    addLog:      (body) => request('POST', '/nutrition/log', body),
    addMealLog:  (body) => request('POST', '/nutrition/log/meal', body),
    updateLog:   (id, body) => request('PUT', `/nutrition/log/${id}`, body),
    deleteLog:   (id) => request('DELETE', `/nutrition/log/${id}`),
    recipes: Object.assign(
      (category) => request('GET', `/nutrition/recipes${category && category !== 'all' ? '?category=' + category : ''}`),
      {
        mine:   ()     => request('GET',    '/nutrition/recipes/mine'),
        create: (data) => request('POST',   '/nutrition/recipes', data),
        delete: (id)   => request('DELETE', `/nutrition/recipes/${id}`)
      }
    ),
    smartSuggestions: () => request('GET', '/nutrition/smart-suggestions')
  },

  // Photo
  photo: {
    analyze: (formData) => request('POST', '/photo/analyze', formData),
    quota:   ()         => request('GET',  '/photo/quota')
  },

  // Invite
  invite: {
    validate: (code) => request('POST', '/invite/validate', { code })
  },

  // Sport
  sport: {
    programmes:  ()          => request('GET', '/sport/programmes'),
    programme:   (id)        => request('GET', `/sport/programmes/${id}`),
    create:      (body)      => request('POST', '/sport/programmes', body),
    delete:      (id)        => request('DELETE', `/sport/programmes/${id}`),
    exercices:   ()          => request('GET', '/sport/exercices'),
    saveSession: (body)      => request('POST', '/sport/historique', body),
    lastSession: (seanceNom) => request('GET', `/sport/historique/last?seance_nom=${encodeURIComponent(seanceNom)}`),
  },

  // Coach (côté coach uniquement — endpoints client-side livrés en Phase B)
  coach: {
    // Profil
    getProfile:    ()     => request('GET',   '/coach/profile'),
    createProfile: (data) => request('POST',  '/coach/profile', data),
    updateProfile: (data) => request('PATCH', '/coach/profile', data),

    // Clients
    getClients:       ()         => request('GET',   '/coach/clients'),
    inviteClient:     (data)     => request('POST',  '/coach/clients/invite', data),
    getClientDetail:  (id)       => request('GET',   `/coach/clients/${id}`),
    updateClient:     (id, data) => request('PATCH', `/coach/clients/${id}`, data),
    acceptInvitation: (id)       => request('POST',  `/coach/accept/${id}`),

    // Plans nutrition
    getClientPlan: (clientId) => request('GET',  `/coach/plans/${clientId}`),
    createPlan:    (data)     => request('POST', '/coach/plans', data),

    // Programmes
    assignProgramme: (data) => request('POST', '/coach/programmes', data),

    // Objectifs hebdo
    getWeeklyGoals:    (clientId) => request('GET',  `/coach/goals/${clientId}`),
    createWeeklyGoals: (data)     => request('POST', '/coach/goals', data),

    // Messages
    getConversations: ()               => request('GET',  '/coach/messages'),
    getMessages:      (clientId)       => request('GET',  `/coach/messages/${clientId}`),
    sendMessage:      (clientId, data) => request('POST', `/coach/messages/${clientId}`, data),

    // Bilans
    generateReview: (clientId) => request('POST',  `/coach/reviews/generate/${clientId}`),
    sendReview:     (id, data) => request('PATCH', `/coach/reviews/${id}`, data),

    // Annuaire
    getPublicCoaches: (params)         => request('GET',  `/coach/public${params || ''}`),
    rateCoach:        (coachId, data)  => request('POST', `/coach/public/${coachId}/rate`, data),

    // ── TODO Phase B : endpoints /api/client/coach/* pas encore implémentés
    // getMyCoach, getMyPlan, getMyProgramme, getMyGoals, getMyMessages,
    // sendMessageToCoach — livrés avec feat/coach-client
  },
};

// ── Page navigation avec fade-out ────────────────────────────
function navigate(url) {
  document.body.style.transition = 'opacity 0.15s ease';
  document.body.style.opacity = '0';
  setTimeout(() => { window.location.href = url; }, 150);
}

// ── Auth guard ────────────────────────────────────────────────
function requireAuth() {
  const token = getToken();
  if (!token) {
    navigate('/pages/login.html');
    return false;
  }
  return true;
}

function getUser() {
  return JSON.parse(localStorage.getItem('kcal_user') || 'null');
}

function setUser(user) {
  localStorage.setItem('kcal_user', JSON.stringify(user));
}

// ── Toast ─────────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = msg;
  container.appendChild(el);

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .3s';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ── Date helpers ──────────────────────────────────────────────
function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function getMondayOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff)).toISOString().split('T')[0];
}

// ── Loading state helper ──────────────────────────────────────
function setLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn._origText = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span>';
    btn.disabled = true;
  } else {
    btn.innerHTML = btn._origText || btn.innerHTML;
    btn.disabled = false;
  }
}
