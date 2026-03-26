const router = require('express').Router();
const { getStats, getUsers, deleteUser, getInvites, createInvite, deleteInvite, getRecipes, createRecipe, updateRecipe, toggleRecipeVisibility, deleteRecipe } = require('../controllers/adminController');
const { requireAdmin } = require('../middleware/admin');

router.use(requireAdmin);

router.get('/stats', getStats);
router.get('/users', getUsers);
router.delete('/users/:id', deleteUser);
router.get('/invites', getInvites);
router.post('/invites', createInvite);
router.delete('/invites/:id', deleteInvite);
router.get('/recipes', getRecipes);
router.post('/recipes', createRecipe);
router.put('/recipes/:id', updateRecipe);
router.patch('/recipes/:id/visibility', toggleRecipeVisibility);
router.delete('/recipes/:id', deleteRecipe);

module.exports = router;
