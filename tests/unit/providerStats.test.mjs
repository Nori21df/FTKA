import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "module";

// aiLogService là CommonJS (dùng EventEmitter) → nạp qua createRequire.
const require = createRequire(import.meta.url);
const aiLog = require("../../src/services/aiLogService.js");

// Gói C2: providerStats() gộp độ trễ theo provider từ ring buffer trong bộ nhớ.
// Chỉ tính log có provider + duration_ms; status "success" = thành công, còn lại = hỏng.
describe("aiLogService.providerStats", () => {
  beforeEach(() => aiLog.clearAiLogs());

  it("buffer rỗng → mảng rỗng", () => {
    expect(aiLog.providerStats()).toEqual([]);
  });

  it("bỏ qua log không có provider hoặc không có duration_ms", () => {
    aiLog.addAiLog({ provider: "", status: "success", duration_ms: 100 }); // thiếu provider
    aiLog.addAiLog({ provider: "groq", status: "progress" });              // OMIT duration (vd "Calling model") → lưu null
    expect(aiLog.providerStats()).toEqual([]);
  });

  it("tính avg trên các lượt THÀNH CÔNG, success_rate trên TỔNG lượt", () => {
    aiLog.addAiLog({ provider: "groq", status: "success", duration_ms: 400 });
    aiLog.addAiLog({ provider: "groq", status: "success", duration_ms: 600 });
    aiLog.addAiLog({ provider: "groq", status: "progress", duration_ms: 50 }); // "Bỏ qua" = hỏng
    const groq = aiLog.providerStats().find((s) => s.provider === "groq");
    expect(groq.attempts).toBe(3);
    expect(groq.ok).toBe(2);
    expect(groq.avg_ms).toBe(500);          // (400+600)/2, KHÔNG tính lượt hỏng 50ms
    expect(groq.success_rate).toBe(67);     // round(2/3*100)
  });

  it("last_ms = lượt thành công GẦN NHẤT (log mới nhất nằm đầu buffer)", () => {
    aiLog.addAiLog({ provider: "google", status: "success", duration_ms: 1000 }); // cũ hơn
    aiLog.addAiLog({ provider: "google", status: "success", duration_ms: 1700 }); // mới nhất
    const g = aiLog.providerStats().find((s) => s.provider === "google");
    expect(g.last_ms).toBe(1700);
  });

  it("provider toàn hỏng → avg_ms null, success_rate 0 (phản ánh sự cố)", () => {
    aiLog.addAiLog({ provider: "google", status: "error", duration_ms: 248 });
    aiLog.addAiLog({ provider: "google", status: "error", duration_ms: 300 });
    const g = aiLog.providerStats().find((s) => s.provider === "google");
    expect(g.avg_ms).toBeNull();
    expect(g.success_rate).toBe(0);
    expect(g.attempts).toBe(2);
  });

  it("sắp xếp theo avg_ms tăng dần; provider chưa có lượt thành công xếp cuối", () => {
    aiLog.addAiLog({ provider: "google", status: "error", duration_ms: 200 });   // avg null → cuối
    aiLog.addAiLog({ provider: "nvidia", status: "success", duration_ms: 1200 });
    aiLog.addAiLog({ provider: "groq", status: "success", duration_ms: 430 });
    const order = aiLog.providerStats().map((s) => s.provider);
    expect(order).toEqual(["groq", "nvidia", "google"]);
  });
});
