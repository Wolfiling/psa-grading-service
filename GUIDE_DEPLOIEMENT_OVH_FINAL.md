# 🚀 GUIDE DE DÉPLOIEMENT RAPIDE - PSA GRADING APP SUR OVH

## 📋 PRÉREQUIS OVH

✅ **VPS OVH** avec Ubuntu 20.04+ (minimum 2 CPU, 4GB RAM)  
✅ **Base de données PostgreSQL** OVH avec accès SSL  
✅ **Nom de domaine** configuré pour pointer vers votre VPS  

---

## ⚡ ÉTAPE 1 : CONFIGURATION SERVEUR (15 minutes)

### 1.1 Connexion et outils
```bash
# Connexion SSH à votre VPS
ssh root@votre-serveur-ovh.com

# Installation des outils essentiels
apt update && apt upgrade -y
apt install -y curl git nginx certbot python3-certbot-nginx nodejs npm

# Installation PM2 pour la gestion de processus
npm install -g pm2@latest
```

### 1.2 Utilisateur sécurisé
```bash
# Création utilisateur dédié (sécurité)
adduser --system --group --home /var/www --shell /bin/bash psa-app
mkdir -p /var/www/psa-grading-app
chown -R psa-app:psa-app /var/www/psa-grading-app
```

---

## 📦 ÉTAPE 2 : DÉPLOIEMENT APPLICATION (10 minutes)

### 2.1 Clone et installation
```bash
# Basculer sur l'utilisateur app
su - psa-app
cd /var/www

# Cloner votre repository
git clone https://github.com/VOTRE_USERNAME/psa-grading-app.git
cd psa-grading-app

# Installation des dépendances
npm ci --production
```

### 2.2 Configuration variables d'environnement
```bash
# Créer le fichier .env avec vos vraies valeurs
cp .env.production.template .env
nano .env

# IMPORTANT: Remplacez TOUTES les valeurs suivantes dans .env:
# NODE_ENV=production
# ALLOWED_ORIGINS=https://votre-domaine.com
# PUBLIC_URL=https://votre-domaine.com
# 
# ADMIN_PASSWORD=VotreMotDePasseSecurise123!
# SESSION_SECRET=GenerezAvecOpenSSL
# PSA_SECRET=GenerezAvecOpenSSL  
# JWT_SECRET=GenerezAvecOpenSSL
# PSA_CLIENT_SECRET=GenerezAvecOpenSSL
#
# DATABASE_URL=postgresql://user:pass@db-host.ovh.net:5432/dbname?sslmode=require
# BREVO_API_KEY=VotreCleAPIBrevo
# PSA_EMAIL=votre-email@psa.com
# PSA_PASSWORD=VotreMotDePassePSA
```

### 2.3 Génération des secrets
```bash
# Générer tous vos secrets sécurisés:
echo "SESSION_SECRET=$(openssl rand -base64 64)"
echo "PSA_SECRET=$(openssl rand -base64 64)"
echo "JWT_SECRET=$(openssl rand -base64 64)"
echo "PSA_CLIENT_SECRET=$(openssl rand -base64 64)"

# Copiez ces valeurs dans votre fichier .env
```

---

## 🌐 ÉTAPE 3 : CONFIGURATION NGINX (5 minutes)

### 3.1 Configuration reverse proxy
```bash
# Revenir en root
exit

# Créer configuration nginx
sudo tee /etc/nginx/sites-available/psa-grading << 'EOF'
server {
    listen 80;
    server_name votre-domaine.com www.votre-domaine.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name votre-domaine.com www.votre-domaine.com;
    
    # SSL Configuration (sera configuré par Certbot)
    ssl_protocols TLSv1.2 TLSv1.3;
    
    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload";
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    
    # Upload limite (vidéos 200MB)
    client_max_body_size 200M;
    
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
    
    # Health check
    location /healthz {
        proxy_pass http://127.0.0.1:5000;
        access_log off;
    }
}
EOF

# Activer la configuration
ln -s /etc/nginx/sites-available/psa-grading /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test configuration
nginx -t
systemctl reload nginx
```

### 3.2 Certificat SSL automatique
```bash
# Installation certificat Let's Encrypt
certbot --nginx -d votre-domaine.com -d www.votre-domaine.com

# Renouvellement automatique
echo "0 12 * * * /usr/bin/certbot renew --quiet" | crontab -
```

---

## 🚀 ÉTAPE 4 : LANCEMENT APPLICATION (5 minutes)

### 4.1 Démarrage avec PM2
```bash
# Basculer sur utilisateur app
su - psa-app
cd /var/www/psa-grading-app

# Lancer avec PM2
pm2 start ecosystem.config.js --env production

# Sauvegarde configuration PM2
pm2 save
pm2 startup

# Sortir et exécuter la commande affichée par pm2 startup en tant que root
exit
# Exécutez la commande suggérée par PM2 (quelque chose comme):
# sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u psa-app --hp /var/www
```

### 4.2 Vérification finale
```bash
# Test health check
curl https://votre-domaine.com/healthz

# Vérifier logs
su - psa-app
pm2 logs --lines 20

# Vérifier statut
pm2 list
```

---

## 🔍 VÉRIFICATION POST-DÉPLOIEMENT

### ✅ Checklist finale
- [ ] **Application accessible** : https://votre-domaine.com fonctionne
- [ ] **SSL actif** : Certificat valide, redirection HTTP→HTTPS
- [ ] **Health check** : https://votre-domaine.com/healthz retourne "healthy"
- [ ] **Logs sans erreur** : `pm2 logs` ne montre aucune erreur critique
- [ ] **Base de données** : Connection PostgreSQL OVH établie
- [ ] **Uploads vidéo** : Test d'upload avec limite 200MB
- [ ] **Authentification** : Test connexion admin et client
- [ ] **PSA Scraping** : Test récupération statut PSA

---

## 🛠️ MAINTENANCE ET MONITORING

### Commandes utiles
```bash
# Redémarrer l'application
pm2 restart psa-grading-app

# Voir les logs en temps réel
pm2 logs psa-grading-app --lines 50

# Monitoring ressources
pm2 monit

# Renouvellement SSL manuel
certbot renew

# Backup base de données
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql
```

### Surveillance automatique
```bash
# Script de monitoring (à exécuter en cron toutes les 5 minutes)
#!/bin/bash
if ! curl -f -s https://votre-domaine.com/healthz > /dev/null; then
    pm2 restart psa-grading-app
    echo "Application redémarrée - $(date)" >> /var/log/psa-monitoring.log
fi
```

---

## 🚨 TROUBLESHOOTING

### Problèmes courants

**❌ Application ne démarre pas**
```bash
# Vérifier logs
pm2 logs psa-grading-app

# Vérifier variables d'environnement
cd /var/www/psa-grading-app && node -e "console.log('DB:', process.env.DATABASE_URL ? 'OK' : 'MISSING')"
```

**❌ SSL ne fonctionne pas**
```bash
# Vérifier configuration nginx
nginx -t

# Renouveler certificat
certbot renew --force-renewal
```

**❌ Base de données inaccessible**
```bash
# Test connexion DB
cd /var/www/psa-grading-app
node -e "const pg = require('pg'); const client = new pg.Pool({connectionString: process.env.DATABASE_URL}); client.query('SELECT NOW()').then(r => console.log('DB OK:', r.rows[0])).catch(e => console.error('DB Error:', e.message));"
```

---

## 📞 SUPPORT

En cas de problème, vérifiez dans l'ordre :
1. **Logs application** : `pm2 logs`
2. **Logs nginx** : `tail -f /var/log/nginx/error.log`
3. **Health check** : `curl https://votre-domaine.com/healthz`
4. **Variables env** : Vérifiez que .env contient toutes les valeurs
5. **Ports ouverts** : `netstat -tlnp | grep :5000`

**🎉 FÉLICITATIONS ! Votre PSA Grading App est maintenant déployée sur OVH !**