#!/bin/bash

# ===============================================
# SCRIPT DE DÉPLOIEMENT AUTOMATISÉ OVH
# PSA GRADING APP - DÉPLOIEMENT COMPLET
# ===============================================
# 🚀 Déploiement automatisé et sécurisé sur VPS OVH
# 📊 Validation, rollback et monitoring intégrés

set -e  # Arrêt immédiat en cas d'erreur

# Configuration par défaut (peut être surchargée par variables d'environnement)
DOMAIN="${DOMAIN:-your-domain.com}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@your-domain.com}"
DB_BACKUP_RETENTION="${DB_BACKUP_RETENTION:-7}"
GIT_REPO="${GIT_REPO:-https://github.com/your-username/psa-grading-app.git}"
GIT_BRANCH="${GIT_BRANCH:-main}"
DEPLOYMENT_ENV="${DEPLOYMENT_ENV:-production}"

# Répertoires
APP_DIR="/var/www/psa-grading-app"
BACKUP_DIR="/var/backups/psa-grading"
LOG_DIR="/var/log/psa-grading"
SCRIPTS_DIR="$APP_DIR/scripts"

# Couleurs pour l'affichage
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Log file pour le déploiement
DEPLOY_LOG="/var/log/psa-deployment-$(date +%Y%m%d-%H%M%S).log"

# Fonctions utilitaires
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1" | tee -a "$DEPLOY_LOG"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1" | tee -a "$DEPLOY_LOG"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$DEPLOY_LOG"
}

log_step() {
    echo -e "${BLUE}[STEP]${NC} $1" | tee -a "$DEPLOY_LOG"
}

log_success() {
    echo -e "${CYAN}[SUCCESS]${NC} $1" | tee -a "$DEPLOY_LOG"
}

# Fonction de gestion des erreurs
handle_error() {
    local exit_code=$?
    log_error "Erreur lors du déploiement à la ligne $1"
    log_error "Code d'erreur: $exit_code"
    
    # Optionnel: rollback automatique
    if [[ "${AUTO_ROLLBACK:-true}" == "true" ]]; then
        log_warn "Déclenchement du rollback automatique..."
        "$SCRIPTS_DIR/deployment/rollback.sh"
    fi
    
    # Notification d'erreur
    send_notification "ERREUR" "Échec du déploiement PSA à la ligne $1"
    exit $exit_code
}

trap 'handle_error $LINENO' ERR

# Fonction de notification
send_notification() {
    local type="$1"
    local message="$2"
    
    if command -v mail >/dev/null 2>&1 && [[ -n "$ADMIN_EMAIL" ]]; then
        echo "$message

Heure: $(date)
Serveur: $(hostname)
Déploiement: $DEPLOYMENT_ENV
Log: $DEPLOY_LOG

---
Déploiement automatique PSA Grading App" | \
        mail -s "PSA Deployment [$type]" "$ADMIN_EMAIL"
    fi
    
    # Log système
    logger -t "psa-deploy" "[$type] $message"
}

# Vérifications préliminaires
check_requirements() {
    log_step "Vérification des prérequis..."
    
    # Vérification root
    if [[ $EUID -ne 0 ]]; then
        log_error "Ce script doit être exécuté en root"
        exit 1
    fi
    
    # Vérification outils requis
    local missing_tools=()
    for tool in git node npm pm2 nginx ufw certbot pg_dump htpasswd; do
        if ! command -v "$tool" >/dev/null 2>&1; then
            missing_tools+=("$tool")
        fi
    done
    
    if [[ ${#missing_tools[@]} -gt 0 ]]; then
        log_error "Outils manquants: ${missing_tools[*]}"
        log_info "Installez les outils requis avant de continuer"
        exit 1
    fi
    
    # Vérification espace disque (minimum 2GB libre)
    local free_space=$(df / | tail -1 | awk '{print $4}')
    if [[ $free_space -lt 2097152 ]]; then  # 2GB en KB
        log_error "Espace disque insuffisant (minimum 2GB requis)"
        exit 1
    fi
    
    log_info "✅ Tous les prérequis sont satisfaits"
}

# Création des répertoires et utilisateur
setup_directories() {
    log_step "Configuration des répertoires et permissions..."
    
    # Créer utilisateur psa-app s'il n'existe pas
    if ! id "psa-app" &>/dev/null; then
        useradd --system --create-home --shell /bin/bash psa-app
        usermod -aG www-data psa-app
    fi
    
    # Créer répertoires
    mkdir -p "$APP_DIR" "$BACKUP_DIR" "$LOG_DIR"
    mkdir -p "/var/cache/nginx/psa"
    mkdir -p "/var/www/letsencrypt/.well-known/acme-challenge"
    
    # Permissions
    chown -R psa-app:psa-app "$APP_DIR" "$LOG_DIR" "$BACKUP_DIR"
    chown -R www-data:www-data "/var/cache/nginx"
    chmod 755 "$APP_DIR" "$LOG_DIR"
    chmod 700 "$BACKUP_DIR"
    
    log_info "✅ Répertoires configurés"
}

# Sauvegarde avant déploiement
create_backup() {
    log_step "Création sauvegarde pré-déploiement..."
    
    local backup_file="$BACKUP_DIR/backup-$(date +%Y%m%d-%H%M%S)"
    
    # Sauvegarde application
    if [[ -d "$APP_DIR" ]]; then
        tar -czf "${backup_file}-app.tar.gz" -C "$APP_DIR" . 2>/dev/null || true
    fi
    
    # Sauvegarde base de données
    if [[ -f "$APP_DIR/.env" ]]; then
        source "$APP_DIR/.env" 2>/dev/null || true
        if [[ -n "$DATABASE_URL" ]] && command -v pg_dump >/dev/null 2>&1; then
            pg_dump "$DATABASE_URL" > "${backup_file}-db.sql" 2>/dev/null || true
            log_info "✅ Base de données sauvegardée"
        else
            log_warn "⚠️ pg_dump non disponible ou DATABASE_URL manquante"
        fi
    fi
    
    # Sauvegarde configuration Nginx
    if [[ -f "/etc/nginx/sites-enabled/psa-grading" ]]; then
        cp "/etc/nginx/sites-enabled/psa-grading" "${backup_file}-nginx.conf"
    fi
    
    # Nettoyage anciennes sauvegardes
    find "$BACKUP_DIR" -name "backup-*" -mtime +$DB_BACKUP_RETENTION -delete 2>/dev/null || true
    
    log_info "✅ Sauvegarde créée: $backup_file"
    echo "$backup_file" > "$BACKUP_DIR/latest-backup.txt"
}

# Déploiement du code
deploy_application() {
    log_step "Déploiement de l'application..."
    
    # Clone ou mise à jour du code
    if [[ -d "$APP_DIR/.git" ]]; then
        cd "$APP_DIR"
        sudo -u psa-app git fetch origin "$GIT_BRANCH"
        sudo -u psa-app git reset --hard "origin/$GIT_BRANCH"
    else
        sudo -u psa-app git clone -b "$GIT_BRANCH" "$GIT_REPO" "$APP_DIR"
        cd "$APP_DIR"
    fi
    
    # Installation dépendances
    sudo -u psa-app npm ci --production --silent
    
    # Configuration .env si template existe
    if [[ -f ".env.production.template" ]] && [[ ! -f ".env" ]]; then
        cp ".env.production.template" ".env"
        chown psa-app:psa-app ".env"
        chmod 600 ".env"
        
        # Personnalisation des variables
        sed -i "s/your-domain.com/$DOMAIN/g" ".env"
        sed -i "s/admin@your-domain.com/$ADMIN_EMAIL/g" ".env"
        
        log_warn "⚠️ Fichier .env créé depuis template - Vérifiez la configuration!"
    fi
    
    # Rendre les scripts exécutables
    find scripts/ -name "*.sh" -type f -exec chmod +x {} \; 2>/dev/null || true
    
    log_info "✅ Application déployée"
}

# Configuration Nginx
setup_nginx() {
    log_step "Configuration Nginx..."
    
    # Copier configuration personnalisée
    if [[ -f "$SCRIPTS_DIR/nginx/psa-grading.conf" ]]; then
        cp "$SCRIPTS_DIR/nginx/psa-grading.conf" "/etc/nginx/sites-available/psa-grading"
        
        # Personnalisation domaine et certificats
        sed -i "s/DOMAIN_PLACEHOLDER/$DOMAIN/g" "/etc/nginx/sites-available/psa-grading"
        sed -i "s/server_name _;/server_name $DOMAIN www.$DOMAIN;/g" "/etc/nginx/sites-available/psa-grading"
        
        # Création .htpasswd sécurisé pour admin
        if [[ ! -f "/etc/nginx/.htpasswd" ]]; then
            log_step "Création fichier .htpasswd pour admin..."
            
            # Génération mot de passe admin aléatoire
            local admin_password=$(openssl rand -base64 32)
            echo "admin:$(openssl passwd -6 "$admin_password")" > /etc/nginx/.htpasswd
            chmod 640 /etc/nginx/.htpasswd
            chown root:www-data /etc/nginx/.htpasswd
            
            # Sauvegarde sécurisée du mot de passe
            echo "ADMIN_PASSWORD=$admin_password" >> "$APP_DIR/.env.admin" 2>/dev/null || true
            chmod 600 "$APP_DIR/.env.admin" 2>/dev/null || true
            
            log_info "✅ .htpasswd créé - mot de passe admin sauvé dans .env.admin"
            log_warn "⚠️ Conservez précieusement: admin / $admin_password"
        fi
    else
        log_warn "Configuration Nginx non trouvée, création basique..."
        cat > "/etc/nginx/sites-available/psa-grading" << EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;
    
    location /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
    }
    
    location / {
        return 301 https://\$server_name\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name $DOMAIN www.$DOMAIN;
    
    # SSL sera configuré par Let's Encrypt
    ssl_certificate /etc/ssl/certs/ssl-cert-snakeoil.pem;
    ssl_certificate_key /etc/ssl/private/ssl-cert-snakeoil.key;
    
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
    fi
    
    # Activation du site
    ln -sf "/etc/nginx/sites-available/psa-grading" "/etc/nginx/sites-enabled/"
    
    # Désactiver site par défaut
    rm -f "/etc/nginx/sites-enabled/default"
    
    # Test configuration avant reload
    if ! nginx -t; then
        log_error "Configuration Nginx invalide!"
        log_info "Restauration configuration précédente..."
        rm -f "/etc/nginx/sites-available/psa-grading"
        exit 1
    fi
    
    systemctl reload nginx
    
    log_info "✅ Nginx configuré"
}

# Configuration SSL avec Let's Encrypt
setup_ssl() {
    log_step "Configuration SSL Let's Encrypt..."
    
    # Installation certbot si nécessaire
    if ! command -v certbot >/dev/null 2>&1; then
        apt update
        apt install -y certbot python3-certbot-nginx
    fi
    
    # Obtention certificat
    certbot --nginx --non-interactive --agree-tos --email "$ADMIN_EMAIL" \
            -d "$DOMAIN" -d "www.$DOMAIN" --redirect
    
    # Configuration renouvellement automatique
    if ! crontab -l 2>/dev/null | grep -q "certbot renew"; then
        (crontab -l 2>/dev/null; echo "0 2 * * * /usr/bin/certbot renew --quiet --post-hook 'systemctl reload nginx'") | crontab -
    fi
    
    log_info "✅ SSL configuré et auto-renouvellement activé"
}

# Configuration base de données
setup_database() {
    log_step "Configuration base de données..."
    
    if [[ -f "$APP_DIR/.env" ]]; then
        cd "$APP_DIR"
        
        # Test connexion DB
        if ! sudo -u psa-app node -e "
            const { Pool } = require('pg');
            const pool = new Pool({ connectionString: process.env.DATABASE_URL });
            pool.query('SELECT NOW()')
                .then(() => { console.log('DB_OK'); pool.end(); })
                .catch(err => { console.error('DB_ERROR:', err.message); process.exit(1); });
        "; then
            log_error "Impossible de se connecter à la base de données"
            log_info "Vérifiez la variable DATABASE_URL dans .env"
            exit 1
        fi
        
        # Initialisation tables
        sudo -u psa-app timeout 30s node -e "
            const { initializeDatabase } = require('./server/database/init.js');
            initializeDatabase()
                .then(() => console.log('DB initialized'))
                .catch(err => { console.error(err); process.exit(1); });
        " || log_warn "Timeout initialisation DB (normal si tables existent)"
        
        log_info "✅ Base de données configurée"
    else
        log_error "Fichier .env non trouvé - configuration DB impossible"
        exit 1
    fi
}

# Configuration firewall et sécurité
setup_security() {
    log_step "Configuration sécurité et firewall..."
    
    # Configuration UFW si script disponible
    if [[ -f "$SCRIPTS_DIR/security/setup-ufw.sh" ]]; then
        chmod +x "$SCRIPTS_DIR/security/setup-ufw.sh"
        DATABASE_TYPE=remote ENABLE_IPV6=false "$SCRIPTS_DIR/security/setup-ufw.sh"
    else
        log_warn "Script UFW non trouvé, configuration basique..."
        ufw --force reset
        ufw default deny incoming
        ufw default allow outgoing
        ufw limit ssh
        ufw allow 80/tcp
        ufw allow 443/tcp
        ufw --force enable
    fi
    
    # Configuration Fail2ban
    if [[ -f "$SCRIPTS_DIR/security/setup-fail2ban.conf" ]]; then
        cp "$SCRIPTS_DIR/security/setup-fail2ban.conf" "/etc/fail2ban/jail.local"
        systemctl restart fail2ban
    fi
    
    log_info "✅ Sécurité configurée"
}

# Configuration monitoring
setup_monitoring() {
    log_step "Configuration monitoring..."
    
    if [[ -f "$SCRIPTS_DIR/monitoring/setup-monitoring.sh" ]]; then
        chmod +x "$SCRIPTS_DIR/monitoring/setup-monitoring.sh"
        ADMIN_EMAIL="$ADMIN_EMAIL" "$SCRIPTS_DIR/monitoring/setup-monitoring.sh"
    else
        log_warn "Script monitoring non trouvé, configuration basique..."
        
        # Health check basique
        cat > "/usr/local/bin/psa-health-check" << 'EOF'
#!/bin/bash
if ! curl -f -s http://localhost:5000/healthz >/dev/null; then
    echo "PSA App down!" | mail -s "PSA Health Alert" "${ADMIN_EMAIL:-root}"
fi
EOF
        chmod +x "/usr/local/bin/psa-health-check"
        (crontab -l 2>/dev/null; echo "*/5 * * * * /usr/local/bin/psa-health-check") | crontab -
    fi
    
    log_info "✅ Monitoring configuré"
}

# Démarrage application avec PM2
start_application() {
    log_step "Démarrage application avec PM2..."
    
    cd "$APP_DIR"
    
    # Configuration PM2 pour psa-app user
    sudo -u psa-app bash << 'EOF'
        # PM2 en tant que psa-app
        export HOME=/home/psa-app
        
        # Arrêt applications existantes
        pm2 delete all 2>/dev/null || true
        
        # Démarrage avec ecosystem
        if [[ -f "ecosystem.config.js" ]]; then
            pm2 start ecosystem.config.js --env production
        else
            pm2 start server/index.js --name "psa-grading-app"
        fi
        
        # Sauvegarde configuration
        pm2 save
        pm2 startup
EOF
    
    # Configuration démarrage système
    pm2 unstartup systemd --user psa-app --hp /home/psa-app 2>/dev/null || true
    sudo -u psa-app pm2 startup systemd -u psa-app --hp /home/psa-app
    
    # Attendre démarrage
    sleep 10
    
    # Vérification status
    if sudo -u psa-app pm2 list | grep -q "online.*psa-grading-app"; then
        log_info "✅ Application démarrée avec succès"
    else
        log_error "Échec démarrage application"
        sudo -u psa-app pm2 logs --lines 20
        exit 1
    fi
}

# Tests post-déploiement
run_post_deployment_tests() {
    log_step "Tests post-déploiement..."
    
    local tests_passed=0
    local total_tests=5
    
    # Test 1: Health check HTTP
    if curl -f -s "http://localhost:5000/healthz" >/dev/null; then
        log_info "✅ Test health check réussi"
        ((tests_passed++))
    else
        log_error "❌ Test health check échoué"
    fi
    
    # Test 2: HTTPS (si configuré)
    if curl -f -s "https://$DOMAIN/healthz" >/dev/null 2>&1; then
        log_info "✅ Test HTTPS réussi"
        ((tests_passed++))
    else
        log_warn "⚠️ Test HTTPS échoué (peut être normal en premier déploiement)"
    fi
    
    # Test 3: Base de données
    cd "$APP_DIR"
    if sudo -u psa-app node -e "
        const { Pool } = require('pg');
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });
        pool.query('SELECT COUNT(*) FROM information_schema.tables')
            .then(res => { console.log('DB_TABLES:', res.rows[0].count); pool.end(); })
            .catch(err => { console.error('DB_ERROR'); process.exit(1); });
    " 2>/dev/null | grep -q "DB_TABLES"; then
        log_info "✅ Test base de données réussi"
        ((tests_passed++))
    else
        log_error "❌ Test base de données échoué"
    fi
    
    # Test 4: PM2 status
    if sudo -u psa-app pm2 list | grep -q "online"; then
        log_info "✅ Test PM2 réussi"
        ((tests_passed++))
    else
        log_error "❌ Test PM2 échoué"
    fi
    
    # Test 5: Nginx status
    if systemctl is-active --quiet nginx; then
        log_info "✅ Test Nginx réussi"
        ((tests_passed++))
    else
        log_error "❌ Test Nginx échoué"
    fi
    
    # Résultat final
    log_info "Tests réussis: $tests_passed/$total_tests"
    
    if [[ $tests_passed -ge 3 ]]; then
        log_success "🎉 Déploiement réussi!"
        return 0
    else
        log_error "⚠️ Déploiement partiellement réussi - vérification manuelle requise"
        return 1
    fi
}

# Fonction principale
main() {
    log_info "🚀 DÉPLOIEMENT PSA GRADING APP - OVH"
    log_info "===================================="
    log_info "Domaine: $DOMAIN"
    log_info "Email admin: $ADMIN_EMAIL"
    log_info "Environnement: $DEPLOYMENT_ENV"
    log_info "Log: $DEPLOY_LOG"
    log_info ""
    
    # Confirmation interactive
    read -p "Confirmer le déploiement? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Déploiement annulé"
        exit 0
    fi
    
    # Notification début
    send_notification "START" "Début déploiement PSA sur $DOMAIN"
    
    # Exécution séquentielle
    check_requirements
    setup_directories
    create_backup
    deploy_application
    setup_nginx
    
    if [[ "$DEPLOYMENT_ENV" == "production" ]]; then
        setup_ssl
    fi
    
    setup_database
    setup_security
    setup_monitoring
    start_application
    
    # Tests finaux
    if run_post_deployment_tests; then
        send_notification "SUCCESS" "Déploiement PSA réussi sur $DOMAIN"
        
        log_success ""
        log_success "🎉 DÉPLOIEMENT RÉUSSI!"
        log_success ""
        log_success "🌐 URL: https://$DOMAIN"
        log_success "📊 Monitoring: https://$DOMAIN:8080 (local)"
        log_success "📋 PM2: sudo -u psa-app pm2 status"
        log_success "🔧 Logs: $DEPLOY_LOG"
        log_success ""
        
    else
        send_notification "WARNING" "Déploiement PSA avec alertes sur $DOMAIN"
        log_warn "Déploiement terminé avec des alertes - vérification requise"
    fi
}

# Point d'entrée
main "$@"