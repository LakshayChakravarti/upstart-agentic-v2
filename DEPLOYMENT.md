# Deployment Guide — Upstart Agentic V2

> [!WARNING]
> **DISPOSABLE FREE DEMO SETUP — NOT FOR PRODUCTION**
> The free-tier deployment configuration outlined here uses an **ephemeral local filesystem** for SQLite.
> Any data stored in the database (users, ideas, saved blueprints, RAG vector chunks) **will be permanently wiped** whenever the Render free-tier instance spins down due to inactivity, restarts, or is redeployed.
> For persistent production use, an external managed database (e.g., PostgreSQL) or a persistent disk on a paid hosting plan (Render Starter tier or higher) is required.

---

## Architecture Overview

- **Backend**: Node.js / Express deployed on **Render Free Web Service** (configured via `render.yaml`).
- **Frontend**: Next.js 16 (App Router) deployed on **Vercel** or any static/Node host.
- **Database**: SQLite with `better-sqlite3` and WAL mode, stored ephemerally at `./data/upstart.db`.
- **Health Check**: Synchronous zero-dependency endpoint at `GET /health`.

---

## 1. Backend Deployment (Render Free Web Service)

### A. Automatic Deployment via Blueprint (`render.yaml`)
1. In your Render Dashboard, click **New +** → **Blueprint**.
2. Connect your repository. Render detects `render.yaml` automatically.
3. Configure the following environment variables when prompted:
   - `GROQ_API_KEY`: Your Groq API key (used for fast reasoning).
   - `GEMINI_API_KEY`: Your Google Gemini API key (used for embeddings and primary generation).
   - `TAVILY_API_KEY`: Your Tavily search API key (used for live market research).
   - `JWT_SECRET`: A secure random string (minimum 32 characters).
     *Generate with:* `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
   - `FRONTEND_URL`: The full URL of your deployed frontend (e.g., `https://your-app.vercel.app`).

### B. Manual Web Service Configuration (Alternative)
- **Environment**: Node
- **Root Directory**: `backend`
- **Build Command**: `npm install`
- **Start Command**: `node server.js`
- **Plan**: Free
- **Health Check Path**: `/health`

---

## 2. Frontend Deployment (Vercel)

1. Import the repository on Vercel.
2. Set the **Root Directory** to `frontend`.
3. Add the environment variable:
   - `NEXT_PUBLIC_API_URL`: Your Render backend service URL (e.g., `https://upstart-backend.onrender.com`).
4. Deploy.

---

## 3. Post-Deployment Verification

1. **Health Check**:
   ```bash
   curl -i https://your-backend.onrender.com/health
   # Expected: HTTP 200 {"status":"ok","version":"1.0.0"}
   ```
2. **CORS Verification**:
   Ensure `FRONTEND_URL` on Render matches your frontend origin exactly (including `https://` without a trailing slash).
3. **Council Generation**:
   `USE_COUNCIL="true"` is enabled by default in `render.yaml` to run the 4-persona adversarial Council synthesis.
