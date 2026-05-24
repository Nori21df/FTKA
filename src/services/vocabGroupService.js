const fs = require("fs");
const path = require("path");
const db = require("../db");
const env = require("../config/env");
const { currentTimestamp } = require("../utils/time");

const CUSTOM_GROUP_NAME_LIMIT = 80;

function normalizeGroupName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").slice(0, CUSTOM_GROUP_NAME_LIMIT);
}

function slugifyGroupName(name) {
  const ascii = normalizeGroupName(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || `group-${Date.now()}`;
}

function exportDir() {
  const dir = path.join(env.rootDir, "data", "custom_vocab_groups");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function makeUniqueGroupSlug(name) {
  const base = slugifyGroupName(name);
  let slug = base;
  let suffix = 2;
  while (await db.one("SELECT id FROM vocab_groups WHERE slug=?", [slug])) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

function serialize(row) {
  if (!row) return null;
  return {
    ...row,
    count: Number(row.count || 0)
  };
}

async function getGroups(ownerUserId) {
  const rows = await db.query(
    `SELECT vocab_groups.id, vocab_groups.name, vocab_groups.slug, vocab_groups.export_path,
            vocab_groups.created_at, COUNT(vocab_group_items.vocab_id) AS count
     FROM vocab_groups
     LEFT JOIN vocab_group_items ON vocab_group_items.group_id = vocab_groups.id
     WHERE vocab_groups.owner_user_id=?
     GROUP BY vocab_groups.id
     ORDER BY vocab_groups.created_at DESC, vocab_groups.id DESC`,
    [ownerUserId]
  );
  return rows.map(serialize);
}

async function getAssignments(ownerUserId) {
  const rows = await db.query(
    `SELECT vocab_group_items.vocab_id, vocab_groups.id AS group_id, vocab_groups.name
     FROM vocab_group_items
     JOIN vocab_groups ON vocab_groups.id = vocab_group_items.group_id
     WHERE vocab_groups.owner_user_id=?
     ORDER BY LOWER(vocab_groups.name) ASC`,
    [ownerUserId]
  );
  const map = {};
  for (const row of rows) {
    map[row.vocab_id] = map[row.vocab_id] || [];
    map[row.vocab_id].push({ id: row.group_id, name: row.name });
  }
  return map;
}

async function exportSnapshot(groupId) {
  const group = await db.one("SELECT * FROM vocab_groups WHERE id=?", [groupId]);
  if (!group) return;
  const rows = await db.query(
    `SELECT vocab.*
     FROM vocab_group_items
     JOIN vocab ON vocab.id = vocab_group_items.vocab_id
     WHERE vocab_group_items.group_id=?
     ORDER BY vocab.created_at DESC, vocab.id DESC`,
    [groupId]
  );
  const outputPath = group.export_path || path.join(exportDir(), `${group.slug}.json`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify({ group: serialize({ ...group, count: rows.length }), vocab_items: rows }, null, 2), "utf8");
}

async function exportGroupsForVocab(vocabId) {
  const rows = await db.query("SELECT group_id FROM vocab_group_items WHERE vocab_id=?", [vocabId]);
  for (const row of rows) {
    await exportSnapshot(row.group_id);
  }
}

async function exportAllSnapshots() {
  const rows = await db.query("SELECT id FROM vocab_groups");
  for (const row of rows) await exportSnapshot(row.id);
}

async function createGroup(name, ownerUserId) {
  const groupName = normalizeGroupName(name);
  if (!groupName) throw new Error("Enter a group name first.");
  const existing = await db.one("SELECT id FROM vocab_groups WHERE owner_user_id=? AND LOWER(name)=LOWER(?)", [ownerUserId, groupName]);
  if (existing) throw new Error("Thư mục này đã tồn tại.");
  const slug = await makeUniqueGroupSlug(groupName);
  const exportPath = path.join(exportDir(), `${slug}.json`);
  await db.run(
    "INSERT INTO vocab_groups (name, slug, export_path, created_at, owner_user_id) VALUES (?, ?, ?, ?, ?)",
    [groupName, slug, exportPath, currentTimestamp(), ownerUserId]
  );
  const group = await db.one(
    `SELECT vocab_groups.*, COUNT(vocab_group_items.vocab_id) AS count
     FROM vocab_groups LEFT JOIN vocab_group_items ON vocab_group_items.group_id = vocab_groups.id
     WHERE vocab_groups.slug=? AND vocab_groups.owner_user_id=?
     GROUP BY vocab_groups.id`,
    [slug, ownerUserId]
  );
  await exportSnapshot(group.id);
  return serialize(group);
}

module.exports = {
  normalizeGroupName,
  getGroups,
  getAssignments,
  exportSnapshot,
  exportGroupsForVocab,
  exportAllSnapshots,
  createGroup,
  exportDir
};
