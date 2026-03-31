const router = require('express').Router();
const multer = require('multer');
const { getToday, getWeek, addLog, deleteLog, updateLog, getSuggestions, getRecipes, getUserRecipes, createUserRecipe, deleteUserRecipe, getSmartSuggestions, searchAliment, getIngredients, uploadRecipePhoto } = require('../controllers/nutritionController');
const { requireAuth } = require('../middleware/auth');

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Format non supporté (jpeg, png, webp, gif uniquement)'));
  }
});

// Routes publiques (avant requireAuth)
router.get('/ingredients', getIngredients);

router.use(requireAuth);

router.get('/today', getToday);
router.get('/week', getWeek);
router.get('/search-aliment', searchAliment);
router.get('/suggestions', getSuggestions);
router.get('/recipes/mine', getUserRecipes);   // avant /recipes/:id pour éviter conflit
router.get('/recipes', getRecipes);
router.post('/recipes', createUserRecipe);
router.post('/recipes/:id/photo', photoUpload.single('photo'), uploadRecipePhoto);
router.delete('/recipes/:id', deleteUserRecipe);
router.get('/smart-suggestions', getSmartSuggestions);
router.post('/log', addLog);
router.put('/log/:id', updateLog);
router.delete('/log/:id', deleteLog);

module.exports = router;
