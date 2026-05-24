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
  return db.one("SELECT id, username, email, role, status, created_at, last_login FROM users WHERE id=?", [Number(userId)]);
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
  if (filters.missing === "audio") where.push("(audio_path IS NULL OR TRIM(audio_path) = '')");
  if (filters.missing === "example") where.push("(example_kr IS NULL OR TRIM(example_kr) = '')");
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [rows, pageInfo] = await paginate(db, `SELECT * FROM vocab ${whereSql} ORDER BY created_at DESC, id DESC`, `SELECT COUNT(*) FROM vocab ${whereSql}`, params, p, pp);
  const sources = await db.query("SELECT DISTINCT source FROM vocab WHERE source IS NOT NULL AND TRIM(source) != '' ORDER BY source");
  return [rows, pageInfo, sources.map((r) => r.source)];
}

async function getVocab(vocabId, db = dbGlobal) {
  const row = await db.one("SELECT * FROM vocab WHERE id=?", [vocabId]);
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

async function deleteVocab(vocabId, db = dbGlobal) {
  const oldValue = await getVocab(vocabId, db);
  if (!oldValue) return [null, []];
  const groupRows = await db.query("SELECT group_id FROM vocab_group_items WHERE vocab_id=?", [vocabId]);
  await db.run("DELETE FROM vocab_group_items WHERE vocab_id=?", [vocabId]);
  await db.run("DELETE FROM vocab WHERE id=?", [vocabId]);
  return [oldValue, groupRows.map((r) => r.group_id)];
}

async function listGrammar(filters, db = dbGlobal) {
  const p = page(filters.page);
  const pp = perPage(filters.per_page);
  const q = filtersGet(filters, "q");
  const params = [];
  const whereSql = q ? "WHERE (LOWER(grammar) LIKE LOWER(?) OR LOWER(meaning_vi) LIKE LOWER(?) OR CAST(id AS TEXT) LIKE ?)" : "";
  if (q) params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  return paginate(db, `SELECT * FROM grammar ${whereSql} ORDER BY created_at DESC, id DESC`, `SELECT COUNT(*) FROM grammar ${whereSql}`, params, p, pp);
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
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return paginate(db, `SELECT * FROM listening_practice ${whereSql} ORDER BY created_at DESC, id DESC`, `SELECT COUNT(*) FROM listening_practice ${whereSql}`, params, p, pp);
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

async function deleteListeningLesson(lessonId, db = dbGlobal) {
  const oldValue = await getListeningLesson(lessonId, db);
  if (!oldValue) return null;
  await db.run("DELETE FROM listening_practice WHERE id=?", [lessonId]);
  return oldValue;
}

async function updateListeningAudio(lessonId, audioFilename, audioError = "", db = dbGlobal) {
  const oldValue = await getListeningLesson(lessonId, db);
  if (!oldValue) return [null, null];
  await db.run("UPDATE listening_practice SET audio_path=?, audio_error=? WHERE id=?", [audioFilename, audioError, lessonId]);
  return [oldValue, await getListeningLesson(lessonId, db)];
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
    `SELECT id, title, audio_path, created_at FROM listening_practice
     WHERE audio_path IS NOT NULL AND TRIM(audio_path) != ''
     ORDER BY created_at DESC, id DESC`
  );
  return rows.map((row) => {
    const [exists, size] = audioPathExists(audioDir, row.audio_path);
    const filename = audioFilenameFromReference(row.audio_path);
    return {
      reference: `listening:${row.id}`,
      display_reference: filename || "Tham chiếu âm thanh không hợp lệ",
      related_type: "Bài nghe",
      related_label: row.title || row.id,
      exists,
      size,
      created_at: row.created_at,
      can_delete: true
    };
  });
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
  updateUserStatus,
  listVocab,
  getVocab,
  updateVocab,
  deleteVocab,
  listGrammar,
  listLearningActivity,
  listListening,
  getListeningLesson,
  deleteListeningLesson,
  updateListeningAudio,
  audioFilenameFromReference,
  audioPathExists,
  listAudioRecords,
  getDashboardStats,
  getRecentErrors,
  logAdminAction,
  listAdminLogs
};
