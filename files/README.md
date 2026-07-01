# FTKA API Router

Hệ thống định tuyến multi-provider AI cho FTKA (dịch & học tập Hàn-Việt, TOPIK).

## Cấu trúc

```
ftka-router/
├── core/
│   ├── providerConfig.js   # Metadata provider: tier, độ trễ, tác vụ ưu tiên
│   ├── circuitBreaker.js   # Tự ngắt provider lỗi liên tục
│   ├── quotaTracker.js     # Theo dõi quota ước tính theo phút/ngày
│   ├── responseCache.js    # Cache kết quả theo hash input
│   ├── sessionAffinity.js  # Giữ nguyên provider trong 1 phiên hội thoại
│   └── router.js           # Router chính, kết hợp tất cả chiến lược
├── providers/
│   ├── google.js
│   ├── groq.js
│   ├── nvidia.js
│   ├── cloudflare.js
│   └── openrouter.js
└── example.js               # Ví dụ sử dụng
```

## 5 chiến lược tối ưu đã tích hợp

1. **Định tuyến theo tác vụ** — mỗi `taskType` (translate / grammar / topik_answer / simple) có thứ tự provider ưu tiên riêng, khai báo trong `providerConfig.js`.
2. **Model tiering** — `router.js` tự ước lượng độ phức tạp câu hỏi (`_estimateComplexity`) để chọn model light/heavy, có thể ép buộc qua `forceTier`.
3. **Race mode** — gọi `router.chat(messages, { mode: "race", raceCount: 2 })` để gọi song song N provider, lấy kết quả về trước.
4. **Circuit breaker** — provider lỗi liên tiếp ≥ `failureThreshold` lần sẽ bị tạm ngắt trong `cooldownMs`, tự động thử lại sau (half-open).
5. **Session affinity** — truyền `sessionId` để giữ nguyên provider đã dùng thành công trong cùng phiên, tránh đổi văn phong liên tục.

Ngoài ra còn có: cache kết quả (tiết kiệm quota cho câu hỏi lặp), quota tracker (chủ động tránh provider sắp hết hạn mức), retry tự động cho lỗi 429.

## Cài đặt

```bash
npm install node-fetch   # nếu Node < 18 (chưa có fetch built-in)
```

## Sử dụng nhanh

```js
const { FTKARouter, TASK_TYPES } = require("./core/router");

const router = new FTKARouter({
  apiKeys: {
    google: "...",
    groq: "...",
    nvidia: "...",
    cloudflare: "...",
    cloudflareAccountId: "...",
    openrouter: "...",
  },
});

const { text, provider } = await router.chat(
  [{ role: "user", content: "Dịch: 안녕하세요" }],
  { taskType: TASK_TYPES.TRANSLATE, sessionId: "user-123" }
);
```

Xem `example.js` để biết thêm các tình huống cụ thể.

## Lưu ý khi triển khai thực tế

- **Quota limits** trong `example.js` là số ước tính, cần kiểm tra lại theo chính sách free tier hiện hành của từng provider tại thời điểm triển khai (các con số này có thể thay đổi).
- **NVIDIA NIM**: nên test thực tế chất lượng dịch Hàn-Việt trước khi tin tưởng đặt ưu tiên cao — model riva-translate chuyên dụng có thể không phủ tốt cặp ngôn ngữ này, nên dùng qua endpoint chat tương thích OpenAI với model LLM tổng quát.
- **Cache**: hiện là in-memory, mất khi restart server. Nếu cần persist, thay `responseCache.js` bằng Redis hoặc SQLite.
- **Validate chất lượng output**: với nội dung học tập (ngữ pháp, dịch), nên cân nhắc thêm bước kiểm tra/so sánh kết quả giữa 2 provider cho các câu hỏi khó, vì câu trả lời sai có thể gây hiểu nhầm nghiêm trọng hơn không có câu trả lời.
