const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

function limitHandler(req, res) {
  const message = "Quá nhiều yêu cầu. Vui lòng thử lại sau ít phút.";
  if (req.originalUrl.startsWith("/api/") || req.is("application/json")) {
    return res.status(429).json({ success: false, error: message });
  }
  return res.status(429).send(message);
}

// Brute-force guard for credential endpoints (login, register, password reset).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitHandler
});

// Quota guard for endpoints that call the AI provider.
// Keyed by user id when logged in so users behind a shared IP don't block each other.
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.currentUser ? `user:${req.currentUser.id}` : ipKeyGenerator(req.ip)),
  handler: limitHandler
});

module.exports = { authLimiter, aiLimiter };
