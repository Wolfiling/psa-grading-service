# 🔐 GUIDE CONFIGURATION SECRETS - PSA GRADING APP

## 🎯 VARIABLES D'ENVIRONNEMENT OBLIGATOIRES

Ce guide détaille toutes les variables à configurer dans votre fichier `.env` pour la production.

---

## 📧 CONFIGURATION BREVO (Email Service)

### Étape 1 : Obtenir votre clé API Brevo
1. Allez sur [https://app.brevo.com](https://app.brevo.com)
2. Créez un compte ou connectez-vous
3. Allez dans **Settings** → **API Keys** 
4. Cliquez sur **Generate a new API key**
5. Copiez votre clé (format : `xkeysib-...`)

```bash
# Dans votre .env
BREVO_API_KEY=xkeysib-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-abcdefghijklmnop
```

---

## 🗄️ CONFIGURATION BASE DE DONNÉES OVH

### Étape 1 : Base PostgreSQL OVH
1. Dans votre espace client OVH
2. Allez dans **Web Cloud** → **Bases de données**
3. Créez une base PostgreSQL ou utilisez existante
4. Notez les informations de connexion

```bash
# Format DATABASE_URL pour OVH
DATABASE_URL=postgresql://USERNAME:PASSWORD@HOST:PORT/DATABASE?sslmode=require

# Exemple réel:
DATABASE_URL=postgresql://psauser:motdepasse@postgresql-xxxxx.database.cloud.ovh.net:5432/psa_grading?sslmode=require
```

### Étape 2 : Vérification connexion
```bash
# Test de connexion depuis votre VPS
psql "postgresql://USERNAME:PASSWORD@HOST:PORT/DATABASE?sslmode=require" -c "SELECT version();"
```

---

## 🎮 CONFIGURATION PSA JAPAN

### Étape 1 : Compte PSA dédié
1. Créez un compte sur [https://www.psacard.co.jp](https://www.psacard.co.jp)
2. **IMPORTANT** : Utilisez un compte professionnel dédié à l'application
3. Notez vos identifiants

```bash
# Dans votre .env
PSA_EMAIL=votre-compte-professionnel@votreentreprise.com
PSA_PASSWORD=VotreMotDePassePSASecurise123!
```

### ⚠️ SÉCURITÉ PSA
- ✅ **Utilisez un compte dédié** : Ne pas utiliser votre compte personnel
- ✅ **Mot de passe fort** : 12+ caractères avec chiffres/symboles
- ✅ **Surveillance** : Vérifiez régulièrement l'activité du compte
- ⚠️ **Rate limiting** : PSA limite les requêtes (l'app gère automatiquement)

---

## 🔒 GÉNÉRATION DES SECRETS SÉCURISÉS

### Étape 1 : Génération automatique
```bash
# Connectez-vous à votre VPS et exécutez:
echo "=== SECRETS POUR VOTRE FICHIER .env ==="
echo "SESSION_SECRET=$(openssl rand -base64 64)"
echo "PSA_SECRET=$(openssl rand -base64 64)"
echo "JWT_SECRET=$(openssl rand -base64 64)"
echo "PSA_CLIENT_SECRET=$(openssl rand -base64 64)"
echo "ADMIN_PASSWORD=$(openssl rand -base64 32 | tr -d '+/=' | head -c 20)_Admin123!"
```

### Étape 2 : Copier dans .env
```bash
# Exemple de résultat à copier dans .env:
SESSION_SECRET=rB8vK2mN9xQ4wE7tY1uI0oP3aSdF6gH8jK9lZ2xC3vB4nM5qW7eR8tY0uI1oP2aS3dF4gH5jK6l
PSA_SECRET=nM8qW2eR5tY9uI1oP0aS4dF7gH3jK6lZ9xC2vB5nM8qW1eR4tY7uI0oP3aS6dF9gH2jK5lZ8x
JWT_SECRET=aS6dF9gH2jK5lZ8xC1vB4nM7qW0eR3tY6uI9oP2aS5dF8gH1jK4lZ7xC0vB3nM6qW9eR2tY5u
PSA_CLIENT_SECRET=F3gH6jK9lZ2xC5vB8nM1qW4eR7tY0uI3oP6aS9dF2gH5jK8lZ1xC4vB7nM0qW3eR6tY9uI2oP5a
ADMIN_PASSWORD=kF9mQ2vB8nX1wE4tY7uI0oP_Admin123!
```

---

## 🌐 CONFIGURATION DOMAINE ET URLS

### Étape 1 : Domaine OVH
```bash
# Remplacez par votre vrai domaine
ALLOWED_ORIGINS=https://votre-domaine.com,https://www.votre-domaine.com
PUBLIC_URL=https://votre-domaine.com
```

### Étape 2 : Vérification DNS
```bash
# Vérifiez que votre domaine pointe vers votre VPS
dig votre-domaine.com
nslookup votre-domaine.com
```

---

## 🛍️ CONFIGURATION SHOPIFY (Optionnelle)

### Si vous utilisez Shopify pour les paiements:

```bash
# Configuration Shopify dans .env
SHOPIFY_SHOP_DOMAIN=votre-boutique.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SHOPIFY_STOREFRONT_ACCESS_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Obtenir les tokens Shopify:
1. Allez dans votre admin Shopify
2. **Apps** → **Develop apps** → **Create an app**
3. Configurez les scopes nécessaires
4. Générez les tokens

---

## 🏃‍♂️ CONFIGURATION COMPLÈTE FINALE

### Fichier .env complet pour production:
```bash
# ===========================================
# CONFIGURATION PRODUCTION PSA GRADING APP
# ===========================================

# Environment
NODE_ENV=production
PORT=5000

# Domaine et CORS (REMPLACEZ PAR VOTRE DOMAINE)
ALLOWED_ORIGINS=https://votre-domaine.com,https://www.votre-domaine.com
PUBLIC_URL=https://votre-domaine.com

# Secrets sécurisés (GÉNÉREZ AVEC OPENSSL)
ADMIN_PASSWORD=VotreMotDePasseAdminSecurise123!
SESSION_SECRET=VotreSecretSessionGenereAvecOpenSSL
PSA_SECRET=VotreSecretPSAGenereAvecOpenSSL
JWT_SECRET=VotreSecretJWTGenereAvecOpenSSL
PSA_CLIENT_SECRET=VotreSecretClientGenereAvecOpenSSL

# Base de données OVH (REMPLACEZ PAR VOS IDENTIFIANTS)
DATABASE_URL=postgresql://username:password@host.ovh.net:5432/dbname?sslmode=require

# Service Email Brevo (REMPLACEZ PAR VOTRE CLÉ)
BREVO_API_KEY=xkeysib-VotreVraieCleBevoIci

# Compte PSA Japan (REMPLACEZ PAR VOS IDENTIFIANTS)
PSA_EMAIL=votre-compte-psa@votreentreprise.com
PSA_PASSWORD=VotreMotDePassePSA

# Shopify (optionnel - si paiements)
SHOPIFY_SHOP_DOMAIN=votre-boutique.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_VotreTokenAdminReel
SHOPIFY_STOREFRONT_ACCESS_TOKEN=VotreTokenStorefrontReel

# Configuration production
LOG_LEVEL=info
TRUST_PROXY=true
ENABLE_COMPRESSION=true
RATE_LIMIT_MAX=100
MAX_UPLOAD_SIZE=200
```

---

## ✅ VALIDATION CONFIGURATION

### Étape 1 : Test connexions
```bash
# Depuis votre VPS, testez chaque service:

# Test base de données
node -e "
const pg = require('pg');
require('dotenv').config();
const client = new pg.Pool({connectionString: process.env.DATABASE_URL});
client.query('SELECT NOW()', (err, res) => {
  console.log(err ? '❌ DB Error: ' + err.message : '✅ DB Connected: ' + res.rows[0].now);
  client.end();
});
"

# Test Brevo
curl -X GET \
  https://api.brevo.com/v3/account \
  -H "api-key: VOTRE_CLE_BREVO"

# Test application
curl https://votre-domaine.com/healthz
```

### Étape 2 : Vérification finale
```bash
# L'application doit démarrer sans erreur:
cd /var/www/psa-grading-app
pm2 restart psa-grading-app
pm2 logs --lines 10

# Rechercher ces messages de succès:
# ✅ Database initialized successfully
# ✅ PSA Scraper initialisé avec succès  
# ✅ Client authentication system initialized
# 🚀 PSA Grading App running on: http://0.0.0.0:5000
```

---

## 🚨 DÉPANNAGE CONFIGURATION

### Erreurs communes et solutions:

**❌ "Database connection failed"**
```bash
# Vérifiez DATABASE_URL avec espaces échappés
# Testez connexion manuelle:
psql "votre-database-url" -c "SELECT 1;"
```

**❌ "Brevo API key invalid"**
```bash
# Vérifiez format: doit commencer par xkeysib-
# Testez la clé:
curl -H "api-key: VOTRE_CLE" https://api.brevo.com/v3/account
```

**❌ "PSA authentication failed"**
```bash
# Vérifiez identifiants PSA en vous connectant manuellement
# Assurez-vous que le compte n'a pas de 2FA activé
```

**❌ "CORS error"**
```bash
# Vérifiez ALLOWED_ORIGINS inclut votre domaine exact
# Format: https://domain.com (pas de slash final)
```

---

## 🔄 MAINTENANCE DES SECRETS

### Rotation des secrets (tous les 90 jours):
```bash
# Générer nouveaux secrets:
openssl rand -base64 64  # Pour SESSION_SECRET
openssl rand -base64 64  # Pour PSA_SECRET
openssl rand -base64 64  # Pour JWT_SECRET

# Mettre à jour .env
# Redémarrer application
pm2 restart psa-grading-app
```

### Sauvegarde sécurisée:
```bash
# Backup chiffré de la configuration (sans secrets)
cp .env .env.backup.$(date +%Y%m%d)
# Stocker en lieu sûr, JAMAIS sur un repo public
```

---

## 🎉 CONFIGURATION TERMINÉE !

Une fois tous ces éléments configurés, votre PSA Grading App sera:
- ✅ **Sécurisée** avec des secrets forts générés
- ✅ **Connectée** à vos services (DB, Email, PSA)  
- ✅ **Accessible** via votre domaine OVH
- ✅ **Prête** pour la production

**Prochaine étape** : [GUIDE_DEPLOIEMENT_OVH_FINAL.md](./GUIDE_DEPLOIEMENT_OVH_FINAL.md)