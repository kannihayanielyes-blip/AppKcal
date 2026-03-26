const { supabaseAdmin } = require('../../config/supabase');

// GET /api/sport/programmes
async function getProgrammes(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('programmes_user')
      .select('id, nom, type, created_at, seances_user(id, nom, jour_numero)')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    console.error('[getProgrammes]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// GET /api/sport/programmes/:id
async function getProgramme(req, res) {
  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from('programmes_user')
      .select(`
        id, nom, type, created_at,
        seances_user(
          id, nom, jour_numero,
          exercices_seance(id, exercice_nom, exercice_groupe, series, reps, poids_kg, ordre)
        )
      `)
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    console.error('[getProgramme]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// POST /api/sport/programmes
// Body: { nom, type, seances: [{nom, jour_numero, exercices: [{exercice_nom, exercice_groupe, series, reps, poids_kg, ordre}]}] }
async function createProgramme(req, res) {
  try {
    const { nom, type, seances = [] } = req.body;
    if (!nom) return res.status(400).json({ error: 'Nom requis' });

    const { data: prog, error: progErr } = await supabaseAdmin
      .from('programmes_user')
      .insert({ user_id: req.user.id, nom, type: type || 'custom' })
      .select()
      .single();

    if (progErr) return res.status(400).json({ error: progErr.message });

    for (const seance of seances) {
      const { data: s, error: sErr } = await supabaseAdmin
        .from('seances_user')
        .insert({ programme_id: prog.id, nom: seance.nom, jour_numero: seance.jour_numero || 0 })
        .select()
        .single();

      if (sErr) { console.error('[createProgramme] seance error:', sErr.message); continue; }

      const exs = seance.exercices || [];
      if (exs.length) {
        await supabaseAdmin
          .from('exercices_seance')
          .insert(exs.map((e, i) => ({
            seance_id:       s.id,
            exercice_nom:    e.exercice_nom    || e.nom    || '—',
            exercice_groupe: e.exercice_groupe || e.groupe || '',
            series:   e.series   ?? 3,
            reps:     e.reps     ?? 10,
            poids_kg: e.poids_kg ?? e.poids ?? 0,
            ordre:    e.ordre    ?? i,
          })));
      }
    }

    res.status(201).json({ id: prog.id, nom: prog.nom, type: prog.type });
  } catch (err) {
    console.error('[createProgramme]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// DELETE /api/sport/programmes/:id
async function deleteProgramme(req, res) {
  try {
    const { id } = req.params;
    const { error } = await supabaseAdmin
      .from('programmes_user')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Programme supprimé' });
  } catch (err) {
    console.error('[deleteProgramme]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// POST /api/sport/historique — sauvegarde une séance terminée
async function saveSession(req, res) {
  try {
    const { programme_nom, seance_nom, date, duree_minutes, volume_total, exercices = [] } = req.body;

    const { data: seance, error: sErr } = await supabaseAdmin
      .from('historique_seances')
      .insert({ user_id: req.user.id, programme_nom, seance_nom, date, duree_minutes, volume_total })
      .select().single();

    if (sErr) return res.status(400).json({ error: sErr.message });

    if (exercices.length) {
      await supabaseAdmin.from('historique_exercices').insert(
        exercices.map(e => ({ seance_id: seance.id, exercice_nom: e.exercice_nom, series: e.series }))
      );
    }

    res.status(201).json({ id: seance.id });
  } catch (err) {
    console.error('[saveSession]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// GET /api/sport/historique/last?seance_nom=X
async function getLastSession(req, res) {
  try {
    const { seance_nom } = req.query;
    const { data, error } = await supabaseAdmin
      .from('historique_seances')
      .select('id, date, duree_minutes, volume_total, historique_exercices(exercice_nom, series)')
      .eq('user_id', req.user.id)
      .eq('seance_nom', seance_nom)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return res.status(400).json({ error: error.message });
    res.json(data || null);
  } catch (err) {
    console.error('[getLastSession]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

module.exports = { getProgrammes, getProgramme, createProgramme, deleteProgramme, saveSession, getLastSession };
