FROM node:20-alpine

WORKDIR /app

# Optimisation du cache npm
COPY package*.json ./
RUN npm ci --only=production

# Copie du code source
COPY . .

ENV NODE_ENV=production
ENV PORT=8000

EXPOSE 8000

# Healthcheck natif
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8000/manifest.json || exit 1

CMD ["node", "index.js"]
