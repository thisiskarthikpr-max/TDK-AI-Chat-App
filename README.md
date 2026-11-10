# TDK AI Chat App

A responsive AI chat application built as a take-home assignment. This phase adds email/password authentication with JWT sessions and protected routes to the React/Vite frontend and Express/Mongoose API.

## Current features

- `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, and `GET /api/auth/me`
- Bcrypt password hashes (cost 12), generic login failures, Zod request validation, Helmet headers, CORS restriction, and per-IP auth rate limiting
- 15-minute bearer access token kept in frontend memory; 7-day HttpOnly refresh cookie restores the session after a reload
- Protected `/` route with responsive login and signup screens
- `GET /api/health` reports whether MongoDB is connected

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

The auth integration tests use `mongodb-memory-server`, so they do not use the local MongoDB database. On the first run, MongoDB Memory Server downloads its test binary. The suite covers signup and password hashing, login and generic failures, refresh-cookie exchange, and protected `/me` access.
