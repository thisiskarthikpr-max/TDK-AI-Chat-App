# TDK AI Chat App

A responsive AI chat application built as a take-home assignment. The React/Vite frontend and Express/Mongoose API now support JWT authentication and per-user saved chat history.

## Current features

- `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, and `GET /api/auth/me`
- Bcrypt password hashes (cost 12), generic login failures, Zod request validation, Helmet headers, CORS restriction, and per-IP auth rate limiting
- 15-minute bearer access token kept in frontend memory; 7-day HttpOnly refresh cookie restores the session after a reload
- Refresh JWTs rotate on use; MongoDB stores only SHA-256 hashes with an expiry TTL index. Logout deletes the current refresh record, and replay of a consumed token revokes every refresh token for that user.
- Concurrent refreshes share one frontend promise; tabs serialize refreshes with Web Locks where supported. MongoDB atomically consumes refresh records, and a short retry window avoids treating parallel tabs as token theft.
- Per-user chat creation, list, message history, rename, and delete APIs; the responsive sidebar groups conversations by date
- Protected `/` and `/chat/:id` routes with responsive login/signup screens and mobile sidebar behavior
- `GET /api/health` reports whether MongoDB is connected

## Chat history API

- `GET /api/chats?limit=50&skip=0` lists the signed-in user's chats, newest first.
- `POST /api/chats` creates an empty `New chat` record.
- `GET /api/chats/:id/messages` loads messages in chronological order.
- `PATCH /api/chats/:id` renames an owned chat; `DELETE /api/chats/:id` deletes the chat and its messages.
- All routes require a bearer access token. Chat and message queries include the authenticated `userId`; unknown, malformed, and other users' IDs return `404`.

## Run locally

Use Node.js 26 (`nvm use` reads `.nvmrc`), run MongoDB locally, and copy `.env.example` to `.env` at the repository root. Install and start each app in separate terminals:

```sh
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

The API runs on `http://localhost:4000`; the Vite app runs on `http://localhost:5173`.

## Verify authentication

```sh
cd backend && npm test
```

The backend integration tests use `mongodb-memory-server`, so they do not use the local MongoDB database. On the first run, MongoDB Memory Server downloads its test binary. The suite covers signup and password hashing, duplicate emails, wrong-password behavior, refresh rotation and reuse, parallel refresh calls, logout revocation, missing/expired access tokens, and protected `/me` access. Chat tests verify that one user cannot read, rename, or delete another user's chat and that deleting an owned chat removes its messages.

## Authentication security controls

- Helmet security headers are enabled globally. CORS allows the configured `CLIENT_ORIGIN` and credentials; it does not reflect arbitrary origins.
- `/api/auth/*` is limited to 10 requests per minute per IP by default (`AUTH_RATE_LIMIT_MAX` can adjust the limit).
- The server exits before connecting to MongoDB when either JWT secret is missing. The sample values in `.env.example` are placeholders and must be replaced for deployment.
- JWT signing and verification are pinned to HS256. Passwords must be 8–72 UTF-8 bytes (the bcrypt input limit); emails are trimmed, validated, and lowercased before lookup or storage.
- The refresh-token collection stores token hashes, not raw refresh JWTs. MongoDB removes expired records through a TTL index. Access tokens are short lived; refresh-token revocation does not invalidate an already-issued access token before its 15-minute expiry.
