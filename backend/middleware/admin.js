function requireAdmin(req, res, next) {
  const { username, password } = req.headers;

  const validUsername = username === process.env.ADMIN_USERNAME
                     || username === process.env.ADMIN_EMAIL;
  const validPassword = password === process.env.ADMIN_PASSWORD;

  if (validUsername && validPassword) {
    return next();
  }
  return res.status(403).json({ error: 'Accès admin refusé' });
}

module.exports = { requireAdmin };
