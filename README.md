# TDK AI Chat App

A responsive AI chat application built as a take-home assignment. The project is being implemented in phases; this initial phase provides the React/Vite frontend scaffold and an Express API connected to MongoDB.

## Phase 1: scaffold and health check

- Frontend: React 19 with Vite 8
- Backend: Node.js 26 LTS, Express 5, and Mongoose 9 (`.nvmrc` pins the major version)
- Health endpoint: `GET /api/health`

Copy `.env.example` to `.env`, then install dependencies in `backend/` and `frontend/` and run MongoDB locally. Start the API with `cd backend && npm run dev` and the frontend with `cd frontend && npm run dev`. The API health endpoint returns `200` when MongoDB is connected and `503` otherwise.
