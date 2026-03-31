function requireAdmin(req, res, next) {
  if (req.user?.isAdmin === true) return next();
  return res.status(403).json({ error: 'Accès admin refusé' });
}

module.exports = { requireAdmin };
