const express = require("express");
const passport = require("passport");
const db = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const { named } = require("../middleware/viewContext");
const { loginRequired, adminRequired } = require("../middleware/auth");
const { authLimiter, aiLimiter } = require("../middleware/rateLimit");
const auth = require("../services/authService");
const settings = require("../services/settingsService");
const learning = require("../services/learningService");
const groups = require("../services/vocabGroupService");
const listening = require("../services/listeningService");
const energy = require("../services/energyService");
const daily = require("../services/dailyService");
const streakRewards = require("../services/streakRewardService");
const writing = require("../services/writingService");
const itTerms = require("../services/itTermsService");
const referral = require("../services/referralService");
const premiumKeys = require("../services/premiumKeyService");
const { isPremiumUser } = require("../middleware/requirePremium");
const { SPECIALTIES, getSpecialty } = require("../config/specialties");
const { emitEnergyUpdate } = require("../services/energySocket");

const router = express.Router();

// Không cache các trang xác thực (đăng nhập/đăng ký/đặt lại mật khẩu) ở trình duyệt hay proxy trung gian.
router.use(["/login", "/register", "/forgot-password", "/reset-password", "/verify-email", "/verify-email-required"], (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

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
    // Link mời bạn bè: /register?ref=<userId> → nhớ vào cookie 30 ngày (thưởng khi user mới verify email)
    if (req.query.ref && /^\d+$/.test(String(req.query.ref))) referral.setRefCookie(res, Number(req.query.ref));
    if (req.currentUser && !auth.isEmailVerified(req.currentUser)) return res.redirect("/verify-email-required");
    if (req.currentUser) return res.redirect(safeNextUrl(req.query.next));
    if (req.query.next === "/" || req.query.next === "/home") return res.redirect("/");
    return res.render("auth/register.html", {
      error: "",
      next_url: cleanAuthNext(req.query.next),
      google_configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
    });
  }))
  .post(authLimiter, ...named("register", asyncHandler(async (req, res) => {
    try {
      const user = await auth.createUser(req.body.username, req.body.email, req.body.password);
      await auth.loginSession(req, user, "register");
      await referral.recordPendingFromCookie(req, user.id).catch(() => {}); // thưởng khi verify email
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
  .post(authLimiter, ...named("login", asyncHandler(async (req, res) => {
    const user = await auth.authenticateUser(req.body.login, req.body.password);
    if (user) {
      await auth.loginSession(req, user, "password");
      if (!auth.isEmailVerified(user)) return res.redirect("/verify-email-required");
      // B2: hâm nóng đoạn "Học hôm nay" ở nền — KHÔNG await (đừng làm chậm login).
      daily.prewarmToday(user.id).catch(() => {});
      return res.redirect(safeNextUrl(req.body.next));
    }
    return res.render("auth/login.html", {
      error: "Sai tài khoản hoặc mật khẩu.",
      next_url: cleanAuthNext(req.body.next || req.query.next),
      google_configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
    });
  })));

router.all("/logout", ...named("logout", asyncHandler(async (req, res) => {
  await auth.logoutSession(req);
  res.clearCookie("ftka.sid");
  return res.redirect("/login");
})));

router.get("/forgot-password", ...named("forgot_password", (req, res) => {
  res.render("auth/forgot_password.html", { message: "", error: "", email: "" });
}));

router.post("/forgot-password", authLimiter, ...named("forgot_password", asyncHandler(async (req, res) => {
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

router.post("/reset-password", authLimiter, ...named("reset_password", asyncHandler(async (req, res) => {
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
  // Verify xong = lúc thưởng referral (nếu user này được mời) — cả hai +30 Sun.
  if (result.user_id) referral.rewardIfPending(result.user_id).catch(() => {});
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
  const nextUrl = req.session.oauth_next || "/dashboard";
  return auth.loginSession(req, req.user, "google")
    .then(async () => {
      daily.prewarmToday(req.user.id).catch(() => {}); // B2: prewarm nền, không chặn
      // User Google mới + có cookie mời: ghi nhận rồi thưởng luôn (Google = email đã verify).
      // recordPendingFromCookie tự bỏ qua nếu tài khoản cũ (>15 phút) hoặc đã ghi nhận.
      try { if (await referral.recordPendingFromCookie(req, req.user.id)) await referral.rewardIfPending(req.user.id); } catch (_e) { /* im lặng */ }
      res.redirect(safeNextUrl(nextUrl));
    })
    .catch((error) => {
      console.error("[auth] Google session creation failed:", error);
      res.redirect("/login");
    });
}));

router.get("/profile", ...named("profile", loginRequired, (req, res) => {
  const premiumActive = isPremiumUser(req.currentUser);
  res.render("auth/profile.html", {
    user: req.currentUser,
    premium_active: premiumActive,
    premium_until_label: premiumActive ? new Date(req.currentUser.premium_until).toLocaleDateString("vi-VN") : "",
  });
}));

// Nhập key Premium (bán key thủ công — không cần cổng thanh toán). authLimiter chống dò key.
router.post("/profile/redeem-key", authLimiter, ...named("redeem_key", loginRequired, asyncHandler(async (req, res) => {
  const result = await premiumKeys.redeemKey(req.currentUser.id, req.body.code);
  if (result.ok) {
    // Lên gói = nạp ĐẦY Sun theo trần Premium (90/90 → 600/600) + đẩy realtime lên pill.
    await energy.fillToMax(req.currentUser.id, "premium_bonus", "key").catch(() => {});
    await emitEnergyUpdate(req.currentUser.id).catch(() => {});
    req.flash("success", `Kích hoạt thành công +${result.days} ngày Premium! Sun đã nạp đầy ☀️ Hạn mới: ${new Date(result.premium_until).toLocaleDateString("vi-VN")} 🎉`);
  } else {
    req.flash("error", result.error);
  }
  res.redirect("/profile");
})));
router.get("/preferences", ...named("preferences", loginRequired, (req, res) => res.render("auth/preferences.html", { user: req.currentUser })));

router.get("/dashboard", ...named("dashboard", loginRequired, asyncHandler(async (req, res) => {
  const ownerId = req.currentUser.id;
  const [vocabRows, focusRows, grammarRows] = await Promise.all([
    db.query("SELECT * FROM vocab WHERE owner_user_id=? ORDER BY created_at DESC, id DESC LIMIT 6", [ownerId]),
    // "Cần ôn hôm nay" = từ đến hạn SRS trước (chưa ôn bao giờ hoặc quá hạn), rồi tới từ mới nhất.
    db.query(
      `SELECT * FROM vocab WHERE owner_user_id=? AND learned=FALSE
       ORDER BY CASE WHEN srs_due IS NULL THEN 0 WHEN srs_due <= NOW() THEN 1 ELSE 2 END, created_at DESC, id DESC LIMIT 5`,
      [ownerId]
    ),
    db.query("SELECT * FROM grammar WHERE owner_user_id=? ORDER BY created_at DESC, id DESC LIMIT 4", [ownerId])
  ]);
  const vocabCount = Number(await db.scalar("SELECT COUNT(*) FROM vocab WHERE owner_user_id=?", [ownerId]));
  const grammarCount = Number(await db.scalar("SELECT COUNT(*) FROM grammar WHERE owner_user_id=?", [ownerId]));
  const unlearned = Number(await db.scalar("SELECT COUNT(*) FROM vocab WHERE owner_user_id=? AND learned=FALSE", [ownerId]));
  const learnedCount = vocabCount - unlearned;
  const timeline = await learning.getLearningActivityTimeline(ownerId);
  const streak = await learning.getLearningStreakStats(ownerId);
  // Heatmap 15 tuần (105 ngày) gom theo tuần, mỗi tuần 7 ô — render tĩnh trong template.
  const heatDays = await learning.getLearningActivityTimeline(ownerId, 105);
  const heatWeeks = [];
  for (let i = 0; i < heatDays.length; i += 7) heatWeeks.push(heatDays.slice(i, i + 7));
  // Mốc thưởng chuỗi (7/30/100 ngày) — phát 1 lần mỗi mốc, hiện banner khi vừa nhận.
  const rewardsGranted = await streakRewards.claimDueRewards(ownerId, streak.days || 0);
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
    heatmap_weeks: heatWeeks,
    streak_rewards_granted: rewardsGranted,
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
  const searchQ = String(req.query.q || "").trim();
  let where = "owner_user_id=?";
  const whereParams = [ownerId];
  if (searchQ) {
    where += " AND (korean ILIKE ? OR meaning_vi ILIKE ? OR explanation_vi ILIKE ? OR example_kr ILIKE ? OR example_vi ILIKE ?)";
    const like = `%${searchQ}%`;
    whereParams.push(like, like, like, like, like);
  }
  const rows = await db.query(`SELECT * FROM vocab WHERE ${where} ORDER BY learned ASC, created_at DESC, id DESC`, whereParams);
  const filteredTotal = Number(await db.scalar(`SELECT COUNT(*) FROM vocab WHERE ${where}`, whereParams));
  const total = Number(await db.scalar("SELECT COUNT(*) FROM vocab WHERE owner_user_id=?", [ownerId]));
  const learnedCount = Number(await db.scalar("SELECT COUNT(*) FROM vocab WHERE owner_user_id=? AND learned=TRUE", [ownerId]));
  res.render("vocab.html", {
    vocab: rows,
    flashcard_vocab: rows.map((row) => ({
      id: row.id,
      korean: row.korean || "",
      meaning_vi: row.meaning_vi || "",
      explanation_vi: row.explanation_vi || "",
      example_kr: row.example_kr || "",
      example_vi: row.example_vi || "",
      tts_text: row.tts_text || row.korean || "",
      learned: Boolean(row.learned),
      created_at: row.created_at || "",
      source: row.source || ""
    })),
    count: total,
    learned_count: learnedCount,
    unlearned_count: total - learnedCount,
    shelf_total: filteredTotal,
    search_q: searchQ,
    vocab_groups: await groups.getGroups(ownerId),
    vocab_group_map: await groups.getAssignments(ownerId),
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

router.post("/listening-practice/generate", aiLimiter, ...named("generate_listening_practice", loginRequired, asyncHandler(async (req, res) => {
  const wantsJson = req.is("application/json");
  try {
    const status = await energy.hasEnoughEnergy(req.currentUser.id, 10);
    if (!status.ok) return wantsJson ? res.status(402).json({ success: false, error: "Không đủ Sun ☀️. Chờ hồi hoặc mở ví Sun trên topbar để nhận thêm.", energy: status.status, required_energy: 10 }) : res.redirect(`/listening-practice?error=${encodeURIComponent("Không đủ Sun ☀️. Chờ hồi hoặc mở ví Sun trên topbar để nhận thêm.")}`);
    const lesson = await listening.createLesson(db, wantsJson ? req.body : req.body, req.currentUser.id);
    const spent = await energy.spendEnergy(req.currentUser.id, 10, "generate_listening_practice", lesson.id);
    if (!spent.ok) return wantsJson ? res.status(402).json({ success: false, error: "Không đủ Sun ☀️. Chờ hồi hoặc mở ví Sun trên topbar để nhận thêm.", energy: spent.status, required_energy: 10 }) : res.redirect(`/listening-practice?error=${encodeURIComponent("Không đủ Sun ☀️. Chờ hồi hoặc mở ví Sun trên topbar để nhận thêm.")}`);
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
  // SRS due-first: từ chưa từng ôn (srs_due NULL) và từ quá hạn lên trước, trong nhóm trộn ngẫu nhiên.
  const quizWords = await db.query(
    `SELECT * FROM vocab WHERE owner_user_id=? AND learned=FALSE
     ORDER BY CASE WHEN srs_due IS NULL THEN 0 WHEN srs_due <= NOW() THEN 1 ELSE 2 END, RANDOM()
     LIMIT ?`,
    [ownerId, learning.QUIZ_SESSION_LIMIT]
  );
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

router.get("/daily", ...named("daily", loginRequired, asyncHandler(async (req, res) => {
  // Đoạn văn của ngày (mặc định hôm nay; ?date=YYYY-MM-DD để xem lại ngày cũ).
  // Chưa có đoạn của HÔM NAY → trang tự tạo bằng AI (client fetch); ngày cũ chỉ xem.
  const today = daily.todayStr();
  const requested = daily.isValidDateStr(req.query.date) ? String(req.query.date) : today;
  const viewDate = requested > today ? today : requested;
  const [passage, recentDates] = await Promise.all([
    daily.getPassageForDate(req.currentUser.id, viewDate),
    daily.listRecentDates(req.currentUser.id, 14)
  ]);
  res.render("daily.html", {
    daily_data: passage,
    daily_view: {
      date: viewDate,
      is_today: viewDate === today,
      today,
      // label dd/mm dựng sẵn ở đây vì Nunjucks không slice chuỗi được
      recent_dates: recentDates.map((d) => ({ date: d, label: d === today ? "Hôm nay" : `${d.slice(8, 10)}/${d.slice(5, 7)}` }))
    }
  });
})));

router.get("/hangul", ...named("hangul", loginRequired, (req, res) => res.render("hangul.html")));

router.get("/chuyen-nganh", ...named("specialties", loginRequired, asyncHandler(async (req, res) => {
  // Hub chọn chuyên ngành. Ngành available kèm tiến độ user.
  const userId = req.currentUser.id;
  const cards = await Promise.all(SPECIALTIES.map(async (s) => {
    if (!s.available) return { ...s };
    const stats = await itTerms.userStats(userId, s.domain);
    return { ...s, learned: stats.learned, favorite: stats.favorite };
  }));
  res.render("specialties.html", { specialties: cards });
})));

// Trang duyệt từ vựng của MỘT chuyên ngành (tổng quát theo domain). Trả sẵn 40 mục đầu; còn lại
// tải dần qua /api/it-terms?domain=… (infinite scroll). Lọc: tất cả / đã học / yêu thích.
router.get("/chuyen-nganh/:slug", ...named("specialty_vocab", loginRequired, asyncHandler(async (req, res) => {
  const spec = getSpecialty(req.params.slug);
  if (!spec) return res.redirect("/chuyen-nganh");
  const userId = req.currentUser.id;
  const filter = ["all", "learned", "favorite"].includes(req.query.filter) ? req.query.filter : "all";
  const q = String(req.query.q || "").slice(0, 80);
  const [terms, total, stats] = await Promise.all([
    itTerms.searchTerms({ userId, domain: spec.domain, q, filter, offset: 0, limit: 40 }),
    itTerms.countTerms({ userId, domain: spec.domain, q, filter }),
    itTerms.userStats(userId, spec.domain),
  ]);
  res.render("specialty-vocab.html", { spec, it_initial: terms, it_total: total, it_query: q, it_filter: filter, it_stats: stats });
})));

// Đường cũ /it-vocab → chuyển hướng sang route tổng quát (giữ link cũ hoạt động).
router.get("/it-vocab", ...named("it_vocab", loginRequired, (req, res) => res.redirect("/chuyen-nganh/cntt")));

router.get("/writing", ...named("writing", loginRequired, asyncHandler(async (req, res) => {
  const submissions = await writing.listSubmissions(req.currentUser.id, 5);
  res.render("writing.html", { writing_topics: writing.WRITING_TOPICS, submissions });
})));

router.get("/speak", ...named("speak", loginRequired, asyncHandler(async (req, res) => {
  // Câu luyện nói: câu ví dụ trong từ vựng của user; thiếu thì bù câu mặc định.
  const rows = await db.query(
    `SELECT example_kr, example_vi FROM vocab
     WHERE owner_user_id=? AND example_kr IS NOT NULL AND TRIM(example_kr) != ''
     ORDER BY created_at DESC, id DESC LIMIT 10`,
    [req.currentUser.id]
  );
  const defaults = [
    { kr: "안녕하세요. 만나서 반갑습니다.", vi: "Xin chào. Rất vui được gặp bạn." },
    { kr: "저는 한국어를 공부하고 있어요.", vi: "Tôi đang học tiếng Hàn." },
    { kr: "오늘 날씨가 정말 좋네요.", vi: "Hôm nay thời tiết đẹp thật." },
    { kr: "이거 얼마예요?", vi: "Cái này bao nhiêu tiền?" },
    { kr: "천천히 말씀해 주세요.", vi: "Xin hãy nói chậm thôi ạ." }
  ];
  const sentences = rows.map((r) => ({ kr: r.example_kr, vi: r.example_vi || "" })).concat(defaults).slice(0, 12);
  res.render("speak.html", { speak_sentences: sentences });
})));

router.get("/shadowing", ...named("shadowing", loginRequired, asyncHandler(async (req, res) => {
  // Shadowing: nghe câu → nhại theo → máy chấm độ giống. Nguồn câu: ví dụ trong từ vựng
  // của user + đoạn "Học hôm nay" (nếu có) + câu mặc định — trộn, bỏ trùng, tối đa 20 câu.
  const ownerId = req.currentUser.id;
  const rows = await db.query(
    `SELECT example_kr, example_vi FROM vocab
     WHERE owner_user_id=? AND example_kr IS NOT NULL AND TRIM(example_kr) != ''
     ORDER BY created_at DESC, id DESC LIMIT 10`,
    [ownerId]
  );
  const sentences = rows.map((r) => ({ kr: String(r.example_kr).trim(), vi: String(r.example_vi || "").trim() }));
  const passage = await daily.getPassageForDate(ownerId, daily.todayStr()).catch(() => null);
  if (passage && passage.korean_text && passage.vietnamese_text) {
    const krLines = String(passage.korean_text).split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const viLines = String(passage.vietnamese_text).split(/\n+/).map((s) => s.trim()).filter(Boolean);
    krLines.forEach((kr, i) => sentences.push({ kr, vi: viLines[i] || "" }));
  }
  const defaults = [
    { kr: "안녕하세요. 만나서 반갑습니다.", vi: "Xin chào. Rất vui được gặp bạn." },
    { kr: "저는 한국어를 공부하고 있어요.", vi: "Tôi đang học tiếng Hàn." },
    { kr: "천천히 말씀해 주세요.", vi: "Xin hãy nói chậm thôi ạ." },
  ];
  const seen = new Set();
  const deck = sentences.concat(defaults)
    .filter((s) => s.kr && !seen.has(s.kr) && seen.add(s.kr))
    .slice(0, 20);
  res.render("shadowing.html", { shadow_deck: deck });
})));

router.get("/topik", ...named("topik", loginRequired, asyncHandler(async (req, res) => {
  const ownerId = req.currentUser.id;
  const rows = await db.query("SELECT * FROM grammar WHERE owner_user_id=? ORDER BY created_at DESC, id DESC", [ownerId]);
  // Đếm số câu hỏi khả dụng theo cấp độ để hiện chip chọn cấp.
  const deckAll = learning.buildGrammarQuizDeck(rows);
  const byLevel = {};
  for (const row of rows) {
    const level = String(row.level || "general").toLowerCase();
    byLevel[level] = byLevel[level] || 0;
  }
  for (const item of deckAll) {
    const level = String(item.level || "general").toLowerCase();
    byLevel[level] = (byLevel[level] || 0) + 1;
  }
  const requested = String(req.query.level || "").toLowerCase();
  const valid = /^topik[1-6]$|^general$/.test(requested) ? requested : "";
  const deck = valid ? deckAll.filter((q) => String(q.level || "general").toLowerCase() === valid) : [];
  res.render("topik.html", {
    topik_levels: Object.entries(byLevel).map(([level, count]) => ({ level, count })).sort((a, b) => a.level.localeCompare(b.level)),
    topik_selected: valid,
    topik_deck: deck.slice(0, 10),
    topik_total_available: deck.length
  });
})));

router.get("/settings", ...named("settings", adminRequired, (req, res) => {
  const config = settings.getConfig();
  res.render("settings.html", { config, has_api_key: Boolean(config.api_key) });
}));

module.exports = router;
