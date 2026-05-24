# FTKA Node/Express Web App

FTKA is a Vietnamese/Korean learning web app built with Node.js, Express, Nunjucks, PostgreSQL, Google AI Studio, Google OAuth, SMTP email, and SePay payments.

## What this app does

- User auth: register, login, logout, Google login, email verification, password reset.
- Learning dashboard: shows vocabulary/grammar totals, weekly activity, streaks, focus words.
- Vocabulary: generate words with AI, add manually, import JSON, group words, mark learned, delete.
- Grammar: add grammar patterns with AI explanations/quizzes, review grammar quiz.
- Listening practice: generate Korean listening lessons, transcript, translation, questions, audio.
- Quiz: review unlearned vocabulary with TTS/audio and example-based questions.
- Admin: manage users, vocab, grammar, listening lessons, audio, activity, payments/logs.
- Premium billing: SePay VietQR checkout, webhook confirmation, premium plan activation.

## Tech stack

- Runtime: Node.js
- Web: Express 4
- Views: Nunjucks templates in `views/`
- Static files: `public/` served as `/static`
- DB: PostgreSQL via `pg`
- Auth/session: `express-session`, `passport`, `passport-google-oauth20`, `bcryptjs`
- Email: `nodemailer`
- AI: Google AI Studio API
- Payment: `sepay-pg-node`

## Project structure

```txt
src/
  app.js                  Express app setup, middleware, route mounting
  server.js               DB schema init + app.listen
  config/env.js           .env loader + env config
  db/index.js             PostgreSQL wrapper + SQLite-style ? placeholder converter
  middleware/             auth, flash, view context, premium guard
  routes/                 web, api, admin, payment, webhook routes
  services/               business logic: auth, AI, learning, listening, payment, email
  utils/                  async handler, time, URL helper
views/                    Nunjucks pages/layouts
public/                   CSS, JS, uploads, generated audio
data/settings.json        app/admin settings
scripts/test-email.js     SMTP test script
```

## Request flow

```txt
Browser
  -> Express app (`src/app.js`)
  -> global middleware
     -> security headers
     -> JSON/form parsing
     -> session
     -> passport
     -> current user loader
     -> flash/view context
  -> routes
     -> web pages (`src/routes/web.js`)
     -> JSON API (`src/routes/api.js`)
     -> admin (`src/routes/admin.js`)
     -> payments (`src/routes/payment.routes.js`)
     -> webhooks (`src/routes/webhook.routes.js`)
  -> services
  -> PostgreSQL / external APIs
  -> Nunjucks HTML or JSON response
```

## Important logic

### Auth flow

1. User registers at `/register`.
2. `authService.createUser()` validates username/email/password.
3. Password is hashed with bcrypt.
4. User is saved as local account, not email-verified.
5. Verification token is generated and sent by email.
6. Until verified, user is redirected to `/verify-email-required`.
7. `/verify-email?token=...` validates token and marks email verified.

Google login uses Passport OAuth. Google users are treated as verified.

Password reset:

1. `/forgot-password` accepts email.
2. Response is generic to avoid account enumeration.
3. Reset token is emailed if account is valid.
4. `/reset-password` validates token and updates password.

### Learning flow

- `/dashboard` loads recent vocab/grammar, learning activity, streak, source breakdown.
- `/vocab` lists words with pagination and groups.
- `/grammar` lists grammar items with level counts.
- `/quiz` picks random unlearned vocab and example pool.
- Learned words are updated through `/api/mark_learned`.
- Learning activity is recorded when a word changes from unlearned to learned.

### AI generation flow

Vocabulary generation:

```txt
POST /api/generate
  -> validate topic/count/group
  -> load existing user words
  -> ai.generateVocabularyBatch()
  -> insert new vocab
  -> optionally assign to vocab group
  -> return JSON items
```

Manual word:

```txt
POST /api/manual_add
  -> validate duplicate
  -> ai.translateSpecificWord()
  -> save vocab
```

Grammar:

```txt
POST /api/add_grammar
  -> validate duplicate
  -> ai.generateGrammarData()
  -> save grammar + quiz_items JSON
```

Listening:

```txt
POST /listening-practice/generate
  -> listening.createLesson()
  -> AI lesson content
  -> TTS/audio generation
  -> save lesson
  -> redirect or JSON response
```

### Payment flow

```txt
/pricing
  -> list active plans
  -> user chooses plan
  -> POST /api/payments/sepay/create-order
  -> create local order
  -> call SePay checkout
  -> user pays VietQR
  -> SePay sends POST /api/webhooks/sepay
  -> app verifies/processes webhook
  -> payment row saved
  -> order marked paid
  -> user's plan/premium_until updated
```

Premium is activated only after webhook confirmation.

## Environment variables

Create `.env` from `.env.example` or set these values:

```env
PORT=8080
NODE_ENV=development
SESSION_SECRET=change-this-long-random-secret
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ftka
BASE_URL=http://localhost:8080
APP_URL=http://127.0.0.1:8080

GOOGLE_AI_STUDIO_API_KEY=
GOOGLE_AI_STUDIO_MODEL=gemma-4-31b-it

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://127.0.0.1:8080/auth/google/callback

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
MAIL_FROM="FTKA <no-reply@example.com>"

LISTENING_AUDIO_DIR=./public/audio
LISTENING_TTS_VOICE=ko-KR-SunHiNeural
LISTENING_TTS_RATE=+0%

SEPAY_ENV=sandbox
SEPAY_MERCHANT_ID=
SEPAY_SECRET_KEY=
SEPAY_IPN_SECRET=
```

Never commit real API keys, SMTP passwords, OAuth secrets, or payment secrets.

## Setup

```bash
npm install
npm run check
npm start
```

Open:

```txt
http://127.0.0.1:8080
```

On startup, `src/server.js` runs:

- `ensureAuthSchema()`
- `ensureBillingSchema()`

These create/alter required auth and payment tables.

## Common routes

### Public/auth

- `GET /`
- `GET /login`, `POST /login`
- `GET /register`, `POST /register`
- `GET /forgot-password`, `POST /forgot-password`
- `GET /reset-password`, `POST /reset-password`
- `GET /auth/google`
- `GET /auth/google/callback`

### User pages

- `GET /dashboard`
- `GET /vocab`
- `GET /grammar`
- `GET /generator`
- `GET /quiz`
- `GET /grammar-quiz`
- `GET /listening-practice`
- `GET /pricing`
- `GET /account/billing`

### API

- `POST /api/generate`
- `POST /api/manual_add`
- `POST /api/add_grammar`
- `POST /api/mark_learned`
- `POST /api/delete_word`
- `POST /api/delete_grammar`
- `GET /api/tts?text=...`
- `POST /api/payments/sepay/create-order`
- `POST /api/webhooks/sepay`

## DB notes

The DB wrapper in `src/db/index.js` accepts SQL with `?` placeholders and converts them to PostgreSQL `$1`, `$2`, etc. It also converts some old SQLite-style syntax like `INSERT OR IGNORE` to PostgreSQL `ON CONFLICT DO NOTHING`.

## Development notes

- Keep route handlers thin.
- Put business logic in `src/services/`.
- Use `asyncHandler()` for async Express handlers.
- Use `loginRequired` for user-only pages/API.
- Use `adminRequired` for admin pages/API.
- Use `url_for()` in Nunjucks templates instead of hardcoded URLs when possible.
- Static files are served from `public/` at `/static`.
- Uploaded/generated audio is under `public/audio` or `public/uploads`.

## Recent bug fix

Password policy is now consistent:

- Register requires at least 10 characters.
- Password reset now also requires at least 10 characters.
- Shared validation lives in `authService.validatePassword()` internally.
