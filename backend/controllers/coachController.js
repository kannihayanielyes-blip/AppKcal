const OpenAI = require('openai');
const { supabaseAdmin } = require('../../config/supabase');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Resolve the coach_profiles row for the authenticated user.
 * Returns { id, max_clients } or null if the user has no coach profile.
 */
async function getCoachForUser(userId) {
  const { data, error } = await supabaseAdmin
    .from('coach_profiles')
    .select('id, max_clients')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

/**
 * Verify that a given client_id is one of this coach's clients (any status
 * except 'inactive'). Returns the coach_clients row or null.
 */
async function verifyCoachOwnsClient(coachId, clientId) {
  const { data } = await supabaseAdmin
    .from('coach_clients')
    .select('id, status, coach_type')
    .eq('coach_id', coachId)
    .eq('client_id', clientId)
    .neq('status', 'inactive')
    .maybeSingle();
  return data || null;
}

/** Monday 00:00 of the week containing `d` (treats Sunday as end of week). */
function mondayOf(d) {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  const dow = dt.getDay() || 7; // Sun = 7
  dt.setDate(dt.getDate() - (dow - 1));
  return dt;
}

/** YYYY-MM-DD for a Date (UTC). */
function ymd(d) {
  return new Date(d).toISOString().slice(0, 10);
}

// ══════════════════════════════════════════════════════════════════════
// PROFIL COACH
// ══════════════════════════════════════════════════════════════════════

async function getCoachProfile(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('coach_profiles')
      .select('*')
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Profil coach non trouvé' });
    res.json(data);
  } catch (err) {
    console.error('[coach.getCoachProfile]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

async function createCoachProfile(req, res) {
  try {
    const { nom, prenom, bio, specialites } = req.body;
    if (!nom || typeof nom !== 'string') {
      return res.status(400).json({ error: 'Le nom est requis' });
    }

    const { data: existing } = await supabaseAdmin
      .from('coach_profiles')
      .select('id')
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (existing) {
      return res.status(409).json({ error: 'Profil coach déjà existant' });
    }

    const trialEnds = new Date();
    trialEnds.setDate(trialEnds.getDate() + 7);

    const { data, error } = await supabaseAdmin
      .from('coach_profiles')
      .insert({
        user_id: req.user.id,
        nom,
        prenom: prenom ?? null,
        bio: bio ?? null,
        specialites: Array.isArray(specialites) ? specialites : [],
        plan_type: 'starter',
        max_clients: 5,
        trial_ends_at: trialEnds.toISOString(),
      })
      .select()
      .single();
    if (error) throw error;

    await supabaseAdmin
      .from('profiles')
      .update({ is_coach: true })
      .eq('id', req.user.id);

    res.status(201).json(data);
  } catch (err) {
    console.error('[coach.createCoachProfile]', err);
    res.status(500).json({ error: 'Erreur création profil coach' });
  }
}

async function updateCoachProfile(req, res) {
  try {
    const allowed = ['nom', 'prenom', 'bio', 'specialites', 'is_visible_annuaire'];
    const update = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) update[k] = req.body[k];
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    }

    const { data, error } = await supabaseAdmin
      .from('coach_profiles')
      .update(update)
      .eq('user_id', req.user.id)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Profil coach non trouvé' });
    res.json(data);
  } catch (err) {
    console.error('[coach.updateCoachProfile]', err);
    res.status(500).json({ error: 'Erreur mise à jour profil' });
  }
}

// ══════════════════════════════════════════════════════════════════════
// CLIENTS
// ══════════════════════════════════════════════════════════════════════

async function getClients(req, res) {
  try {
    const coach = await getCoachForUser(req.user.id);
    if (!coach) return res.status(404).json({ error: 'Profil coach non trouvé' });

    const { data: ccs, error } = await supabaseAdmin
      .from('coach_clients')
      .select('*')
      .eq('coach_id', coach.id)
      .neq('status', 'inactive');
    if (error) throw error;
    if (!ccs || ccs.length === 0) return res.json([]);

    const clientIds = ccs.map(c => c.client_id);
    const { data: profs } = await supabaseAdmin
      .from('profiles')
      .select('id, username, avatar_url, goal, daily_kcal_target')
      .in('id', clientIds);
    const profMap = Object.fromEntries((profs || []).map(p => [p.id, p]));

    const today = ymd(new Date());
    const yesterday = ymd(new Date(Date.now() - 86400000));

    const enriched = await Promise.all(ccs.map(async (cc) => {
      const { data: lastLog } = await supabaseAdmin
        .from('nutrition_logs')
        .select('date')
        .eq('user_id', cc.client_id)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle();

      let color_status = 'red';
      if (lastLog?.date === today) color_status = 'green';
      else if (lastLog?.date === yesterday) color_status = 'orange';

      return {
        ...cc,
        profile: profMap[cc.client_id] || null,
        color_status,
      };
    }));

    res.json(enriched);
  } catch (err) {
    console.error('[coach.getClients]', err);
    res.status(500).json({ error: 'Erreur récupération clients' });
  }
}

async function inviteClient(req, res) {
  try {
    const { client_email, coach_type } = req.body;
    if (!client_email || !coach_type) {
      return res.status(400).json({ error: 'client_email et coach_type requis' });
    }
    if (!['nutrition', 'sport', 'both'].includes(coach_type)) {
      return res.status(400).json({ error: 'coach_type invalide' });
    }

    const coach = await getCoachForUser(req.user.id);
    if (!coach) return res.status(404).json({ error: 'Profil coach non trouvé' });

    // Quota check (active + pending count toward the limit)
    const { count: activeCount } = await supabaseAdmin
      .from('coach_clients')
      .select('*', { count: 'exact', head: true })
      .eq('coach_id', coach.id)
      .in('status', ['active', 'pending']);
    if ((activeCount ?? 0) >= (coach.max_clients ?? 5)) {
      return res.status(403).json({ error: 'Limite max_clients atteinte' });
    }

    // Lookup client by email — handle 0 / 1 / >1 matches
    const { data: matches, error: matchErr } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', client_email);
    if (matchErr) throw matchErr;

    if (!matches || matches.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    if (matches.length > 1) {
      return res.status(400).json({
        error: 'Plusieurs utilisateurs avec cet email — invitation impossible',
      });
    }
    const clientId = matches[0].id;

    if (clientId === req.user.id) {
      return res.status(400).json({ error: 'Tu ne peux pas t\'inviter toi-même' });
    }

    const { data: existing } = await supabaseAdmin
      .from('coach_clients')
      .select('id, status')
      .eq('coach_id', coach.id)
      .eq('client_id', clientId)
      .maybeSingle();
    if (existing) {
      return res.status(409).json({ error: 'Ce client est déjà invité ou actif' });
    }

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('coach_clients')
      .insert({
        coach_id: coach.id,
        client_id: clientId,
        coach_type,
        status: 'pending',
      })
      .select()
      .single();
    if (insErr) throw insErr;

    res.status(201).json({
      success: true,
      client_id: clientId,
      coach_client_id: inserted.id,
    });
  } catch (err) {
    console.error('[coach.inviteClient]', err);
    res.status(500).json({ error: 'Erreur invitation client' });
  }
}

async function acceptInvitation(req, res) {
  try {
    const ccId = req.params.coachClientId;
    const { data: cc, error } = await supabaseAdmin
      .from('coach_clients')
      .select('*')
      .eq('id', ccId)
      .maybeSingle();
    if (error) throw error;
    if (!cc) return res.status(404).json({ error: 'Invitation introuvable' });
    if (cc.client_id !== req.user.id) {
      return res.status(403).json({ error: 'Pas autorisé' });
    }
    if (cc.status !== 'pending') {
      return res.status(400).json({ error: `Invitation déjà ${cc.status}` });
    }

    const { error: updErr } = await supabaseAdmin
      .from('coach_clients')
      .update({ status: 'active', accepted_at: new Date().toISOString() })
      .eq('id', ccId);
    if (updErr) throw updErr;

    res.json({ success: true });
  } catch (err) {
    console.error('[coach.acceptInvitation]', err);
    res.status(500).json({ error: 'Erreur acceptation' });
  }
}

async function getClientDetail(req, res) {
  try {
    const clientId = req.params.id;
    const coach = await getCoachForUser(req.user.id);
    if (!coach) return res.status(404).json({ error: 'Profil coach non trouvé' });

    const cc = await verifyCoachOwnsClient(coach.id, clientId);
    if (!cc) return res.status(403).json({ error: 'Ce client ne fait pas partie de tes clients' });

    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 6); // inclusive 7-day window
    const startStr = ymd(sevenDaysAgo);
    const todayStr = ymd(today);
    const weekStart = ymd(mondayOf(today));

    const [
      { data: profile },
      { data: logs },
      { data: sportHistory },
      { data: activePlan },
      { data: activeAssign },
      { data: weeklyGoals },
    ] = await Promise.all([
      supabaseAdmin.from('profiles').select('*').eq('id', clientId).maybeSingle(),
      supabaseAdmin.from('nutrition_logs')
        .select('date, kcal, protein_g, carbs_g, fat_g, name, meal_type')
        .eq('user_id', clientId).gte('date', startStr).lte('date', todayStr),
      supabaseAdmin.from('historique_seances')
        .select('*')
        .eq('user_id', clientId).gte('date', startStr).lte('date', todayStr),
      supabaseAdmin.from('coach_nutrition_plans')
        .select('*')
        .eq('client_id', clientId).eq('coach_id', coach.id).eq('is_active', true)
        .maybeSingle(),
      supabaseAdmin.from('coach_programme_assignments')
        .select('*')
        .eq('client_id', clientId).eq('coach_id', coach.id).eq('is_active', true)
        .maybeSingle(),
      supabaseAdmin.from('coach_weekly_goals')
        .select('*')
        .eq('coach_id', coach.id).eq('client_id', clientId).eq('week_start', weekStart)
        .maybeSingle(),
    ]);

    // Daily totals
    const dailyTotals = {};
    for (const l of (logs || [])) {
      if (!dailyTotals[l.date]) {
        dailyTotals[l.date] = { date: l.date, kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
      }
      dailyTotals[l.date].kcal += Number(l.kcal) || 0;
      dailyTotals[l.date].protein_g += Number(l.protein_g) || 0;
      dailyTotals[l.date].carbs_g += Number(l.carbs_g) || 0;
      dailyTotals[l.date].fat_g += Number(l.fat_g) || 0;
    }
    const nutritionByDay = Object.values(dailyTotals).sort((a, b) => a.date.localeCompare(b.date));

    // Adherence nutrition: % of last 7 days within ±10% of target
    const target = activePlan?.daily_kcal_target ?? profile?.daily_kcal_target ?? 2000;
    const lower = target * 0.9, upper = target * 1.1;
    const inGoal = nutritionByDay.filter(d => d.kcal >= lower && d.kcal <= upper).length;
    const nutrition_pct = Math.round((inGoal / 7) * 100);

    // Adherence sport: count(historique_seances) / count(seances_user) for assigned programme
    let sport_pct = null;
    if (activeAssign?.programme_id) {
      const { count: planned } = await supabaseAdmin
        .from('seances_user')
        .select('*', { count: 'exact', head: true })
        .eq('programme_id', activeAssign.programme_id);
      const done = (sportHistory || []).length;
      sport_pct = (planned ?? 0) > 0 ? Math.round((done / planned) * 100) : null;
    }

    res.json({
      profile: profile || null,
      coach_client: cc,
      nutrition: { logs: logs || [], by_day: nutritionByDay },
      sport: { history: sportHistory || [] },
      active_plan: activePlan || null,
      active_programme_assignment: activeAssign || null,
      weekly_goals: weeklyGoals || null,
      adherence: { nutrition_pct, sport_pct },
      target_kcal_used: target,
    });
  } catch (err) {
    console.error('[coach.getClientDetail]', err);
    res.status(500).json({ error: 'Erreur récupération détail client' });
  }
}

async function updateClient(req, res) {
  try {
    const clientId = req.params.id;
    const coach = await getCoachForUser(req.user.id);
    if (!coach) return res.status(404).json({ error: 'Profil coach non trouvé' });

    const allowed = ['status', 'pause_until', 'notes_internes', 'bilan_initial'];
    const update = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) update[k] = req.body[k];
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    }
    if (update.status && !['pending', 'active', 'paused', 'inactive'].includes(update.status)) {
      return res.status(400).json({ error: 'status invalide' });
    }

    const { data, error } = await supabaseAdmin
      .from('coach_clients')
      .update(update)
      .eq('coach_id', coach.id)
      .eq('client_id', clientId)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Client non trouvé' });
    res.json(data);
  } catch (err) {
    console.error('[coach.updateClient]', err);
    res.status(500).json({ error: 'Erreur mise à jour client' });
  }
}

// ══════════════════════════════════════════════════════════════════════
// PLANS NUTRITION
// ══════════════════════════════════════════════════════════════════════

async function getClientPlan(req, res) {
  try {
    const clientId = req.params.clientId;
    const coach = await getCoachForUser(req.user.id);
    if (!coach) return res.status(404).json({ error: 'Profil coach non trouvé' });

    const cc = await verifyCoachOwnsClient(coach.id, clientId);
    if (!cc) return res.status(403).json({ error: 'Pas autorisé' });

    const { data, error } = await supabaseAdmin
      .from('coach_nutrition_plans')
      .select('*')
      .eq('client_id', clientId)
      .eq('coach_id', coach.id)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    res.json(data || null);
  } catch (err) {
    console.error('[coach.getClientPlan]', err);
    res.status(500).json({ error: 'Erreur récupération plan' });
  }
}

async function createPlan(req, res) {
  try {
    const {
      client_id, nom, daily_kcal_target,
      proteines_target_g, glucides_target_g, lipides_target_g,
      kcal_sport_day, kcal_rest_day, notes, recettes_assignees,
    } = req.body;

    if (!client_id || !nom || daily_kcal_target == null) {
      return res.status(400).json({ error: 'client_id, nom et daily_kcal_target requis' });
    }

    const coach = await getCoachForUser(req.user.id);
    if (!coach) return res.status(404).json({ error: 'Profil coach non trouvé' });

    const cc = await verifyCoachOwnsClient(coach.id, client_id);
    if (!cc) return res.status(403).json({ error: 'Ce client ne fait pas partie de tes clients' });

    // Deactivate previous active plan
    await supabaseAdmin
      .from('coach_nutrition_plans')
      .update({ is_active: false })
      .eq('client_id', client_id)
      .eq('coach_id', coach.id)
      .eq('is_active', true);

    const { data, error } = await supabaseAdmin
      .from('coach_nutrition_plans')
      .insert({
        coach_id: coach.id,
        client_id,
        nom,
        daily_kcal_target,
        proteines_target_g: proteines_target_g ?? 0,
        glucides_target_g: glucides_target_g ?? 0,
        lipides_target_g: lipides_target_g ?? 0,
        kcal_sport_day: kcal_sport_day ?? null,
        kcal_rest_day: kcal_rest_day ?? null,
        notes: notes ?? null,
        recettes_assignees: Array.isArray(recettes_assignees) ? recettes_assignees : [],
        is_active: true,
      })
      .select()
      .single();
    if (error) throw error;

    res.status(201).json(data);
  } catch (err) {
    console.error('[coach.createPlan]', err);
    res.status(500).json({ error: 'Erreur création plan' });
  }
}

// ══════════════════════════════════════════════════════════════════════
// PROGRAMMES SPORT
// ══════════════════════════════════════════════════════════════════════

async function assignProgramme(req, res) {
  try {
    const { client_id, programme_id, notes } = req.body;
    if (!client_id || !programme_id) {
      return res.status(400).json({ error: 'client_id et programme_id requis' });
    }

    const coach = await getCoachForUser(req.user.id);
    if (!coach) return res.status(404).json({ error: 'Profil coach non trouvé' });

    const cc = await verifyCoachOwnsClient(coach.id, client_id);
    if (!cc) return res.status(403).json({ error: 'Ce client ne fait pas partie de tes clients' });

    // Verify programme exists AND belongs to this client
    const { data: prog } = await supabaseAdmin
      .from('programmes_user')
      .select('id, user_id')
      .eq('id', programme_id)
      .maybeSingle();
    if (!prog) return res.status(404).json({ error: 'Programme introuvable' });
    if (prog.user_id !== client_id) {
      return res.status(403).json({ error: 'Ce programme n\'appartient pas à ce client' });
    }

    // Deactivate previous assignment
    await supabaseAdmin
      .from('coach_programme_assignments')
      .update({ is_active: false })
      .eq('client_id', client_id)
      .eq('coach_id', coach.id)
      .eq('is_active', true);

    const { data, error } = await supabaseAdmin
      .from('coach_programme_assignments')
      .insert({
        coach_id: coach.id,
        client_id,
        programme_id,
        notes: notes ?? null,
        is_active: true,
      })
      .select()
      .single();
    if (error) throw error;

    res.status(201).json(data);
  } catch (err) {
    console.error('[coach.assignProgramme]', err);
    res.status(500).json({ error: 'Erreur assignation programme' });
  }
}

// ══════════════════════════════════════════════════════════════════════
// OBJECTIFS HEBDO
// ══════════════════════════════════════════════════════════════════════

async function getWeeklyGoals(req, res) {
  try {
    const clientId = req.params.clientId;
    const coach = await getCoachForUser(req.user.id);
    if (!coach) return res.status(404).json({ error: 'Profil coach non trouvé' });

    const cc = await verifyCoachOwnsClient(coach.id, clientId);
    if (!cc) return res.status(403).json({ error: 'Pas autorisé' });

    const weekStart = ymd(mondayOf(new Date()));
    const { data, error } = await supabaseAdmin
      .from('coach_weekly_goals')
      .select('*')
      .eq('coach_id', coach.id)
      .eq('client_id', clientId)
      .eq('week_start', weekStart)
      .maybeSingle();
    if (error) throw error;
    res.json(data || null);
  } catch (err) {
    console.error('[coach.getWeeklyGoals]', err);
    res.status(500).json({ error: 'Erreur récupération objectifs' });
  }
}

async function createWeeklyGoals(req, res) {
  try {
    const { client_id, goals } = req.body;
    if (!client_id || !Array.isArray(goals)) {
      return res.status(400).json({ error: 'client_id et goals (array) requis' });
    }

    const coach = await getCoachForUser(req.user.id);
    if (!coach) return res.status(404).json({ error: 'Profil coach non trouvé' });

    const cc = await verifyCoachOwnsClient(coach.id, client_id);
    if (!cc) return res.status(403).json({ error: 'Ce client ne fait pas partie de tes clients' });

    const weekStart = ymd(mondayOf(new Date()));

    // Replace any existing goals row for the same week
    const { data: existing } = await supabaseAdmin
      .from('coach_weekly_goals')
      .select('id')
      .eq('coach_id', coach.id)
      .eq('client_id', client_id)
      .eq('week_start', weekStart)
      .maybeSingle();

    let result;
    if (existing) {
      const { data, error } = await supabaseAdmin
        .from('coach_weekly_goals')
        .update({ goals, status: [] })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from('coach_weekly_goals')
        .insert({
          coach_id: coach.id,
          client_id,
          week_start: weekStart,
          goals,
          status: [],
        })
        .select()
        .single();
      if (error) throw error;
      result = data;
    }

    res.status(201).json(result);
  } catch (err) {
    console.error('[coach.createWeeklyGoals]', err);
    res.status(500).json({ error: 'Erreur création objectifs' });
  }
}

// ══════════════════════════════════════════════════════════════════════
// MESSAGES
// ══════════════════════════════════════════════════════════════════════

async function getConversations(req, res) {
  try {
    const coach = await getCoachForUser(req.user.id);
    if (!coach) return res.status(404).json({ error: 'Profil coach non trouvé' });

    const { data: ccs } = await supabaseAdmin
      .from('coach_clients')
      .select('client_id, status')
      .eq('coach_id', coach.id)
      .neq('status', 'inactive');

    if (!ccs || ccs.length === 0) return res.json([]);

    const clientIds = ccs.map(c => c.client_id);
    const { data: profs } = await supabaseAdmin
      .from('profiles')
      .select('id, username, avatar_url')
      .in('id', clientIds);
    const profMap = Object.fromEntries((profs || []).map(p => [p.id, p]));

    const conversations = await Promise.all(ccs.map(async (cc) => {
      const { data: lastMsg } = await supabaseAdmin
        .from('coach_messages')
        .select('*')
        .eq('coach_id', coach.id)
        .eq('client_id', cc.client_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const { count: unread } = await supabaseAdmin
        .from('coach_messages')
        .select('*', { count: 'exact', head: true })
        .eq('coach_id', coach.id)
        .eq('client_id', cc.client_id)
        .eq('sender_id', cc.client_id)
        .is('read_at', null);
      return {
        client_id: cc.client_id,
        profile: profMap[cc.client_id] || null,
        last_message: lastMsg || null,
        unread_count: unread ?? 0,
      };
    }));

    conversations.sort((a, b) => {
      const aT = a.last_message?.created_at || '';
      const bT = b.last_message?.created_at || '';
      return bT.localeCompare(aT);
    });

    res.json(conversations);
  } catch (err) {
    console.error('[coach.getConversations]', err);
    res.status(500).json({ error: 'Erreur récupération conversations' });
  }
}

async function getMessages(req, res) {
  try {
    const clientId = req.params.clientId;
    const coach = await getCoachForUser(req.user.id);
    if (!coach) return res.status(404).json({ error: 'Profil coach non trouvé' });

    const cc = await verifyCoachOwnsClient(coach.id, clientId);
    if (!cc) return res.status(403).json({ error: 'Pas autorisé' });

    const { data: messages, error } = await supabaseAdmin
      .from('coach_messages')
      .select('*')
      .eq('coach_id', coach.id)
      .eq('client_id', clientId)
      .order('created_at', { ascending: true });
    if (error) throw error;

    // Mark messages from the client (read by the coach now)
    await supabaseAdmin
      .from('coach_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('coach_id', coach.id)
      .eq('client_id', clientId)
      .eq('sender_id', clientId)
      .is('read_at', null);

    res.json(messages || []);
  } catch (err) {
    console.error('[coach.getMessages]', err);
    res.status(500).json({ error: 'Erreur récupération messages' });
  }
}

async function sendMessage(req, res) {
  try {
    const clientId = req.params.clientId;
    const { content, attachment_type, attachment_id } = req.body;
    if (!content && !attachment_id) {
      return res.status(400).json({ error: 'content ou attachment_id requis' });
    }
    if (attachment_type && !['recette', 'seance', 'bilan'].includes(attachment_type)) {
      return res.status(400).json({ error: 'attachment_type invalide' });
    }

    const coach = await getCoachForUser(req.user.id);
    if (!coach) return res.status(404).json({ error: 'Profil coach non trouvé' });

    const cc = await verifyCoachOwnsClient(coach.id, clientId);
    if (!cc) return res.status(403).json({ error: 'Pas autorisé' });

    const { data, error } = await supabaseAdmin
      .from('coach_messages')
      .insert({
        coach_id: coach.id,
        client_id: clientId,
        sender_id: req.user.id,
        content: content ?? null,
        attachment_type: attachment_type ?? null,
        attachment_id: attachment_id ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('[coach.sendMessage]', err);
    res.status(500).json({ error: 'Erreur envoi message' });
  }
}

// ══════════════════════════════════════════════════════════════════════
// BILAN HEBDO IA
// ══════════════════════════════════════════════════════════════════════

async function generateWeeklyReview(req, res) {
  try {
    const clientId = req.params.clientId;
    const coach = await getCoachForUser(req.user.id);
    if (!coach) return res.status(404).json({ error: 'Profil coach non trouvé' });

    const cc = await verifyCoachOwnsClient(coach.id, clientId);
    if (!cc) return res.status(403).json({ error: 'Ce client ne fait pas partie de tes clients' });

    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 6);
    const startStr = ymd(sevenDaysAgo);
    const todayStr = ymd(today);
    const weekStart = ymd(mondayOf(today));

    const [
      { data: profile },
      { data: logs },
      { data: sport },
      { data: weights },
      { data: plan },
      { data: assign },
    ] = await Promise.all([
      supabaseAdmin.from('profiles')
        .select('username, daily_kcal_target, weight_kg, goal')
        .eq('id', clientId).maybeSingle(),
      supabaseAdmin.from('nutrition_logs')
        .select('date, kcal').eq('user_id', clientId)
        .gte('date', startStr).lte('date', todayStr),
      supabaseAdmin.from('historique_seances')
        .select('seance_nom, date, duree_minutes')
        .eq('user_id', clientId).gte('date', startStr).lte('date', todayStr),
      supabaseAdmin.from('weight_logs')
        .select('date, weight_kg')
        .eq('user_id', clientId).gte('date', startStr).lte('date', todayStr)
        .order('date', { ascending: true }),
      supabaseAdmin.from('coach_nutrition_plans')
        .select('daily_kcal_target')
        .eq('client_id', clientId).eq('coach_id', coach.id).eq('is_active', true)
        .maybeSingle(),
      supabaseAdmin.from('coach_programme_assignments')
        .select('programme_id')
        .eq('client_id', clientId).eq('coach_id', coach.id).eq('is_active', true)
        .maybeSingle(),
    ]);

    // Daily kcal
    const dailyKcal = {};
    for (const l of (logs || [])) {
      dailyKcal[l.date] = (dailyKcal[l.date] || 0) + Number(l.kcal || 0);
    }

    const target = plan?.daily_kcal_target ?? profile?.daily_kcal_target ?? 2000;
    const lower = target * 0.9, upper = target * 1.1;
    const inGoal = Object.values(dailyKcal).filter(k => k >= lower && k <= upper).length;
    const adherence_pct = Math.round((inGoal / 7) * 100);

    let sport_adherence = null;
    if (assign?.programme_id) {
      const { count: planned } = await supabaseAdmin
        .from('seances_user')
        .select('*', { count: 'exact', head: true })
        .eq('programme_id', assign.programme_id);
      const done = (sport || []).length;
      sport_adherence = (planned ?? 0) > 0 ? Math.round((done / planned) * 100) : null;
    }

    let weightDelta = null;
    if (weights && weights.length >= 2) {
      weightDelta = Math.round((Number(weights[weights.length - 1].weight_kg) - Number(weights[0].weight_kg)) * 10) / 10;
    }

    const summary = {
      username: profile?.username || 'Client',
      objectif: profile?.goal || 'non défini',
      target_kcal: target,
      kcal_par_jour: dailyKcal,
      jours_dans_objectif_sur_7: inGoal,
      adherence_nutrition_pct: adherence_pct,
      seances_effectuees: (sport || []).length,
      seances_detail: (sport || []).map(s => ({ nom: s.seance_nom, date: s.date, duree_min: s.duree_minutes })),
      adherence_sport_pct: sport_adherence,
      poids_debut_kg: weights?.[0]?.weight_kg ?? null,
      poids_fin_kg: weights?.[weights.length - 1]?.weight_kg ?? null,
      poids_delta_kg: weightDelta,
    };

    const prompt = `Tu es un assistant coach sportif. Génère un bilan hebdomadaire bienveillant et motivant pour ce client en français. Données de la semaine : ${JSON.stringify(summary, null, 2)}. Max 200 mots. Commence par les points positifs, puis les axes d'amélioration, puis un objectif pour la semaine suivante.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    });
    const ia_draft = completion.choices[0]?.message?.content?.trim() || '';

    // Upsert review for the current week
    const { data: existing } = await supabaseAdmin
      .from('coach_weekly_reviews')
      .select('id, is_sent')
      .eq('coach_id', coach.id)
      .eq('client_id', clientId)
      .eq('week_start', weekStart)
      .maybeSingle();

    let review;
    if (existing) {
      // Don't overwrite a bilan déjà envoyé
      if (existing.is_sent) {
        return res.status(409).json({ error: 'Bilan déjà envoyé pour cette semaine' });
      }
      const { data, error } = await supabaseAdmin
        .from('coach_weekly_reviews')
        .update({
          ia_draft,
          adherence_pct,
          sport_adherence,
        })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      review = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from('coach_weekly_reviews')
        .insert({
          coach_id: coach.id,
          client_id: clientId,
          week_start: weekStart,
          ia_draft,
          adherence_pct,
          sport_adherence,
          is_sent: false,
        })
        .select()
        .single();
      if (error) throw error;
      review = data;
    }

    res.json(review);
  } catch (err) {
    console.error('[coach.generateWeeklyReview]', err);
    if (err.code === 'insufficient_quota') {
      return res.status(402).json({ error: 'Quota OpenAI dépassé' });
    }
    res.status(500).json({ error: 'Erreur génération bilan' });
  }
}

async function sendWeeklyReview(req, res) {
  try {
    const reviewId = req.params.id;
    const { coach_content } = req.body;
    if (!coach_content || typeof coach_content !== 'string') {
      return res.status(400).json({ error: 'coach_content requis' });
    }

    const coach = await getCoachForUser(req.user.id);
    if (!coach) return res.status(404).json({ error: 'Profil coach non trouvé' });

    const { data, error } = await supabaseAdmin
      .from('coach_weekly_reviews')
      .update({ coach_content, is_sent: true })
      .eq('id', reviewId)
      .eq('coach_id', coach.id)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Bilan introuvable' });
    res.json(data);
  } catch (err) {
    console.error('[coach.sendWeeklyReview]', err);
    res.status(500).json({ error: 'Erreur envoi bilan' });
  }
}

// ══════════════════════════════════════════════════════════════════════
// ANNUAIRE PUBLIC
// ══════════════════════════════════════════════════════════════════════

async function getPublicCoaches(req, res) {
  try {
    const { specialite, note_min } = req.query;

    // is_visible_annuaire = true AND (subscription_status IN active/trialing OR NULL)
    let query = supabaseAdmin
      .from('coach_profiles')
      .select('*')
      .eq('is_visible_annuaire', true)
      .or('subscription_status.eq.active,subscription_status.eq.trialing,subscription_status.is.null');

    if (specialite) {
      query = query.contains('specialites', [specialite]);
    }

    const { data: coaches, error } = await query;
    if (error) throw error;
    if (!coaches || coaches.length === 0) return res.json([]);

    const ids = coaches.map(c => c.id);

    // Active client counts
    const { data: clients } = await supabaseAdmin
      .from('coach_clients')
      .select('coach_id')
      .in('coach_id', ids)
      .eq('status', 'active');
    const clientCount = {};
    for (const c of (clients || [])) {
      clientCount[c.coach_id] = (clientCount[c.coach_id] || 0) + 1;
    }

    // Average ratings
    const { data: ratings } = await supabaseAdmin
      .from('coach_ratings')
      .select('coach_id, note')
      .in('coach_id', ids);
    const ratingsMap = {};
    for (const r of (ratings || [])) {
      if (!ratingsMap[r.coach_id]) ratingsMap[r.coach_id] = { sum: 0, count: 0 };
      ratingsMap[r.coach_id].sum += Number(r.note);
      ratingsMap[r.coach_id].count += 1;
    }

    let enriched = coaches.map(c => {
      const r = ratingsMap[c.id];
      return {
        ...c,
        nb_clients: clientCount[c.id] || 0,
        note_moyenne: r ? Math.round((r.sum / r.count) * 10) / 10 : null,
        nb_avis: r?.count || 0,
      };
    });

    if (note_min !== undefined) {
      const min = Number(note_min);
      if (!Number.isNaN(min)) {
        enriched = enriched.filter(c => c.note_moyenne !== null && c.note_moyenne >= min);
      }
    }

    res.json(enriched);
  } catch (err) {
    console.error('[coach.getPublicCoaches]', err);
    res.status(500).json({ error: 'Erreur récupération coaches' });
  }
}

async function rateCoach(req, res) {
  try {
    const coachId = req.params.coachId;
    const { note, commentaire } = req.body;
    const noteNum = Number(note);
    if (!Number.isInteger(noteNum) || noteNum < 1 || noteNum > 5) {
      return res.status(400).json({ error: 'note doit être un entier entre 1 et 5' });
    }

    // Caller must have an active coach_clients row for this coach
    const { data: cc } = await supabaseAdmin
      .from('coach_clients')
      .select('id, status')
      .eq('coach_id', coachId)
      .eq('client_id', req.user.id)
      .maybeSingle();
    if (!cc || cc.status !== 'active') {
      return res.status(403).json({ error: 'Tu dois être client actif de ce coach pour le noter' });
    }

    // Upsert (UNIQUE coach_id, client_id)
    const { error: upsertErr } = await supabaseAdmin
      .from('coach_ratings')
      .upsert(
        {
          coach_id: coachId,
          client_id: req.user.id,
          note: noteNum,
          commentaire: commentaire ?? null,
        },
        { onConflict: 'coach_id,client_id' }
      );
    if (upsertErr) throw upsertErr;

    // Recompute average note for this coach
    const { data: ratings } = await supabaseAdmin
      .from('coach_ratings')
      .select('note')
      .eq('coach_id', coachId);
    const avg = ratings && ratings.length > 0
      ? ratings.reduce((s, r) => s + Number(r.note), 0) / ratings.length
      : 0;

    await supabaseAdmin
      .from('coach_profiles')
      .update({ note_moyenne: Math.round(avg * 10) / 10 })
      .eq('id', coachId);

    res.json({ success: true });
  } catch (err) {
    console.error('[coach.rateCoach]', err);
    res.status(500).json({ error: 'Erreur notation coach' });
  }
}

module.exports = {
  // profil
  getCoachProfile,
  createCoachProfile,
  updateCoachProfile,
  // clients
  getClients,
  inviteClient,
  acceptInvitation,
  getClientDetail,
  updateClient,
  // plans
  getClientPlan,
  createPlan,
  // programmes
  assignProgramme,
  // objectifs
  getWeeklyGoals,
  createWeeklyGoals,
  // messages
  getConversations,
  getMessages,
  sendMessage,
  // bilans
  generateWeeklyReview,
  sendWeeklyReview,
  // annuaire
  getPublicCoaches,
  rateCoach,
};
