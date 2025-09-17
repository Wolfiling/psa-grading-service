# 🌍 CONFIGURATION DES ENVIRONNEMENTS GITHUB - PSA GRADING APP

## 📋 Vue d'ensemble

Ce guide explique comment configurer les **Environments** GitHub pour un déploiement automatisé sécurisé avec approbations et restrictions d'accès.

## 🏗️ ARCHITECTURE DES ENVIRONNEMENTS

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   DEVELOPMENT   │    │     STAGING     │    │   PRODUCTION    │
│                 │    │                 │    │                 │
│ • Local/Replit  │    │ • Auto Deploy   │    │ • Manual Approval│
│ • No restrictions│───▶│ • Branch: develop│───▶│ • Branch: main   │
│ • Mock services │    │ • staging.domain│    │ • Live domain    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 🔧 CONFIGURATION ENVIRONMENTS

### 1. Créer les Environments

**Repository → Settings → Environments → New Environment**

#### 🧪 Environment: `staging`

```yaml
Name: staging
Description: Pre-production environment for testing
Deployment branches: develop
URL: https://staging.${DOMAIN}
```

**Protection Rules:**
- ✅ Required reviewers: 1 person
- ✅ Wait timer: 0 minutes  
- ❌ Prevent self-review: false
- ✅ Deployment branch rule: `develop` only

**Environment Secrets:**
```
STAGING_HOST
STAGING_USER  
STAGING_SSH_KEY
STAGING_ADMIN_PASSWORD
STAGING_DATABASE_URL
```

#### 🏭 Environment: `production`

```yaml
Name: production
Description: Live production environment
Deployment branches: main
URL: https://${DOMAIN}
```

**Protection Rules:**
- ✅ Required reviewers: 2 people minimum
- ✅ Wait timer: 5 minutes
- ✅ Prevent self-review: true
- ✅ Deployment branch rule: `main` only
- ✅ Required status checks: tests, security-scan

**Environment Secrets:**
```
PRODUCTION_HOST
PRODUCTION_USER
PRODUCTION_SSH_KEY  
PRODUCTION_ADMIN_PASSWORD
PRODUCTION_DATABASE_URL
```

#### 🔍 Environment: `review` (Optionnel)

```yaml
Name: review
Description: Review apps for pull requests  
Deployment branches: All branches
URL: https://pr-${PR_NUMBER}.${STAGING_DOMAIN}
```

**Protection Rules:**
- ✅ Required reviewers: 1 person
- ✅ Auto-delete after 7 days
- ❌ Deployment branch rule: All branches

## 👥 CONFIGURATION DES REVIEWERS

### Staging Reviewers

**Rôle:** Validation technique rapide
**Personnes:** Développeurs seniors, DevOps
**Critères:** Tests passés, pas de régression

```yaml
Reviewers:
  - lead-developer
  - devops-engineer
Min Reviews: 1
Self Review: Allowed
```

### Production Reviewers

**Rôle:** Validation critique business + technique
**Personnes:** Tech Lead, Product Owner, DevOps Lead
**Critères:** Impact business, stabilité, sécurité

```yaml
Reviewers:
  - tech-lead
  - product-owner  
  - devops-lead
Min Reviews: 2
Self Review: Forbidden
```

## 🔐 SECRETS PAR ENVIRONNEMENT

### Secrets Partagés (Repository Level)

Ces secrets sont utilisés par tous les environnements :

```yaml
# Cryptographiques (identiques partout)
SESSION_SECRET
PSA_SECRET  
JWT_SECRET
PSA_CLIENT_SECRET

# Services externes
BREVO_API_KEY
PSA_EMAIL
PSA_PASSWORD

# Configuration globale
DOMAIN
SLACK_WEBHOOK
```

### Secrets Staging (Environment Level)

Spécifiques à l'environnement de staging :

```yaml
# Serveur staging
STAGING_HOST: "192.168.1.100"
STAGING_USER: "psa-app"  
STAGING_SSH_KEY: "-----BEGIN OPENSSH PRIVATE KEY-----..."

# Sécurité staging
STAGING_ADMIN_PASSWORD: "staging_secure_password_2024"

# Base données staging
STAGING_DATABASE_URL: "postgresql://staging_user:staging_pass@staging-db:5432/psa_grading_staging?sslmode=require"
```

### Secrets Production (Environment Level)

Critiques pour l'environnement de production :

```yaml
# Serveur production 
PRODUCTION_HOST: "production.server.com"
PRODUCTION_USER: "psa-app"
PRODUCTION_SSH_KEY: "-----BEGIN OPENSSH PRIVATE KEY-----..."

# Sécurité production (différente staging)
PRODUCTION_ADMIN_PASSWORD: "production_ultra_secure_password_2024"

# Base données production
PRODUCTION_DATABASE_URL: "postgresql://prod_user:prod_pass@prod-db:5432/psa_grading_prod?sslmode=require"

# Approbateurs
PRODUCTION_APPROVERS: "tech-lead,product-owner"
```

## 🚀 WORKFLOW DE DÉPLOIEMENT

### 1. Déploiement Staging (Automatique)

```mermaid
graph TD
    A[Push to develop] --> B[Run Tests]
    B --> C[Build Docker Image]
    C --> D[Security Scan]
    D --> E{All Checks Pass?}
    E -->|Yes| F[Deploy to Staging]
    E -->|No| G[Block Deployment]
    F --> H[Health Check]
    H --> I[Notify Team]
```

**Déclencheur:** Push sur `develop`
**Approbation:** 1 reviewer minimum
**Durée:** ~10-15 minutes
**URL:** https://staging.${DOMAIN}

### 2. Déploiement Production (Manuel)

```mermaid
graph TD
    A[Push to main] --> B[Run Tests]
    B --> C[Build Docker Image]  
    C --> D[Security Scan]
    D --> E{All Checks Pass?}
    E -->|Yes| F[Request Approval]
    E -->|No| G[Block Deployment]
    F --> H[Wait for 2 Reviewers]
    H --> I[Manual Approval]
    I --> J[Deploy to Production]
    J --> K[Health Check]
    K --> L[Notify Success]
```

**Déclencheur:** Push sur `main`
**Approbation:** 2 reviewers + 5 min wait
**Durée:** ~20-30 minutes  
**URL:** https://${DOMAIN}

## 🛡️ PROTECTION RULES DÉTAILLÉES

### Branch Protection Rules

**Repository → Settings → Branches**

#### Branch: `main`
- ✅ Require pull request reviews (2)
- ✅ Require status checks to pass
  - `test`
  - `build`
  - `security-scan`
- ✅ Require branches to be up to date
- ✅ Restrict pushes (Admin only)
- ✅ Allow force pushes (Disabled)

#### Branch: `develop`
- ✅ Require pull request reviews (1)  
- ✅ Require status checks to pass
  - `test`
  - `build`
- ✅ Allow force pushes (Enabled for development)

### Environment Protection Rules

#### Staging Protection
```yaml
protection_rules:
  required_reviewers: 1
  prevent_self_review: false
  wait_timer: 0
  allowed_branches:
    - develop
```

#### Production Protection
```yaml
protection_rules:
  required_reviewers: 2
  prevent_self_review: true
  wait_timer: 300  # 5 minutes
  allowed_branches:
    - main
  required_status_checks:
    - staging-deployment-success
```

## 📊 MONITORING DES DÉPLOIEMENTS

### Métriques Trackées

**Par Environment:**
- ✅ Taux de succès déploiement
- ⏱️ Durée moyenne déploiement
- 🔄 Nombre de rollbacks
- 👥 Reviewers les plus actifs

**Global:**
- 📈 Fréquence des déploiements
- 🐛 Taux d'erreur post-déploiement
- ⚡ Mean Time To Recovery (MTTR)

### Alertes Configurées

**Slack Notifications:**
- ✅ Déploiement staging réussi
- ❌ Échec déploiement quelconque
- ⏳ Approbation production en attente
- 🚨 Rollback déclenché

**Email Notifications:**
- 📧 Déploiement production réussi
- 🚨 Échec critique production
- 📊 Rapport hebdomadaire déploiements

## 🔄 PROCESSUS D'APPROBATION

### Template d'Approbation Staging

```markdown
## 🧪 Staging Deployment Review

**Branch:** develop
**Commit:** ${GITHUB_SHA}
**Author:** ${GITHUB_ACTOR}

### ✅ Checklist Review
- [ ] Tests automatisés passent
- [ ] Pas de régression connue
- [ ] Features testables en staging

### Approval Decision
- ✅ **APPROVE** - Ready for staging
- ❌ **REQUEST CHANGES** - Issues found

**Comments:** [Votre commentaire ici]
```

### Template d'Approbation Production

```markdown  
## 🏭 Production Deployment Review

**Branch:** main
**Commit:** ${GITHUB_SHA}
**Author:** ${GITHUB_ACTOR}
**Staging URL:** https://staging.${DOMAIN}

### 🔍 Pre-Production Checklist
- [ ] Staging deployment successful  
- [ ] Manual testing completed
- [ ] Performance acceptable
- [ ] No critical bugs reported
- [ ] Database migrations safe
- [ ] Rollback plan confirmed
- [ ] Business stakeholder approval

### 📊 Impact Assessment
**Risk Level:** [LOW/MEDIUM/HIGH]
**User Impact:** [Describe impact]
**Rollback Strategy:** [Describe plan]

### Approval Decision  
- ✅ **APPROVE** - Ready for production
- ❌ **REQUEST CHANGES** - Issues identified

**Reviewer:** [Your name]
**Comments:** [Detailed feedback]
```

## 🆘 TROUBLESHOOTING ENVIRONMENTS

### Problèmes Courants

| Issue | Symptôme | Solution |
|-------|----------|----------|
| Deployment blocked | "Required reviewers not met" | Add reviewers to environment |
| Wrong environment | Staging deploys to production | Check branch protection rules |
| Secrets not found | "Secret not available" | Verify environment-specific secrets |
| Approval timeout | Deployment stuck pending | Check reviewer notifications |

### Debug Commands

```bash
# Vérifier configuration environment
gh api repos/:owner/:repo/environments

# Lister les deployments  
gh api repos/:owner/:repo/deployments

# Voir protection rules
gh api repos/:owner/:repo/environments/production/protection-rules
```

## 🎯 BEST PRACTICES

### ✅ Recommandations

1. **Nommage Consistant**
   - Environments: `staging`, `production` (pas `prod`, `stage`)
   - Secrets: `{ENV}_SECRET_NAME` format

2. **Sécurité Progressive** 
   - Staging: Tests automatisés + 1 reviewer
   - Production: Tests + Security + 2 reviewers + Wait time

3. **Isolation Complète**
   - Secrets différents par environnement
   - Bases de données séparées  
   - Domaines distincts

4. **Documentation à Jour**
   - Reviewers actifs documentés
   - Processus d'escalade défini
   - Contacts d'urgence listés

### ❌ À Éviter

- ❌ Même mot de passe staging/production
- ❌ Auto-approval en production
- ❌ Secrets hardcodés dans workflow
- ❌ Reviewers indisponibles longtemps
- ❌ Déploiements vendredi soir

---

> 🚀 **Configuration complète** : Avec ces environments configurés, votre workflow PSA Grading App dispose d'un pipeline de déploiement professionnel avec toutes les protections nécessaires.