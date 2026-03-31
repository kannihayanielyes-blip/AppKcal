/* ══════════════════════════════════════
   DASHBOARD LOGIC
══════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {
  if (!requireAuth()) return;

  await Promise.all([loadProfile(), loadTodayData(), loadStreak(), loadWeightSection()]);
  loadSmartSuggestions();
  initAddFoodSheet();
  initWeightModal();
});

// ── Profile header ────────────────────────────────────────────
async function loadProfile() {
  // Afficher d'abord le localStorage pour éviter le flash vide
  const cachedUser = getUser();
  if (cachedUser?.username) {
    document.getElementById('user-name').textContent = cachedUser.username;
    document.getElementById('greeting').textContent = getGreeting();
  }

  try {
    const profile = await API.user.profile();
    console.log('[dashboard] profil chargé:', profile);

    document.getElementById('greeting').textContent  = getGreeting();
    document.getElementById('user-name').textContent = profile.username || cachedUser?.username || 'Toi';

    const avatar = document.getElementById('user-avatar');
    if (avatar) {
      if (profile.avatar_url) {
        avatar.innerHTML = `<img src="${profile.avatar_url}" alt="avatar">`;
      } else {
        avatar.textContent = (profile.username || cachedUser?.username || '?')[0].toUpperCase();
      }
    }

    // Stocker l'objectif kcal du profil
    window._dailyKcal = profile.daily_kcal_target || 2000;

    // Stocker les objectifs macros (mode avancé uniquement)
    const hasCustomMacros = profile.protein_target_g || profile.carbs_target_g || profile.fat_target_g;
    window._macroTargets = (profile.mode === 'advanced' && hasCustomMacros)
      ? {
          protein: profile.protein_target_g || null,
          carbs:   profile.carbs_target_g   || null,
          fat:     profile.fat_target_g     || null
        }
      : null;
    updateMacroBadges();

    // Mettre à jour le cache localStorage avec le vrai username Supabase
    if (cachedUser && profile.username) {
      cachedUser.username = profile.username;
      setUser(cachedUser);
    }
  } catch (err) {
    console.error('[loadProfile] erreur:', err);
    // Utiliser les données en cache si l'API échoue
    window._dailyKcal = 2000;
    window._macroTargets = null;
  }
}

// ── Accent dynamique selon progression ────────────────────────
function getAccentColor(percent) {
  if (percent >= 100) return '#22C55E'; // --accent-success
  if (percent >= 70)  return '#F59E0B'; // --accent-warning
  return '#EF4444';                     // --accent-danger
}

// ── Today's nutrition ─────────────────────────────────────────
async function loadTodayData() {
  try {
    const { logs, totals } = await API.nutrition.today();

    // Kcal hero
    const target = window._dailyKcal || 2000;
    document.getElementById('kcal-consumed').textContent = Math.round(totals.kcal);
    document.getElementById('kcal-target').textContent   = target;
    const pct = Math.min(100, (totals.kcal / target) * 100);
    const bar = document.getElementById('kcal-bar');
    bar.style.width = pct + '%';
    bar.style.backgroundColor = getAccentColor(pct);

    // Macros (valeurs consommées brutes — updateMacroBadges gère l'affichage cible)
    document.getElementById('macro-protein').textContent = Math.round(totals.protein);
    document.getElementById('macro-carbs').textContent   = Math.round(totals.carbs);
    document.getElementById('macro-fat').textContent     = Math.round(totals.fat);

    // Stocker pour les suggestions et les barres macros
    window._consumedKcal = totals.kcal || 0;
    window._macroTotals  = totals;
    updateMacroBadges();

    // Food list
    renderFoodList(logs);
  } catch (err) {
    console.error('[loadTodayData]', err);
  }
}

// ── Macro badges (objectifs avancés) ─────────────────────────
function updateMacroBadges() {
  const totals  = window._macroTotals;
  const targets = window._macroTargets;

  const configs = [
    { key: 'protein', label: 'Protéines' },
    { key: 'carbs',   label: 'Glucides'  },
    { key: 'fat',     label: 'Lipides'   },
  ];

  configs.forEach(({ key }) => {
    const consumed  = totals ? (totals[key] || 0) : null;
    const target    = targets ? targets[key] : null;
    const targetEl  = document.getElementById(`macro-${key}-target`);
    const barEl     = document.getElementById(`macro-${key}-bar`);
    const barWrap   = document.getElementById(`macro-${key}-bar-wrap`);

    if (target && consumed !== null) {
      const pct = Math.min(100, (consumed / target) * 100);
      if (targetEl)  { targetEl.textContent = '/ ' + Math.round(target) + 'g'; targetEl.style.display = ''; }
      if (barEl)       barEl.style.width = pct + '%';
      if (barWrap)     barWrap.style.display = '';
    } else {
      if (targetEl)  { targetEl.textContent = ''; targetEl.style.display = 'none'; }
      if (barWrap)     barWrap.style.display = 'none';
    }
  });
}

function renderFoodList(logs) {
  const list = document.getElementById('food-list');
  if (!list) return;

  if (!logs || logs.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="icon">🥗</div>
        <h3>Rien encore</h3>
        <p>Ajoute ton premier repas !</p>
      </div>`;
    return;
  }

  const mealIcons = { breakfast: '🌅', lunch: '☀️', dinner: '🌙', snack: '🍎' };

  list.innerHTML = logs.map(log => `
    <div class="food-item" data-id="${log.id}">
      <div class="food-item__icon">${mealIcons[log.meal_type] || '🍽️'}</div>
      <div class="food-item__body">
        <div class="food-item__name">${escHtml(log.name)}</div>
        <div class="food-item__meta">${log.protein_g}g prot · ${log.carbs_g}g glucides · ${log.fat_g}g lip</div>
      </div>
      <div class="food-item__kcal">${log.kcal} kcal</div>
      <button class="food-item__delete" onclick="deleteLog('${log.id}')" aria-label="Supprimer">✕</button>
    </div>
  `).join('');
}

async function deleteLog(id) {
  if (!confirm('Supprimer cette entrée ?')) return;
  try {
    await API.nutrition.deleteLog(id);
    toast('Supprimé', 'success');
    await loadTodayData();
    loadSmartSuggestions();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Smart suggestions ─────────────────────────────────────────

// Suggestions de secours si aucune recette en base
const FALLBACK_RECIPES = [
  { id: 'fb1', nom: 'Yaourt grec + fruits rouges', calories_total: 150, proteines_total: 10, glucides_total: 18, lipides_total: 2,  categorie: 'snack' },
  { id: 'fb2', nom: 'Poulet grillé + riz basmati', calories_total: 460, proteines_total: 42, glucides_total: 52, lipides_total: 8,  categorie: 'meal'  },
  { id: 'fb3', nom: 'Salade thon avocat',           calories_total: 310, proteines_total: 26, glucides_total: 10, lipides_total: 18, categorie: 'meal'  },
  { id: 'fb4', nom: 'Shaker protéiné',              calories_total: 210, proteines_total: 32, glucides_total: 10, lipides_total: 3,  categorie: 'snack' },
  { id: 'fb5', nom: 'Omelette 3 œufs + légumes',   calories_total: 290, proteines_total: 22, glucides_total: 6,  lipides_total: 19, categorie: 'meal'  },
  { id: 'fb6', nom: 'Banane + amandes',             calories_total: 185, proteines_total: 5,  glucides_total: 28, lipides_total: 7,  categorie: 'snack' },
  { id: 'fb7', nom: 'Bowl quinoa légumes',          calories_total: 380, proteines_total: 15, glucides_total: 55, lipides_total: 10, categorie: 'meal'  },
  { id: 'fb8', nom: 'Cottage cheese + noix',        calories_total: 200, proteines_total: 18, glucides_total: 5,  lipides_total: 12, categorie: 'snack' },
];

// Stockage des recettes pour les boutons onclick
window._smartRecipes = {};

async function loadSmartSuggestions() {
  const section = document.getElementById('smart-suggestions-section');
  const banner  = document.getElementById('smart-banner');
  const cardsEl = document.getElementById('smart-cards');

  const target    = window._dailyKcal    || 2000;
  const consumed  = window._consumedKcal || 0;
  const remaining = Math.round(target - consumed);

  // Objectif atteint ou dépassé
  if (remaining <= 0) {
    section.style.display = '';
    banner.innerHTML = '';
    cardsEl.innerHTML = `
      <div class="smart-goal-reached">
        🎉 Objectif atteint !<br>
        <span style="font-size:.88rem;font-weight:500">Tu as mangé ${Math.round(consumed)} kcal aujourd'hui</span>
      </div>`;
    return;
  }

  // Déterminer le nombre de suggestions selon les kcal restantes
  let count;
  if      (remaining > 800) count = 4;
  else if (remaining > 400) count = 3;
  else if (remaining > 200) count = 2;
  else                      count = 1;

  // Charger les recettes depuis l'API
  let recipes = [];
  try {
    const data = await API.nutrition.recipes('all');
    recipes = Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn('[loadSmartSuggestions] API recipes error:', err.message);
  }
  // Fallback si aucune recette en base
  if (!recipes.length) recipes = FALLBACK_RECIPES;

  // Algorithme de sélection : cible = remaining / count kcal par recette
  const targetPerRecipe = remaining / count;
  const selected = selectBestRecipes(recipes, count, targetPerRecipe);

  // Stocker pour les boutons
  window._smartRecipes = {};
  selected.forEach(r => { window._smartRecipes[String(r.id)] = r; });

  // Afficher
  section.style.display = '';
  banner.textContent = `Il te reste ~${remaining} kcal · ${count} idée${count > 1 ? 's' : ''} pour toi :`;
  cardsEl.innerHTML = selected.map(r => renderSuggestionCard(r)).join('');
}

// Sélectionne `count` recettes les plus proches de `targetKcal` chacune, sans doublons
function selectBestRecipes(recipes, count, targetKcal) {
  const sorted = [...recipes].sort(
    (a, b) => Math.abs(a.calories_total - targetKcal) - Math.abs(b.calories_total - targetKcal)
  );
  return sorted.slice(0, count);
}

function renderSuggestionCard(r) {
  const photoHtml = r.photo_url
    ? `<img src="${escHtml(r.photo_url)}" alt="${escHtml(r.nom)}">`
    : getCategoryEmoji(r.categorie);

  const mealType = r.categorie === 'breakfast' ? 'breakfast'
                 : r.categorie === 'meal'      ? 'lunch'
                 : 'snack';

  return `
    <div class="smart-card">
      <div class="smart-card__photo">${photoHtml}</div>
      <div class="smart-card__info">
        <div class="smart-card__name">${escHtml(r.nom)}</div>
        <div class="smart-card__kcal">${r.calories_total} kcal</div>
        <div class="smart-card__macros">P ${r.proteines_total ?? 0}g · G ${r.glucides_total ?? 0}g · L ${r.lipides_total ?? 0}g</div>
      </div>
      <button class="smart-card__add" onclick="addSuggestion('${String(r.id)}','${mealType}')">+ Ajouter</button>
    </div>`;
}

function getCategoryEmoji(cat) {
  const map = { breakfast: '🌅', meal: '🍽️', snack: '🍎', dessert: '🍮', shaker: '🥤' };
  return map[cat] || '🍽️';
}

async function addSuggestion(id, mealType) {
  const r = window._smartRecipes[id];
  if (!r) return;

  // Trouver le bouton cliqué et le passer en loading
  const btn = document.querySelector(`[onclick="addSuggestion('${id}','${mealType}')"]`);
  if (btn) { btn.disabled = true; btn.textContent = '…'; }

  try {
    await API.nutrition.addLog({
      name:      r.nom,
      kcal:      r.calories_total,
      protein_g: r.proteines_total ?? 0,
      carbs_g:   r.glucides_total  ?? 0,
      fat_g:     r.lipides_total   ?? 0,
      meal_type: mealType
    });
    toast(`${r.nom} ajouté !`, 'success');
    await loadTodayData();
    loadSmartSuggestions();
  } catch (err) {
    toast(err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '+ Ajouter'; }
  }
}

// ── Streak ────────────────────────────────────────────────────
async function loadStreak() {
  try {
    const { streak } = await API.user.streak();
    const el = document.getElementById('streak-count');
    if (el) el.textContent = streak;
  } catch {}
}

// ── Add Food Sheet ────────────────────────────────────────────
function initAddFoodSheet() {
  const overlay = document.getElementById('add-food-overlay');
  const fab     = document.getElementById('fab');
  const closeBtn = document.getElementById('close-sheet');
  const form    = document.getElementById('add-food-form');
  const photoBtn = document.getElementById('photo-btn');
  const photoInput = document.getElementById('photo-input');

  fab?.addEventListener('click', () => {
    overlay?.classList.add('open');
    document.getElementById('food-name')?.focus();
  });

  closeBtn?.addEventListener('click', () => overlay?.classList.remove('open'));
  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('open');
  });

  // Meal type selection
  document.querySelectorAll('.meal-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.meal-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Photo analysis
  photoBtn?.addEventListener('click', () => photoInput?.click());
  photoInput?.addEventListener('change', async () => {
    const file = photoInput.files[0];
    if (!file) return;

    setLoading(photoBtn, true);
    toast('Analyse en cours...', 'info');

    const formData = new FormData();
    formData.append('photo', file);

    try {
      const result = await API.photo.analyze(formData);
      document.getElementById('food-name').value   = result.name || '';
      document.getElementById('food-kcal').value   = result.kcal || '';
      document.getElementById('food-protein').value = result.protein_g || '';
      document.getElementById('food-carbs').value  = result.carbs_g || '';
      document.getElementById('food-fat').value    = result.fat_g || '';
      toast(`Détecté: ${result.name} (${result.confidence})`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(photoBtn, false);
    }
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('[type="submit"]');
    const mealType = document.querySelector('.meal-type-btn.active')?.dataset.meal || 'snack';

    const body = {
      name:      document.getElementById('food-name').value.trim(),
      kcal:      document.getElementById('food-kcal').value,
      protein_g: document.getElementById('food-protein').value || 0,
      carbs_g:   document.getElementById('food-carbs').value || 0,
      fat_g:     document.getElementById('food-fat').value || 0,
      meal_type: mealType
    };

    if (!body.name || !body.kcal) { toast('Nom et kcal requis', 'error'); return; }

    setLoading(submitBtn, true);
    try {
      await API.nutrition.addLog(body);
      toast('Repas ajouté !', 'success');
      overlay?.classList.remove('open');
      form.reset();
      await loadTodayData();
      loadSmartSuggestions();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(submitBtn, false);
    }
  });
}

// ── Suivi du poids ────────────────────────────────────────────
let _weightChart = null;
let _weightHistory = [];

async function loadWeightSection() {
  try {
    const [profile, history] = await Promise.all([
      API.user.profile(),
      API.user.weightHistory(28)
    ]);

    _weightHistory = history || [];

    // ── 3 stats ───────────────────────────────────────────────
    // Poids actuel : dernière pesée enregistrée ou valeur profil
    const lastEntry = _weightHistory.at(-1);
    const currentWeight = lastEntry?.weight_kg ?? profile?.weight_kg ?? null;
    document.getElementById('w-current').textContent = currentWeight ? currentWeight + ' kg' : '—';

    // Objectif poids (non stocké en DB pour l'instant → on affiche l'IMC cible si connu)
    document.getElementById('w-goal').textContent = profile?.weight_goal_kg
      ? profile.weight_goal_kg + ' kg'
      : '—';

    // Prochaine pesée : 7 jours après la dernière
    if (lastEntry?.date) {
      const lastDate   = new Date(lastEntry.date);
      const nextDate   = new Date(lastDate);
      nextDate.setDate(nextDate.getDate() + 7);
      const today      = new Date();
      today.setHours(0, 0, 0, 0);
      nextDate.setHours(0, 0, 0, 0);
      const diffDays   = Math.round((nextDate - today) / 86400000);

      let label;
      if (diffDays < 0)       label = 'Maintenant';
      else if (diffDays === 0) label = "Aujourd'hui";
      else if (diffDays === 1) label = 'Demain';
      else                     label = `Dans ${diffDays}j`;

      document.getElementById('w-next').textContent = label;
    } else {
      document.getElementById('w-next').textContent = 'Maintenant';
    }

    // ── Chart vs empty state ──────────────────────────────────
    if (_weightHistory.length === 0) {
      document.getElementById('weight-empty').style.display  = '';
      document.getElementById('weight-chart').style.display  = 'none';
    } else {
      document.getElementById('weight-empty').style.display  = 'none';
      document.getElementById('weight-chart').style.display  = 'block';
      renderWeightChart(_weightHistory);
    }
  } catch (err) {
    console.error('[loadWeightSection]', err);
  }
}

function renderWeightChart(data) {
  const canvas = document.getElementById('weight-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // Gradient fill
  const gradient = ctx.createLinearGradient(0, 0, 0, 180);
  gradient.addColorStop(0, 'rgba(13,13,13,.12)');
  gradient.addColorStop(1, 'rgba(13,13,13,.0)');

  const labels = data.map(d => {
    const dt = new Date(d.date);
    return dt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  });
  const values = data.map(d => Number(d.weight_kg));

  // Détruire le graphe précédent si on re-render
  if (_weightChart) { _weightChart.destroy(); _weightChart = null; }

  _weightChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: '#0D0D0D',
        borderWidth: 1.5,
        backgroundColor: gradient,
        pointBackgroundColor: '#0D0D0D',
        pointRadius: data.length === 1 ? 4 : 2,
        pointHoverRadius: 5,
        fill: true,
        tension: 0.35
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.parsed.y} kg`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 10, family: 'DM Mono' }, maxTicksLimit: 6, color: '#9B9B9B' }
        },
        y: {
          grid: { color: '#F0F0EE' },
          ticks: { font: { size: 10, family: 'DM Mono' }, color: '#9B9B9B', callback: v => v + ' kg' },
          // zoom autour des valeurs réelles
          suggestedMin: Math.min(...values) - 1,
          suggestedMax: Math.max(...values) + 1
        }
      }
    }
  });
}

// ── Weight Modal ──────────────────────────────────────────────
function initWeightModal() {
  const saveBtn = document.getElementById('weight-save-btn');
  saveBtn?.addEventListener('click', saveWeight);

  document.getElementById('weight-input-modal')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveWeight();
  });
}

function openWeightModal() {
  const modal = document.getElementById('weight-modal');
  const input = document.getElementById('weight-input-modal');

  // Pré-remplir avec le dernier poids connu
  const lastWeight = _weightHistory.at(-1)?.weight_kg;
  if (lastWeight) input.value = lastWeight;

  // Date du jour
  const today = new Date().toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' });
  document.getElementById('weight-modal-date').textContent = today;

  modal?.classList.add('open');
  setTimeout(() => { input?.focus(); input?.select(); }, 150);
}

function closeWeightModal() {
  document.getElementById('weight-modal')?.classList.remove('open');
}

function handleWeightOverlayClick(e) {
  if (e.target === document.getElementById('weight-modal')) closeWeightModal();
}

async function saveWeight() {
  const input  = document.getElementById('weight-input-modal');
  const saveBtn = document.getElementById('weight-save-btn');
  const weight = parseFloat(input.value);

  if (!weight || weight < 20 || weight > 400) {
    toast('Poids invalide', 'error');
    return;
  }

  setLoading(saveBtn, true);
  try {
    await API.user.logWeight({ weight_kg: weight });
    toast(`${weight} kg enregistré ✅`, 'success');
    closeWeightModal();
    // Rafraîchir la section poids
    await loadWeightSection();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setLoading(saveBtn, false);
  }
}

// ── Helpers ───────────────────────────────────────────────────
function getGreeting() {
  const h = new Date().getHours();
  if (h < 6)  return 'Bonne nuit 🌙';
  if (h < 12) return 'Bonjour ☀️';
  if (h < 18) return 'Bonne après-midi 🌤️';
  return 'Bonsoir 🌆';
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
