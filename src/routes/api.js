const express = require("express");
const multer = require("multer");
const fs = require("fs");
const db = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const { named } = require("../middleware/viewContext");
const { loginRequired, adminRequired } = require("../middleware/auth");
const { aiLimiter, ttsLimiter } = require("../middleware/rateLimit");
const auth = require("../services/authService");
const ai = require("../services/aiService");
const daily = require("../services/dailyService");
const srsService = require("../services/srsService");
const writingService = require("../services/writingService");
const itTerms = require("../services/itTermsService");
const { getSpecialty } = require("../config/specialties");

// Chuẩn hoá domain từ request về một ngành available đã biết (mặc định cntt).
function resolveDomain(value) {
  const spec = getSpecialty(String(value || "").trim());
  return spec ? spec.domain : "cntt";
}
const settings = require("../services/settingsService");
const tts = require("../services/ttsService");
const learning = require("../services/learningService");
const groups = require("../services/vocabGroupService");
const energy = require("../services/energyService");
const { emitEnergyUpdate } = require("../services/energySocket");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });
const router = express.Router();

function normalizeTopic(value) {
  return String(value || "").trim();
}

function normalizeWordKey(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function parseBooleanInput(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value === null || value === undefined || value === "") return false;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return Boolean(value);
}

function parseOptionalGroupId(value) {
  if (value === null || value === undefined || value === "") return { ok: true, groupId: null };
  if (typeof value === "string" && value.trim() === "") return { ok: true, groupId: null };
  if (typeof value === "string" && value.trim().toLowerCase() === "null") return { ok: true, groupId: null };
  const groupId = Number(value);
  if (!Number.isInteger(groupId) || groupId <= 0) return { ok: false, groupId: null };
  return { ok: true, groupId };
}

async function getOwnedGroupOrRespond(res, groupId, ownerId) {
  if (!groupId) return null;
  const group = await db.one("SELECT id, name FROM vocab_groups WHERE id=? AND owner_user_id=?", [groupId, ownerId]);
  if (!group) {
    res.status(400).json({ error: "Vui lòng chọn thư mục hợp lệ." });
    return false;
  }
  return group;
}

function parseGeneratorCount(value) {
  const count = Number.parseInt(value || "3", 10);
  if (!Number.isFinite(count)) throw new Error("Vui lòng chọn số lượng từ hợp lệ.");
  return Math.max(1, Math.min(count, 10));
}

function wordCount(items) {
  return Math.max(1, (Array.isArray(items) ? items : []).filter((item) => item && item.korean).length);
}

async function spendOr402(res, userId, amount, reason, ref) {
  const result = await energy.spendEnergy(userId, amount, reason, ref);
  if (result.ok) { await emitEnergyUpdate(userId); return true; }
  res.status(402).json({ success: false, error: "Không đủ năng lượng. Vui lòng chờ hồi phục hoặc nhận thưởng hằng ngày.", energy: result.status, required_energy: amount });
  return false;
}

async function requireEnergyOr402(res, userId, amount) {
  const result = await energy.hasEnoughEnergy(userId, amount);
  const status = result.status;
  if (result.ok) return true;
  res.status(402).json({ success: false, error: "Không đủ năng lượng. Vui lòng chờ hồi phục hoặc nhận thưởng hằng ngày.", energy: status, required_energy: amount });
  return false;
}

router.get("/energy", loginRequired, asyncHandler(async (req, res) => {
  res.json({ success: true, energy: await energy.getEnergyStatus(req.currentUser.id) });
}));

router.get("/me/energy", loginRequired, asyncHandler(async (req, res) => {
  res.json({ success: true, energy: await energy.getEnergyStatus(req.currentUser.id) });
}));

router.post("/energy/claim-daily", loginRequired, asyncHandler(async (req, res) => {
  const result = await energy.claimDailyEnergy(req.currentUser.id);
  await emitEnergyUpdate(req.currentUser.id);
  res.status(result.ok ? 200 : 400).json({ success: result.ok, already_claimed: Boolean(result.already_claimed), energy: result.status, error: result.ok ? "" : "Bạn đã nhận thưởng năng lượng hôm nay." });
}));

router.post("/vocab_groups", loginRequired, asyncHandler(async (req, res) => {
  try {
    const group = await groups.createGroup(req.body.name, req.currentUser.id);
    res.json({ success: true, group });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}));

router.post("/vocab_groups/assign", loginRequired, asyncHandler(async (req, res) => {
  const vocabId = req.body.vocab_id;
  const groupId = Number.parseInt(req.body.group_id, 10);
  if (!vocabId) return res.status(400).json({ error: "Word id is required." });
  if (!Number.isInteger(groupId)) return res.status(400).json({ error: "Vui lòng chọn thư mục hợp lệ." });
  const ownerId = req.currentUser.id;
  const vocabRow = await db.one("SELECT id, korean FROM vocab WHERE id=? AND owner_user_id=?", [vocabId, ownerId]);
  if (!vocabRow) return res.status(404).json({ error: "Word not found." });
  const groupRow = await db.one("SELECT id, name FROM vocab_groups WHERE id=? AND owner_user_id=?", [groupId, ownerId]);
  if (!groupRow) return res.status(404).json({ error: "Custom group not found." });
  await db.run("INSERT OR IGNORE INTO vocab_group_items (group_id, vocab_id, created_at) VALUES (?, ?, ?)", [groupId, vocabId, new Date().toISOString()]);
  await groups.exportSnapshot(groupId);
  const [group] = (await groups.getGroups(ownerId)).filter((g) => Number(g.id) === groupId);
  res.json({ success: true, group, word: vocabRow.korean });
}));

router.post("/vocab_groups/delete", loginRequired, asyncHandler(async (req, res) => {
  const groupId = Number.parseInt(req.body.group_id, 10);
  if (!Number.isInteger(groupId)) return res.status(400).json({ error: "Vui lòng chọn thư mục hợp lệ." });
  const groupRow = await db.one("SELECT id, export_path FROM vocab_groups WHERE id=? AND owner_user_id=?", [groupId, req.currentUser.id]);
  if (!groupRow) return res.status(404).json({ error: "Custom group not found." });
  await db.run("DELETE FROM vocab_group_items WHERE group_id=?", [groupId]);
  await db.run("DELETE FROM vocab_groups WHERE id=?", [groupId]);
  if (groupRow.export_path && fs.existsSync(groupRow.export_path)) fs.unlinkSync(groupRow.export_path);
  res.json({ success: true });
}));

router.post("/import_vocab", loginRequired, upload.single("file"), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });
  if (!req.file.originalname.endsWith(".json")) return res.status(400).json({ error: "Only JSON files are allowed." });
  let data;
  try {
    data = JSON.parse(req.file.buffer.toString("utf8"));
  } catch (error) {
    return res.status(400).json({ error: `Không phân tích hoặc nhập được tệp JSON: ${error.message}` });
  }
  const items = Array.isArray(data) ? data : data.vocab_items;
  if (!Array.isArray(items)) return res.status(400).json({ error: "Định dạng không hợp lệ: cần JSON list hoặc object có vocab_items." });
  let imported = 0;
  for (const item of items) {
    if (!item || !item.id || !item.korean) continue;
    const duplicate = await db.one("SELECT id FROM vocab WHERE owner_user_id=? AND korean=?", [req.currentUser.id, item.korean]);
    if (duplicate) continue;
    const id = await learning.makeUniqueRecordId("vocab", item.id);
    await db.run(
      `INSERT INTO vocab (id, korean, meaning_vi, explanation_vi, example_kr, example_vi, tts_text, audio_path, quiz_type, learned, created_at, source, owner_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, item.korean, item.meaning_vi || "", item.explanation_vi || "", item.example_kr || "", item.example_vi || "", item.tts_text || item.korean, item.audio_path || "", item.quiz_type || "word", Boolean(item.learned), item.created_at || new Date().toISOString(), item.source || "import", req.currentUser.id]
    );
    imported += 1;
  }
  res.json({ success: true, count: imported });
}));

router.post("/generate", aiLimiter, loginRequired, asyncHandler(async (req, res) => {
  const topic = normalizeTopic(req.body.topic);
  if (!topic) return res.status(400).json({ error: "Vui lòng nhập chủ đề hoặc tình huống trước." });
  let count;
  try {
    count = parseGeneratorCount(req.body.count);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  const ownerId = req.currentUser.id;
  if (!(await requireEnergyOr402(res, ownerId, count))) return;
  const parsedGroup = parseOptionalGroupId(req.body.group_id);
  if (!parsedGroup.ok) return res.status(400).json({ error: "Vui lòng chọn thư mục hợp lệ." });
  const groupId = parsedGroup.groupId;
  let targetGroupName = "";
  if (groupId !== null) {
    const group = await getOwnedGroupOrRespond(res, groupId, ownerId);
    if (group === false) return;
    targetGroupName = group.name;
  }
  const existingRows = await db.query("SELECT korean FROM vocab WHERE owner_user_id=?", [ownerId]);
  const existingWords = existingRows.map((r) => normalizeWordKey(r.korean)).filter(Boolean);
  const generated = await ai.generateVocabularyBatch(count, existingWords, topic);
  const newItems = [];
  for (const item of Array.isArray(generated) ? generated : []) {
    const korean = normalizeWordKey(item.korean);
    if (!korean || existingWords.includes(korean) || newItems.length >= count) continue;
    const id = await learning.makeUniqueRecordId("vocab", item.id);
    const saved = { ...item, id, korean, tts_text: item.tts_text || korean };
    await db.run(
      `INSERT OR IGNORE INTO vocab (id, korean, meaning_vi, explanation_vi, example_kr, example_vi, tts_text, audio_path, quiz_type, learned, created_at, source, owner_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, korean, saved.meaning_vi, saved.explanation_vi, saved.example_kr, saved.example_vi, saved.tts_text, "", "word", false, learning.normalizeCreatedAt(saved.created_at), "ai_generated", ownerId]
    );
    if (groupId) {
      await db.run("INSERT OR IGNORE INTO vocab_group_items (group_id, vocab_id, created_at) VALUES (?, ?, ?)", [groupId, id, new Date().toISOString()]);
    }
    newItems.push(saved);
    existingWords.push(korean);
  }
  if (groupId && newItems.length) await groups.exportSnapshot(groupId);
  if (!newItems.length) return res.status(400).json({ error: "Không tìm thấy từ mới cho chủ đề này. Hãy thử tình huống cụ thể hơn." });
  const cost = wordCount(newItems);
  if (!(await spendOr402(res, ownerId, cost, "generate_vocab", `topic:${topic}`))) return;
  res.json({ success: true, items: newItems, ...(targetGroupName ? { group_name: targetGroupName } : {}) });
}));

router.post("/mark_learned", loginRequired, asyncHandler(async (req, res) => {
  const itemId = req.body.id;
  if (!itemId) return res.status(400).json({ error: "Word id is required" });
  const row = await db.one("SELECT learned FROM vocab WHERE id=? AND owner_user_id=?", [itemId, req.currentUser.id]);
  if (!row) return res.status(404).json({ error: "Word not found" });
  const should = parseBooleanInput(req.body.learned);
  await db.run("UPDATE vocab SET learned=? WHERE id=? AND owner_user_id=?", [should, itemId, req.currentUser.id]);
  if (should && !row.learned) await learning.recordLearningActivity(itemId, req.currentUser.id);
  // Đánh dấu "đã học" cũng là một lượt ôn nhớ-được → cho SRS tiến lịch.
  if (should) await srsService.reviewWord(req.currentUser.id, itemId, "good");
  await groups.exportGroupsForVocab(itemId);
  res.json({ success: true });
}));

// SRS: chấm 1 lượt ôn ("good" = nhớ được, "again" = ôn lại sớm) — quiz gọi fire-and-forget.
router.post("/srs_review", loginRequired, asyncHandler(async (req, res) => {
  const grade = req.body.grade === "again" ? "again" : "good";
  const result = await srsService.reviewWord(req.currentUser.id, req.body.id, grade);
  if (!result) return res.status(404).json({ error: "Word not found" });
  res.json({ success: true, due: result.due, interval_days: result.interval_days, reps: result.reps });
}));

// ── Từ vựng chuyên ngành (catalog dùng chung theo domain) ──────────────
// Tìm/phân trang + tiến độ user. Không tốn energy (chỉ đọc catalog có sẵn). ?domain= chọn ngành.
router.get("/it-terms", loginRequired, asyncHandler(async (req, res) => {
  const domain = resolveDomain(req.query.domain);
  const filter = ["all", "learned", "favorite", "untranslated"].includes(req.query.filter) ? req.query.filter : "all";
  const q = String(req.query.q || "").slice(0, 80);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 60);
  const [terms, total] = await Promise.all([
    itTerms.searchTerms({ userId: req.currentUser.id, domain, q, filter, offset, limit }),
    itTerms.countTerms({ userId: req.currentUser.id, domain, q, filter }),
  ]);
  res.json({ success: true, terms, total, offset, limit, has_more: offset + terms.length < total });
}));

router.post("/it-terms/favorite", loginRequired, asyncHandler(async (req, res) => {
  const key = String(req.body.key || "").trim();
  if (!key) return res.status(400).json({ error: "key required" });
  const favorite = await itTerms.toggleFavorite(req.currentUser.id, resolveDomain(req.body.domain), key);
  res.json({ success: true, favorite });
}));

router.post("/it-terms/learned", loginRequired, asyncHandler(async (req, res) => {
  const key = String(req.body.key || "").trim();
  if (!key) return res.status(400).json({ error: "key required" });
  await itTerms.setLearned(req.currentUser.id, resolveDomain(req.body.domain), key, parseBooleanInput(req.body.learned));
  res.json({ success: true });
}));

// SRS (good/again) — flashcard gọi fire-and-forget.
router.post("/it-terms/review", loginRequired, asyncHandler(async (req, res) => {
  const key = String(req.body.key || "").trim();
  if (!key) return res.status(400).json({ error: "key required" });
  const grade = req.body.grade === "again" ? "again" : "good";
  const next = await itTerms.reviewTerm(req.currentUser.id, resolveDomain(req.body.domain), key, grade);
  res.json({ success: true, due: next.due, interval_days: next.interval_days, reps: next.reps });
}));

router.get("/it-terms/deck", loginRequired, asyncHandler(async (req, res) => {
  const deck = await itTerms.getStudyDeck(req.currentUser.id, resolveDomain(req.query.domain), 12);
  res.json({ success: true, deck });
}));

router.post("/reset_learned", loginRequired, asyncHandler(async (req, res) => {
  const before = Number(await db.scalar("SELECT COUNT(*) FROM vocab WHERE owner_user_id=? AND learned=TRUE", [req.currentUser.id]));
  const result = await db.run("UPDATE vocab SET learned=FALSE WHERE owner_user_id=?", [req.currentUser.id]);
  await groups.exportAllSnapshots();
  const after = Number(await db.scalar("SELECT COUNT(*) FROM vocab WHERE owner_user_id=? AND learned=TRUE", [req.currentUser.id]));
  res.json({ success: true, updated_rows: result.rowCount, learned_before: before, learned_after: after });
}));

router.post("/delete_word", loginRequired, asyncHandler(async (req, res) => {
  const itemId = req.body.id;
  if (!itemId) return res.status(400).json({ error: "Word id is required" });
  const existing = await db.one("SELECT id FROM vocab WHERE id=? AND owner_user_id=?", [itemId, req.currentUser.id]);
  if (!existing) return res.status(404).json({ error: "Word not found" });
  const groupRows = await db.query("SELECT group_id FROM vocab_group_items WHERE vocab_id=?", [itemId]);
  await db.run("DELETE FROM vocab_group_items WHERE vocab_id=?", [itemId]);
  await db.run("DELETE FROM vocab WHERE id=? AND owner_user_id=?", [itemId, req.currentUser.id]);
  for (const row of groupRows) await groups.exportSnapshot(row.group_id);
  res.json({ success: true });
}));

router.post("/delete_grammar", loginRequired, asyncHandler(async (req, res) => {
  const itemId = String(req.body.id || "").trim();
  if (!itemId) return res.status(400).json({ error: "Thiếu ID ngữ pháp" });
  const existing = await db.one("SELECT id FROM grammar WHERE id=? AND owner_user_id=?", [itemId, req.currentUser.id]);
  if (!existing) return res.status(404).json({ error: "Không tìm thấy ngữ pháp" });
  await db.run("DELETE FROM grammar WHERE id=? AND owner_user_id=?", [itemId, req.currentUser.id]);
  res.json({ success: true });
}));

router.post("/regenerate_grammar_quiz_items", aiLimiter, loginRequired, asyncHandler(async (req, res) => {
  const itemId = String(req.body.id || "").trim();
  const existing = await db.one("SELECT * FROM grammar WHERE id=? AND owner_user_id=?", [itemId, req.currentUser.id]);
  if (!existing) return res.status(404).json({ error: "Không tìm thấy ngữ pháp" });
  if (!(await requireEnergyOr402(res, req.currentUser.id, 3))) return;
  const quizItems = await ai.generateGrammarQuizzesBatch(existing.grammar, 3);
  await db.run("UPDATE grammar SET quiz_items=? WHERE id=? AND owner_user_id=?", [JSON.stringify(quizItems), itemId, req.currentUser.id]);
  if (!(await spendOr402(res, req.currentUser.id, 3, "regenerate_grammar_quiz_items", itemId))) return;
  res.json({ success: true, item: learning.serializeGrammarApiItem({ ...existing, quiz_items: quizItems }), quiz_count: quizItems.length });
}));

// Tạo lại quiz cho TẤT CẢ mẫu ngữ pháp của người dùng, xử lý theo LÔ để tránh request quá dài
// và tránh vượt rate-limit. Client gửi `offset` (con trỏ ổn định vì thứ tự sắp xếp không đổi) rồi
// gọi lặp cho tới khi remaining = 0 hoặc hết năng lượng. Mỗi mẫu tốn 3 năng lượng như endpoint đơn lẻ.
router.post("/regenerate_all_grammar_quiz_items", aiLimiter, loginRequired, asyncHandler(async (req, res) => {
  const userId = req.currentUser.id;
  const MAX_BATCH = 20;   // số mẫu tối đa mỗi request (chặn timeout)
  const COST = 3;         // năng lượng mỗi mẫu

  const offset = Math.max(0, Number.parseInt(req.body.offset, 10) || 0);
  const total = Number(await db.scalar("SELECT COUNT(*) FROM grammar WHERE owner_user_id=?", [userId]));
  if (!total) {
    return res.json({ success: true, total: 0, updated: 0, failed: 0, updated_ids: [], failed_items: [], offset: 0, next_offset: 0, remaining: 0, out_of_energy: false });
  }

  const rows = await db.query(
    "SELECT id, grammar FROM grammar WHERE owner_user_id=? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
    [userId, MAX_BATCH, offset]
  );

  let updated = 0;
  let failed = 0;
  let outOfEnergy = false;
  const updatedIds = [];
  const failedItems = [];

  for (const row of rows) {
    // Dừng khi không còn đủ năng lượng (không tính mẫu này là đã xử lý → sẽ làm lại lần sau).
    if (!(await energy.hasEnoughEnergy(userId, COST)).ok) { outOfEnergy = true; break; }
    try {
      const quizItems = await ai.generateGrammarQuizzesBatch(row.grammar, 3);
      if (!Array.isArray(quizItems) || !quizItems.length) throw new Error("Không tạo được câu hỏi.");
      await db.run("UPDATE grammar SET quiz_items=? WHERE id=? AND owner_user_id=?", [JSON.stringify(quizItems), row.id, userId]);
      // Chỉ trừ năng lượng khi tạo + lưu thành công (giống thứ tự endpoint đơn lẻ).
      const spent = await energy.spendEnergy(userId, COST, "regenerate_grammar_quiz_items", String(row.id));
      if (!spent.ok) { outOfEnergy = true; break; }
      updated += 1;
      updatedIds.push(row.id);
    } catch (error) {
      failed += 1;
      if (failedItems.length < 50) failedItems.push({ id: row.id, grammar: row.grammar });
    }
  }

  await emitEnergyUpdate(userId);
  const processed = updated + failed;           // số mẫu thực sự đã xử lý trong lô này
  const nextOffset = offset + processed;
  const remaining = Math.max(0, total - nextOffset);
  res.json({
    success: true,
    total,
    updated,
    failed,
    updated_ids: updatedIds,
    failed_items: failedItems,
    offset,
    next_offset: nextOffset,
    remaining,
    out_of_energy: outOfEnergy,
    energy: await energy.getEnergyStatus(userId)
  });
}));

router.post("/add_grammar", aiLimiter, loginRequired, asyncHandler(async (req, res) => {
  const pattern = normalizeTopic(req.body.grammar || req.body.pattern);
  if (!pattern) return res.status(400).json({ error: "Vui lòng nhập mẫu ngữ pháp tiếng Hàn trước." });
  const duplicate = await db.one("SELECT id FROM grammar WHERE owner_user_id=? AND LOWER(grammar)=LOWER(?)", [req.currentUser.id, pattern]);
  if (duplicate) return res.status(400).json({ error: `Mẫu ngữ pháp '${pattern}' đã tồn tại.` });
  if (!(await requireEnergyOr402(res, req.currentUser.id, 5))) return;
  const item = await ai.generateGrammarData(pattern);
  const id = await learning.makeUniqueRecordId("grammar", item.id);
  const saved = { ...item, id, grammar: item.grammar || pattern, quiz_items: item.quiz_items || [] };
  await db.run(
    `INSERT INTO grammar (id, grammar, meaning_vi, explanation_vi, example_kr, example_vi, level, usage_notes_vi, common_mistakes_vi, quiz_items, learned, created_at, source, owner_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, saved.grammar, saved.meaning_vi || "", saved.explanation_vi || "", saved.example_kr || "", saved.example_vi || "", saved.level || "general", saved.usage_notes_vi || "", saved.common_mistakes_vi || "", JSON.stringify(saved.quiz_items), false, new Date().toISOString(), "ai_generated", req.currentUser.id]
  );
  if (!(await spendOr402(res, req.currentUser.id, 5, "add_grammar", id))) return;
  res.json({ success: true, item: learning.serializeGrammarApiItem(saved) });
}));

router.post("/manual_add", aiLimiter, loginRequired, asyncHandler(async (req, res) => {
  const word = normalizeWordKey(req.body.word);
  if (!word) return res.status(400).json({ error: "Vui lòng nhập từ tiếng Hàn." });
  const parsedGroup = parseOptionalGroupId(req.body.group_id);
  if (!parsedGroup.ok) return res.status(400).json({ error: "Vui lòng chọn thư mục hợp lệ." });
  const groupId = parsedGroup.groupId;
  if (groupId !== null) {
    const group = await getOwnedGroupOrRespond(res, groupId, req.currentUser.id);
    if (group === false) return;
  }
  const existing = await db.one("SELECT id FROM vocab WHERE owner_user_id=? AND korean=?", [req.currentUser.id, word]);
  if (existing) return res.status(400).json({ error: `Từ '${word}' đã có trong từ điển.` });
  const item = await ai.translateSpecificWord(word);
  const korean = normalizeWordKey(item.korean || word);
  const translatedExisting = await db.one("SELECT id FROM vocab WHERE owner_user_id=? AND korean=?", [req.currentUser.id, korean]);
  if (translatedExisting) return res.status(400).json({ error: `Từ '${korean}' đã có trong từ điển.` });
  const id = await learning.makeUniqueRecordId("vocab", item.id);
  await db.run(
    `INSERT INTO vocab (id, korean, meaning_vi, explanation_vi, example_kr, example_vi, tts_text, audio_path, quiz_type, learned, created_at, source, owner_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, korean, item.meaning_vi || "", item.explanation_vi || "", item.example_kr || "", item.example_vi || "", item.tts_text || korean, "", "word", false, new Date().toISOString(), "manual", req.currentUser.id]
  );
  if (groupId !== null) {
    await db.run("INSERT OR IGNORE INTO vocab_group_items (group_id, vocab_id, created_at) VALUES (?, ?, ?)", [groupId, id, new Date().toISOString()]);
    await groups.exportSnapshot(groupId);
  }
  res.json({ success: true, item: { ...item, id, korean } });
}));

// Tab "Học hôm nay": tạo (hoặc tạo lại) đoạn văn của ngày cho user rồi lưu cache.
router.post("/daily/generate", aiLimiter, loginRequired, asyncHandler(async (req, res) => {
  const ownerId = req.currentUser.id;
  const date = daily.todayStr();
  const passage = await ai.generateDailyPassage({ topic: daily.pickTopic() });
  const saved = await daily.savePassage(ownerId, date, passage);
  res.json({ success: true, passage: saved });
}));

// Xuất từ vựng sang Anki (TSV: mặt trước = tiếng Hàn, mặt sau = nghĩa + ví dụ).
// Anki nhập trực tiếp file .txt tab-separated. ?group_id= để xuất theo thư mục.
router.get("/export_anki", loginRequired, asyncHandler(async (req, res) => {
  const ownerId = req.currentUser.id;
  const parsedGroup = parseOptionalGroupId(req.query.group_id);
  if (!parsedGroup.ok) return res.status(400).json({ error: "Vui lòng chọn thư mục hợp lệ." });
  let rows;
  if (parsedGroup.groupId) {
    const group = await getOwnedGroupOrRespond(res, parsedGroup.groupId, ownerId);
    if (group === false) return;
    rows = await db.query(
      `SELECT vocab.* FROM vocab
       JOIN vocab_group_items ON vocab_group_items.vocab_id = vocab.id
       WHERE vocab_group_items.group_id=? AND vocab.owner_user_id=?
       ORDER BY vocab.created_at ASC`,
      [parsedGroup.groupId, ownerId]
    );
  } else {
    rows = await db.query("SELECT * FROM vocab WHERE owner_user_id=? ORDER BY created_at ASC", [ownerId]);
  }
  const clean = (v) => String(v || "").replace(/\t/g, " ").replace(/\r?\n/g, "<br>");
  const lines = rows.map((r) => {
    const back = [clean(r.meaning_vi), clean(r.explanation_vi), r.example_kr ? `${clean(r.example_kr)}<br>${clean(r.example_vi)}` : ""]
      .filter(Boolean).join("<br><br>");
    return `${clean(r.korean)}\t${back}\tftka`;
  });
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="ftka-anki.txt"');
  res.send("#separator:tab\n#html:true\n#tags column:3\n" + lines.join("\n") + "\n");
}));

// Luyện viết: AI chấm điểm + sửa lỗi rồi lưu vào lịch sử bài nộp (tốn 2 năng lượng).
router.post("/writing/grade", aiLimiter, loginRequired, asyncHandler(async (req, res) => {
  const topic = String(req.body.topic || "").trim().slice(0, 120);
  const text = String(req.body.text || "").trim();
  if (text.length < 10) return res.status(400).json({ error: "Bài viết quá ngắn — hãy viết ít nhất một câu hoàn chỉnh." });
  if (!(await spendOr402(res, req.currentUser.id, 2, "writing", "grade"))) return;
  const graded = await ai.gradeWriting(topic, text);
  const saved = await writingService.saveSubmission(req.currentUser.id, {
    topic: topic || "tự do",
    original: text.slice(0, 2000),
    corrected: graded.corrected,
    score: graded.score,
    feedback: { feedback_vi: graded.feedback_vi, corrections: graded.corrections }
  });
  res.json({ success: true, result: saved });
}));

// Tra từ nhanh (không lưu). Cache trong bộ nhớ để từ phổ biến không tốn quota AI.
const DICT_CACHE = new Map();
const DICT_CACHE_MAX = 500;
router.post("/dict", aiLimiter, loginRequired, asyncHandler(async (req, res) => {
  const word = String(req.body.word || "").trim().slice(0, 60);
  if (!word) return res.status(400).json({ error: "Vui lòng nhập từ cần tra." });
  const key = word.toLowerCase();
  if (DICT_CACHE.has(key)) {
    const cached = DICT_CACHE.get(key);
    DICT_CACHE.delete(key);
    DICT_CACHE.set(key, cached); // refresh vị trí LRU
    return res.json({ success: true, entry: cached, cached: true });
  }
  const entry = await ai.lookupWord(word);
  DICT_CACHE.set(key, entry);
  while (DICT_CACHE.size > DICT_CACHE_MAX) DICT_CACHE.delete(DICT_CACHE.keys().next().value);
  res.json({ success: true, entry });
}));

router.get("/tts", ttsLimiter, asyncHandler(async (req, res) => {
  // Phát âm MIỄN PHÍ (không trừ energy): thao tác học cốt lõi, nhẹ, đã cache. ttsLimiter chống spam.
  const text = String(req.query.text || "").trim().slice(0, 200);
  if (!text) return res.status(400).send("");
  let buffer;
  try {
    buffer = await tts.synthesizeBuffer(text);
  } catch (err) {
    // Google chặn/treo → 503 gọn để client fallback sang giọng trình duyệt ngay.
    return res.status(err.status === 503 ? 503 : 502).send("");
  }
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Content-Disposition", "inline; filename=\"tts.mp3\"");
  res.send(buffer);
}));

router.get("/listening-practice/audio/:filename", loginRequired, (req, res) => {
  const filePath = tts.safeAudioPath(req.params.filename);
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).send("");
  res.type("audio/mpeg").sendFile(filePath);
});

router.post("/settings", ...named("api_update_settings", adminRequired, (req, res) => {
  const payload = { ...req.body };
  delete payload.api_key;
  delete payload.language;
  settings.saveSettings(payload);
  res.json({ success: true });
}));

router.post("/settings/test_api", adminRequired, asyncHandler(async (req, res) => {
  try {
    await ai.testConnection();
    res.json({ success: true, message: "API hoạt động." });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
}));

router.get("/settings/ai_status", adminRequired, asyncHandler(async (req, res) => {
  const env = require("../config/env");
  const { PROVIDERS_CONFIG, DEFAULT_FALLBACK_ORDER } = require("../ai/core/providerConfig");

  // Which providers have keys configured
  const keyMap = {
    google: env.googleAiStudioApiKey,
    groq: env.groqApiKey,
    nvidia: env.nvidiaApiKey,
    cloudflare: env.cloudflareApiKey,
    openrouter: env.openrouterApiKey,
  };

  const routerStatus = ai.getRouterStatus ? ai.getRouterStatus() : { circuitBreaker: {}, quota: {} };

  const providers = DEFAULT_FALLBACK_ORDER.map((name) => {
    const cfg = PROVIDERS_CONFIG[name];
    const cb = routerStatus.circuitBreaker[name] || { state: "closed", failures: 0, openedAt: null };
    const quota = routerStatus.quota[name] || { perMinuteRemaining: Infinity, perDayRemaining: Infinity };
    return {
      name,
      configured: Boolean(keyMap[name]),
      models: cfg.models,
      taskPriority: cfg.taskPriority,
      avgLatencyMs: cfg.avgLatencyMs,
      circuitBreaker: cb,
      quota: {
        perMinuteRemaining: quota.perMinuteRemaining === Infinity ? null : quota.perMinuteRemaining,
        perDayRemaining: quota.perDayRemaining === Infinity ? null : quota.perDayRemaining,
      },
    };
  });

  res.json({
    activeModel: env.googleAiStudioModel || "gemma-4-31b-it",
    providers,
  });
}));


router.get("/learning_activity/chart_data", loginRequired, asyncHandler(async (req, res) => {
  const timeline = await learning.getLearningActivityTimeline(req.currentUser.id, 30);
  res.json({ labels: timeline.map((day) => day.short_date), data: timeline.map((day) => day.count) });
}));

module.exports = router;
