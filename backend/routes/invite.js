const router = require('express').Router();
const { validateCode } = require('../controllers/inviteController');

router.post('/validate', validateCode);

module.exports = router;
