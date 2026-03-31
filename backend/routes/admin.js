const router = require('express').Router();
const multer = require('multer');
const {
  getStats, getUsers, searchUsers, getUserFull, deleteUser,
  getInvites, createInvite, deleteInvite,
  getRecipes, createRecipe, updateRecipe, toggleRecipeVisibility, deleteRecipe,
  getIngredients, createIngredient, updateIngredient, deleteIngredient
} = require('../controllers/adminController');
const { uploadRecipePhoto } = require('../controllers/nutritionController');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Seules les images sont acceptées'));
  }
});

router.use(requireAuth);
router.use(requireAdmin);

router.get('/stats', getStats);
router.get('/users/search', searchUsers);   // avant /users/:id pour éviter conflit
router.get('/users', getUsers);
router.get('/users/:id/full', getUserFull);
router.delete('/users/:id', deleteUser);
router.get('/invites', getInvites);
router.post('/invites', createInvite);
router.delete('/invites/:id', deleteInvite);
router.get('/recipes', getRecipes);
router.post('/recipes', photoUpload.single('photo'), createRecipe);
router.put('/recipes/:id', photoUpload.single('photo'), updateRecipe);
router.post('/recipes/:id/photo', photoUpload.single('photo'), uploadRecipePhoto);
router.patch('/recipes/:id/visibility', toggleRecipeVisibility);
router.delete('/recipes/:id', deleteRecipe);

router.get('/ingredients', getIngredients);
router.post('/ingredients', createIngredient);
router.put('/ingredients/:id', updateIngredient);
router.delete('/ingredients/:id', deleteIngredient);

module.exports = router;
