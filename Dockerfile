# ===============================================
# DOCKERFILE MULTI-STAGE - PSA GRADING APP
# ===============================================
# 🐳 Image Docker optimisée pour production
# 🚀 Build multi-stage pour réduire la taille
# 🔒 Configuration sécurisée pour GitHub Actions

# ===============================================
# STAGE 1: BUILD STAGE
# ===============================================
FROM node:18-alpine AS builder

# Métadonnées de l'image
LABEL maintainer="PSA Grading App Team"
LABEL description="PSA Pokemon Card Grading Service"
LABEL version="1.0.0"

# Arguments de build
ARG NODE_ENV=production
ARG BUILD_DATE
ARG VCS_REF

# Variables d'environnement pour le build
ENV NODE_ENV=$NODE_ENV
ENV NPM_CONFIG_LOGLEVEL=warn
ENV NPM_CONFIG_PRODUCTION=true

# Optimisations Alpine
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/cache/apk/*

# Création utilisateur non-root
RUN addgroup -g 1001 -S psa && \
    adduser -S psa -u 1001

# Configuration répertoire de travail
WORKDIR /app

# Copie des fichiers de configuration package
COPY package*.json ./
COPY vite.config.js ./

# Installation des dépendances avec cache optimization
RUN npm ci --only=production --silent --no-audit --no-fund && \
    npm cache clean --force

# Copie du code source
COPY --chown=psa:psa . .

# Build du frontend (si nécessaire)
RUN npm run build:client 2>/dev/null || echo "No client build step"

# ===============================================
# STAGE 2: RUNTIME STAGE
# ===============================================
FROM node:18-alpine AS runtime

# Arguments runtime
ARG BUILD_DATE
ARG VCS_REF
ARG NODE_ENV=production

# Labels pour traçabilité
LABEL org.opencontainers.image.title="PSA Grading App"
LABEL org.opencontainers.image.description="Pokemon Card Grading Service with Shopify Integration"
LABEL org.opencontainers.image.version="1.0.0"
LABEL org.opencontainers.image.created=$BUILD_DATE
LABEL org.opencontainers.image.revision=$VCS_REF
LABEL org.opencontainers.image.source="https://github.com/psa-grading/psa-grading-app"
LABEL org.opencontainers.image.licenses="MIT"

# Variables d'environnement runtime
ENV NODE_ENV=$NODE_ENV
ENV PORT=5000
ENV USER_ID=1001
ENV GROUP_ID=1001

# Installation des outils système nécessaires
RUN apk add --no-cache \
    dumb-init \
    ca-certificates \
    curl \
    && rm -rf /var/cache/apk/*

# Création utilisateur et groupes sécurisés
RUN addgroup -g $GROUP_ID -S psa && \
    adduser -S psa -u $USER_ID -G psa

# Configuration répertoires avec permissions appropriées
WORKDIR /app
RUN mkdir -p /app/uploads /app/server/uploads /app/logs && \
    chown -R psa:psa /app

# Copie des fichiers depuis le build stage
COPY --from=builder --chown=psa:psa /app/node_modules ./node_modules
COPY --from=builder --chown=psa:psa /app/package*.json ./
COPY --from=builder --chown=psa:psa /app/server ./server
COPY --from=builder --chown=psa:psa /app/public ./public
COPY --from=builder --chown=psa:psa /app/client ./client

# Copie des fichiers de configuration (SECURITY: .env files excluded - use runtime ENV vars)
# COPY --from=builder --chown=psa:psa /app/.env.* ./ # REMOVED FOR SECURITY - secrets via ENV vars only
COPY --from=builder --chown=psa:psa /app/ecosystem.config.js ./

# Scripts d'entrée et healthcheck
COPY --from=builder --chown=psa:psa /app/scripts ./scripts

# Configuration des permissions finales
RUN chmod +x /app/scripts/health-check.sh 2>/dev/null || echo "No health-check script"
RUN chmod -R 755 /app/uploads && \
    chmod -R 755 /app/logs

# Basculer vers utilisateur non-root
USER psa

# Configuration health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:$PORT/healthz || exit 1

# Exposition du port
EXPOSE $PORT

# Point d'entrée avec dumb-init pour gestion propre des signaux
ENTRYPOINT ["dumb-init", "--"]

# Commande par défaut
CMD ["node", "server/index.js"]

# ===============================================
# STAGE 3: DEVELOPMENT STAGE (optionnel)
# ===============================================
FROM builder AS development

# Variables pour le développement
ENV NODE_ENV=development

# Installation des dépendances de développement
RUN npm install --include=dev --silent

# Installation d'outils de développement
RUN apk add --no-cache \
    bash \
    vim \
    less

# Configuration pour hot reload
VOLUME ["/app/server", "/app/client", "/app/public"]

# Port pour développement
EXPOSE 5000 3000

# Commande développement avec nodemon
CMD ["npm", "run", "dev"]