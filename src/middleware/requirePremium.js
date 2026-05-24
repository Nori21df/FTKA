const { wantsJson } = require("./auth");

function isPremiumUser(user) {
  if (!user || String(user.plan || "").toLowerCase() !== "premium") {
    return false;
  }
  const until = user.premium_until ? new Date(user.premium_until) : null;
  return Boolean(until && !Number.isNaN(until.getTime()) && until > new Date());
}

function requirePremium(req, res, next) {
  if (isPremiumUser(req.currentUser)) {
    return next();
  }

  if (!req.currentUser) {
    if (wantsJson(req)) {
      return res.status(401).json({ success: false, error: "Login required.", login_url: `/login?next=${encodeURIComponent(req.originalUrl || "/dashboard")}` });
    }
    const nextUrl = encodeURIComponent(req.originalUrl || "/dashboard");
    return res.redirect(`/login?next=${nextUrl}`);
  }

  if (wantsJson(req)) {
    return res.status(403).json({ success: false, error: "Premium required.", pricing_url: "/pricing" });
  }
  return res.redirect("/pricing");
}

module.exports = {
  isPremiumUser,
  requirePremium
};
