const jwt = require('jsonwebtoken');
const { supabase } = require('../../config/supabase');

async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  const token = header.slice(7);

  // ── 1. Tenter vérification JWT custom (comptes hardcodés) ──
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.id, email: payload.email, isAdmin: payload.isAdmin };
    req.token = token;
    return next();
  } catch {
    // Pas un JWT custom → on essaie Supabase
  }

  // ── 2. Fallback : token Supabase ───────────────────────────
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }

  req.user = user;
  req.token = token;
  next();
}

module.exports = { requireAuth };
