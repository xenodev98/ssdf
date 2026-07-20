# Déployer "Fiches" gratuitement (Groq + Render)

## Ce qui a changé dans le code
- `server.py` appelle maintenant l'API **Groq** (gratuite, sans carte bancaire) au lieu d'une librairie interne qui ne fonctionnait qu'en interne chez Anthropic — elle n'aurait jamais marché une fois déployée.
- Le frontend (`static/index.html`, `static/app.js`, `static/styles.css`) est maintenant servi **par le même serveur** que l'API. Un seul service à héberger, pas de souci de CORS.
- `app.js` appelle l'API en chemin relatif (plus besoin de configurer une URL séparée).

## Étape 1 — Récupérer une clé Groq (gratuit)
1. Va sur https://console.groq.com/keys
2. Crée un compte (email ou Google), aucune carte bancaire demandée.
3. Clique sur "Create API Key", copie la clé (elle commence par `gsk_...`).
4. Limites gratuites : ~30 requêtes/minute, largement suffisant pour démarrer. Si ton app grossit, tu pourras passer au tier "Developer" (toujours pas cher).

## Étape 2 — Mettre le code sur GitHub
1. Crée un dépôt GitHub (public ou privé, peu importe).
2. Mets-y tout le contenu de ce dossier (`server.py`, `requirements.txt`, `static/`).

```bash
git init
git add .
git commit -m "Fiches app"
git branch -M main
git remote add origin https://github.com/TON_USER/TON_REPO.git
git push -u origin main
```

## Étape 3 — Déployer sur Render (gratuit)
1. Va sur https://render.com et crée un compte (tu peux te connecter avec GitHub).
2. Clique "New +" → "Web Service".
3. Connecte ton dépôt GitHub.
4. Configure :
   - **Runtime** : Python 3
   - **Build Command** : `pip install -r requirements.txt`
   - **Start Command** : `python server.py`
   - **Instance Type** : Free
5. Dans l'onglet "Environment", ajoute une variable :
   - **Key** : `GROQ_API_KEY`
   - **Value** : ta clé `gsk_...`
6. Clique "Create Web Service". Render va builder et déployer (2-3 minutes).
7. Une fois prêt, tu as une URL du type `https://fiches-xxxx.onrender.com` — c'est ton app, accessible à tout le monde.

## À savoir sur le tier gratuit de Render
- Le service **s'endort après 15 minutes d'inactivité** et met ~30-50 secondes à se réveiller au prochain visiteur. Normal sur le plan gratuit.
- Les données (`SUBSCRIBED`, `FICHES`) sont stockées **en mémoire** : elles sont perdues à chaque redémarrage/mise en veille du service. Pour un vrai lancement avec des utilisateurs qui reviennent, il faudra une vraie base de données (ex. Render propose aussi un Postgres gratuit) — dis-moi si tu veux qu'on ajoute ça.

## Pour tester en local avant de déployer
```bash
export GROQ_API_KEY="ta_cle_ici"
pip install -r requirements.txt
python server.py
# puis ouvre http://localhost:8000
```
