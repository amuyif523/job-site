# JARVIS Backend — Auth Setup

## Folder structure

Place these files in `jarvis-ai-suite/backend/`:

```
backend/
├── main.py
├── auth.py
├── database.py
├── dependencies.py
├── models.py
├── security.py
└── requirements.txt
```

Place the updated frontend files:
```
src/lib/api.ts          ← replace existing
src/components/LandingPage.tsx  ← replace existing
```

---

## Backend setup

```bash
cd backend

# Create virtual environment
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # Mac/Linux

# Install dependencies
pip install -r requirements.txt

# Start server
uvicorn main:app --reload --port 8000
```

The server starts at http://localhost:8000
API docs at http://localhost:8000/docs

---

## API endpoints

| Method | Endpoint         | Body                                              |
|--------|-----------------|---------------------------------------------------|
| POST   | /auth/register  | name, email, password, confirm_password, target_role |
| POST   | /auth/login     | email, password                                   |
| POST   | /auth/logout    | —                                                |
| GET    | /auth/me        | — (cookie auth)                                  |

All protected routes expect the `access_token` HttpOnly cookie set by login/register/reset-password.

## Auth security notes

- Login and signup are rate-limited in-memory per IP/identifier.
- Logout invalidates the current JWT server-side by rotating the user's `token_version`.
- Password reset also rotates `token_version`, which expires older sessions.

## Cookie configuration

- `JWT_SECRET`: required in every environment.
- `COOKIE_SECURE`: optional. If omitted, secure cookies are enabled automatically when `FRONTEND_URL` is `https://...`.
- `COOKIE_SAMESITE`: optional. Allowed values: `lax`, `strict`, `none`.
- `FRONTEND_URL`: optional but recommended so local/dev/prod cookie behavior matches the deployed frontend.

If `COOKIE_SAMESITE=none` is set while secure cookies are disabled, the backend falls back to `lax` for safety.

---

## Before going to production

- [ ] Set a real `JWT_SECRET` environment variable
- [ ] Set `COOKIE_SECURE=true` behind HTTPS if you are not relying on `FRONTEND_URL` auto-detection
- [ ] Confirm `COOKIE_SAMESITE` matches your deployed frontend/backend topology
- [ ] Switch from SQLite to PostgreSQL
