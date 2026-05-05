const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const coach = require('../controllers/coachController');

// ── Profil coach ──────────────────────────────────────────────
router.get('/profile', requireAuth, coach.getCoachProfile);
router.post('/profile', requireAuth, coach.createCoachProfile);
router.patch('/profile', requireAuth, coach.updateCoachProfile);

// ── Clients ───────────────────────────────────────────────────
// `/clients/invite` doit être déclaré avant `/clients/:id`
router.get('/clients', requireAuth, coach.getClients);
router.post('/clients/invite', requireAuth, coach.inviteClient);
router.get('/clients/:id', requireAuth, coach.getClientDetail);
router.patch('/clients/:id', requireAuth, coach.updateClient);

// ── Plans nutrition ───────────────────────────────────────────
router.get('/plans/:clientId', requireAuth, coach.getClientPlan);
router.post('/plans', requireAuth, coach.createPlan);

// ── Programmes sport ──────────────────────────────────────────
router.post('/programmes', requireAuth, coach.assignProgramme);

// ── Objectifs hebdo ───────────────────────────────────────────
router.get('/goals/:clientId', requireAuth, coach.getWeeklyGoals);
router.post('/goals', requireAuth, coach.createWeeklyGoals);

// ── Messages ──────────────────────────────────────────────────
router.get('/messages', requireAuth, coach.getConversations);
router.get('/messages/:clientId', requireAuth, coach.getMessages);
router.post('/messages/:clientId', requireAuth, coach.sendMessage);

// ── Bilans hebdo ──────────────────────────────────────────────
router.post('/reviews/generate/:clientId', requireAuth, coach.generateWeeklyReview);
router.patch('/reviews/:id', requireAuth, coach.sendWeeklyReview);

// ── Annuaire (lecture publique) ───────────────────────────────
router.get('/public', coach.getPublicCoaches);
router.post('/public/:coachId/rate', requireAuth, coach.rateCoach);

// ── Côté client : accepter une invitation ─────────────────────
router.post('/accept/:coachClientId', requireAuth, coach.acceptInvitation);

module.exports = router;
