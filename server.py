#!/usr/bin/env python3
"""Fiches backend — abonnement (par visiteur), génération IA de fiches, stockage."""
import json
import os
import time
import uuid

import httpx
from fastapi import FastAPI, Header, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

app = FastAPI(title="Fiches API")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

# --- Configuration IA (Groq — gratuit, compatible API OpenAI) ---
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "llama-3.3-70b-versatile"

# --- Configuration Google Sign-In ---
GOOGLE_CLIENT_ID = "160926224905-vg5aqskvad6jjolk0t07fmans0gf3g1u.apps.googleusercontent.com"

# Emails ayant un accès gratuit à vie (ex. toi-même, comptes de test, proches...).
FREE_ACCESS_EMAILS = {
    "nfeuillant@gmail.com",
}

# In-memory state keyed by visitor id (anonyme, ou compte Google une fois connecté).
SUBSCRIBED: dict[str, str] = {}     # visitor_id -> plan
FICHES: dict[str, list[dict]] = {}  # visitor_id -> [fiche, ...]
SESSIONS: dict[str, str] = {}       # session_id -> visitor_id canonique ("google:<sub>")
USERS: dict[str, dict] = {}         # visitor_id canonique -> {name, email, picture}

PLANS = {
    "decouverte": {"name": "Découverte", "price": "0,99 €", "period": "/ mois", "generations": 10},
    "pro": {"name": "Pro", "price": "4,99 €", "period": "/ mois", "generations": 100},
    "premium": {"name": "Premium", "price": "9,99 €", "period": "/ mois", "generations": 1000},
}


def visitor_id(x_visitor_id: str | None = Header(default=None, alias="X-Visitor-Id")) -> str:
    if not x_visitor_id:
        raise HTTPException(status_code=400, detail="Identifiant visiteur manquant")
    # Si c'est un identifiant de session (après connexion Google), on résout
    # vers l'identifiant canonique du compte ; sinon on garde l'id anonyme tel quel.
    return SESSIONS.get(x_visitor_id, x_visitor_id)


# ---------------- Subscription ----------------
@app.get("/api/me")
def me(vid: str = Depends(visitor_id)):
    plan = SUBSCRIBED.get(vid)
    user = USERS.get(vid)
    return {"subscribed": bool(plan), "plan": plan, "plans": PLANS, "user": user}


# ---------------- Connexion avec Google ----------------
@app.post("/api/auth/google")
async def auth_google(request: Request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=422, detail="JSON invalide")
    credential = body.get("credential")
    if not credential:
        raise HTTPException(status_code=422, detail="Jeton Google manquant")

    # Vérifie le jeton auprès de Google (évite d'accepter un jeton forgé).
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://oauth2.googleapis.com/tokeninfo",
                params={"id_token": credential},
            )
        if resp.status_code != 200:
            raise HTTPException(status_code=401, detail="Jeton Google invalide")
        payload = resp.json()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="Impossible de vérifier le jeton Google")

    if payload.get("aud") != GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=401, detail="Jeton Google destiné à une autre application")

    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Jeton Google incomplet")

    vid = f"google:{sub}"
    USERS[vid] = {
        "name": payload.get("name") or payload.get("email") or "Utilisateur",
        "email": payload.get("email") or "",
        "picture": payload.get("picture") or "",
    }
    FICHES.setdefault(vid, [])

    if USERS[vid]["email"] in FREE_ACCESS_EMAILS:
        SUBSCRIBED[vid] = "premium"

    session_id = "s" + uuid.uuid4().hex
    SESSIONS[session_id] = vid

    return {
        "session_id": session_id,
        "user": USERS[vid],
        "subscribed": vid in SUBSCRIBED,
        "plan": SUBSCRIBED.get(vid),
    }


@app.post("/api/subscribe")
async def subscribe(request: Request, vid: str = Depends(visitor_id)):
    try:
        data = await request.json()
    except Exception:
        data = {}
    plan = data.get("plan") if data.get("plan") in PLANS else "decouverte"
    SUBSCRIBED[vid] = plan
    FICHES.setdefault(vid, [])
    return {"subscribed": True, "plan": plan}


# ---------------- Fiches storage ----------------
@app.get("/api/fiches")
def list_fiches(vid: str = Depends(visitor_id)):
    if vid not in SUBSCRIBED:
        raise HTTPException(status_code=402, detail="Abonnement requis")
    return FICHES.get(vid, [])


@app.post("/api/fiches")
async def upsert_fiche(request: Request, vid: str = Depends(visitor_id)):
    if vid not in SUBSCRIBED:
        raise HTTPException(status_code=402, detail="Abonnement requis")
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=422, detail="JSON invalide")
    items = FICHES.setdefault(vid, [])
    now = time.time()
    fid = body.get("id")
    if fid:
        for f in items:
            if f["id"] == fid:
                f["title"] = body.get("title", "")
                f["subject_area"] = body.get("subject_area", "")
                f["content"] = body.get("content", "")
                f["updated"] = now
                return f
    f = {
        "id": fid or ("f" + uuid.uuid4().hex[:10]),
        "title": body.get("title", ""),
        "subject_area": body.get("subject_area", ""),
        "content": body.get("content", ""),
        "updated": now,
    }
    items.insert(0, f)
    return f


@app.delete("/api/fiches/{fiche_id}")
def delete_fiche(fiche_id: str, vid: str = Depends(visitor_id)):
    if vid not in SUBSCRIBED:
        raise HTTPException(status_code=402, detail="Abonnement requis")
    items = FICHES.get(vid, [])
    FICHES[vid] = [f for f in items if f["id"] != fiche_id]
    return {"deleted": fiche_id}


# ---------------- AI generation ----------------
SYSTEM_PROMPT = (
    "Tu es un créateur de fiches de révision pour étudiants francophones. "
    "À partir d'un sujet, tu produis une fiche claire, structurée et facile à mémoriser. "
    "Tu réponds en français, avec un niveau adapté à l'étudiant."
)

FORMAT_RULES = """\
Tu dois répondre en JSON strict, sans texte autour, avec cette forme :
{"title": "titre court de la fiche", "subject_area": "matière", "content": "contenu markdown"}

Le champ "content" doit utiliser UNIQUEMENT ce format markdown léger :
- # Titre de grande section
- ## Sous-section
- - puce (liste)
- Terme : définition  (sur une seule ligne, crée une carte définition)
- Question ? Réponse.  (sur une seule ligne, crée une carte révision)
- **gras** pour souligner un mot clé, ==texte== pour surligner

Structure la fiche ainsi :
1. Une section « Définition » avec la notion centrale (1-2 phrases).
2. Une section « Points clés » en puces (4-6 puces concises).
3. Une section « À retenir » avec 2-3 définitions au format « Terme : définition ».
4. Une section « Auto-évaluation » avec 3 questions au format « Question ? Réponse ».

Reste concis (la fiche doit tenir sur une page). Pas de code, pas de HTML, juste le markdown dans "content"."""


@app.post("/api/generate")
async def generate(request: Request, vid: str = Depends(visitor_id)):
    if vid not in SUBSCRIBED:
        raise HTTPException(status_code=402, detail="Abonnement requis")
    try:
        body = await request.json()
    except Exception:
        body = {}
    sujet = (body.get("subject") or "").strip()
    if not sujet:
        raise HTTPException(status_code=422, detail="Sujet requis")
    niveau = body.get("niveau") or "lycée"
    matiere = body.get("subject_area") or ""

    user_msg = (
        f"Sujet : {sujet}\n"
        + (f"Matière : {matiere}\n" if matiere else "")
        + f"Niveau : {niveau}\n\n"
        + FORMAT_RULES
    )

    if not GROQ_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="GROQ_API_KEY manquante côté serveur (variable d'environnement).",
        )

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                GROQ_URL,
                headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
                json={
                    "model": GROQ_MODEL,
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_msg},
                    ],
                    "max_tokens": 1200,
                    "response_format": {"type": "json_object"},
                },
            )
        if resp.status_code != 200:
            raise HTTPException(
                status_code=502, detail=f"Erreur IA ({resp.status_code}): {resp.text[:300]}"
            )
        result = resp.json()
        text = result["choices"][0]["message"]["content"]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Erreur IA: {e}")

    # Parse JSON (tolerate surrounding text / code fences).
    data = parse_llm_json(text)
    if not data:
        raise HTTPException(status_code=502, detail="Réponse IA illisible")

    return {
        "title": str(data.get("title") or sujet)[:120],
        "subject_area": str(data.get("subject_area") or matiere or "")[:60],
        "content": str(data.get("content") or "")[:8000],
    }


def parse_llm_json(text: str):
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
    # find first { and last }
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        return json.loads(text[start : end + 1])
    except Exception:
        return None


# ---------------- (request bodies are parsed manually for py3.14 annotation compat) ----------------



# ---------------- Frontend statique (même service, pas de CORS) ----------------
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")


@app.get("/")
def serve_index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


app.mount("/", StaticFiles(directory=STATIC_DIR), name="static")


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
