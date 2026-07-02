// Nhãn tiếng Việt cho cấp độ / chủ đề / độ dài bài luyện nghe.
// Dùng làm Nunjucks filter (đăng ký trong src/app.js) thay cho chuỗi if/elif lặp
// trong template. Giá trị lạ trả về theo fallback cũ của template (giữ nguyên UI);
// rỗng/undefined trả về "—".

const LEVEL_LABELS = {
  beginner: "Sơ cấp",
  intermediate: "Trung cấp",
  advanced: "Cao cấp"
};

const TOPIC_LABELS = {
  daily_life: "Đời sống hàng ngày",
  school: "Trường học",
  work: "Công việc",
  travel: "Du lịch",
  shopping: "Mua sắm",
  food: "Ẩm thực",
  weather: "Thời tiết",
  culture: "Văn hóa"
};

const LENGTH_LABELS = {
  short: "Ngắn",
  medium: "Vừa"
};

// Mô phỏng đúng filter |title của Nunjucks: viết hoa chữ đầu mỗi từ, thường hoá phần còn lại.
function titleize(value) {
  return String(value)
    .split(" ")
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word))
    .join(" ");
}

function normalized(value) {
  return String(value == null ? "" : value).trim();
}

// Fallback cũ của level/topic trong template: |replace('_', ' ')|title
function levelLabel(value) {
  const raw = normalized(value);
  if (!raw) return "—";
  return LEVEL_LABELS[raw.toLowerCase()] || titleize(raw.replace(/_/g, " "));
}

// Chủ đề có thể là chuỗi tiếng Việt tự nhập (datalist) → pass-through qua fallback title.
function topicLabel(value) {
  const raw = normalized(value);
  if (!raw) return "—";
  return TOPIC_LABELS[raw.toLowerCase()] || titleize(raw.replace(/_/g, " "));
}

// Fallback cũ của length trong template: |title (không replace).
function lengthLabel(value) {
  const raw = normalized(value);
  if (!raw) return "—";
  return LENGTH_LABELS[raw.toLowerCase()] || titleize(raw);
}

module.exports = { levelLabel, topicLabel, lengthLabel, LEVEL_LABELS, TOPIC_LABELS, LENGTH_LABELS };
