---
name: cloud-stream-deployer
description: >-
  Conteneurisation Docker, CI/CD GitHub Actions, et déploiement automatisé multi-plateformes
  (Render, Koyeb, Railway, VPS) pour les serveurs et addons Nuvio/Stremio avec healthchecks et keep-alive.
---

# Cloud Stream Deployer & CI/CD Guide

Ce skill fournit les manifestes et configurations prêts à l'emploi pour conteneuriser, tester et déployer l'addon Nuvio/Stremio sur le cloud (Render, Koyeb, VPS Docker) sans interruption de service.

---

## 1. `Dockerfile` Multi-Stage Optimisé (<90 MB)

À placer à la racine du projet (`Dockerfile`) :

```dockerfile
# Étape 1 : Dépendances
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# Étape 2 : Runtime léger & sécurisé
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=7000

# Création d'un utilisateur non-root pour la sécurité
USER node

# Copie des dépendances et du code source
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node . .

EXPOSE 7000

# Healthcheck natif Docker
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:7000/manifest.json || exit 1

CMD ["node", "index.js"]
```

---

## 2. GitHub Actions CI/CD (`.github/workflows/test-and-deploy.yml`)

Permet de valider l'intégrité de tous les providers à chaque push ou pull-request :

```yaml
name: Test Providers & Auto-Deploy

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Install Dependencies
        run: npm ci

      - name: Run Providers Verification Test
        run: npm test

  deploy:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Render Deploy Webhook
        if: env.RENDER_DEPLOY_HOOK != ''
        env:
          RENDER_DEPLOY_HOOK: ${{ secrets.RENDER_DEPLOY_HOOK }}
        run: |
          curl -X POST "$RENDER_DEPLOY_HOOK"
```

---

## 3. Configuration Render (`render.yaml`)

Pour un déploiement instantané "Infrastructure as Code" sur Render :

```yaml
services:
  - type: web
    name: nuvio-french-providers
    env: node
    plan: free
    region: frankfurt
    buildCommand: npm install
    startCommand: node index.js
    healthCheckPath: /manifest.json
    autoDeploy: true
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 10000
```

---

## 4. Prévention de l'Endormissement Render (Anti-Sleep Ping)

Sur le plan gratuit de Render, le service se met en veille après 15 minutes d'inactivité, causant un délai de 50 secondes au prochain démarrage.

### Solution Native (Self-Ping Cron dans Express) :

```javascript
/**
 * Auto-ping pour maintenir l'addon éveillé de 8h à minuit
 * @param {string} publicUrl - ex: 'https://nuvio-french-providers.onrender.com'
 */
function startKeepAlive(publicUrl) {
  if (!publicUrl) return;
  setInterval(async () => {
    try {
      const now = new Date();
      const hour = now.getUTCHours() + 2; // Heure de Paris (UTC+2)
      // On garde éveillé seulement pendant les heures d'audience (08h00 - 00h30)
      if (hour >= 8 && hour <= 24) {
        await fetch(`${publicUrl}/manifest.json`);
        console.log('[KeepAlive] Self-ping réussi.');
      }
    } catch (e) {
      console.warn('[KeepAlive] Erreur ping:', e.message);
    }
  }, 10 * 60 * 1000); // Toutes les 10 minutes
}
```
