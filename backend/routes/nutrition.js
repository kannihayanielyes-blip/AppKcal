const router = require('express').Router();
const { getToday, getWeek, addLog, deleteLog, updateLog, getSuggestions, getRecipes, getSmartSuggestions } = require('../controllers/nutritionController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/today', getToday);
router.get('/week', getWeek);
router.get('/suggestions', getSuggestions);
router.get('/recipes', getRecipes);
router.get('/smart-suggestions', getSmartSuggestions);
router.post('/log', addLog);
router.put('/log/:id', updateLog);
router.delete('/log/:id', deleteLog);

module.exports = router;
