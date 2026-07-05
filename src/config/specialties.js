// Danh mục chuyên ngành từ vựng. Gom vào 1 tab "Chuyên ngành" ở sidebar → trang hub này để
// user chọn lĩnh vực (tránh mỗi ngành một mục nav làm sidebar quá dài).
// Thêm ngành mới = thêm 1 mục ở đây + dựng trang dữ liệu riêng, đặt available:true + href.
// available:false = "Sắp có" (hiển thị mờ, chưa vào được).
const SPECIALTIES = [
  {
    slug: "cntt",
    name: "Công nghệ thông tin",
    tag: "TTA · 19.620 thuật ngữ",
    icon: "code",
    desc: "Thuật ngữ CNTT – viễn thông (Hàn–Việt) từ từ điển TTA 정보통신용어사전.",
    href: "/it-vocab",
    available: true,
  },
  { slug: "y-te", name: "Y tế · Điều dưỡng", tag: "Sắp có", icon: "medical_services", desc: "Thuật ngữ y khoa, điều dưỡng, chăm sóc sức khỏe.", href: "", available: false },
  { slug: "kinh-doanh", name: "Kinh doanh · Văn phòng", tag: "Sắp có", icon: "business_center", desc: "Từ vựng công sở, thương mại, hợp đồng.", href: "", available: false },
  { slug: "nha-hang", name: "Nhà hàng · Phục vụ", tag: "Sắp có", icon: "restaurant", desc: "Phục vụ, lễ tân, ẩm thực, khách sạn.", href: "", available: false },
];

module.exports = { SPECIALTIES };
