const router = require('express').Router();
const { getProgrammes, getProgramme, createProgramme, deleteProgramme, saveSession, getLastSession } = require('../controllers/sportController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/programmes', getProgrammes);
router.get('/programmes/:id', getProgramme);
router.post('/programmes', createProgramme);
router.delete('/programmes/:id', deleteProgramme);

// Mise à jour poids/reps après séance
router.patch('/exercices/:id', async (req, res) => {
  const { supabaseAdmin } = require('../../config/supabase');
  const { id } = req.params;
  const { poids_kg, reps, series } = req.body;
  const updates = {};
  if (poids_kg !== undefined) updates.poids_kg = poids_kg;
  if (reps      !== undefined) updates.reps     = reps;
  if (series    !== undefined) updates.series   = series;
  try {
    const { data, error } = await supabaseAdmin
      .from('exercices_seance')
      .update(updates)
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    if (!data)  return res.status(404).json({ error: 'Exercice introuvable' });
    res.json({ message: 'ok' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Historique séances
router.post('/historique', saveSession);
router.get('/historique/last', getLastSession);

// Liste statique des exercices disponibles (pas besoin de DB)
router.get('/exercices', (req, res) => {
  res.json([
    { nom:'Développé couché',        groupe:'Pectoraux' },
    { nom:'Développé incliné',       groupe:'Pectoraux' },
    { nom:'Développé haltères',      groupe:'Pectoraux' },
    { nom:'Écarté câbles',           groupe:'Pectoraux' },
    { nom:'Pompes lestées',          groupe:'Pectoraux' },
    { nom:'Dips',                    groupe:'Pectoraux' },
    { nom:'Tractions',               groupe:'Dos' },
    { nom:'Rowing barre',            groupe:'Dos' },
    { nom:'Rowing haltère',          groupe:'Dos' },
    { nom:'Rowing câble',            groupe:'Dos' },
    { nom:'Tirage horizontal câble', groupe:'Dos' },
    { nom:'Soulevé de terre',        groupe:'Dos' },
    { nom:'Pull-over',               groupe:'Dos' },
    { nom:'Shrugs',                  groupe:'Trapèzes' },
    { nom:'Développé militaire',     groupe:'Épaules' },
    { nom:'Arnold press',            groupe:'Épaules' },
    { nom:'Élévations latérales',    groupe:'Épaules' },
    { nom:'Élévations frontales',    groupe:'Épaules' },
    { nom:'Face pull',               groupe:'Épaules' },
    { nom:'Curl barre',              groupe:'Biceps' },
    { nom:'Curl haltères',           groupe:'Biceps' },
    { nom:'Curl marteau',            groupe:'Biceps' },
    { nom:'Curl concentré',          groupe:'Biceps' },
    { nom:'Triceps corde',           groupe:'Triceps' },
    { nom:'Triceps extension',       groupe:'Triceps' },
    { nom:'Triceps barre front',     groupe:'Triceps' },
    { nom:'Squat barre',             groupe:'Quadriceps' },
    { nom:'Squat goblet',            groupe:'Quadriceps' },
    { nom:'Leg press',               groupe:'Quadriceps' },
    { nom:'Fentes marchées',         groupe:'Quadriceps' },
    { nom:'Leg extension',           groupe:'Quadriceps' },
    { nom:'Hack squat',              groupe:'Quadriceps' },
    { nom:'Romanian deadlift',       groupe:'Ischio' },
    { nom:'Leg curl',                groupe:'Ischio' },
    { nom:'Hip thrust',              groupe:'Fessiers' },
    { nom:'Mollets debout',          groupe:'Mollets' },
    { nom:'Mollets assis',           groupe:'Mollets' },
    { nom:'Planche',                 groupe:'Abdos' },
    { nom:'Crunchs',                 groupe:'Abdos' },
    { nom:'Russian twist',           groupe:'Abdos' },
    { nom:'Leg raises',              groupe:'Abdos' },
    { nom:'Burpees',                 groupe:'Cardio' },
    { nom:'Mountain climbers',       groupe:'Cardio' },
    { nom:'Jump squats',             groupe:'Cardio' },
    { nom:'Footing',                 groupe:'Cardio' },
  ]);
});

module.exports = router;
