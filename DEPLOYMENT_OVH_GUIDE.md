# 🚀 GUIDE COMPLET DE DÉPLOIEMENT OVH - PSA GRADING APP

## 📋 PRÉREQUIS OBLIGATOIRES

### ✅ Infrastructure OVH
- [ ] **VPS OVH** avec minimum 2 CPU, 4GB RAM, 40GB SSD
- [ ] **Base de données PostgreSQL** OVH avec SSL activé
- [ ] **Nom de domaine** pointant vers votre VPS
- [ ] **Certificat SSL** configuré (Let's Encrypt recommandé)

### ✅ Accès et Outils
- [ ] **Accès SSH** à votre VPS OVH
- [ ] **Git** installé sur le serveur
- [ ] **Node.js 18+** installé
- [ ] **PM2** installé globalement
- [ ] **Nginx** configuré comme reverse proxy

---

## 🔧 ÉTAPE 1 : PRÉPARATION DU SERVEUR

### 1.1 Connexion et mise à jour système

```bash
# Connexion SSH à votre VPS
ssh root@votre-serveur.ovh.net

# Mise à jour système
apt update && apt upgrade -y

# Installation des outils essentiels + dépendances health check
apt install -y curl git nginx certbot python3-certbot-nginx net-tools jq
```

### 1.2 Installation Node.js et PM2

```bash
# Installation Node.js 18 LTS
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt install -y nodejs

# Installation PM2 globalement
npm install -g pm2@latest

# Installation pm2-logrotate pour gestion automatique des logs
pm2 install pm2-logrotate

# Configuration pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 10
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
pm2 set pm2-logrotate:workerInterval 30
pm2 set pm2-logrotate:rotateInterval 0 0 * * *

# Vérification versions et modules
node --version  # >= 18.0.0
npm --version   # >= 9.0.0
pm2 --version   # >= 5.0.0
pm2 list        # Vérifier que pm2-logrotate est installé
```

### 1.3 Création utilisateur dédié (SÉCURITÉ)

```bash
# Créer utilisateur pour l'application
adduser --system --group --home /var/www --shell /bin/bash psa-app

# Créer répertoires
mkdir -p /var/www/psa-grading-app
mkdir -p /var/log/psa-grading
mkdir -p /var/backups/psa-grading

# Permissions
chown -R psa-app:psa-app /var/www/psa-grading-app
chown -R psa-app:psa-app /var/log/psa-grading
chmod 755 /var/www/psa-grading-app
chmod 755 /var/log/psa-grading
```

---

## 📦 ÉTAPE 2 : DÉPLOIEMENT DE L'APPLICATION

### 2.1 Clone et configuration

```bash
# Basculer sur utilisateur dédié
su - psa-app
cd /var/www

# Cloner le repository
git clone https://github.com/votre-username/psa-grading-app.git
cd psa-grading-app

# Copier et configurer environnement
cp .env.production.template .env

# ⚠️ CRITIQUE : Éditer .env avec vos vraies valeurs
nano .env
```

### 2.2 Configuration des variables d'environnement

**⚠️ REMPLACEZ TOUTES les valeurs dans .env :**

```bash
# Variables OBLIGATOIRES à configurer
NODE_ENV=production
PORT=5000
ALLOWED_ORIGINS=https://votre-domaine.com,https://www.votre-domaine.com
PUBLIC_URL=https://votre-domaine.com

# SECRETS (générez avec : openssl rand -base64 64)
ADMIN_PASSWORD=VotreMotDePasseUltraSecurise123!
SESSION_SECRET=VotreSecretSessionAleatoire
PSA_SECRET=VotreSecretPSAAleatoire
JWT_SECRET=VotreSecretJWTAleatoire
PSA_CLIENT_SECRET=VotreSecretClientAleatoire

# DATABASE OVH
DATABASE_URL=postgresql://username:password@postgresql-host.ovh.net:5432/psa_grading_prod?sslmode=require

# SERVICES EXTERNES
BREVO_API_KEY=VotreCleBrevoReelle
PSA_EMAIL=votre-email-psa@votredomaine.com
PSA_PASSWORD=VotreMotDePassePSA

# SHOPIFY (si utilisé)
SHOPIFY_SHOP_DOMAIN=votre-boutique.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_VotreTokenAdmin
SHOPIFY_STOREFRONT_ACCESS_TOKEN=VotreTokenStorefront
```

### 2.3 Installation dépendances et build

```bash
# Installation dépendances production
npm ci --production

# Installation dépendances dev pour build (si nécessaire)
npm install --save-dev

# Build de l'application (si applicable)
npm run build 2>/dev/null || echo "No build script, skipping..."

# Permissions finales
chmod +x scripts/*.sh 2>/dev/null || echo "No scripts directory"
```

---

## 🗄️ ÉTAPE 3 : CONFIGURATION BASE DE DONNÉES

### 3.1 Configuration PostgreSQL OVH

```bash
# Test de connexion database
node -e "
const pg = require('pg');
const client = new pg.Pool({ connectionString: process.env.DATABASE_URL });
client.query('SELECT NOW()', (err, res) => {
  if (err) console.error('❌ DB Error:', err);
  else console.log('✅ DB Connected:', res.rows[0]);
  client.end();
});
"
```

### 3.2 Initialisation des tables

```bash
# Lancement temporaire pour initialisation DB
NODE_ENV=production timeout 30 node server/index.js || echo "DB initialized"
```

---

## ⚙️ ÉTAPE 4 : CONFIGURATION NGINX

### 4.1 Configuration reverse proxy

```bash
# Créer configuration Nginx
sudo tee /etc/nginx/sites-available/psa-grading << 'EOF'
server {
    listen 80;
    server_name votre-domaine.com www.votre-domaine.com;
    
    # Redirection HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name votre-domaine.com www.votre-domaine.com;
    
    # SSL Configuration (Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/votre-domaine.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/votre-domaine.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;
    ssl_prefer_server_ciphers off;
    
    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload";
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header Referrer-Policy "strict-origin-when-cross-origin";
    
    # Limite de taille upload
    client_max_body_size 10M;
    
    # Proxy vers Node.js
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
    
    # Assets statiques avec cache long
    location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        proxy_pass http://127.0.0.1:5000;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
    
    # Health check
    location /healthz {
        proxy_pass http://127.0.0.1:5000;
        access_log off;
    }
}
EOF

# Activer la configuration
sudo ln -sf /etc/nginx/sites-available/psa-grading /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 4.2 Configuration SSL Let's Encrypt

```bash
# Installation certificat SSL
sudo certbot --nginx -d votre-domaine.com -d www.votre-domaine.com

# Test renouvellement automatique
sudo certbot renew --dry-run
```

---

## 🚀 ÉTAPE 5 : DÉMARRAGE AVEC PM2

### 5.1 Configuration PM2

```bash
# Retour utilisateur psa-app
su - psa-app
cd /var/www/psa-grading-app

# Démarrage avec PM2
pm2 start ecosystem.config.js --env production

# Vérification status
pm2 status
pm2 logs psa-grading-app --lines 50

# Sauvegarde configuration PM2
pm2 save

# Auto-démarrage système
pm2 startup
# Suivre les instructions affichées (commande à exécuter en root)
```

### 5.2 Configuration monitoring PM2

```bash
# Installation monitoring PM2 (optionnel)
pm2 install pm2-logrotate

# Configuration rotation logs
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 30
pm2 set pm2-logrotate:compress true
```

---

## 🔒 ÉTAPE 6 : SÉCURISATION AVANCÉE

### 6.1 Firewall UFW

```bash
# Configuration firewall
sudo ufw --force reset
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Autoriser SSH, HTTP, HTTPS
sudo ufw allow ssh
sudo ufw allow 'Nginx Full'

# Activer firewall
sudo ufw --force enable
sudo ufw status verbose
```

### 6.2 Fail2Ban (protection brute force)

```bash
# Installation Fail2Ban
sudo apt install -y fail2ban

# Configuration pour Nginx
sudo tee /etc/fail2ban/jail.local << 'EOF'
[nginx-http-auth]
enabled = true
port = http,https
logpath = /var/log/nginx/error.log

[nginx-noscript]
enabled = true
port = http,https
logpath = /var/log/nginx/access.log
maxretry = 6

[nginx-badbots]
enabled = true
port = http,https
logpath = /var/log/nginx/access.log
maxretry = 2
EOF

# Démarrage service
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
sudo fail2ban-client status
```

### 6.3 Configuration des backups automatiques

```bash
# Script de backup
sudo tee /usr/local/bin/psa-backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/var/backups/psa-grading"
DATE=$(date +%Y%m%d_%H%M%S)

# Backup base de données
pg_dump $DATABASE_URL > $BACKUP_DIR/db_backup_$DATE.sql

# Backup fichiers application
tar -czf $BACKUP_DIR/app_backup_$DATE.tar.gz -C /var/www psa-grading-app

# Nettoyage anciens backups (garde 7 jours)
find $BACKUP_DIR -name "*.sql" -mtime +7 -delete
find $BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete

echo "Backup completed: $DATE"
EOF

sudo chmod +x /usr/local/bin/psa-backup.sh

# Cron job backup quotidien 2h du matin
echo "0 2 * * * /usr/local/bin/psa-backup.sh" | sudo crontab -
```

---

## ✅ ÉTAPE 7 : VÉRIFICATIONS POST-DÉPLOIEMENT

### 7.1 Tests automatisés

```bash
# Test santé application
curl -f https://votre-domaine.com/healthz || echo "❌ Health check failed"

# Test page principale
curl -I https://votre-domaine.com/ | grep "200 OK" || echo "❌ Main page failed"

# Test APIs critiques
curl -f https://votre-domaine.com/api/public/health || echo "❌ API health failed"
```

### 7.2 Monitoring et métriques

```bash
# Status PM2
pm2 monit

# Logs en temps réel
pm2 logs psa-grading-app --lines 100 -f

# Métriques serveur
htop
df -h
free -h
```

---

## 🚨 CHECKLIST SÉCURITÉ FINALE

### ✅ Sécurité Application
- [ ] **Toutes les variables** dans .env configurées avec vraies valeurs
- [ ] **Mots de passe forts** générés aléatoirement (20+ caractères)
- [ ] **Base de données SSL** activé et testé
- [ ] **HTTPS forcé** sur tout le domaine
- [ ] **Headers sécurité** configurés dans Nginx
- [ ] **Rate limiting** activé dans l'application
- [ ] **Logs masquage** des données sensibles testé

### ✅ Sécurité Infrastructure
- [ ] **Firewall UFW** activé avec règles restrictives
- [ ] **Fail2Ban** configuré contre brute force
- [ ] **SSH sécurisé** (clés uniquement, pas de root)
- [ ] **Utilisateur dédié** psa-app sans privilèges root
- [ ] **Permissions fichiers** strictes (755/644)
- [ ] **Certificat SSL** valide et auto-renouvelé
- [ ] **Backup automatique** quotidien configuré

### ✅ Monitoring Production
- [ ] **PM2 monitoring** actif et opérationnel
- [ ] **Logs rotation** configurée (30 jours max)
- [ ] **Health checks** toutes les 5 minutes
- [ ] **Alertes email** en cas de dysfonctionnement
- [ ] **Métriques performance** collectées
- [ ] **Backup testé** et restauration validée

---

## 🔄 PROCÉDURES MAINTENANCE

### Mise à jour application

```bash
# Sauvegarde avant mise à jour
sudo /usr/local/bin/psa-backup.sh

# Mise à jour code
su - psa-app
cd /var/www/psa-grading-app
git pull origin main
npm ci --production

# Redémarrage gracieux PM2
pm2 reload psa-grading-app
pm2 save

# Vérification post-mise-à-jour
curl -f https://votre-domaine.com/healthz
```

### Rollback d'urgence

```bash
# Arrêt application
pm2 stop psa-grading-app

# Retour version précédente
git reset --hard HEAD~1

# Redémarrage
pm2 start psa-grading-app
```

### Monitoring quotidien

```bash
# Vérifications manuelles quotidiennes
pm2 status                    # Status processus
sudo ufw status              # Status firewall
sudo fail2ban-client status  # Status protection
df -h                        # Espace disque
free -h                      # Mémoire disponible
```

---

## 📞 SUPPORT ET DÉPANNAGE

### Logs essentiels
- **Application PM2** : `pm2 logs psa-grading-app`
- **Nginx** : `/var/log/nginx/error.log`
- **Application** : `/var/log/psa-grading/error.log`
- **Système** : `journalctl -u nginx -f`

### Commandes de dépannage

```bash
# Redémarrage services
sudo systemctl restart nginx
pm2 restart psa-grading-app

# Test connectivité database
node -e "require('pg').Pool({connectionString:process.env.DATABASE_URL}).query('SELECT 1')"

# Vérification ports
sudo netstat -tlnp | grep :5000
sudo netstat -tlnp | grep :443
```

---

## ⚠️ POINTS CRITIQUES À RETENIR

1. **JAMAIS** commiter le fichier `.env` avec les vraies valeurs
2. **TOUJOURS** utiliser HTTPS en production (certificat SSL)
3. **CONFIGURER** les backups automatiques avant mise en prod
4. **TESTER** le processus de restauration régulièrement
5. **SURVEILLER** les logs d'erreur quotidiennement
6. **METTRE À JOUR** les dépendances de sécurité mensuellement

---

## 🎯 RÉSULTAT ATTENDU

Après cette procédure, vous aurez :
- ✅ **Application PSA Grading** fonctionnelle en HTTPS
- ✅ **Base de données PostgreSQL** sécurisée avec SSL
- ✅ **Monitoring PM2** avec clustering automatique
- ✅ **Backups quotidiens** automatisés
- ✅ **Sécurité renforcée** contre les attaques
- ✅ **Performance optimisée** avec cache et compression
- ✅ **Logs structurés** avec rotation automatique

**Votre application PSA Grading est prête pour la production ! 🚀**