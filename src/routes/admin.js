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
const activityLogService = require("../services/activityLogService");

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

function flashSaved(req) { req.flash("success", "Đã lưu thay đổi"); }
function flashDeleted(req) { req.flash("success", "Đã xoá thành công"); }
function flashNotFound(req) { req.flash("warning", "Không tìm thấy dữ liệu"); }
function flashDenied(req) { req.flash("error", "Bạn không có quyền thực hiện thao tác này"); }
function flashGenericError(req) { req.flash("error", "Có lỗi xảy ra, vui lòng thử lại"); }

function sendNotFound(req, res, fallback) {
  if (fallback) return redirectNotFound(req, res, fallback);
  flashNotFound(req);
  return res.status(404).render("admin/unavailable.html", { title: "Không tìm thấy dữ liệu", explanation: "Không tìm thấy dữ liệu" });
}

function redirectNotFound(req, res, fallback = "/admin") {
  flashNotFound(req);
  return res.redirect(fallback);
}

function backTo(req, fallback) {
  try {
    const url = new URL(req.get("referer"), `${req.protocol}://${req.get("host")}`);
    if (url.pathname.startsWith("/admin")) return url.pathname + url.search;
  } catch (error) { /* fall through */ }
  return fallback;
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
  if (!user) return redirectNotFound(req, res, "/admin/users");
  res.render("admin/user_detail.html", { user });
})));

router.post("/users/:user_id/ban", ...named("admin.ban_user", asyncHandler(async (req, res) => {
  if (Number(req.params.user_id) === Number(adminId(req))) {
    flashDenied(req);
    return res.redirect(`/admin/users/${req.params.user_id}`);
  }
  await db.withClient(async (clientDb) => {
    await clientDb.begin();
    const [oldValue, newValue] = await admin.updateUserStatus(req.params.user_id, "banned", clientDb);
    if (!oldValue) throw new Error("Not found");
    await admin.logAdminAction(clientDb, adminId(req), "user_ban", "user", req.params.user_id, oldValue, newValue);
    await clientDb.commit();
  });
  flashSaved(req);
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
  flashSaved(req);
  res.redirect(`/admin/users/${req.params.user_id}`);
})));

router.post("/users/:user_id/energy/add", ...named("admin.add_user_energy", (req, res) => {
  flashGenericError(req);
  res.redirect(`/admin/users/${req.params.user_id}`);
}));

router.get("/users/:user_id/edit", ...named("admin.edit_user", asyncHandler(async (req, res) => {
  const user = await admin.getUserDetail(req.params.user_id);
  if (!user) return redirectNotFound(req, res, "/admin/users");
  res.render("admin/user_edit.html", { user });
})));

router.post("/users/:user_id/edit", ...named("admin.update_user", asyncHandler(async (req, res) => {
  if (Number(req.params.user_id) === Number(adminId(req)) && req.body.role !== "admin") {
    flashDenied(req);
    return res.redirect(`/admin/users/${req.params.user_id}/edit`);
  }
  await db.withClient(async (clientDb) => {
    await clientDb.begin();
    const [oldValue, newValue] = await admin.updateUser(req.params.user_id, req.body, clientDb);
    if (!oldValue) throw new Error("Not found");
    await admin.logAdminAction(clientDb, adminId(req), "user_update", "user", req.params.user_id, oldValue, newValue, req.body.reason);
    await clientDb.commit();
  });
  flashSaved(req);
  res.redirect(`/admin/users/${req.params.user_id}`);
})));

router.post("/users/:user_id/delete", ...named("admin.delete_user", asyncHandler(async (req, res) => {
  if (Number(req.params.user_id) === Number(adminId(req))) {
    flashDenied(req);
    return res.redirect(`/admin/users/${req.params.user_id}`);
  }
  await db.withClient(async (clientDb) => {
    await clientDb.begin();
    const oldValue = await admin.deleteUser(req.params.user_id, clientDb);
    if (!oldValue) throw new Error("Not found");
    await admin.logAdminAction(clientDb, adminId(req), "user_delete", "user", req.params.user_id, oldValue, null, req.body.reason);
    await clientDb.commit();
  });
  flashDeleted(req);
  res.redirect("/admin/users");
})));
router.post("/users/:user_id/energy/subtract", ...named("admin.subtract_user_energy", (req, res) => {
  flashGenericError(req);
  res.redirect(`/admin/users/${req.params.user_id}`);
}));
router.post("/users/:user_id/streak/reset", ...named("admin.reset_user_streak", (req, res) => {
  flashGenericError(req);
  res.redirect(`/admin/users/${req.params.user_id}`);
}));

router.get("/users/:user_id/vocab", ...named("admin.user_vocab", asyncHandler(async (req, res) => {
  const user = await admin.getUserDetail(req.params.user_id); if (!user) return sendNotFound(req, res, "/admin/users");
  const [vocab, pageInfo, sources] = await admin.listVocab({ ...req.query, user_id: user.id });
  res.render("admin/user_items.html", { user, title: "Quản lý từ vựng", items: vocab, page_info: pageInfo, page_base: `/admin/users/${user.id}/vocab`, col1: "Tiếng Hàn", col1_key: "korean", col2: "Nghĩa", col2_key: "meaning_vi", edit_endpoint: "admin.user_vocab_edit", delete_endpoint: "admin.user_vocab_delete" });
})));
router.get("/users/:user_id/vocab/:id/edit", ...named("admin.user_vocab_edit", asyncHandler(async (req, res) => {
  const user = await admin.getUserDetail(req.params.user_id); const item = user && await admin.getUserVocab(user.id, req.params.id);
  if (!item) return sendNotFound(req, res, `/admin/users/${req.params.user_id}/vocab`); res.render("admin/user_vocab_edit.html", { user, item });
})));
router.post("/users/:user_id/vocab/:id/edit", ...named("admin.user_vocab_update", asyncHandler(async (req, res) => {
  let groupIds = [];
  await db.withClient(async (clientDb) => { await clientDb.begin(); const [oldValue, newValue] = await admin.updateUserVocab(req.params.user_id, req.params.id, req.body, clientDb); if (!oldValue) throw new Error("Not found"); await admin.logAdminAction(clientDb, adminId(req), "user_vocab_update", "vocab", req.params.id, oldValue, newValue, req.body.reason); await clientDb.commit(); });
  await groups.exportGroupsForVocab(req.params.id); flashSaved(req); res.redirect(`/admin/users/${req.params.user_id}/vocab`);
})));
router.post("/users/:user_id/vocab/:id/delete", ...named("admin.user_vocab_delete", asyncHandler(async (req, res) => {
  let groupIds = [];
  await db.withClient(async (clientDb) => { await clientDb.begin(); const [oldValue, ids] = await admin.deleteUserVocab(req.params.user_id, req.params.id, clientDb); if (!oldValue) throw new Error("Not found"); groupIds = ids; await admin.logAdminAction(clientDb, adminId(req), "user_vocab_delete", "vocab", req.params.id, oldValue, null, req.body.reason); await clientDb.commit(); });
  for (const id of groupIds) await groups.exportSnapshot(id); flashDeleted(req); res.redirect(backTo(req, `/admin/users/${req.params.user_id}/vocab`));
})));
router.get("/users/:user_id/grammar", ...named("admin.user_grammar", asyncHandler(async (req, res) => { const user = await admin.getUserDetail(req.params.user_id); if (!user) return sendNotFound(req, res, "/admin/users"); const [grammar, pageInfo] = await admin.listGrammar({ ...req.query, user_id: user.id }); res.render("admin/user_items.html", { user, title: "Quản lý ngữ pháp", items: grammar, page_info: pageInfo, page_base: `/admin/users/${user.id}/grammar`, col1: "Ngữ pháp", col1_key: "grammar", col2: "Nghĩa", col2_key: "meaning_vi", edit_endpoint: "admin.user_grammar_edit", delete_endpoint: "admin.user_grammar_delete" }); })));
router.get("/users/:user_id/grammar/:id/edit", ...named("admin.user_grammar_edit", asyncHandler(async (req, res) => { const user = await admin.getUserDetail(req.params.user_id); const item = user && await admin.getUserGrammar(user.id, req.params.id); if (!item) return sendNotFound(req, res, `/admin/users/${req.params.user_id}/grammar`); res.render("admin/user_grammar_edit.html", { user, item }); })));
router.post("/users/:user_id/grammar/:id/edit", ...named("admin.user_grammar_update", asyncHandler(async (req, res) => { await db.withClient(async (clientDb) => { await clientDb.begin(); const [oldValue, newValue] = await admin.updateUserGrammar(req.params.user_id, req.params.id, req.body, clientDb); if (!oldValue) throw new Error("Not found"); await admin.logAdminAction(clientDb, adminId(req), "user_grammar_update", "grammar", req.params.id, oldValue, newValue, req.body.reason); await clientDb.commit(); }); flashSaved(req); res.redirect(`/admin/users/${req.params.user_id}/grammar`); })));
router.post("/users/:user_id/grammar/:id/delete", ...named("admin.user_grammar_delete", asyncHandler(async (req, res) => { await db.withClient(async (clientDb) => { await clientDb.begin(); const oldValue = await admin.deleteUserGrammar(req.params.user_id, req.params.id, clientDb); if (!oldValue) throw new Error("Not found"); await admin.logAdminAction(clientDb, adminId(req), "user_grammar_delete", "grammar", req.params.id, oldValue, null, req.body.reason); await clientDb.commit(); }); flashDeleted(req); res.redirect(backTo(req, `/admin/users/${req.params.user_id}/grammar`)); })));
router.get("/users/:user_id/writing", ...named("admin.user_writing", (req, res) => renderUnavailable(res, "writing")));
router.get("/users/:user_id/listening", ...named("admin.user_listening", asyncHandler(async (req, res) => { const user = await admin.getUserDetail(req.params.user_id); if (!user) return sendNotFound(req, res, "/admin/users"); const [lessons, pageInfo] = await admin.listListening({ ...req.query, user_id: user.id }); res.render("admin/user_items.html", { user, title: "Quản lý nghe", items: lessons, page_info: pageInfo, page_base: `/admin/users/${user.id}/listening`, col1: "Tiêu đề", col1_key: "title", col2: "Chủ đề", col2_key: "topic", edit_endpoint: "admin.user_listening_edit", delete_endpoint: "admin.user_listening_delete" }); })));
router.get("/users/:user_id/listening/:id/edit", ...named("admin.user_listening_edit", asyncHandler(async (req, res) => { const user = await admin.getUserDetail(req.params.user_id); const lesson = user && await admin.getUserListeningLesson(user.id, req.params.id); if (!lesson) return sendNotFound(req, res, `/admin/users/${req.params.user_id}/listening`); res.render("admin/user_listening_edit.html", { user, lesson }); })));
router.post("/users/:user_id/listening/:id/edit", ...named("admin.user_listening_update", asyncHandler(async (req, res) => { await db.withClient(async (clientDb) => { await clientDb.begin(); const [oldValue, newValue] = await admin.updateUserListeningLesson(req.params.user_id, req.params.id, req.body, clientDb); if (!oldValue) throw new Error("Not found"); await admin.logAdminAction(clientDb, adminId(req), "user_listening_update", "listening_practice", req.params.id, oldValue, newValue, req.body.reason); await clientDb.commit(); }); flashSaved(req); res.redirect(`/admin/users/${req.params.user_id}/listening`); })));
router.post("/users/:user_id/listening/:id/delete", ...named("admin.user_listening_delete", asyncHandler(async (req, res) => { await db.withClient(async (clientDb) => { await clientDb.begin(); const oldValue = await admin.deleteUserListeningLesson(req.params.user_id, req.params.id, clientDb); if (!oldValue) throw new Error("Not found"); await admin.logAdminAction(clientDb, adminId(req), "user_listening_delete", "listening_practice", req.params.id, oldValue, null, req.body.reason); await clientDb.commit(); }); flashDeleted(req); res.redirect(backTo(req, `/admin/users/${req.params.user_id}/listening`)); })));
router.get("/users/:user_id/audio", ...named("admin.user_audio", asyncHandler(async (req, res) => { const user = await admin.getUserDetail(req.params.user_id); if (!user) return sendNotFound(req, res, "/admin/users"); res.render("admin/user_audio.html", { user, records: await admin.listUserAudioRecords(user.id, tts.audioDir()) }); })));
router.get("/users/:user_id/audio/:id/edit", ...named("admin.user_audio_edit", asyncHandler(async (req, res) => { const user = await admin.getUserDetail(req.params.user_id); const lesson = user && await admin.getUserListeningLesson(user.id, req.params.id); if (!lesson) return sendNotFound(req, res, `/admin/users/${req.params.user_id}/audio`); res.render("admin/user_audio_edit.html", { user, lesson }); })));
router.post("/users/:user_id/audio/:id/edit", ...named("admin.user_audio_update", asyncHandler(async (req, res) => { await db.withClient(async (clientDb) => { await clientDb.begin(); const [oldValue, newValue] = await admin.updateUserListeningAudio(req.params.user_id, req.params.id, req.body.audio_path || "", req.body.audio_error || "", clientDb); if (!oldValue) throw new Error("Not found"); await admin.logAdminAction(clientDb, adminId(req), "user_audio_update", "listening_practice", req.params.id, oldValue, newValue, req.body.reason); await clientDb.commit(); }); flashSaved(req); res.redirect(`/admin/users/${req.params.user_id}/audio`); })));
router.post("/users/:user_id/audio/:id/delete", ...named("admin.user_audio_delete", asyncHandler(async (req, res) => { const lesson = await admin.getUserListeningLesson(req.params.user_id, req.params.id); if (!lesson) return sendNotFound(req, res, `/admin/users/${req.params.user_id}/audio`); let oldValue; let newValue; await db.withClient(async (clientDb) => { await clientDb.begin(); [oldValue, newValue] = await admin.updateUserListeningAudio(req.params.user_id, req.params.id, "", "Âm thanh đã bị quản trị viên xoá.", clientDb); if (!oldValue) throw new Error("Not found"); await admin.logAdminAction(clientDb, adminId(req), "user_audio_delete", "listening_practice", req.params.id, oldValue, newValue, req.body.reason); await clientDb.commit(); }); const filename = admin.audioFilenameFromReference(lesson.audio_path); if (filename) { const full = path.resolve(tts.audioDir(), filename); if (path.dirname(full) === path.resolve(tts.audioDir()) && fs.existsSync(full)) fs.unlinkSync(full); } flashDeleted(req); res.redirect(`/admin/users/${req.params.user_id}/audio`); })));
router.get("/users/:user_id/energy", ...named("admin.user_energy", (req, res) => renderUnavailable(res, "energy")));
router.get("/users/:user_id/streak", ...named("admin.user_streak", (req, res) => renderUnavailable(res, "streaks")));

const bulkDeleteConfigs = {
  vocab: {
    action: "user_vocab_delete",
    targetType: "vocab",
    remove: async (clientDb, userId, id) => {
      const [oldValue, groupIds] = await admin.deleteUserVocab(userId, id, clientDb);
      return { oldValue, groupIds };
    }
  },
  grammar: {
    action: "user_grammar_delete",
    targetType: "grammar",
    remove: async (clientDb, userId, id) => ({ oldValue: await admin.deleteUserGrammar(userId, id, clientDb), groupIds: [] })
  },
  listening: {
    action: "user_listening_delete",
    targetType: "listening_practice",
    remove: async (clientDb, userId, id) => ({ oldValue: await admin.deleteUserListeningLesson(userId, id, clientDb), groupIds: [] })
  }
};

function userItemsBulkDelete(type) {
  const config = bulkDeleteConfigs[type];
  return asyncHandler(async (req, res) => {
    const back = backTo(req, `/admin/users/${req.params.user_id}/${type}`);
    const ids = [].concat(req.body.ids || []).map((value) => String(value).trim()).filter(Boolean);
    if (!ids.length) {
      flashGenericError(req);
      return res.redirect(back);
    }
    const groupIdSet = new Set();
    let deleted = 0;
    await db.withClient(async (clientDb) => {
      await clientDb.begin();
      for (const id of ids) {
        const { oldValue, groupIds } = await config.remove(clientDb, req.params.user_id, id);
        if (!oldValue) continue;
        groupIds.forEach((gid) => groupIdSet.add(gid));
        await admin.logAdminAction(clientDb, adminId(req), config.action, config.targetType, id, oldValue, null, req.body.reason || "Xoá hàng loạt từ trang quản trị người dùng");
        deleted += 1;
      }
      await clientDb.commit();
    });
    for (const gid of groupIdSet) await groups.exportSnapshot(gid);
    if (deleted) flashDeleted(req); else flashNotFound(req);
    res.redirect(back);
  });
}

router.post("/users/:user_id/vocab/bulk-delete", ...named("admin.user_vocab_bulk_delete", userItemsBulkDelete("vocab")));
router.post("/users/:user_id/grammar/bulk-delete", ...named("admin.user_grammar_bulk_delete", userItemsBulkDelete("grammar")));
router.post("/users/:user_id/listening/bulk-delete", ...named("admin.user_listening_bulk_delete", userItemsBulkDelete("listening")));

router.get("/vocab", ...named("admin.vocab", asyncHandler(async (req, res) => {
  const [rows, pageInfo, sources] = await admin.listVocab(req.query);
  res.render("admin/vocab.html", { vocab: rows, page_info: pageInfo, sources });
})));

router.get("/vocab/:vocab_id", ...named("admin.vocab_detail", asyncHandler(async (req, res) => {
  const item = await admin.getVocab(req.params.vocab_id);
  if (!item) return sendNotFound(req, res, "/admin/vocab");
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
  flashSaved(req);
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
  flashDeleted(req);
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

router.get("/writing", ...named("admin.writing", asyncHandler(async (req, res) => {
  const [rows, pageInfo] = await admin.listWritingSubmissions(req.query);
  res.render("admin/writing.html", { submissions: rows, page_info: pageInfo });
})));
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
  if (!lesson) return sendNotFound(req, res, "/admin/listening");
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
  flashDeleted(req);
  res.redirect("/admin/listening");
})));

router.post("/listening/:lesson_id/regenerate-audio", ...named("admin.regenerate_listening_audio", asyncHandler(async (req, res) => {
  const lesson = await admin.getListeningLesson(req.params.lesson_id);
  if (!lesson) return sendNotFound(req, res, "/admin/listening");
  if (!String(lesson.korean_text || "").trim()) {
    flashGenericError(req);
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
  flashSaved(req);
  res.redirect(`/admin/listening/${req.params.lesson_id}`);
})));

router.get("/audio", ...named("admin.audio", asyncHandler(async (req, res) => {
  res.render("admin/audio.html", { records: await admin.listAudioRecords(tts.audioDir()) });
})));

router.post("/audio/:audio_reference/delete", ...named("admin.delete_audio", asyncHandler(async (req, res) => {
  const audioReference = req.params.audio_reference;
  if (!audioReference.startsWith("listening:")) return sendNotFound(req, res, "/admin/audio");
  const lessonId = audioReference.split(":", 2)[1];
  const lesson = await admin.getListeningLesson(lessonId);
  if (!lesson) return sendNotFound(req, res, "/admin/audio");
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
  flashDeleted(req);
  res.redirect("/admin/audio");
})));

router.get("/energy", ...named("admin.energy", asyncHandler(async (req, res) => {
  const [rows, pageInfo] = await admin.listUserEnergy(req.query);
  res.render("admin/energy.html", { rows, page_info: pageInfo });
})));
router.get("/transactions", ...named("admin.transactions", asyncHandler(async (req, res) => {
  const [rows, pageInfo] = await admin.listEnergyTransactions(req.query);
  res.render("admin/transactions.html", { transactions: rows, page_info: pageInfo });
})));
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

// ── Console hoạt động realtime (hiển thị trên Bảng quản trị) ──
router.get("/activity-console.json", ...named("admin.activity_console_json", (req, res) => {
  res.json({ logs: activityLogService.listActivity(req.query) });
}));

router.get("/activity-console/stream", ...named("admin.activity_console_stream", (req, res) => {
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
  const unsubscribe = activityLogService.subscribeActivity((payload) => {
    if (payload.event === "activity") send("activity", payload.entry);
    if (payload.event === "clear") send("activity-clear", {});
  });
  const heartbeat = setInterval(() => safeWrite(": heartbeat\n\n"), 15000);
  req.on("close", () => {
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  });
}));

router.post("/activity-console/clear", ...named("admin.activity_console_clear", (req, res) => {
  activityLogService.clearActivity();
  res.json({ success: true });
}));

router.get("/logs", ...named("admin.logs", asyncHandler(async (req, res) => {
  const [rows, pageInfo] = await admin.listAdminLogs(req.query);
  res.render("admin/logs.html", { logs: rows, page_info: pageInfo });
})));

module.exports = router;
