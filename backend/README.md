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

## Dev shortcut (delete before production)

**Ctrl+Shift+L** on the login page → instantly logs in as:
- Email: `dev@jarvis.local`
- Password: `devpass123`

The dev user is auto-created when the database initialises.

A yellow badge in the top-right corner reminds you it's active.

---

## API endpoints

| Method | Endpoint         | Body                                              |
|--------|-----------------|---------------------------------------------------|
| POST   | /auth/register  | name, email, password, confirm_password, target_role |
| POST   | /auth/login     | email, password                                   |
| GET    | /auth/me        | — (Bearer token required)                        |

All protected routes expect: `Authorization: Bearer <token>`

---

## Before going to production

- [ ] Delete the dev user block in `database.py`
- [ ] Delete the `useEffect` Ctrl+Shift+L block in `LandingPage.tsx`
- [ ] Delete the yellow DEV badge div in `LandingPage.tsx`
- [ ] Set a real `JWT_SECRET` environment variable
- [ ] Switch from SQLite to PostgreSQL
