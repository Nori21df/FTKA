const express = require("express");
const fs = require("fs");
const path = require("path");
const db = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const { named } = require("../middleware/viewContext");
const { adminRequired } = require("../middleware/auth");
const admin = require("../services/adminService");
const tts = require("../services/ttsService");
const groups = require("../services/vocabGroupService");
const sepay = require("../services/sepay.service");
const aiLogService = require("../services/aiLogService");

const router = express.Router();

const unavailable = {
  writing: ["Bài viết", "Chưa có bảng bài viết hoặc dịch vụ chấm bài trong mã nguồn hiện tại."],
  energy: ["Năng lượng", "Chưa có bảng năng lượng hoặc dịch vụ năng lượng."],
  transactions: ["Giao dịch", "Chưa có bảng giao dịch năng lượng hoặc tiền."],
  purchases: ["Thanh toán", "Chưa cấu hình hệ thống thanh toán."],
  streaks: ["Chuỗi học", "Hiện chỉ có hoạt động học từ vựng toàn cục, chưa có bảng chuỗi học theo người dùng."],
  ai_usage: ["Nhật ký AI", "Chưa có bảng nhật ký sử dụng AI."]
};

function renderUnavailable(res, key) {
  const [title, explanation] = unavailable[key];
  return res.render("admin/unavailable.html", { title, explanation });
}

function adminId(req) {
  return req.currentUser ? req.currentUser.id : null;
}

router.use(adminRequired);

router.get("/", ...named("admin.dashboard", asyncHandler(async (req, res) => {
  res.render("admin/dashboard.html", {
    stats: await admin.getDashboardStats(),
    recent_errors: await admin.getRecentErrors()
  });
})));

router.get("/users", ...named("admin.users", asyncHandler(async (req, res) => {
  const [users, pageInfo] = await admin.listUsers(req.query);
  res.render("admin/users.html", { users, page_info: pageInfo });
})));

router.get("/users/:user_id", ...named("admin.user_detail", asyncHandler(async (req, res) => {
  const user = await admin.getUserDetail(req.params.user_id);
  if (!user) return res.status(404).send("Not found");
  res.render("admin/user_detail.html", { user });
})));

router.post("/users/:user_id/ban", ...named("admin.ban_user", asyncHandler(async (req, res) => {
  if (Number(req.params.user_id) === Number(adminId(req))) {
    req.flash("error", "Bạn không thể khoá chính tài khoản quản trị của mình.");
    return res.redirect(`/admin/users/${req.params.user_id}`);
  }
  await db.withClient(async (clientDb) => {
    await clientDb.begin();
    const [oldValue, newValue] = await admin.updateUserStatus(req.params.user_id, "banned", clientDb);
    if (!oldValue) throw new Error("Not found");
    await admin.logAdminAction(clientDb, adminId(req), "user_ban", "user", req.params.user_id, oldValue, newValue);
    await clientDb.commit();
  });
  req.flash("success", "Đã khoá người dùng.");
  res.redirect(`/admin/users/${req.params.user_id}`);
})));

router.post("/users/:user_id/unban", ...named("admin.unban_user", asyncHandler(async (req, res) => {
  await db.withClient(async (clientDb) => {
    await clientDb.begin();
    const [oldValue, newValue] = await admin.updateUserStatus(req.params.user_id, "active", clientDb);
    if (!oldValue) throw new Error("Not found");
    await admin.logAdminAction(clientDb, adminId(req), "user_unban", "user", req.params.user_id, oldValue, newValue);
    await clientDb.commit();
  });
  req.flash("success", "Đã mở khoá người dùng.");
  res.redirect(`/admin/users/${req.params.user_id}`);
})));

router.post("/users/:user_id/energy/add", ...named("admin.add_user_energy", (req, res) => {
  req.flash("error", "Tính năng chưa khả dụng: chưa có dịch vụ năng lượng.");
  res.redirect(`/admin/users/${req.params.user_id}`);
}));
router.post("/users/:user_id/energy/subtract", ...named("admin.subtract_user_energy", (req, res) => {
  req.flash("error", "Tính năng chưa khả dụng: chưa có dịch vụ năng lượng.");
  res.redirect(`/admin/users/${req.params.user_id}`);
}));
router.post("/users/:user_id/streak/reset", ...named("admin.reset_user_streak", (req, res) => {
  req.flash("error", "Tính năng chưa khả dụng: chưa có bảng chuỗi học theo người dùng.");
  res.redirect(`/admin/users/${req.params.user_id}`);
}));

router.get("/users/:user_id/vocab", ...named("admin.user_vocab", (req, res) => res.render("admin/unavailable.html", { title: "Từ vựng của người dùng", explanation: "Từ vựng hiện đã được lưu theo tài khoản trong ứng dụng. Trang quản trị chi tiết theo người dùng sẽ được bổ sung sau." })));
router.get("/users/:user_id/writing", ...named("admin.user_writing", (req, res) => renderUnavailable(res, "writing")));
router.get("/users/:user_id/listening", ...named("admin.user_listening", (req, res) => res.render("admin/unavailable.html", { title: "Bài nghe của người dùng", explanation: "Bài nghe hiện đã được lưu theo tài khoản trong ứng dụng. Trang quản trị chi tiết theo người dùng sẽ được bổ sung sau." })));
router.get("/users/:user_id/energy", ...named("admin.user_energy", (req, res) => renderUnavailable(res, "energy")));
router.get("/users/:user_id/streak", ...named("admin.user_streak", (req, res) => renderUnavailable(res, "streaks")));

router.get("/vocab", ...named("admin.vocab", asyncHandler(async (req, res) => {
  const [rows, pageInfo, sources] = await admin.listVocab(req.query);
  res.render("admin/vocab.html", { vocab: rows, page_info: pageInfo, sources });
})));

router.get("/vocab/:vocab_id", ...named("admin.vocab_detail", asyncHandler(async (req, res) => {
  const item = await admin.getVocab(req.params.vocab_id);
  if (!item) return res.status(404).send("Not found");
  res.render("admin/vocab_detail.html", { item });
})));

router.post("/vocab/:vocab_id/update", ...named("admin.update_vocab", asyncHandler(async (req, res) => {
  await db.withClient(async (clientDb) => {
    await clientDb.begin();
    const [oldValue, newValue] = await admin.updateVocab(req.params.vocab_id, req.body, clientDb);
    if (!oldValue) throw new Error("Not found");
    await admin.logAdminAction(clientDb, adminId(req), "vocab_update", "vocab", req.params.vocab_id, oldValue, newValue, req.body.reason);
    await clientDb.commit();
  });
  await groups.exportGroupsForVocab(req.params.vocab_id);
  req.flash("success", "Đã cập nhật từ vựng.");
  res.redirect(`/admin/vocab/${encodeURIComponent(req.params.vocab_id)}`);
})));

router.post("/vocab/:vocab_id/delete", ...named("admin.delete_vocab", asyncHandler(async (req, res) => {
  let groupIds = [];
  await db.withClient(async (clientDb) => {
    await clientDb.begin();
    const [oldValue, ids] = await admin.deleteVocab(req.params.vocab_id, clientDb);
    if (!oldValue) throw new Error("Not found");
    groupIds = ids;
    await admin.logAdminAction(clientDb, adminId(req), "vocab_delete", "vocab", req.params.vocab_id, oldValue, null, req.body.reason);
    await clientDb.commit();
  });
  for (const id of groupIds) await groups.exportSnapshot(id);
  req.flash("success", "Đã xoá từ vựng.");
  res.redirect("/admin/vocab");
})));

router.get("/grammar", ...named("admin.grammar", asyncHandler(async (req, res) => {
  const [rows, pageInfo] = await admin.listGrammar(req.query);
  res.render("admin/grammar.html", { grammar: rows, page_info: pageInfo });
})));

router.get("/activity", ...named("admin.activity", asyncHandler(async (req, res) => {
  const [rows, pageInfo] = await admin.listLearningActivity(req.query);
  res.render("admin/activity.html", { activities: rows, page_info: pageInfo });
})));

router.get("/writing", ...named("admin.writing", (req, res) => renderUnavailable(res, "writing")));
router.get("/writing/:submission_id", ...named("admin.writing_detail", (req, res) => renderUnavailable(res, "writing")));
router.post("/writing/:submission_id/delete", ...named("admin.writing_delete", (req, res) => {
  req.flash("error", "Tính năng chưa khả dụng: chưa có bảng bài viết.");
  res.redirect("/admin/writing");
}));
router.post("/writing/:submission_id/regrade", ...named("admin.writing_regrade", (req, res) => {
  req.flash("error", "Tính năng chưa khả dụng: chưa có dịch vụ chấm bài viết.");
  res.redirect("/admin/writing");
}));

router.get("/listening", ...named("admin.listening", asyncHandler(async (req, res) => {
  const [rows, pageInfo] = await admin.listListening(req.query);
  res.render("admin/listening.html", { lessons: rows, page_info: pageInfo });
})));

router.get("/listening/:lesson_id", ...named("admin.listening_detail", asyncHandler(async (req, res) => {
  const lesson = await admin.getListeningLesson(req.params.lesson_id);
  if (!lesson) return res.status(404).send("Not found");
  const [audioExists, audioSize] = admin.audioPathExists(tts.audioDir(), lesson.audio_path);
  res.render("admin/listening_detail.html", { lesson, audio_exists: audioExists, audio_size: audioSize });
})));

router.post("/listening/:lesson_id/delete", ...named("admin.delete_listening", asyncHandler(async (req, res) => {
  await db.withClient(async (clientDb) => {
    await clientDb.begin();
    const oldValue = await admin.deleteListeningLesson(req.params.lesson_id, clientDb);
    if (!oldValue) throw new Error("Not found");
    await admin.logAdminAction(clientDb, adminId(req), "listening_delete", "listening_practice", req.params.lesson_id, oldValue, null, req.body.reason);
    await clientDb.commit();
  });
  req.flash("success", "Đã xoá bài nghe.");
  res.redirect("/admin/listening");
})));

router.post("/listening/:lesson_id/regenerate-audio", ...named("admin.regenerate_listening_audio", asyncHandler(async (req, res) => {
  const lesson = await admin.getListeningLesson(req.params.lesson_id);
  if (!lesson) return res.status(404).send("Not found");
  if (!String(lesson.korean_text || "").trim()) {
    req.flash("error", "Không thể tạo lại âm thanh vì thiếu văn bản tiếng Hàn.");
    return res.redirect(`/admin/listening/${req.params.lesson_id}`);
  }
  const audioPath = await tts.generateAudio(lesson.korean_text);
  const filename = tts.filenameForPath(audioPath);
  await db.withClient(async (clientDb) => {
    await clientDb.begin();
    const [oldValue, newValue] = await admin.updateListeningAudio(req.params.lesson_id, filename, "", clientDb);
    await admin.logAdminAction(clientDb, adminId(req), "listening_audio_regenerate", "listening_practice", req.params.lesson_id, oldValue, newValue, req.body.reason);
    await clientDb.commit();
  });
  req.flash("success", "Đã tạo lại âm thanh bài nghe.");
  res.redirect(`/admin/listening/${req.params.lesson_id}`);
})));

router.get("/audio", ...named("admin.audio", asyncHandler(async (req, res) => {
  res.render("admin/audio.html", { records: await admin.listAudioRecords(tts.audioDir()) });
})));

router.post("/audio/:audio_reference/delete", ...named("admin.delete_audio", asyncHandler(async (req, res) => {
  const audioReference = req.params.audio_reference;
  if (!audioReference.startsWith("listening:")) return res.status(404).send("Not found");
  const lessonId = audioReference.split(":", 2)[1];
  const lesson = await admin.getListeningLesson(lessonId);
  if (!lesson) return res.status(404).send("Not found");
  const filename = admin.audioFilenameFromReference(lesson.audio_path);
  let removed = false;
  if (filename) {
    const full = path.resolve(tts.audioDir(), filename);
    if (path.dirname(full) === path.resolve(tts.audioDir()) && fs.existsSync(full)) {
      fs.unlinkSync(full);
      removed = true;
    }
  }
  await db.withClient(async (clientDb) => {
    await clientDb.begin();
    const [oldValue, newValue] = await admin.updateListeningAudio(lessonId, "", "Âm thanh đã bị quản trị viên xoá.", clientDb);
    await admin.logAdminAction(clientDb, adminId(req), "audio_delete", "listening_practice", lessonId, oldValue, { removed_file: removed, record: newValue }, req.body.reason);
    await clientDb.commit();
  });
  req.flash("success", "Đã xoá tham chiếu âm thanh và tệp nếu tồn tại.");
  res.redirect("/admin/audio");
})));

router.get("/energy", ...named("admin.energy", (req, res) => renderUnavailable(res, "energy")));
router.get("/transactions", ...named("admin.transactions", (req, res) => renderUnavailable(res, "transactions")));
router.get("/purchases", ...named("admin.purchases", asyncHandler(async (req, res) => {
  res.render("admin/payment_debug.html", await sepay.getAdminPaymentDebug());
})));
router.post("/purchases/:orderId/cancel", ...named("admin.cancel_purchase", asyncHandler(async (req, res) => {
  try {
    const order = await sepay.cancelAdminOrder(req.params.orderId, adminId(req), req.body.reason);
    return res.json({ success: true, order });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, error: error.message });
  }
})));
router.post("/purchases/:orderId/delete", ...named("admin.delete_purchase", asyncHandler(async (req, res) => {
  try {
    const order = await sepay.deleteAdminOrder(req.params.orderId, adminId(req));
    return res.json({ success: true, order });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, error: error.message });
  }
})));
router.get("/streaks", ...named("admin.streaks", (req, res) => renderUnavailable(res, "streaks")));
router.get("/ai-usage", ...named("admin.ai_usage", (req, res) => renderUnavailable(res, "ai_usage")));

router.get("/ai-logs", ...named("admin.ai_logs", (req, res) => {
  res.render("admin/ai_logs.html", { logs: aiLogService.listAiLogs(req.query), query: req.query });
}));

router.get("/ai-logs.json", ...named("admin.ai_logs_json", (req, res) => {
  res.json({ logs: aiLogService.listAiLogs(req.query) });
}));

router.get("/ai-logs/stream", ...named("admin.ai_logs_stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  req.socket?.setTimeout(0);
  req.socket?.setNoDelay?.(true);
  res.flushHeaders?.();
  let closed = false;
  const safeWrite = (chunk) => {
    if (closed || res.destroyed || res.writableEnded) return false;
    try { return res.write(chunk); } catch { closed = true; return false; }
  };
  const send = (event, data) => safeWrite(`event: ${event}\ndata: ${JSON.stringify(data || {})}\n\n`);
  safeWrite(": connected\n\n");
  const unsubscribe = aiLogService.subscribeAiLogs((payload) => {
    if (payload.event === "log") send("ai-log", payload.log);
    if (payload.event === "clear") send("ai-clear", {});
  });
  const heartbeat = setInterval(() => safeWrite(": heartbeat\n\n"), 15000);
  req.on("close", () => {
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  });
}));

router.post("/ai-logs/test", ...named("admin.ai_logs_test", (req, res) => {
  const log = aiLogService.addAiLog({
    type: "test",
    status: "progress",
    message: "Realtime SSE test log",
    model: "manual-test"
  });
  res.json({ success: true, log });
}));

router.post("/ai-logs/clear", ...named("admin.ai_logs_clear", (req, res) => {
  aiLogService.clearAiLogs();
  req.flash("success", "AI logs cleared.");
  res.redirect("/admin/ai-logs");
}));

router.get("/logs", ...named("admin.logs", asyncHandler(async (req, res) => {
  const [rows, pageInfo] = await admin.listAdminLogs(req.query);
  res.render("admin/logs.html", { logs: rows, page_info: pageInfo });
})));

module.exports = router;
