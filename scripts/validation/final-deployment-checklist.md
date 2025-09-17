# ✅ CHECKLIST FINALE DÉPLOIEMENT OVH - PSA GRADING APP

## 📋 VALIDATION PRÉ-DÉPLOIEMENT

### 🖥️ **SERVEUR OVH**
- [ ] **VPS OVH commandé** (min. 2 CPU, 4GB RAM, 40GB SSD)
- [ ] **Accès SSH configuré** avec clé publique
- [ ] **Système Ubuntu/Debian à jour** (`apt update && apt upgrade`)
- [ ] **Nom de domaine** pointé vers l'IP du VPS
- [ ] **Ports 22, 80, 443 ouverts** dans le firewall OVH

### 🗄️ **BASE DE DONNÉES**
- [ ] **PostgreSQL OVH configurée** ou base externe
- [ ] **Utilisateur et mot de passe** créés
- [ ] **Connexion SSL activée** (recommandé)
- [ ] **URL de connexion** validée et testée
- [ ] **Permissions** configurées pour l'utilisateur

### 🔧 **CONFIGURATION LOCAL**
- [ ] **Fichiers customisés** avec `./scripts/deployment/customize-for-deployment.sh`
- [ ] **Domaine configuré** dans tous les fichiers
- [ ] **Email admin configuré** pour les alertes
- [ ] **Repository Git** accessible et à jour
- [ ] **Secrets générés** et sécurisés

---

## 🔐 CONFIGURATION .ENV

### ✅ **VARIABLES OBLIGATOIRES À CONFIGURER**

#### 🌐 Domaine et URLs
- [ ] `DOMAIN` = votre-domaine.com *(pas de https://)*
- [ ] `PUBLIC_URL` = https://votre-domaine.com
- [ ] `ALLOWED_ORIGINS` = https://votre-domaine.com,https://www.votre-domaine.com

#### 🔑 Secrets de sécurité (CRITIQUE)
- [ ] `ADMIN_PASSWORD` = mot de passe ultra sécurisé
- [ ] `SESSION_SECRET` = 64+ caractères aléatoireslimit
- [ ] `PSA_SECRET` = 64+ caractères aléatoires
- [ ] `JWT_SECRET` = 64+ caractères aléatoires
- [ ] `PSA_CLIENT_SECRET` = 64+ caractères aléatoires

#### 🗄️ Base de données
- [ ] `DATABASE_URL` = postgresql://user:pass@host:5432/db?sslmode=require

#### 📧 Configuration email
- [ ] `BREVO_API_KEY` = votre clé API Brevo/SendinBlue
- [ ] `PSA_EMAIL` = noreply@votre-domaine.com
- [ ] `ADMIN_EMAIL` = votre email pour alertes

#### 🛒 Shopify (si utilisé)
- [ ] `SHOPIFY_SHOP_DOMAIN` = boutique.myshopify.com
- [ ] `SHOPIFY_ADMIN_ACCESS_TOKEN` = shpat_xxxxx
- [ ] `SHOPIFY_STOREFRONT_ACCESS_TOKEN` = token storefront

### 🧪 **TESTS CONFIGURATION**
```bash
# Test connexion base de données
node -e "const {Pool}=require('pg'); const pool=new Pool({connectionString:process.env.DATABASE_URL}); pool.query('SELECT NOW()').then(r=>console.log('✅ DB OK:',r.rows[0])).catch(e=>console.error('❌ DB Error:',e.message))"

# Test Brevo API
curl -X GET "https://api.brevo.com/v3/account" -H "api-key: VOTRE_CLE_API"

# Test résolution DNS
nslookup votre-domaine.com
```

---

## 🚀 DÉPLOIEMENT ÉTAPE PAR ÉTAPE

### 📝 **1. PRÉPARATION FINALE**
```bash
# 1. Customisation automatique
./scripts/deployment/customize-for-deployment.sh votre-domaine.com admin@email.com

# 2. Configuration .env
cp .env.production.template .env
nano .env  # Configurer TOUTES les variables

# 3. Validation
chmod 600 .env
ls -la .env  # Doit montrer -rw-------
```

### 🔐 **2. SÉCURITÉ SERVEUR**
```bash
# Sur le serveur OVH en SSH
sudo ./scripts/security/setup-ufw.sh
sudo ./scripts/security/setup-fail2ban.sh
```

### 🚀 **3. DÉPLOIEMENT APPLICATION**
```bash
# Déploiement automatique complet
sudo DOMAIN=votre-domaine.com ADMIN_EMAIL=admin@email.com ./scripts/deployment/deploy-to-ovh.sh

# OU déploiement rapide personnalisé
sudo ./quick-deploy-votre-domaine.com.sh
```

### 🔐 **4. CONFIGURATION SSL**
```bash
# SSL Let's Encrypt automatique
sudo DOMAIN=votre-domaine.com ADMIN_EMAIL=admin@email.com ./scripts/ssl/setup-letsencrypt.sh
```

### 📊 **5. MONITORING**
```bash
# Configuration monitoring et alertes
sudo ADMIN_EMAIL=admin@email.com ./scripts/monitoring/setup-monitoring.sh
```

---

## 🧪 TESTS POST-DÉPLOIEMENT

### ✅ **TESTS AUTOMATIQUES**
```bash
# Health check application
curl -f https://votre-domaine.com/healthz

# Test redirection HTTP → HTTPS
curl -I http://votre-domaine.com/ | grep "301"

# Test base de données
cd /var/www/psa-grading-app
sudo -u psa-app node -e "console.log('Test DB...'); require('./server/database/init.js');"

# Status services
sudo systemctl status nginx
sudo -u psa-app pm2 status
```

### 🔍 **VÉRIFICATIONS MANUELLES**

#### 🌐 Application Web
- [ ] **Page d'accueil** accessible sur https://votre-domaine.com
- [ ] **Certificat SSL valide** (cadenas vert dans le navigateur)
- [ ] **Health check** : https://votre-domaine.com/healthz retourne OK
- [ ] **Admin interface** accessible et sécurisée
- [ ] **Upload de fichiers** fonctionne
- [ ] **Base de données** répond correctement

#### 🛡️ Sécurité
- [ ] **Firewall UFW actif** : `sudo ufw status`
- [ ] **Fail2ban configuré** : `sudo fail2ban-client status`
- [ ] **SSL A+ rating** : testez sur https://www.ssllabs.com/ssltest/
- [ ] **Headers sécurité** présents : `curl -I https://votre-domaine.com`
- [ ] **Ports non nécessaires fermés** : `nmap votre-domaine.com`

#### 📊 Monitoring
- [ ] **PM2 monitoring** : `sudo -u psa-app pm2 monit`
- [ ] **Logs sans erreurs** : `tail -f /var/log/psa-grading/*.log`
- [ ] **Uptime Kuma** (si activé) : http://localhost:3001
- [ ] **Notifications email** fonctionnelles

---

## 🚨 TROUBLESHOOTING DÉPLOIEMENT

### ❌ **PROBLÈMES COURANTS**

#### 🔌 **"Site non accessible"**
```bash
# Vérifications
sudo systemctl status nginx
sudo -u psa-app pm2 status
sudo ufw status
nslookup votre-domaine.com

# Solutions
sudo systemctl restart nginx
sudo -u psa-app pm2 restart all
```

#### 🔐 **"Certificat SSL échoué"**
```bash
# Vérifications
sudo certbot certificates
sudo nginx -t
nslookup votre-domaine.com

# Solutions
sudo certbot --nginx -d votre-domaine.com --force-renewal
sudo systemctl reload nginx
```

#### 🗄️ **"Erreur base de données"**
```bash
# Test connexion
cd /var/www/psa-grading-app
sudo -u psa-app node -e "const {Pool}=require('pg'); const pool=new Pool({connectionString:process.env.DATABASE_URL}); pool.query('SELECT 1').then(()=>console.log('✅ DB OK')).catch(e=>console.error('❌',e.message))"

# Vérifier .env
sudo -u psa-app cat .env | grep DATABASE_URL
```

#### 🔥 **"Firewall bloque le trafic"**
```bash
# Vérifier règles UFW
sudo ufw status verbose

# Réinitialiser si nécessaire
sudo ufw --force reset
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

### 🆘 **ROLLBACK D'URGENCE**
```bash
# Rollback automatique
sudo ./scripts/deployment/rollback.sh

# Rollback manuel
sudo -u psa-app pm2 stop all
sudo systemctl stop nginx
sudo systemctl start nginx  # Page maintenance
sudo -u psa-app pm2 start ecosystem.config.js --env production
```

### 📞 **AIDE SUPPLÉMENTAIRE**

#### 📋 **Commandes de diagnostic**
```bash
# Status général
./scripts/health-check.sh

# Logs détaillés
tail -f /var/log/psa-grading/*.log
sudo -u psa-app pm2 logs --lines 50
tail -f /var/log/nginx/error.log

# Métriques système
htop
df -h
free -h
```

#### 🔧 **Contacts support**
- **Email admin configuré** : voir variable ADMIN_EMAIL
- **Documentation** : DEPLOYMENT_OVH_GUIDE.md
- **Logs** : /var/log/psa-grading/
- **Status** : https://votre-domaine.com/healthz

---

## 🎯 POST-DÉPLOIEMENT

### ✅ **TÂCHES FINALES**
- [ ] **Sauvegarde initiale** de la base de données
- [ ] **Test complet** de toutes les fonctionnalités
- [ ] **Documentation** des mots de passe et secrets
- [ ] **Planification** des sauvegardes automatiques
- [ ] **Surveillance** des logs pendant 24-48h
- [ ] **Formation** des utilisateurs finaux

### 📊 **MONITORING CONTINU**
- [ ] **Alertes email** configurées et testées
- [ ] **Monitoring uptime** actif
- [ ] **Sauvegardes** automatiques programmées
- [ ] **Mises à jour sécurité** planifiées
- [ ] **Renouvellement SSL** automatique vérifié

### 🔒 **SÉCURITÉ CONTINUE**
- [ ] **Mots de passe** changés régulièrement
- [ ] **Logs** surveillés pour intrusions
- [ ] **Mises à jour** système appliquées
- [ ] **Firewall** rules révisées
- [ ] **Backups** testés régulièrement

---

## 🎉 DÉPLOIEMENT RÉUSSI !

**✅ Votre application PSA Grading est maintenant déployée et sécurisée sur OVH !**

- 🌐 **URL publique** : https://votre-domaine.com
- 🔒 **Sécurisée** avec SSL et firewall
- 📊 **Monitorée** avec alertes automatiques
- 🔄 **Sauvegardée** avec rollback automatique
- 📧 **Support** : votre-email-admin

**Bravo ! 🚀**