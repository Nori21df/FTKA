const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const db = require("../db");
const srs = require("../utils/srs");

/**
 * itTermsService — Từ vựng chuyên ngành CNTT (bộ TTA 정보통신용어사전, ~19.620 thuật ngữ).
 *
 * Mô hình: catalog DÙNG CHUNG `it_terms` (seed 1 lần từ asset nén) + tiến độ RIÊNG theo user
 * `it_term_progress` (thưa — chỉ tạo hàng khi user tương tác). Tái dùng srs.js cho ôn ngắt quãng.
 * Khác vocab (per-user) vì đây là từ điển công khai, không nhân bản 19.6k dòng/user.
 */

const ASSET_PATH = path.join(__dirname, "..", "..", "assets", "it-terms.json.gz");
const EXPECTED_COUNT = 19620; // để guard seed (bỏ qua nếu đã đủ)

async function ensureItTermsSchema(clientDb = db) {
  await clientDb.run(`
    CREATE TABLE IF NOT EXISTS it_terms (
      key TEXT PRIMARY KEY,
      korean TEXT NOT NULL,
      gloss_en TEXT,
      definition_kr TEXT,
      definition_vi TEXT
    )`);
  await clientDb.run("CREATE INDEX IF NOT EXISTS idx_it_terms_korean ON it_terms(korean)");
  await clientDb.run(`
    CREATE TABLE IF NOT EXISTS it_term_progress (
      user_id INTEGER NOT NULL,
      term_key TEXT NOT NULL,
      learned BOOLEAN NOT NULL DEFAULT FALSE,
      favorite BOOLEAN NOT NULL DEFAULT FALSE,
      srs_due TIMESTAMPTZ,
      srs_interval REAL NOT NULL DEFAULT 0,
      srs_ease REAL NOT NULL DEFAULT 2.5,
      srs_reps INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, term_key)
    )`);
  await clientDb.run("CREATE INDEX IF NOT EXISTS idx_it_progress_due ON it_term_progress(user_id, srs_due)");
}

// Đọc asset nén (chỉ đọc file ỔN ĐỊNH đã commit — KHÔNG đọc data/it-terms.json vì script dịch
// có thể đang ghi dở). Trả mảng { key, korean, gloss_en, definition_kr, definition_vi } hoặc null.
function loadSeedData() {
  if (!fs.existsSync(ASSET_PATH)) return null;
  const gz = fs.readFileSync(ASSET_PATH);
  return JSON.parse(zlib.gunzipSync(gz).toString("utf8"));
}

// Seed/nạp catalog. Guard: đã đủ EXPECTED_COUNT thì bỏ qua (trừ khi force). Upsert theo key —
// re-seed bằng asset dịch đầy đủ hơn sẽ ĐIỀN definition_vi còn trống mà không ghi đè bản đã có.
async function seedItTerms({ force = false } = {}) {
  const current = Number(await db.scalar("SELECT COUNT(*) FROM it_terms").catch(() => 0));
  if (!force && current >= EXPECTED_COUNT) return { seeded: 0, skipped: true, current };
  const data = loadSeedData();
  if (!data || !data.length) {
    console.log("[it-terms] Chưa có assets/it-terms.json.gz — bỏ qua seed.");
    return { seeded: 0, skipped: true, current };
  }
  const CHUNK = 500;
  let seeded = 0;
  for (let i = 0; i < data.length; i += CHUNK) {
    const chunk = data.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => "(?,?,?,?,?)").join(",");
    const params = [];
    for (const t of chunk) {
      params.push(t.key, t.korean, t.gloss_en || "", t.definition_kr || "", t.definition_vi || "");
    }
    await db.run(
      `INSERT INTO it_terms (key, korean, gloss_en, definition_kr, definition_vi)
       VALUES ${placeholders}
       ON CONFLICT (key) DO UPDATE SET
         korean = EXCLUDED.korean,
         gloss_en = EXCLUDED.gloss_en,
         definition_kr = EXCLUDED.definition_kr,
         definition_vi = CASE WHEN EXCLUDED.definition_vi <> '' THEN EXCLUDED.definition_vi ELSE it_terms.definition_vi END`,
      params
    );
    seeded += chunk.length;
  }
  console.log(`[it-terms] Seed xong ${seeded} thuật ngữ CNTT.`);
  return { seeded, skipped: false, current };
}

// ── Truy vấn cho trang duyệt (Phase 2) ──────────────────────────────────
// filter: 'all' | 'learned' | 'favorite' | 'untranslated'. Tìm trên korean + gloss_en + definition_vi.
function buildWhere({ q, filter }) {
  const cond = [];
  const params = [];
  if (q && q.trim()) {
    const like = `%${q.trim()}%`;
    cond.push("(t.korean ILIKE ? OR t.gloss_en ILIKE ? OR t.definition_vi ILIKE ?)");
    params.push(like, like, like);
  }
  if (filter === "learned") cond.push("p.learned = TRUE");
  else if (filter === "favorite") cond.push("p.favorite = TRUE");
  else if (filter === "untranslated") cond.push("(t.definition_vi IS NULL OR t.definition_vi = '')");
  return { where: cond.length ? `WHERE ${cond.join(" AND ")}` : "", params };
}

async function searchTerms({ userId, q = "", filter = "all", offset = 0, limit = 40 }) {
  const { where, params } = buildWhere({ q, filter });
  const rows = await db.query(
    `SELECT t.key, t.korean, t.gloss_en, t.definition_kr, t.definition_vi,
            COALESCE(p.learned, FALSE) AS learned, COALESCE(p.favorite, FALSE) AS favorite
     FROM it_terms t
     LEFT JOIN it_term_progress p ON p.term_key = t.key AND p.user_id = ?
     ${where}
     ORDER BY t.korean
     LIMIT ? OFFSET ?`,
    [userId, ...params, Math.min(Number(limit) || 40, 100), Math.max(Number(offset) || 0, 0)]
  );
  return rows;
}

async function countTerms({ userId, q = "", filter = "all" }) {
  const { where, params } = buildWhere({ q, filter });
  const needsJoin = filter === "learned" || filter === "favorite";
  const sql = needsJoin
    ? `SELECT COUNT(*) FROM it_terms t LEFT JOIN it_term_progress p ON p.term_key=t.key AND p.user_id=? ${where}`
    : `SELECT COUNT(*) FROM it_terms t ${where}`;
  const args = needsJoin ? [userId, ...params] : params;
  return Number(await db.scalar(sql, args).catch(() => 0));
}

// ── Tiến độ theo user (Phase 3) ─────────────────────────────────────────
async function ensureProgressRow(userId, termKey) {
  await db.run(
    `INSERT INTO it_term_progress (user_id, term_key) VALUES (?, ?)
     ON CONFLICT (user_id, term_key) DO NOTHING`,
    [userId, termKey]
  );
}

async function setLearned(userId, termKey, learned) {
  await ensureProgressRow(userId, termKey);
  await db.run(
    "UPDATE it_term_progress SET learned=? WHERE user_id=? AND term_key=?",
    [!!learned, userId, termKey]
  );
}

async function toggleFavorite(userId, termKey) {
  await ensureProgressRow(userId, termKey);
  const row = await db.one("SELECT favorite FROM it_term_progress WHERE user_id=? AND term_key=?", [userId, termKey]);
  const next = !(row && row.favorite);
  await db.run("UPDATE it_term_progress SET favorite=? WHERE user_id=? AND term_key=?", [next, userId, termKey]);
  return next;
}

// Chấm 1 lượt ôn SRS (grade 'good' | 'again') cho thuật ngữ.
async function reviewTerm(userId, termKey, grade) {
  await ensureProgressRow(userId, termKey);
  const row = await db.one(
    "SELECT srs_interval, srs_ease, srs_reps FROM it_term_progress WHERE user_id=? AND term_key=?",
    [userId, termKey]
  );
  const next = srs.review(
    { reps: row.srs_reps, interval_days: row.srs_interval, ease: row.srs_ease },
    grade === "again" ? "again" : "good"
  );
  await db.run(
    `UPDATE it_term_progress SET srs_due=?, srs_interval=?, srs_ease=?, srs_reps=?, learned=TRUE
     WHERE user_id=? AND term_key=?`,
    [next.due.toISOString(), next.interval_days, next.ease, next.reps, userId, termKey]
  );
  return next;
}

// Bộ thẻ để học: ưu tiên đến hạn ôn (srs_due<=NOW) → thuật ngữ yêu thích → còn lại (mới/chưa học).
// Luôn có thẻ kể cả user mới (giới thiệu thuật ngữ mới theo alphabet Hàn).
async function getStudyDeck(userId, limit = 12) {
  return db.query(
    `SELECT t.key, t.korean, t.gloss_en, t.definition_kr, t.definition_vi,
            p.srs_due, COALESCE(p.favorite, FALSE) AS favorite
     FROM it_terms t
     LEFT JOIN it_term_progress p ON p.term_key = t.key AND p.user_id = ?
     WHERE COALESCE(p.learned, FALSE) = FALSE OR (p.srs_due IS NOT NULL AND p.srs_due <= NOW())
     ORDER BY CASE WHEN p.srs_due IS NOT NULL AND p.srs_due <= NOW() THEN 0 ELSE 1 END,
              CASE WHEN COALESCE(p.favorite, FALSE) THEN 0 ELSE 1 END,
              t.korean
     LIMIT ?`,
    [userId, Math.min(Number(limit) || 12, 50)]
  );
}

async function userStats(userId) {
  const learned = Number(await db.scalar("SELECT COUNT(*) FROM it_term_progress WHERE user_id=? AND learned=TRUE", [userId]).catch(() => 0));
  const favorite = Number(await db.scalar("SELECT COUNT(*) FROM it_term_progress WHERE user_id=? AND favorite=TRUE", [userId]).catch(() => 0));
  const total = Number(await db.scalar("SELECT COUNT(*) FROM it_terms").catch(() => 0));
  const translated = Number(await db.scalar("SELECT COUNT(*) FROM it_terms WHERE definition_vi <> ''").catch(() => 0));
  return { learned, favorite, total, translated };
}

module.exports = {
  ensureItTermsSchema,
  seedItTerms,
  loadSeedData,
  searchTerms,
  countTerms,
  setLearned,
  toggleFavorite,
  reviewTerm,
  getStudyDeck,
  userStats,
  EXPECTED_COUNT,
};
