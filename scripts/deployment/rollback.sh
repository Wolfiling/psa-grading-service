#!/bin/bash

# ===============================================
# SCRIPT DE ROLLBACK - PSA GRADING APP
# ===============================================
# 🔄 Rollback automatique et sécurisé en cas d'échec de déploiement
# 📊 Restauration application, base de données et configurations

set -e

# Configuration
APP_DIR="/var/www/psa-grading-app"
BACKUP_DIR="/var/backups/psa-grading"
LOG_DIR="/var/log/psa-grading"

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Log file pour rollback
ROLLBACK_LOG="/var/log/psa-rollback-$(date +%Y%m%d-%H%M%S).log"

# Fonctions utilitaires
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1" | tee -a "$ROLLBACK_LOG"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1" | tee -a "$ROLLBACK_LOG"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$ROLLBACK_LOG"
}

log_step() {
    echo -e "${BLUE}[STEP]${NC} $1" | tee -a "$ROLLBACK_LOG"
}

# Fonction de notification
send_notification() {
    local type="$1"
    local message="$2"
    
    if command -v mail >/dev/null 2>&1 && [[ -n "${ADMIN_EMAIL}" ]]; then
        echo "$message

Heure: $(date)
Serveur: $(hostname)
Log rollback: $ROLLBACK_LOG

---
Rollback automatique PSA Grading App" | \
        mail -s "PSA Rollback [$type]" "${ADMIN_EMAIL}"
    fi
    
    logger -t "psa-rollback" "[$type] $message"
}

# Vérifications préliminaires
check_prerequisites() {
    log_step "Vérification prérequis rollback..."
    
    if [[ $EUID -ne 0 ]]; then
        log_error "Ce script doit être exécuté en root"
        exit 1
    fi
    
    if [[ ! -d "$BACKUP_DIR" ]]; then
        log_error "Répertoire de sauvegarde non trouvé: $BACKUP_DIR"
        exit 1
    fi
    
    log_info "✅ Prérequis validés"
}

# Identification de la dernière sauvegarde
find_latest_backup() {
    log_step "Recherche de la dernière sauvegarde..."
    
    if [[ -f "$BACKUP_DIR/latest-backup.txt" ]]; then
        BACKUP_PREFIX=$(cat "$BACKUP_DIR/latest-backup.txt")
        log_info "Sauvegarde trouvée: $BACKUP_PREFIX"
    else
        # Recherche manuelle de la sauvegarde la plus récente
        BACKUP_PREFIX=$(find "$BACKUP_DIR" -name "backup-*-app.tar.gz" | \
                       sort -r | head -1 | sed 's/-app\.tar\.gz$//')
        
        if [[ -z "$BACKUP_PREFIX" ]]; then
            log_error "Aucune sauvegarde trouvée"
            exit 1
        fi
        
        log_info "Sauvegarde automatiquement détectée: $BACKUP_PREFIX"
    fi
    
    # Vérification existence des fichiers de sauvegarde
    local missing_files=()
    
    if [[ ! -f "${BACKUP_PREFIX}-app.tar.gz" ]]; then
        missing_files+=("application")
    fi
    
    if [[ ! -f "${BACKUP_PREFIX}-db.sql" ]]; then
        missing_files+=("base de données")
    fi
    
    if [[ ${#missing_files[@]} -gt 0 ]]; then
        log_warn "Fichiers de sauvegarde manquants: ${missing_files[*]}"
        log_warn "Le rollback sera partiel"
    fi
}

# Arrêt des services
stop_services() {
    log_step "Arrêt des services..."
    
    # Arrêt PM2
    if command -v pm2 >/dev/null 2>&1; then
        sudo -u psa-app pm2 stop all 2>/dev/null || true
        sudo -u psa-app pm2 delete all 2>/dev/null || true
        log_info "✅ PM2 arrêté"
    fi
    
    # Nginx peut continuer à tourner pour servir une page de maintenance
    log_info "✅ Services arrêtés"
}

# Page de maintenance
enable_maintenance_mode() {
    log_step "Activation mode maintenance..."
    
    # Créer page de maintenance
    cat > "/var/www/maintenance.html" << 'EOF'
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Maintenance - PSA Grading</title>
    <style>
        body { 
            font-family: Arial, sans-serif; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            margin: 0; padding: 0; height: 100vh;
            display: flex; align-items: center; justify-content: center;
        }
        .container { 
            text-align: center; background: white; 
            padding: 40px; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            max-width: 500px; margin: 20px;
        }
        h1 { color: #333; margin-bottom: 20px; }
        p { color: #666; line-height: 1.6; }
        .status { 
            background: #f8f9fa; padding: 15px; border-radius: 5px; 
            margin: 20px 0; border-left: 4px solid #ffc107;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔧 Maintenance en cours</h1>
        <p>PSA Grading Service est temporairement indisponible pour maintenance.</p>
        <div class="status">
            <strong>Status :</strong> Restauration système en cours<br>
            <strong>Durée estimée :</strong> 10-15 minutes
        </div>
        <p>Nous nous excusons pour la gêne occasionnée.<br>Le service sera rétabli dans les plus brefs délais.</p>
        <p><small>En cas d'urgence, contactez: ${ADMIN_EMAIL:-support@psa-grading.com}</small></p>
    </div>
</body>
</html>
EOF
    
    # Configuration Nginx temporaire pour maintenance
    cat > "/etc/nginx/sites-available/maintenance" << 'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    listen 443 ssl http2 default_server;
    listen [::]:443 ssl http2 default_server;
    
    # SSL avec certificats auto-signés (temporaire)
    ssl_certificate /etc/ssl/certs/ssl-cert-snakeoil.pem;
    ssl_certificate_key /etc/ssl/private/ssl-cert-snakeoil.key;
    
    root /var/www;
    index maintenance.html;
    
    location / {
        try_files /maintenance.html =503;
    }
    
    location = /healthz {
        return 200 "maintenance mode\n";
        add_header Content-Type text/plain;
    }
}
EOF
    
    # Activation configuration maintenance
    ln -sf /etc/nginx/sites-available/maintenance /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/psa-grading
    
    nginx -t && systemctl reload nginx
    
    log_info "✅ Mode maintenance activé"
}

# Restauration de l'application
restore_application() {
    log_step "Restauration application..."
    
    if [[ -f "${BACKUP_PREFIX}-app.tar.gz" ]]; then
        # Sauvegarde actuelle cassée (au cas où)
        if [[ -d "$APP_DIR" ]]; then
            mv "$APP_DIR" "${APP_DIR}.broken-$(date +%s)" 2>/dev/null || true
        fi
        
        # Création nouveau répertoire
        mkdir -p "$APP_DIR"
        
        # Extraction sauvegarde
        tar -xzf "${BACKUP_PREFIX}-app.tar.gz" -C "$APP_DIR"
        
        # Permissions
        chown -R psa-app:psa-app "$APP_DIR"
        
        log_info "✅ Application restaurée"
    else
        log_error "Fichier sauvegarde application non trouvé"
        return 1
    fi
}

# Restauration base de données
restore_database() {
    log_step "Restauration base de données..."
    
    if [[ -f "${BACKUP_PREFIX}-db.sql" ]]; then
        cd "$APP_DIR"
        
        if [[ -f ".env" ]]; then
            source ".env" 2>/dev/null || true
            
            if [[ -n "$DATABASE_URL" ]]; then
                # Sauvegarde DB actuelle avant restauration
                pg_dump "$DATABASE_URL" > "/tmp/db-before-rollback-$(date +%s).sql" 2>/dev/null || true
                
                # Restauration
                log_warn "Restauration base de données en cours..."
                psql "$DATABASE_URL" < "${BACKUP_PREFIX}-db.sql" 2>/dev/null || {
                    log_error "Échec restauration base de données"
                    return 1
                }
                
                log_info "✅ Base de données restaurée"
            else
                log_warn "DATABASE_URL non configurée - restauration DB ignorée"
            fi
        else
            log_warn "Fichier .env non trouvé - restauration DB ignorée"
        fi
    else
        log_warn "Pas de sauvegarde base de données trouvée"
    fi
}

# Restauration configuration Nginx
restore_nginx_config() {
    log_step "Restauration configuration Nginx..."
    
    if [[ -f "${BACKUP_PREFIX}-nginx.conf" ]]; then
        cp "${BACKUP_PREFIX}-nginx.conf" "/etc/nginx/sites-available/psa-grading"
        
        # Test configuration
        if nginx -t 2>/dev/null; then
            log_info "✅ Configuration Nginx restaurée"
        else
            log_error "Configuration Nginx corrompue, restauration de base..."
            # Création config minimale
            cat > "/etc/nginx/sites-available/psa-grading" << 'EOF'
server {
    listen 80;
    server_name _;
    
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
        fi
    else
        log_warn "Pas de sauvegarde Nginx trouvée - configuration par défaut"
    fi
}

# Redémarrage des services
restart_services() {
    log_step "Redémarrage services..."
    
    # Désactivation mode maintenance
    rm -f /etc/nginx/sites-enabled/maintenance
    ln -sf /etc/nginx/sites-available/psa-grading /etc/nginx/sites-enabled/
    
    # Test et rechargement Nginx
    if nginx -t; then
        systemctl reload nginx
        log_info "✅ Nginx redémarré"
    else
        log_error "Configuration Nginx invalide"
        return 1
    fi
    
    # Redémarrage application avec PM2
    cd "$APP_DIR"
    
    # Installation dépendances si nécessaire
    sudo -u psa-app npm ci --production --silent 2>/dev/null || true
    
    # Démarrage PM2
    if [[ -f "ecosystem.config.js" ]]; then
        sudo -u psa-app pm2 start ecosystem.config.js --env production
    else
        sudo -u psa-app pm2 start server/index.js --name "psa-grading-app"
    fi
    
    # Attendre démarrage
    sleep 10
    
    if sudo -u psa-app pm2 list | grep -q "online"; then
        log_info "✅ Application redémarrée"
    else
        log_error "Échec redémarrage application"
        sudo -u psa-app pm2 logs --lines 20
        return 1
    fi
}

# Tests post-rollback
run_rollback_tests() {
    log_step "Tests post-rollback..."
    
    local tests_passed=0
    local total_tests=3
    
    # Test health check
    if curl -f -s "http://localhost:5000/healthz" >/dev/null 2>&1; then
        log_info "✅ Test health check OK"
        ((tests_passed++))
    else
        log_error "❌ Test health check échoué"
    fi
    
    # Test PM2
    if sudo -u psa-app pm2 list | grep -q "online"; then
        log_info "✅ Test PM2 OK"
        ((tests_passed++))
    else
        log_error "❌ Test PM2 échoué"
    fi
    
    # Test DB si possible
    cd "$APP_DIR"
    if [[ -f ".env" ]] && sudo -u psa-app node -e "
        const { Pool } = require('pg');
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });
        pool.query('SELECT 1').then(() => pool.end()).catch(() => process.exit(1));
    " 2>/dev/null; then
        log_info "✅ Test base de données OK"
        ((tests_passed++))
    else
        log_warn "⚠️ Test base de données échoué ou non configuré"
    fi
    
    log_info "Tests rollback réussis: $tests_passed/$total_tests"
    
    return $([[ $tests_passed -ge 2 ]] && echo 0 || echo 1)
}

# Nettoyage post-rollback
cleanup() {
    log_step "Nettoyage post-rollback..."
    
    # Suppression page maintenance
    rm -f "/var/www/maintenance.html"
    rm -f "/etc/nginx/sites-available/maintenance"
    
    # Sauvegarde PM2
    sudo -u psa-app pm2 save 2>/dev/null || true
    
    log_info "✅ Nettoyage terminé"
}

# Fonction principale
main() {
    log_info "🔄 ROLLBACK PSA GRADING APP"
    log_info "=========================="
    log_info "Log rollback: $ROLLBACK_LOG"
    log_info ""
    
    # Variables d'environnement
    ADMIN_EMAIL="${ADMIN_EMAIL:-admin@localhost}"
    
    # Confirmation si exécution manuelle
    if [[ "${1:-}" != "--auto" ]]; then
        read -p "Confirmer le rollback? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Rollback annulé"
            exit 0
        fi
    fi
    
    # Notification début
    send_notification "START" "Début rollback PSA"
    
    # Exécution séquentielle avec gestion d'erreurs
    if check_prerequisites && \
       find_latest_backup && \
       stop_services && \
       enable_maintenance_mode && \
       restore_application && \
       restore_database && \
       restore_nginx_config && \
       restart_services && \
       run_rollback_tests; then
        
        cleanup
        
        send_notification "SUCCESS" "Rollback PSA réussi"
        
        log_info ""
        log_info "🎉 ROLLBACK RÉUSSI!"
        log_info ""
        log_info "✅ Application restaurée depuis: $(basename "$BACKUP_PREFIX")"
        log_info "🌐 Application accessible: http://localhost:5000"
        log_info "📋 Status PM2: sudo -u psa-app pm2 status"
        log_info "🔧 Log: $ROLLBACK_LOG"
        log_info ""
        
    else
        send_notification "FAILED" "Échec rollback PSA - intervention manuelle requise"
        
        log_error ""
        log_error "❌ ROLLBACK ÉCHOUÉ!"
        log_error ""
        log_error "🔧 Vérifications manuelles requises:"
        log_error "  • Logs: $ROLLBACK_LOG"
        log_error "  • PM2: sudo -u psa-app pm2 logs"
        log_error "  • Nginx: nginx -t && systemctl status nginx"
        log_error "  • App: curl http://localhost:5000/healthz"
        log_error ""
        
        exit 1
    fi
}

# Point d'entrée
main "$@"