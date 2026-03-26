const router = require('express').Router();
const multer = require('multer');
const { getProfile, updateProfile, getStreak, getWeightHistory, logWeight, uploadAvatar } = require('../controllers/userController');
const { requireAuth } = require('../middleware/auth');

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Format non supporté (jpg, png, webp uniquement)'));
  }
});

router.use(requireAuth);

router.get('/profile', getProfile);
router.patch('/profile', updateProfile);
router.post('/avatar', avatarUpload.single('avatar'), uploadAvatar);
router.get('/streak', getStreak);
router.get('/weight', getWeightHistory);
router.post('/weight', logWeight);

module.exports = router;
