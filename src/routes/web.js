const express = require("express");
const passport = require("passport");
const db = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const { named } = require("../middleware/viewContext");
const { loginRequired, adminRequired } = require("../middleware/auth");
const auth = require("../services/authService");
const settings = require("../services/settingsService");
const learning = require("../services/learningService");
const groups = require("../services/vocabGroupService");
const listening = require("../services/listeningService");
const energy = require("../services/energyService");
const { emitEnergyUpdate } = require("../services/energySocket");

const router = express.Router();

function safeNextUrl(raw, fallback = "/dashboard") {
  const value = String(raw || "").trim();
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.startsWith("/auth/")) {
    return fallback;
  }
  return value;
}

function cleanAuthNext(raw) {
  const next = safeNextUrl(raw, "");
  return next === "/" || next === "/home" ? "" : next;
}

router.get("/", ...named("index", (req, res) => res.render("index.html")));
router.get("/home", ...named("index", (req, res) => res.render("index.html")));
router.get("/favicon.ico", (req, res) => res.status(204).send(""));

router.route("/register")
  .get(...named("register", (req, res) => {
    if (req.currentUser && !auth.isEmailVerified(req.currentUser)) return res.redirect("/verify-email-required");
    if (req.currentUser) return res.redirect(safeNextUrl(req.query.next));
    if (req.query.next === "/" || req.query.next === "/home") return res.redirect("/");
    return res.render("auth/register.html", {
      error: "",
      next_url: cleanAuthNext(req.query.next),
      google_configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
    });
  }))
  .post(...named("register", asyncHandler(async (req, res) => {
    try {
      const user = await auth.createUser(req.body.username, req.body.email, req.body.password);
      auth.loginSession(req, user);
      return res.redirect("/verify-email-required");
    } catch (error) {
      return res.render("auth/register.html", {
        error: error.message,
        next_url: cleanAuthNext(req.body.next || req.query.next),
        google_configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
      });
    }
  })));

router.route("/login")
  .get(...named("login", (req, res) => {
    if (req.currentUser && !auth.isEmailVerified(req.currentUser)) return res.redirect("/verify-email-required");
    if (req.currentUser) return res.redirect(safeNextUrl(req.query.next));
    if (req.query.next === "/" || req.query.next === "/home") return res.redirect("/");
    return res.render("auth/login.html", {
      error: "",
      next_url: cleanAuthNext(req.query.next),
      google_configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
    });
  }))
  .post(...named("login", asyncHandler(async (req, res) => {
    const user = await auth.authenticateUser(req.body.login, req.body.password);
    if (user) {
      auth.loginSession(req, user);
      if (!auth.isEmailVerified(user)) return res.redirect("/verify-email-required");
      return res.redirect(safeNextUrl(req.body.next));
    }
    return res.render("auth/login.html", {
      error: "Sai tài khoản hoặc mật khẩu.",
      next_url: cleanAuthNext(req.body.next || req.query.next),
      google_configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
    });
  })));

router.all("/logout", ...named("logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
}));

router.get("/forgot-password", ...named("forgot_password", (req, res) => {
  res.render("auth/forgot_password.html", { message: "", error: "", email: "" });
}));

router.post("/forgot-password", ...named("forgot_password", asyncHandler(async (req, res) => {
  const result = await auth.requestPasswordReset(req.body.email);
  if (req.is("application/json")) return res.json({ success: true, message: result.message });
  return res.render("auth/forgot_password.html", { message: result.message, error: "", email: req.body.email || "" });
})));

router.get("/reset-password", ...named("reset_password", asyncHandler(async (req, res) => {
  const token = String(req.query.token || "");
  const row = await auth.getValidPasswordResetToken(token);
  if (!row) {
    return res.status(400).render("auth/reset_password.html", { token: "", error: "Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.", success: "" });
  }
  return res.render("auth/reset_password.html", { token, error: "", success: "" });
})));

router.post("/reset-password", ...named("reset_password", asyncHandler(async (req, res) => {
  const result = await auth.resetPassword(req.body.token, req.body.password, req.body.confirmPassword);
  if (req.is("application/json")) {
    return result.ok ? res.json({ success: true }) : res.status(400).json({ success: false, error: result.error });
  }
  if (!result.ok) {
    return res.status(400).render("auth/reset_password.html", { token: req.body.token || "", error: result.error, success: "" });
  }
  req.flash("success", "Mật khẩu đã được cập nhật. Vui lòng đăng nhập lại.");
  return res.redirect("/login");
})));

router.get("/verify-email", ...named("verify_email", asyncHandler(async (req, res) => {
  const result = await auth.verifyEmailToken(req.query.token);
  if (!result.ok) {
    return res.status(400).render("auth/verify_email_result.html", {
      success: false,
      title: "Không thể xác minh email",
      message: result.reason
    });
  }
  return res.render("auth/verify_email_result.html", {
    success: true,
    title: "Email đã được xác minh",
    message: "Bạn có thể tiếp tục sử dụng FTKA."
  });
})));

router.get("/verify-email-required", ...named("verify_email_required", (req, res) => {
  if (!req.currentUser) return res.redirect(`/login?next=${encodeURIComponent("/verify-email-required")}`);
  if (auth.isEmailVerified(req.currentUser)) return res.redirect("/dashboard");
  return res.render("auth/verify_email_required.html", { user: req.currentUser, error: "" });
}));

router.post("/resend-verification-email", ...named("resend_verification_email", asyncHandler(async (req, res) => {
  if (!req.currentUser) return res.redirect(`/login?next=${encodeURIComponent("/verify-email-required")}`);
  if (auth.isEmailVerified(req.currentUser)) return res.redirect("/dashboard");
  try {
    await auth.resendVerificationEmail(req.currentUser);
    return res.render("auth/verify_email_required.html", { user: req.currentUser, message: "Đã gửi lại email xác minh nếu hệ thống email được cấu hình.", error: "" });
  } catch (error) {
    return res.status(error.statusCode || 400).render("auth/verify_email_required.html", { user: req.currentUser, message: "", error: error.message });
  }
})));

router.get("/auth/google", ...named("google_login", (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    req.flash("error", "Google OAuth chưa được cấu hình.");
    return res.redirect("/login");
  }
  req.session.oauth_next = safeNextUrl(req.query.next);
  passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
}));

router.get("/auth/google/callback", ...named("google_callback", (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    req.flash("error", "Google OAuth chưa được cấu hình.");
    return res.redirect("/login");
  }
  return passport.authenticate("google", { failureRedirect: "/login" })(req, res, next);
}, (req, res) => {
  if (req.user) auth.loginSession(req, req.user);
  const nextUrl = req.session.oauth_next || "/dashboard";
  delete req.session.oauth_next;
  res.redirect(safeNextUrl(nextUrl));
}));

router.get("/profile", ...named("profile", loginRequired, (req, res) => res.render("auth/profile.html", { user: req.currentUser })));
router.get("/preferences", ...named("preferences", loginRequired, (req, res) => res.render("auth/preferences.html", { user: req.currentUser })));

router.get("/dashboard", ...named("dashboard", loginRequired, asyncHandler(async (req, res) => {
  const ownerId = req.currentUser.id;
  const [vocabRows, focusRows, grammarRows] = await Promise.all([
    db.query("SELECT * FROM vocab WHERE owner_user_id=? ORDER BY created_at DESC, id DESC LIMIT 6", [ownerId]),
    db.query("SELECT * FROM vocab WHERE owner_user_id=? AND learned=FALSE ORDER BY created_at DESC, id DESC LIMIT 5", [ownerId]),
    db.query("SELECT * FROM grammar WHERE owner_user_id=? ORDER BY created_at DESC, id DESC LIMIT 4", [ownerId])
  ]);
  const vocabCount = Number(await db.scalar("SELECT COUNT(*) FROM vocab WHERE owner_user_id=?", [ownerId]));
  const grammarCount = Number(await db.scalar("SELECT COUNT(*) FROM grammar WHERE owner_user_id=?", [ownerId]));
  const unlearned = Number(await db.scalar("SELECT COUNT(*) FROM vocab WHERE owner_user_id=? AND learned=FALSE", [ownerId]));
  const learnedCount = vocabCount - unlearned;
  const timeline = await learning.getLearningActivityTimeline(ownerId);
  const streak = await learning.getLearningStreakStats(ownerId);
  const recentLearning = await learning.getRecentLearningActivity(ownerId);
  const sourceBreakdown = await learning.getSourceBreakdown(ownerId, vocabCount);
  const newWordsThisWeek = await learning.countRecentVocabEntries(ownerId);
  const energyStatus = await energy.getEnergyStatus(ownerId);
  res.render("dashboard.html", {
    vocab: learning.serializeRecentVocab(vocabRows),
    grammar: learning.serializeRecentGrammar(grammarRows),
    focus_words: learning.serializeFocusWords(focusRows),
    vocab_count: vocabCount,
    grammar_count: grammarCount,
    unlearned,
    learning_streak: streak,
    streak_status_labels: {
      active: "Đang học",
      at_risk: "Cần học hôm nay",
      warning: "Sắp mất streak",
      lost: "Mất streak",
      inactive: "Chưa hoạt động",
      none: "Chưa học"
    },
    learning_timeline: timeline,
    recent_learning: recentLearning,
    source_breakdown: sourceBreakdown,
    energy_status: energyStatus,
    dashboard_summary: {
      learned_count: learnedCount,
      mastery_rate: vocabCount ? Math.round((learnedCount / vocabCount) * 100) : 0,
      focus_count: Math.min(unlearned, learning.QUIZ_SESSION_LIMIT),
      today_goal: 5,
      today_goal_progress: Math.min(100, Math.round(((streak.today_count || 0) / 5) * 100)),
      new_words_this_week: newWordsThisWeek,
      this_week_learned: timeline.reduce((sum, day) => sum + day.count, 0),
      active_learning_days: timeline.filter((day) => day.count > 0).length
    }
  });
})));

router.get("/vocab", ...named("vocab", loginRequired, asyncHandler(async (req, res) => {
  const ownerId = req.currentUser.id;
  const page = Math.max(Number.parseInt(req.query.page || "1", 10) || 1, 1);
  const perPage = 20;
  const offset = (page - 1) * perPage;
  const rows = await db.query("SELECT * FROM vocab WHERE owner_user_id=? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?", [ownerId, perPage, offset]);
  const total = Number(await db.scalar("SELECT COUNT(*) FROM vocab WHERE owner_user_id=?", [ownerId]));
  const learnedCount = Number(await db.scalar("SELECT COUNT(*) FROM vocab WHERE owner_user_id=? AND learned=TRUE", [ownerId]));
  res.render("vocab.html", {
    vocab: rows,
    count: total,
    learned_count: learnedCount,
    unlearned_count: total - learnedCount,
    vocab_groups: await groups.getGroups(ownerId),
    vocab_group_map: await groups.getAssignments(ownerId),
    page,
    total_pages: Math.ceil(total / perPage),
    per_page: perPage,
    total_vocab: total
  });
})));

router.get("/grammar", ...named("grammar", loginRequired, asyncHandler(async (req, res) => {
  const ownerId = req.currentUser.id;
  const page = Math.max(Number.parseInt(req.query.page || "1", 10) || 1, 1);
  const perPage = 20;
  const offset = (page - 1) * perPage;
  const rows = await db.query("SELECT * FROM grammar WHERE owner_user_id=? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?", [ownerId, perPage, offset]);
  const total = Number(await db.scalar("SELECT COUNT(*) FROM grammar WHERE owner_user_id=?", [ownerId]));
  const levelRows = await db.query(
    "SELECT COALESCE(NULLIF(LOWER(TRIM(level)), ''), 'general') AS level, COUNT(*) AS count FROM grammar WHERE owner_user_id=? GROUP BY level",
    [ownerId]
  );
  res.render("grammar.html", {
    grammar: rows,
    count: total,
    level_counts: Object.fromEntries(levelRows.map((row) => [row.level, row.count])),
    page,
    total_pages: Math.ceil(total / perPage),
    per_page: perPage,
    total_grammar: total
  });
})));

router.get("/generator", ...named("generator", loginRequired, asyncHandler(async (req, res) => {
  res.render("generator.html", { vocab_groups: await groups.getGroups(req.currentUser.id) });
})));

router.get("/listening-practice", ...named("listening_practice", loginRequired, asyncHandler(async (req, res) => {
  const ownerId = req.currentUser.id;
  const savedLessons = await listening.listLessonSummaries(db, ownerId);
  let selectedLesson = await listening.getLessonById(db, req.query.lesson_id, ownerId);
  if (!selectedLesson && savedLessons.length) selectedLesson = await listening.getLessonById(db, savedLessons[0].id, ownerId);
  res.render("listening_practice.html", {
    levels: listening.LISTENING_LEVELS,
    topics: listening.LISTENING_TOPICS,
    lengths: listening.LISTENING_LENGTHS,
    saved_lessons: savedLessons,
    selected_lesson: selectedLesson,
    selected_lesson_id: selectedLesson ? selectedLesson.id : "",
    generation_error: req.query.error || ""
  });
})));

router.post("/listening-practice/generate", ...named("generate_listening_practice", loginRequired, asyncHandler(async (req, res) => {
  const wantsJson = req.is("application/json");
  try {
    const status = await energy.hasEnoughEnergy(req.currentUser.id, 10);
    if (!status.ok) return wantsJson ? res.status(402).json({ success: false, error: "Không đủ năng lượng. Vui lòng chờ hồi phục hoặc nhận thưởng hằng ngày.", energy: status.status, required_energy: 10 }) : res.redirect(`/listening-practice?error=${encodeURIComponent("Không đủ năng lượng. Vui lòng chờ hồi phục hoặc nhận thưởng hằng ngày.")}`);
    const lesson = await listening.createLesson(db, wantsJson ? req.body : req.body, req.currentUser.id);
    const spent = await energy.spendEnergy(req.currentUser.id, 10, "generate_listening_practice", lesson.id);
    if (!spent.ok) return wantsJson ? res.status(402).json({ success: false, error: "Không đủ năng lượng. Vui lòng chờ hồi phục hoặc nhận thưởng hằng ngày.", energy: spent.status, required_energy: 10 }) : res.redirect(`/listening-practice?error=${encodeURIComponent("Không đủ năng lượng. Vui lòng chờ hồi phục hoặc nhận thưởng hằng ngày.")}`);
    await emitEnergyUpdate(req.currentUser.id);
    const detailUrl = `/listening-practice?lesson_id=${encodeURIComponent(lesson.id)}`;
    return wantsJson ? res.json({ success: true, lesson, redirect_url: detailUrl }) : res.redirect(detailUrl);
  } catch (error) {
    return wantsJson ? res.status(400).json({ error: error.message }) : res.redirect(`/listening-practice?error=${encodeURIComponent(error.message)}`);
  }
})));

router.post("/listening-practice/:lesson_id/delete", ...named("delete_listening_practice_lesson", loginRequired, asyncHandler(async (req, res) => {
  const ok = await listening.deleteLesson(db, req.params.lesson_id, req.currentUser.id);
  res.redirect(ok ? "/listening-practice?message=Đã xoá bài nghe đã lưu." : "/listening-practice?error=Không tìm thấy bài nghe đã lưu.");
})));

router.get("/quiz", ...named("quiz", loginRequired, asyncHandler(async (req, res) => {
  const ownerId = req.currentUser.id;
  const quizWords = await db.query("SELECT * FROM vocab WHERE owner_user_id=? AND learned=FALSE ORDER BY RANDOM() LIMIT ?", [ownerId, learning.QUIZ_SESSION_LIMIT]);
  const pool = await db.query("SELECT example_vi FROM vocab WHERE owner_user_id=? AND example_vi IS NOT NULL AND TRIM(example_vi) != '' ORDER BY RANDOM() LIMIT 80", [ownerId]);
  res.render("quiz.html", {
    quiz_words: quizWords,
    quiz_example_vi_pool: pool.map((row) => row.example_vi),
    total_vocab: Number(await db.scalar("SELECT COUNT(*) FROM vocab WHERE owner_user_id=?", [ownerId])),
    total_unlearned: Number(await db.scalar("SELECT COUNT(*) FROM vocab WHERE owner_user_id=? AND learned=FALSE", [ownerId])),
    session_limit: learning.QUIZ_SESSION_LIMIT
  });
})));

router.get("/grammar-quiz", ...named("grammar_quiz", loginRequired, asyncHandler(async (req, res) => {
  const ownerId = req.currentUser.id;
  const rows = await db.query("SELECT * FROM grammar WHERE owner_user_id=? ORDER BY created_at DESC, id DESC", [ownerId]);
  const deck = learning.buildGrammarQuizDeck(rows);
  res.render("grammar_quiz.html", {
    quiz_items: deck.slice(0, learning.QUIZ_SESSION_LIMIT),
    total_items: deck.length,
    total_grammar: Number(await db.scalar("SELECT COUNT(*) FROM grammar WHERE owner_user_id=?", [ownerId])),
    session_limit: learning.QUIZ_SESSION_LIMIT
  });
})));

router.get("/settings", ...named("settings", adminRequired, (req, res) => {
  const config = settings.getConfig();
  res.render("settings.html", { config, has_api_key: Boolean(config.api_key) });
}));

module.exports = router;
