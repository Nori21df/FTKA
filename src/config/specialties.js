// Danh mục chuyên ngành từ vựng. Gom vào 1 tab "Chuyên ngành" ở sidebar → trang hub để user
// chọn lĩnh vực. Thêm ngành mới = thêm 1 mục ở đây (slug, domain, dataFile, count) + đặt asset
// assets/<dataFile>. Trang duyệt + API + seed đều tổng quát theo `domain`, không phải viết lại.
// available:false = "Sắp có" (hiển thị mờ, chưa vào được — chưa có dữ liệu).
const SPECIALTIES = [
  {
    slug: "cntt",
    domain: "cntt",
    name: "Công nghệ thông tin",
    tag: "TTA · 19.620 thuật ngữ",
    icon: "code",
    desc: "Thuật ngữ CNTT – viễn thông (Hàn–Việt) từ từ điển TTA 정보통신용어사전.",
    dataFile: "it-terms.json.gz",
    count: 19620,
    available: true,
  },
  {
    slug: "y",
    domain: "y",
    name: "Y khoa",
    tag: "KMLE · 2.244 thuật ngữ",
    icon: "medical_services",
    desc: "Thuật ngữ y khoa (Hàn–Anh–Việt) theo bộ KMLE — dành cho người học/làm ngành y tại Hàn.",
    dataFile: "y-terms.json.gz",
    count: 2244,
    available: true,
  },
  {
    slug: "marketing",
    domain: "marketing",
    name: "Marketing",
    tag: "675 thuật ngữ",
    icon: "campaign",
    desc: "Thuật ngữ marketing / digital / SEO / branding / growth (Hàn–Anh–Việt) từ Ascent, Sowonweb, AppsFlyer, i-boss, DFINERY + bộ biên soạn theo 12 mảng.",
    dataFile: "marketing-terms.json.gz",
    count: 675,
    available: true,
  },
  {
    slug: "oto",
    domain: "oto",
    name: "Cơ khí · Ô tô",
    tag: "KSAE · 30.195 thuật ngữ",
    icon: "directions_car",
    desc: "Thuật ngữ cơ khí – kỹ thuật ô tô (Hàn–Anh–Việt) theo bộ KSAE 한국자동차공학회.",
    dataFile: "auto-terms.json.gz",
    count: 30195,
    available: true,
  },
  {
    slug: "kinh-doanh",
    domain: "kinh-doanh",
    name: "Kinh doanh · Kinh tế",
    tag: "Hankyung · 13.459 thuật ngữ",
    icon: "business_center",
    desc: "Thuật ngữ kinh tế – kinh doanh – tài chính (Hàn–Anh–Việt) từ 한경 경제용어사전 (Hankyung).",
    dataFile: "business-terms.json.gz",
    count: 13459,
    available: true,
  },
  {
    slug: "topik",
    domain: "topik",
    name: "Từ vựng TOPIK",
    tag: "9.750 từ · theo đề + chủ đề",
    icon: "school",
    desc: "Từ vựng TOPIK (Hàn–Việt): theo đề thi thật (đề 35–64, phần Đọc/Nghe) và theo chủ đề.",
    dataFile: "topik-terms.json.gz",
    count: 9750,
    available: true,
  },
  {
    slug: "han-viet",
    domain: "han-viet",
    name: "Hán-Việt tương đồng",
    tag: "2.032 từ",
    icon: "translate",
    desc: "Từ tiếng Hàn gốc Hán có âm Hán-Việt giống tiếng Việt (검사=Kiểm tra, 결과=Kết quả) — học cực nhanh với người Việt.",
    dataFile: "hanviet-terms.json.gz",
    count: 2032,
    available: true,
  },
  { slug: "van-phong", domain: "van-phong", name: "Văn phòng", tag: "Sắp có", icon: "work", desc: "Từ vựng công sở, hành chính, email công việc.", available: false },
  { slug: "du-lich", domain: "du-lich", name: "Du lịch · Khách sạn", tag: "Sắp có", icon: "luggage", desc: "Từ vựng du lịch, lễ tân, nhà hàng, khách sạn.", available: false },
  { slug: "lam-dep", domain: "lam-dep", name: "Làm đẹp · Thẩm mỹ", tag: "Sắp có", icon: "spa", desc: "Từ vựng làm đẹp, mỹ phẩm, thẩm mỹ, spa.", available: false },
];

function getSpecialty(slug) {
  return SPECIALTIES.find((s) => s.slug === slug && s.available) || null;
}

module.exports = { SPECIALTIES, getSpecialty };
