const router = require('express').Router();
const multer = require('multer');
const { analyzePhoto } = require('../controllers/photoController');
const { requireAuth } = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Seules les images sont acceptées'));
  }
});

router.use(requireAuth);
router.post('/analyze', upload.single('photo'), analyzePhoto);

module.exports = router;
