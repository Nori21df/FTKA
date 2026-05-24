function currentTimestamp() {
  return new Date().toISOString();
}

function parseTimestamp(value) {
  if (!value || typeof value !== "string") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatRelativeDateLabel(value) {
  const parsed = parseTimestamp(value);
  if (!parsed) return "Gần đây";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  const diffDays = Math.round((today - day) / 86400000);
  if (diffDays === 0) return "Hôm nay";
  if (diffDays === 1) return "Hôm qua";
  return `${parsed.getDate()}/${parsed.getMonth() + 1}`;
}

function compactCreatedAt(value) {
  const parsed = parseTimestamp(value);
  if (!parsed) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

module.exports = {
  currentTimestamp,
  parseTimestamp,
  formatRelativeDateLabel,
  compactCreatedAt
};
