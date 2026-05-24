const authService = require("../services/authService");

function wantsJson(req) {
  return req.path.startsWith("/api/") || req.xhr || req.is("application/json") || req.accepts(["json", "html"]) === "json";
}

async function loadCurrentUser(req, res, next) {
  res.locals.current_user = null;
  res.locals.currentUser = null;
  if (!req.session?.user_id) return next();
  try {
    const user = await authService.getUserById(req.session.user_id);
    if (user && authService.isActiveUser(user)) {
      req.currentUser = user;
      res.locals.current_user = user;
      res.locals.currentUser = user;
    } else {
      req.session.destroy(() => {});
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

function loginRequired(req, res, next) {
  if (req.currentUser) return requireVerifiedEmail(req, res, next);
  if (wantsJson(req)) {
    return res.status(401).json({ success: false, error: "Login required.", login_url: `/login?next=${encodeURIComponent(req.originalUrl || "/dashboard")}` });
  }
  const nextUrl = encodeURIComponent(req.originalUrl || "/dashboard");
  return res.redirect(`/login?next=${nextUrl}`);
}

function adminRequired(req, res, next) {
  if (authService.isAdmin(req.currentUser)) return requireVerifiedEmail(req, res, next);
  if (!req.currentUser) {
    if (wantsJson(req)) {
      return res.status(401).json({ success: false, error: "Login required.", login_url: `/login?next=${encodeURIComponent(req.originalUrl || "/admin")}` });
    }
    const nextUrl = encodeURIComponent(req.originalUrl || "/admin");
    return res.redirect(`/login?next=${nextUrl}`);
  }
  return wantsJson(req) ? res.status(403).json({ success: false, error: "Forbidden" }) : res.status(403).send("Forbidden");
}

function requireVerifiedEmail(req, res, next) {
  if (!req.currentUser || authService.isEmailVerified(req.currentUser)) return next();
  if (wantsJson(req)) {
    return res.status(403).json({ success: false, error: "Email verification required.", verification_url: "/verify-email-required" });
  }
  return res.redirect("/verify-email-required");
}

module.exports = {
  loadCurrentUser,
  loginRequired,
  adminRequired,
  requireVerifiedEmail,
  wantsJson
};
