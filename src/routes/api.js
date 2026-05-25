const express = require("express");
const multer = require("multer");
const fs = require("fs");
const db = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const { named } = require("../middleware/viewContext");
const { loginRequired, adminRequired } = require("../middleware/auth");
const auth = require("../services/authService");
const ai = require("../services/aiService");
const settings = require("../services/settingsService");
const tts = require("../services/ttsService");
const learning = require("../services/learningService");
const groups = require("../services/vocabGroupService");

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

router.post("/preferences", ...named("api_update_preferences", loginRequired, asyncHandler(async (req, res) => {
  try {
    const user = await auth.updateUserThemePreference(req.currentUser.id, req.body.theme);
    req.currentUser = user;
    res.json({ success: true, theme: req.body.theme });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
})));

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

router.post("/generate", loginRequired, asyncHandler(async (req, res) => {
  const topic = normalizeTopic(req.body.topic);
  if (!topic) return res.status(400).json({ error: "Vui lòng nhập chủ đề hoặc tình huống trước." });
  let count;
  try {
    count = parseGeneratorCount(req.body.count);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  const ownerId = req.currentUser.id;
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
  await groups.exportGroupsForVocab(itemId);
  res.json({ success: true });
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

router.post("/regenerate_grammar_quiz_items", loginRequired, asyncHandler(async (req, res) => {
  const itemId = String(req.body.id || "").trim();
  const existing = await db.one("SELECT * FROM grammar WHERE id=? AND owner_user_id=?", [itemId, req.currentUser.id]);
  if (!existing) return res.status(404).json({ error: "Không tìm thấy ngữ pháp" });
  const quizItems = await ai.generateGrammarQuizzesBatch(existing.grammar, 3);
  await db.run("UPDATE grammar SET quiz_items=? WHERE id=? AND owner_user_id=?", [JSON.stringify(quizItems), itemId, req.currentUser.id]);
  res.json({ success: true, item: learning.serializeGrammarApiItem({ ...existing, quiz_items: quizItems }), quiz_count: quizItems.length });
}));

router.post("/add_grammar", loginRequired, asyncHandler(async (req, res) => {
  const pattern = normalizeTopic(req.body.grammar || req.body.pattern);
  if (!pattern) return res.status(400).json({ error: "Vui lòng nhập mẫu ngữ pháp tiếng Hàn trước." });
  const duplicate = await db.one("SELECT id FROM grammar WHERE owner_user_id=? AND LOWER(grammar)=LOWER(?)", [req.currentUser.id, pattern]);
  if (duplicate) return res.status(400).json({ error: `Mẫu ngữ pháp '${pattern}' đã tồn tại.` });
  const item = await ai.generateGrammarData(pattern);
  const id = await learning.makeUniqueRecordId("grammar", item.id);
  const saved = { ...item, id, grammar: item.grammar || pattern, quiz_items: item.quiz_items || [] };
  await db.run(
    `INSERT INTO grammar (id, grammar, meaning_vi, explanation_vi, example_kr, example_vi, level, usage_notes_vi, common_mistakes_vi, quiz_items, learned, created_at, source, owner_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, saved.grammar, saved.meaning_vi || "", saved.explanation_vi || "", saved.example_kr || "", saved.example_vi || "", saved.level || "general", saved.usage_notes_vi || "", saved.common_mistakes_vi || "", JSON.stringify(saved.quiz_items), false, new Date().toISOString(), "ai_generated", req.currentUser.id]
  );
  res.json({ success: true, item: learning.serializeGrammarApiItem(saved) });
}));

router.post("/manual_add", loginRequired, asyncHandler(async (req, res) => {
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

router.get("/tts", asyncHandler(async (req, res) => {
  const text = String(req.query.text || "").trim();
  if (!text) return res.status(400).send("");
  const buffer = await tts.synthesizeBuffer(text);
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Content-Disposition", "inline; filename=\"tts.mp3\"");
  res.send(buffer);
}));

router.get("/listening-practice/audio/:filename", (req, res) => {
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

router.get("/learning_activity/chart_data", loginRequired, asyncHandler(async (req, res) => {
  const timeline = await learning.getLearningActivityTimeline(req.currentUser.id, 30);
  res.json({ labels: timeline.map((day) => day.short_date), data: timeline.map((day) => day.count) });
}));

module.exports = router;
