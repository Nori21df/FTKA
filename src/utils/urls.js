const routes = {
  index: "/",
  home: "/home",
  register: "/register",
  login: "/login",
  logout: "/logout",
  forgot_password: "/forgot-password",
  reset_password: "/reset-password",
  google_login: "/auth/google",
  google_callback: "/auth/google/callback",
  verify_email: "/verify-email",
  verify_email_required: "/verify-email-required",
  resend_verification_email: "/resend-verification-email",
  pricing: "/pricing",
  account_billing: "/account/billing",
  payment_success: "/payment/success",
  payment_error: "/payment/error",
  payment_cancel: "/payment/cancel",
  profile: "/profile",
  preferences: "/preferences",
  api_update_preferences: "/api/preferences",
  api_create_sepay_order: "/api/payments/sepay/create-order",
  dashboard: "/dashboard",
  vocab: "/vocab",
  grammar: "/grammar",
  generator: "/generator",
  listening_practice: "/listening-practice",
  generate_listening_practice: "/listening-practice/generate",
  delete_listening_practice_lesson: "/listening-practice/:lesson_id/delete",
  quiz: "/quiz",
  grammar_quiz: "/grammar-quiz",
  settings: "/settings",
  api_update_settings: "/api/settings",
  "admin.dashboard": "/admin",
  "admin.users": "/admin/users",
  "admin.user_detail": "/admin/users/:user_id",
  "admin.edit_user": "/admin/users/:user_id/edit",
  "admin.update_user": "/admin/users/:user_id/edit",
  "admin.delete_user": "/admin/users/:user_id/delete",
  "admin.ban_user": "/admin/users/:user_id/ban",
  "admin.unban_user": "/admin/users/:user_id/unban",
  "admin.add_user_energy": "/admin/users/:user_id/energy/add",
  "admin.subtract_user_energy": "/admin/users/:user_id/energy/subtract",
  "admin.reset_user_streak": "/admin/users/:user_id/streak/reset",
  "admin.user_vocab": "/admin/users/:user_id/vocab",
  "admin.user_vocab_edit": "/admin/users/:user_id/vocab/:id/edit",
  "admin.user_vocab_update": "/admin/users/:user_id/vocab/:id/edit",
  "admin.user_vocab_delete": "/admin/users/:user_id/vocab/:id/delete",
  "admin.user_grammar": "/admin/users/:user_id/grammar",
  "admin.user_grammar_edit": "/admin/users/:user_id/grammar/:id/edit",
  "admin.user_grammar_update": "/admin/users/:user_id/grammar/:id/edit",
  "admin.user_grammar_delete": "/admin/users/:user_id/grammar/:id/delete",
  "admin.user_writing": "/admin/users/:user_id/writing",
  "admin.user_listening": "/admin/users/:user_id/listening",
  "admin.user_listening_edit": "/admin/users/:user_id/listening/:id/edit",
  "admin.user_listening_update": "/admin/users/:user_id/listening/:id/edit",
  "admin.user_listening_delete": "/admin/users/:user_id/listening/:id/delete",
  "admin.user_audio": "/admin/users/:user_id/audio",
  "admin.user_audio_edit": "/admin/users/:user_id/audio/:id/edit",
  "admin.user_audio_update": "/admin/users/:user_id/audio/:id/edit",
  "admin.user_audio_delete": "/admin/users/:user_id/audio/:id/delete",
  "admin.user_energy": "/admin/users/:user_id/energy",
  "admin.user_streak": "/admin/users/:user_id/streak",
  "admin.vocab": "/admin/vocab",
  "admin.vocab_detail": "/admin/vocab/:vocab_id",
  "admin.update_vocab": "/admin/vocab/:vocab_id/update",
  "admin.delete_vocab": "/admin/vocab/:vocab_id/delete",
  "admin.grammar": "/admin/grammar",
  "admin.activity": "/admin/activity",
  "admin.writing": "/admin/writing",
  "admin.writing_detail": "/admin/writing/:submission_id",
  "admin.writing_delete": "/admin/writing/:submission_id/delete",
  "admin.writing_regrade": "/admin/writing/:submission_id/regrade",
  "admin.listening": "/admin/listening",
  "admin.listening_detail": "/admin/listening/:lesson_id",
  "admin.delete_listening": "/admin/listening/:lesson_id/delete",
  "admin.regenerate_listening_audio": "/admin/listening/:lesson_id/regenerate-audio",
  "admin.audio": "/admin/audio",
  "admin.delete_audio": "/admin/audio/:audio_reference/delete",
  "admin.energy": "/admin/energy",
  "admin.transactions": "/admin/transactions",
  "admin.purchases": "/admin/purchases",
  "admin.cancel_purchase": "/admin/purchases/:orderId/cancel",
  "admin.delete_purchase": "/admin/purchases/:orderId/delete",
  "admin.streaks": "/admin/streaks",
  "admin.ai_usage": "/admin/ai-usage",
  "admin.ai_logs": "/admin/ai-logs",
  "admin.ai_logs_json": "/admin/ai-logs.json",
  "admin.ai_logs_stream": "/admin/ai-logs/stream",
  "admin.ai_logs_clear": "/admin/ai-logs/clear",
  "admin.logs": "/admin/logs"
};

function collectParams(args) {
  const params = {};
  for (const arg of args) {
    if (arg && typeof arg === "object") {
      Object.assign(params, arg.__keywords ? Object.fromEntries(Object.entries(arg).filter(([k]) => k !== "__keywords")) : arg);
    }
  }
  return params;
}

function urlFor(endpoint, ...args) {
  const params = collectParams(args);
  if (endpoint === "static") {
    return `/static/${encodeURIComponent(params.filename || "").replace(/%2F/g, "/")}`;
  }
  let pattern = routes[endpoint] || "/";
  const used = new Set();
  pattern = pattern.replace(/:([A-Za-z0-9_]+)/g, (_, key) => {
    used.add(key);
    return encodeURIComponent(params[key] == null ? "" : String(params[key]));
  });
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (used.has(key) || value == null || value === "") continue;
    query.set(key, String(value));
  }
  const queryString = query.toString();
  return queryString ? `${pattern}?${queryString}` : pattern;
}

module.exports = {
  routes,
  urlFor
};
