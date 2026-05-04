const router = require('express').Router();
const { register, login, logout, onboarding, forgotPassword } = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

router.post('/register', register);
router.post('/login', login);
router.post('/logout', logout);
router.post('/forgot-password', forgotPassword);
router.post('/onboarding', requireAuth, onboarding);

module.exports = router;
