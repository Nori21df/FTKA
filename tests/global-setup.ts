import { request, type FullConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Đăng nhập 1 lần bằng tài khoản test local rồi lưu storageState cho các test authed.
// Tài khoản này phải tồn tại sẵn trong DB dev và ĐÃ verify email (loginRequired ép verify).
// Cách tạo lại nếu DB bị xoá: đăng ký qua UI (/register) rồi mở link trong log server
// "[DEV VERIFY EMAIL URL] ..." — xem docs/REFACTOR_NOTES.md mục Phase 0.
const TEST_USER = { login: "uxreviewer", password: "ReviewPass2026!" };
export const AUTH_FILE = path.join(__dirname, ".auth", "user.json");

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL || "http://localhost:3000";
  const ctx = await request.newContext({ baseURL });

  const login = await ctx.post("/login", {
    form: { login: TEST_USER.login, password: TEST_USER.password, next: "" },
    maxRedirects: 0
  });
  if (login.status() !== 302 || !(login.headers()["location"] || "").includes("/dashboard")) {
    throw new Error(
      `Đăng nhập tài khoản test thất bại (status ${login.status()}). ` +
        `Cần user '${TEST_USER.login}' đã verify email trong DB dev — xem hướng dẫn trong tests/global-setup.ts.`
    );
  }

  // Seed 2 từ vựng cố định (1 chưa học + 1 đã học, created_at cũ để nằm ngoài chart 7 ngày).
  // Endpoint import bỏ qua từ trùng (theo owner + korean) nên gọi lặp là an toàn.
  const seedPath = path.join(__dirname, "fixtures", "seed-vocab.json");
  const seed = await ctx.post("/api/import_vocab", {
    multipart: {
      file: { name: "seed-vocab.json", mimeType: "application/json", buffer: fs.readFileSync(seedPath) }
    }
  });
  if (!seed.ok()) {
    throw new Error(`Seed vocab thất bại: ${seed.status()} ${await seed.text()}`);
  }

  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  await ctx.storageState({ path: AUTH_FILE });
  await ctx.dispose();
}
