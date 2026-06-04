const fs = require("fs");
const path = require("path");
const dbGlobal = require("../db");

const PER_PAGE_DEFAULT = 20;
const PER_PAGE_MAX = 100;
const AUDIO_PREFIX = "/api/listening-practice/audio/";

function page(value) {
  return Math.max(Number.parseInt(value || "1", 10) || 1, 1);
}

function perPage(value, fallback = PER_PAGE_DEFAULT) {
  return Math.max(1, Math.min(Number.parseInt(value || fallback, 10) || fallback, PER_PAGE_MAX));
}

function pagination(current, size, total) {
  const totalPages = Math.max(1, Math.ceil(total / size));
  return { page: current, per_page: size, total, total_pages: totalPages, has_prev: current > 1, has_next: current < totalPages };
}

async function paginate(db, baseSql, countSql, params, current, size) {
  const total = Number(await db.scalar(countSql, params));
  const offset = (current - 1) * size;
  const rows = await db.query(`${baseSql} LIMIT ? OFFSET ?`, [...params, size, offset]);
  return [rows, pagination(current, size, total)];
}

function filtersGet(filters, key) {
  return String(filters[key] || "").trim();
}

async function listUsers(filters, db = dbGlobal) {
  const p = page(filters.page);
  const pp = perPage(filters.per_page);
  const where = [];
  const params = [];
  const q = filtersGet(filters, "q");
  if (q) {
    where.push("(CAST(id AS TEXT) LIKE ? OR LOWER(username) LIKE LOWER(?) OR LOWER(email) LIKE LOWER(?))");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  for (const key of ["role", "status"]) {
    const value = filtersGet(filters, key);
    if (value) {
      where.push(`${key} = ?`);
      params.push(value);
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return paginate(db, `SELECT id, username, email, role, status, created_at, last_login FROM users ${whereSql} ORDER BY created_at DESC, id DESC`, `SELECT COUNT(*) FROM users ${whereSql}`, params, p, pp);
}

async function getUserDetail(userId, db = dbGlobal) {
  return db.one(`SELECT users.id, username, email, role, status, plan, premium_until, users.created_at, last_login,
    user_energy.current_energy, user_energy.max_energy
    FROM users LEFT JOIN user_energy ON user_energy.user_id = users.id WHERE users.id=?`, [Number(userId)]);
}

async function updateUser(userId, form, db = dbGlobal) {
  const oldValue = await getUserDetail(userId, db);
  if (!oldValue) return [null, null];
  await db.run("UPDATE users SET username=?, email=?, role=?, status=?, plan=?, premium_until=? WHERE id=?", [
    String(form.username || "").trim(), String(form.email || "").trim(), String(form.role || "user").trim(),
    String(form.status || "active").trim(), String(form.plan || "free").trim(), String(form.premium_until || "").trim() || null, oldValue.id
  ]);
  return [oldValue, await getUserDetail(oldValue.id, db)];
}

async function deleteUser(userId, db = dbGlobal) {
  const oldValue = await getUserDetail(userId, db);
  if (!oldValue) return null;
  await db.run("DELETE FROM users WHERE id=?", [oldValue.id]);
  return oldValue;
}

async function updateUserStatus(userId, status, db = dbGlobal) {
  const oldValue = await getUserDetail(userId, db);
  if (!oldValue) return [null, null];
  await db.run("UPDATE users SET status=? WHERE id=?", [status, oldValue.id]);
  return [oldValue, await getUserDetail(oldValue.id, db)];
}

async function listVocab(filters, db = dbGlobal) {
  const p = page(filters.page);
  const pp = perPage(filters.per_page);
  const where = [];
  const params = [];
  const q = filtersGet(filters, "q");
  if (q) {
    where.push("(LOWER(korean) LIKE LOWER(?) OR LOWER(meaning_vi) LIKE LOWER(?) OR CAST(id AS TEXT) LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (filters.learned === "learned") where.push("learned = TRUE");
  if (filters.learned === "unlearned") where.push("learned = FALSE");
  if (filters.source) {
    where.push("source = ?");
    params.push(filters.source);
  }
  if (filters.user_id) { where.push("owner_user_id = ?"); params.push(Number(filters.user_id)); }
  if (filters.missing === "audio") where.push("(audio_path IS NULL OR TRIM(audio_path) = '')");
  if (filters.missing === "example") where.push("(example_kr IS NULL OR TRIM(example_kr) = '')");
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [rows, pageInfo] = await paginate(db, `SELECT vocab.*, users.username AS owner_username, users.email AS owner_email FROM vocab LEFT JOIN users ON users.id = vocab.owner_user_id ${whereSql} ORDER BY vocab.created_at DESC, vocab.id DESC`, `SELECT COUNT(*) FROM vocab ${whereSql}`, params, p, pp);
  const sources = await db.query("SELECT DISTINCT source FROM vocab WHERE source IS NOT NULL AND TRIM(source) != '' ORDER BY source");
  return [rows, pageInfo, sources.map((r) => r.source)];
}

async function getVocab(vocabId, db = dbGlobal) {
  const row = await db.one("SELECT * FROM vocab WHERE id=?", [vocabId]);
  return row ? { ...row, audio_reference_display: audioFilenameFromReference(row.audio_path) || row.audio_path || "" } : null;
}

async function getUserVocab(userId, vocabId, db = dbGlobal) {
  const row = await db.one("SELECT * FROM vocab WHERE id=? AND owner_user_id=?", [vocabId, Number(userId)]);
  return row ? { ...row, audio_reference_display: audioFilenameFromReference(row.audio_path) || row.audio_path || "" } : null;
}

async function updateVocab(vocabId, form, db = dbGlobal) {
  const oldValue = await getVocab(vocabId, db);
  if (!oldValue) return [null, null];
  const fields = ["korean", "meaning_vi", "explanation_vi", "example_kr", "example_vi", "tts_text", "audio_path", "quiz_type", "source"];
  const values = fields.map((f) => String(form[f] || "").trim());
  await db.run(
    `UPDATE vocab SET korean=?, meaning_vi=?, explanation_vi=?, example_kr=?, example_vi=?,
     tts_text=?, audio_path=?, quiz_type=?, source=?, learned=? WHERE id=?`,
    [...values, form.learned === "on", vocabId]
  );
  return [oldValue, await getVocab(vocabId, db)];
}

async function updateUserVocab(userId, vocabId, form, db = dbGlobal) {
  const oldValue = await getUserVocab(userId, vocabId, db);
  if (!oldValue) return [null, null];
  const fields = ["korean", "meaning_vi", "explanation_vi", "example_kr", "example_vi", "tts_text", "audio_path", "quiz_type", "source"];
  const values = fields.map((f) => String(form[f] || "").trim());
  await db.run(`UPDATE vocab SET korean=?, meaning_vi=?, explanation_vi=?, example_kr=?, example_vi=?,
     tts_text=?, audio_path=?, quiz_type=?, source=?, learned=? WHERE id=? AND owner_user_id=?`, [...values, form.learned === "on", vocabId, Number(userId)]);
  return [oldValue, await getUserVocab(userId, vocabId, db)];
}

async function deleteVocab(vocabId, db = dbGlobal) {
  const oldValue = await getVocab(vocabId, db);
  if (!oldValue) return [null, []];
  const groupRows = await db.query("SELECT group_id FROM vocab_group_items WHERE vocab_id=?", [vocabId]);
  await db.run("DELETE FROM vocab_group_items WHERE vocab_id=?", [vocabId]);
  await db.run("DELETE FROM vocab WHERE id=?", [vocabId]);
  return [oldValue, groupRows.map((r) => r.group_id)];
}

async function deleteUserVocab(userId, vocabId, db = dbGlobal) {
  const oldValue = await getUserVocab(userId, vocabId, db);
  if (!oldValue) return [null, []];
  const groupRows = await db.query("SELECT group_id FROM vocab_group_items WHERE vocab_id=?", [vocabId]);
  await db.run("DELETE FROM vocab_group_items WHERE vocab_id=?", [vocabId]);
  await db.run("DELETE FROM vocab WHERE id=? AND owner_user_id=?", [vocabId, Number(userId)]);
  return [oldValue, groupRows.map((r) => r.group_id)];
}

async function listGrammar(filters, db = dbGlobal) {
  const p = page(filters.page);
  const pp = perPage(filters.per_page);
  const q = filtersGet(filters, "q");
  const params = [];
  const where = [];
  if (q) where.push("(LOWER(grammar) LIKE LOWER(?) OR LOWER(meaning_vi) LIKE LOWER(?) OR CAST(id AS TEXT) LIKE ?)");
  if (q) params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  if (filters.user_id) { where.push("owner_user_id = ?"); params.push(Number(filters.user_id)); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return paginate(db, `SELECT grammar.*, users.username AS owner_username, users.email AS owner_email FROM grammar LEFT JOIN users ON users.id = grammar.owner_user_id ${whereSql} ORDER BY grammar.created_at DESC, grammar.id DESC`, `SELECT COUNT(*) FROM grammar ${whereSql}`, params, p, pp);
}

async function getUserGrammar(userId, grammarId, db = dbGlobal) { return db.one("SELECT * FROM grammar WHERE id=? AND owner_user_id=?", [grammarId, Number(userId)]); }
async function updateUserGrammar(userId, grammarId, form, db = dbGlobal) {
  const oldValue = await getUserGrammar(userId, grammarId, db); if (!oldValue) return [null, null];
  await db.run(`UPDATE grammar SET grammar=?, meaning_vi=?, explanation_vi=?, example_kr=?, example_vi=?, level=?, usage_notes_vi=?, common_mistakes_vi=?, source=?, learned=? WHERE id=? AND owner_user_id=?`,
    ["grammar", "meaning_vi", "explanation_vi", "example_kr", "example_vi", "level", "usage_notes_vi", "common_mistakes_vi", "source"].map((f) => String(form[f] || "").trim()).concat([form.learned === "on", grammarId, Number(userId)]));
  return [oldValue, await getUserGrammar(userId, grammarId, db)];
}
async function deleteUserGrammar(userId, grammarId, db = dbGlobal) {
  const oldValue = await getUserGrammar(userId, grammarId, db); if (!oldValue) return null;
  await db.run("DELETE FROM grammar WHERE id=? AND owner_user_id=?", [grammarId, Number(userId)]); return oldValue;
}

async function listLearningActivity(filters, db = dbGlobal) {
  return paginate(
    db,
    `SELECT learning_activity.*, vocab.korean, vocab.meaning_vi
     FROM learning_activity LEFT JOIN vocab ON vocab.id = learning_activity.vocab_id
     ORDER BY learning_activity.created_at DESC, learning_activity.id DESC`,
    "SELECT COUNT(*) FROM learning_activity",
    [],
    page(filters.page),
    perPage(filters.per_page)
  );
}

async function listListening(filters, db = dbGlobal) {
  const p = page(filters.page);
  const pp = perPage(filters.per_page);
  const where = [];
  const params = [];
  const q = filtersGet(filters, "q");
  if (q) {
    where.push("(LOWER(title) LIKE LOWER(?) OR LOWER(topic) LIKE LOWER(?) OR LOWER(level) LIKE LOWER(?))");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (filters.level) {
    where.push("level = ?");
    params.push(filters.level);
  }
  if (filters.missing_audio === "1") where.push("(audio_path IS NULL OR TRIM(audio_path) = '')");
  if (filters.user_id) { where.push("owner_user_id = ?"); params.push(Number(filters.user_id)); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return paginate(db, `SELECT listening_practice.*, users.username AS owner_username, users.email AS owner_email FROM listening_practice LEFT JOIN users ON users.id = listening_practice.owner_user_id ${whereSql} ORDER BY listening_practice.created_at DESC, listening_practice.id DESC`, `SELECT COUNT(*) FROM listening_practice ${whereSql}`, params, p, pp);
}

function loadsJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function audioFilenameFromReference(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return "";
  const filename = path.basename(value.startsWith(AUDIO_PREFIX) ? value.slice(AUDIO_PREFIX.length) : value);
  return /^listening_[A-Za-z0-9_.-]+\.mp3$/.test(filename) ? filename : "";
}

async function getListeningLesson(lessonId, db = dbGlobal) {
  const row = await db.one("SELECT * FROM listening_practice WHERE id=?", [lessonId]);
  if (!row) return null;
  const filename = audioFilenameFromReference(row.audio_path);
  return {
    ...row,
    vocabulary_items: loadsJson(row.vocabulary, []),
    question_items: loadsJson(row.questions, []),
    sentence_items: loadsJson(row.sentences, []),
    audio_url: filename ? `${AUDIO_PREFIX}${filename}` : ""
  };
}

async function getUserListeningLesson(userId, lessonId, db = dbGlobal) {
  const row = await db.one("SELECT * FROM listening_practice WHERE id=? AND owner_user_id=?", [lessonId, Number(userId)]);
  if (!row) return null;
  const filename = audioFilenameFromReference(row.audio_path);
  return { ...row, vocabulary_items: loadsJson(row.vocabulary, []), question_items: loadsJson(row.questions, []), sentence_items: loadsJson(row.sentences, []), audio_url: filename ? `${AUDIO_PREFIX}${filename}` : "" };
}

async function updateUserListeningLesson(userId, lessonId, form, db = dbGlobal) {
  const oldValue = await getUserListeningLesson(userId, lessonId, db); if (!oldValue) return [null, null];
  await db.run(`UPDATE listening_practice SET title=?, level=?, topic=?, length=?, korean_text=?, vietnamese_translation=?, vocabulary=?, questions=?, audio_path=?, audio_error=? WHERE id=? AND owner_user_id=?`,
    ["title", "level", "topic", "length", "korean_text", "vietnamese_translation", "vocabulary", "questions", "audio_path", "audio_error"].map((f) => String(form[f] || "").trim()).concat([lessonId, Number(userId)]));
  return [oldValue, await getUserListeningLesson(userId, lessonId, db)];
}

async function deleteListeningLesson(lessonId, db = dbGlobal) {
  const oldValue = await getListeningLesson(lessonId, db);
  if (!oldValue) return null;
  await db.run("DELETE FROM listening_practice WHERE id=?", [lessonId]);
  return oldValue;
}

async function deleteUserListeningLesson(userId, lessonId, db = dbGlobal) {
  const oldValue = await getUserListeningLesson(userId, lessonId, db); if (!oldValue) return null;
  await db.run("DELETE FROM listening_practice WHERE id=? AND owner_user_id=?", [lessonId, Number(userId)]); return oldValue;
}

async function updateListeningAudio(lessonId, audioFilename, audioError = "", db = dbGlobal) {
  const oldValue = await getListeningLesson(lessonId, db);
  if (!oldValue) return [null, null];
  await db.run("UPDATE listening_practice SET audio_path=?, audio_error=? WHERE id=?", [audioFilename, audioError, lessonId]);
  return [oldValue, await getListeningLesson(lessonId, db)];
}

async function updateUserListeningAudio(userId, lessonId, audioFilename, audioError = "", db = dbGlobal) {
  const oldValue = await getUserListeningLesson(userId, lessonId, db); if (!oldValue) return [null, null];
  await db.run("UPDATE listening_practice SET audio_path=?, audio_error=? WHERE id=? AND owner_user_id=?", [audioFilename, audioError, lessonId, Number(userId)]);
  return [oldValue, await getUserListeningLesson(userId, lessonId, db)];
}

function audioPathExists(audioDir, audioReference) {
  const filename = audioFilenameFromReference(audioReference);
  if (!filename) return [false, 0];
  const full = path.resolve(audioDir, filename);
  if (path.dirname(full) !== path.resolve(audioDir) || !fs.existsSync(full)) return [false, 0];
  return [true, fs.statSync(full).size];
}

async function listAudioRecords(audioDir, db = dbGlobal) {
  const rows = await db.query(
    `SELECT listening_practice.id, title, audio_path, listening_practice.created_at, owner_user_id, users.username AS owner_username FROM listening_practice LEFT JOIN users ON users.id = listening_practice.owner_user_id
     WHERE audio_path IS NOT NULL AND TRIM(audio_path) != ''
     ORDER BY created_at DESC, id DESC`
  );
  return rows.map((row) => {
    const [exists, size] = audioPathExists(audioDir, row.audio_path);
    const filename = audioFilenameFromReference(row.audio_path);
    return {
      reference: `listening:${row.id}`,
      lesson_id: row.id,
      display_reference: filename || "Tham chiếu âm thanh không hợp lệ",
      related_type: "Bài nghe",
      related_label: row.title || row.id,
      exists,
      size,
      created_at: row.created_at,
      owner_user_id: row.owner_user_id,
      owner_username: row.owner_username,
      can_delete: true
    };
  });
}

async function listUserAudioRecords(userId, audioDir, db = dbGlobal) {
  const records = await listAudioRecords(audioDir, db);
  return records.filter((r) => Number(r.owner_user_id) === Number(userId));
}

async function getDashboardStats(db = dbGlobal) {
  const count = (table, where = "", params = []) => db.scalar(`SELECT COUNT(*) FROM ${table}${where ? ` WHERE ${where}` : ""}`, params).then(Number).catch(() => 0);
  return {
    total_users: await count("users"),
    new_users_today: await count("users", "created_at >= ?", [new Date(Date.now() - 86400000).toISOString()]),
    new_users_this_week: await count("users", "created_at >= ?", [new Date(Date.now() - 7 * 86400000).toISOString()]),
    total_vocabulary: await count("vocab"),
    total_writing_submissions: 0,
    total_listening_lessons: await count("listening_practice"),
    total_audio_files: await count("listening_practice", "audio_path IS NOT NULL AND TRIM(audio_path) != ''"),
    total_ai_generations: (await count("vocab", "source = ?", ["ai_generated"])) + (await count("grammar", "source = ?", ["ai_generated"])) + (await count("listening_practice", "source = ?", ["ai"])),
    total_energy_balance: 0,
    total_energy_spent: 0,
    grammar_count: await count("grammar"),
    learning_activity_count: await count("learning_activity"),
    recent_admin_actions: await count("admin_action_logs")
  };
}

async function getRecentErrors(db = dbGlobal, limit = 8) {
  const rows = await db.query(
    `SELECT id, title, audio_error, created_at FROM listening_practice
     WHERE audio_error IS NOT NULL AND TRIM(audio_error) != ''
     ORDER BY created_at DESC, id DESC LIMIT ?`,
    [limit]
  ).catch(() => []);
  return rows.map((row) => ({ source: "Luyện nghe", message: row.audio_error, reference: row.title || row.id, created_at: row.created_at }));
}

async function logAdminAction(db, adminUserId, action, targetType, targetId, oldValue, newValue, reason) {
  await db.run(
    `INSERT INTO admin_action_logs (admin_user_id, action, target_type, target_id, old_value_json, new_value_json, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [adminUserId, action, targetType, String(targetId || ""), oldValue ? JSON.stringify(oldValue) : null, newValue ? JSON.stringify(newValue) : null, String(reason || "").trim() || null, new Date().toISOString()]
  );
}

async function listAdminLogs(filters, db = dbGlobal) {
  return paginate(
    db,
    `SELECT admin_action_logs.*, users.username AS admin_username
     FROM admin_action_logs LEFT JOIN users ON users.id = admin_action_logs.admin_user_id
     ORDER BY admin_action_logs.created_at DESC, admin_action_logs.id DESC`,
    "SELECT COUNT(*) FROM admin_action_logs",
    [],
    page(filters.page),
    perPage(filters.per_page)
  );
}

module.exports = {
  listUsers,
  getUserDetail,
  updateUser,
  deleteUser,
  updateUserStatus,
  listVocab,
  getVocab,
  getUserVocab,
  updateVocab,
  updateUserVocab,
  deleteVocab,
  deleteUserVocab,
  listGrammar,
  getUserGrammar,
  updateUserGrammar,
  deleteUserGrammar,
  listLearningActivity,
  listListening,
  getListeningLesson,
  getUserListeningLesson,
  updateUserListeningLesson,
  deleteListeningLesson,
  deleteUserListeningLesson,
  updateListeningAudio,
  updateUserListeningAudio,
  audioFilenameFromReference,
  audioPathExists,
  listAudioRecords,
  listUserAudioRecords,
  getDashboardStats,
  getRecentErrors,
  logAdminAction,
  listAdminLogs
};
