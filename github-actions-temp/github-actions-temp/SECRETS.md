# 🔐 CONFIGURATION DES SECRETS GITHUB - PSA GRADING APP

## 📋 Vue d'ensemble

Ce document décrit tous les secrets GitHub Actions requis pour le déploiement automatisé de l'application PSA Grading. Ces secrets sont configurés dans **Repository Settings → Secrets and Variables → Actions**.

## 🚨 SECRETS OBLIGATOIRES

### 1. 🏠 Configuration Serveurs

| Secret Name | Description | Format | Exemple |
|------------|-------------|--------|---------|
| `DOMAIN` | Domaine production principal | domain.com | `psa-grading.com` |
| `STAGING_HOST` | IP/Domaine serveur staging | IP ou FQDN | `192.168.1.100` |
| `STAGING_USER` | Utilisateur SSH staging | username | `psa-app` |
| `STAGING_PORT` | Port SSH staging | number | `22` |
| `STAGING_SSH_KEY` | Clé privée SSH staging | private key | `-----BEGIN OPENSSH PRIVATE KEY-----...` |
| `PRODUCTION_HOST` | IP/Domaine serveur production | IP ou FQDN | `production.server.com` |
| `PRODUCTION_USER` | Utilisateur SSH production | username | `psa-app` |
| `PRODUCTION_PORT` | Port SSH production | number | `22` |
| `PRODUCTION_SSH_KEY` | Clé privée SSH production | private key | `-----BEGIN OPENSSH PRIVATE KEY-----...` |

### 2. 🔐 Secrets Cryptographiques

| Secret Name | Description | Génération | Longueur |
|------------|-------------|------------|----------|
| `SESSION_SECRET` | Secret sessions Express | `openssl rand -base64 64` | 64+ chars |
| `PSA_SECRET` | Secret application PSA | `openssl rand -base64 64` | 64+ chars |
| `JWT_SECRET` | Secret tokens JWT | `openssl rand -base64 64` | 64+ chars |
| `PSA_CLIENT_SECRET` | Secret client PSA | `openssl rand -base64 64` | 64+ chars |

### 3. 🔑 Mots de Passe Admin

| Secret Name | Description | Exigences | Génération |
|------------|-------------|-----------|------------|
| `STAGING_ADMIN_PASSWORD` | Admin staging | 20+ chars, complexe | `openssl rand -base64 32` |
| `PRODUCTION_ADMIN_PASSWORD` | Admin production | 20+ chars, complexe | `openssl rand -base64 32` |

### 4. 🗄️ Bases de Données

| Secret Name | Description | Format |
|------------|-------------|--------|
| `STAGING_DATABASE_URL` | PostgreSQL staging | `postgresql://user:pass@host:port/db?sslmode=require` |
| `PRODUCTION_DATABASE_URL` | PostgreSQL production | `postgresql://user:pass@host:port/db?sslmode=require` |

### 5. 📧 Services Externes

| Secret Name | Description | Source |
|------------|-------------|--------|
| `BREVO_API_KEY` | Clé API Brevo/Sendinblue | https://app.brevo.com/settings/keys/api |
| `PSA_EMAIL` | Email compte PSA | Compte professionnel PSA |
| `PSA_PASSWORD` | Mot de passe compte PSA | Compte professionnel PSA |

## 🔧 SECRETS OPTIONNELS

### 1. 📊 Monitoring et Notifications

| Secret Name | Description | Utilisation |
|------------|-------------|-------------|
| `SLACK_WEBHOOK` | Webhook Slack notifications | Alertes déploiement |
| `GRAFANA_ADMIN_PASSWORD` | Admin Grafana dashboard | Monitoring avancé |
| `GRAFANA_SECRET_KEY` | Secret Grafana | Sécurité dashboard |

### 2. 👥 Gestion des Déploiements

| Secret Name | Description | Format |
|------------|-------------|--------|
| `PRODUCTION_APPROVERS` | Approbateurs production | `user1,user2,user3` |

### 3. ☁️ Backup et Stockage

| Secret Name | Description | Service |
|------------|-------------|---------|
| `BACKUP_S3_BUCKET` | Bucket S3 backups | AWS S3 |
| `AWS_ACCESS_KEY_ID` | Clé accès AWS | AWS IAM |
| `AWS_SECRET_ACCESS_KEY` | Secret AWS | AWS IAM |

### 4. 🛍️ Intégration Shopify

| Secret Name | Description | Optionnel |
|------------|-------------|-----------|
| `SHOPIFY_SHOP_DOMAIN` | Domaine boutique Shopify | Si intégration |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | Token admin Shopify | Si intégration |
| `SHOPIFY_STOREFRONT_ACCESS_TOKEN` | Token storefront Shopify | Si intégration |

## 🛠️ GUIDE DE CONFIGURATION

### 1. Générer les Clés SSH

```bash
# Générer une paire de clés pour déploiement
ssh-keygen -t ed25519 -C "github-actions-psa-grading" -f ~/.ssh/psa_deploy

# Ajouter la clé publique sur vos serveurs
ssh-copy-id -i ~/.ssh/psa_deploy.pub psa-app@your-staging-server.com
ssh-copy-id -i ~/.ssh/psa_deploy.pub psa-app@your-production-server.com

# Copier le contenu de la clé privée dans GitHub Secrets
cat ~/.ssh/psa_deploy
# → Ajouter comme STAGING_SSH_KEY et PRODUCTION_SSH_KEY
```

### 2. Générer les Secrets Cryptographiques

```bash
# Générer tous les secrets nécessaires
echo "SESSION_SECRET=$(openssl rand -base64 64)"
echo "PSA_SECRET=$(openssl rand -base64 64)" 
echo "JWT_SECRET=$(openssl rand -base64 64)"
echo "PSA_CLIENT_SECRET=$(openssl rand -base64 64)"

# Générer mots de passe admin sécurisés
echo "STAGING_ADMIN_PASSWORD=$(openssl rand -base64 32)"
echo "PRODUCTION_ADMIN_PASSWORD=$(openssl rand -base64 32)"
```

### 3. Configurer les URLs de Base de Données

```bash
# Format PostgreSQL avec SSL
STAGING_DATABASE_URL="postgresql://username:password@staging-db-host:5432/psa_grading_staging?sslmode=require"
PRODUCTION_DATABASE_URL="postgresql://username:password@prod-db-host:5432/psa_grading_prod?sslmode=require"
```

### 4. Configuration dans GitHub

1. **Aller dans Repository Settings**
   - Repository → Settings → Secrets and Variables → Actions

2. **Ajouter les Secrets**
   - Click "New repository secret"
   - Nom exact du secret (sensible à la casse)
   - Valeur du secret (jamais affichée après sauvegarde)

3. **Vérifier la Configuration**
   - Minimum 10-15 secrets configurés
   - Tous les secrets obligatoires présents
   - Pas d'espaces ou caractères étranges

## ⚡ ENVIRONNEMENTS GITHUB

### Configuration par Environment

Vous pouvez configurer des environments séparés dans **Repository Settings → Environments** :

- **staging** : Déploiement automatique depuis `develop`
- **production** : Déploiement avec approbation depuis `main`

### Secrets par Environment

| Environment | Secrets spécifiques |
|-------------|-------------------|
| `staging` | `STAGING_*` secrets |
| `production` | `PRODUCTION_*` secrets |
| `global` | Secrets partagés (cryptographiques) |

## 🔍 VALIDATION ET TESTS

### Vérifier la Configuration

```bash
# Test de connexion SSH
ssh -i ~/.ssh/psa_deploy psa-app@your-server.com "echo 'SSH OK'"

# Test de base de données
psql "postgresql://user:pass@host:5432/db?sslmode=require" -c "SELECT 1;"

# Test API Brevo
curl -X GET "https://api.brevo.com/v3/account" -H "api-key: YOUR_KEY"
```

### Workflow de Test

1. **Push sur branche test** → déclenche validation
2. **Vérification secrets** → GitHub Actions vérifie configuration
3. **Tests automatisés** → utilise `.env.test.template`
4. **Déploiement staging** → si tests passent
5. **Validation manuelle** → puis production

## 🚨 SÉCURITÉ CRITIQUE

### ✅ Bonnes Pratiques

- ✅ **Secrets uniques** par environnement (staging ≠ production)
- ✅ **Rotation régulière** (90 jours maximum)
- ✅ **Mots de passe complexes** (20+ caractères)
- ✅ **Clés SSH dédiées** pour GitHub Actions
- ✅ **Audit régulier** des accès et permissions
- ✅ **Backup sécurisé** des secrets dans coffre-fort

### ❌ Risques à Éviter

- ❌ **Jamais** de secrets dans le code
- ❌ **Jamais** de secrets dans les logs
- ❌ **Jamais** de partage des clés SSH
- ❌ **Jamais** de réutilisation mot de passe admin
- ❌ **Jamais** de secrets en plain text dans documentation

## 🆘 TROUBLESHOOTING

### Problèmes Courants

| Erreur | Cause | Solution |
|--------|-------|---------|
| SSH Connection refused | Clé SSH incorrecte | Vérifier format clé privée complète |
| Database connection failed | URL mal formée | Vérifier format PostgreSQL + SSL |
| API key invalid | Clé expirée/incorrecte | Régénérer depuis service |
| Permission denied | User SSH incorrect | Vérifier utilisateur sur serveur |

### Logs de Debugging

Les workflows GitHub Actions loggent (sans exposer les secrets) :
- ✅ Connexions réussies
- ❌ Échecs d'authentification  
- 🔍 Étapes de déploiement
- 📊 Métriques de performance

## 📞 SUPPORT

En cas de problème avec la configuration des secrets :

1. **Vérifier** ce document en premier
2. **Tester** individuellement chaque secret
3. **Consulter** les logs GitHub Actions
4. **Régénérer** les secrets suspects
5. **Contacter** l'équipe DevOps si problème persistant

---

> ⚠️ **RAPPEL SÉCURITÉ** : Ce document décrit la configuration mais ne contient aucun secret réel. Tous les secrets doivent être stockés uniquement dans GitHub Secrets.