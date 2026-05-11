const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'mayvel_super_secret_key_change_in_prod';

function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'No token provided' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
}

// Variant of `authenticate` that ALSO accepts the token as a `?token=...` query
// string (or `?t=...`). Browsers can't add Authorization headers to <img> /
// <iframe> / <a download> requests, so query-string auth is the simplest way
// to gate static file serving.
function authenticateAnySource(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.split(' ')[1])
    || req.query.token
    || req.query.t;
  if (!token) return res.status(401).json({ error: 'No token provided' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
}

function generateToken(user) {
  return jwt.sign({ userId: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

module.exports = { authenticate, authenticateAnySource, generateToken, JWT_SECRET };
