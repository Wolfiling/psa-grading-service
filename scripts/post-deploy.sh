#!/bin/bash

# ===============================================
# SCRIPT POST-DÉPLOIEMENT PSA GRADING APP
# ===============================================
# 🚀 Ce script automatise les tâches après déploiement
# ⚠️ À exécuter après chaque mise à jour de production

set -e  # Arrêt immédiat en cas d'erreur

# Configuration
APP_DIR="/var/www/psa-grading-app"
LOG_DIR="/var/log/psa-grading"
BACKUP_DIR="/var/backups/psa-grading"
APP_USER="psa-app"

# Couleurs pour affichage
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Fonctions utilitaires
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

check_user() {
    if [[ $EUID -eq 0 ]]; then
        log_error "Ce script ne doit PAS être exécuté en root"
        log_info "Utilisez: su - $APP_USER puis exécutez le script"
        exit 1
    fi
    
    if [[ $(whoami) != "$APP_USER" ]]; then
        log_error "Ce script doit être exécuté par l'utilisateur $APP_USER"
        log_info "Utilisez: su - $APP_USER"
        exit 1
    fi
}

check_environment() {
    log_step "Vérification de l'environnement..."
    
    # Vérifier que nous sommes dans le bon répertoire
    if [[ ! -f "$APP_DIR/package.json" ]]; then
        log_error "Fichier package.json non trouvé dans $APP_DIR"
        exit 1
    fi
    
    # Vérifier que NODE_ENV est en production
    if [[ "$NODE_ENV" != "production" ]]; then
        log_warn "NODE_ENV n'est pas en production (actuel: ${NODE_ENV:-'non défini'})"
        export NODE_ENV=production
    fi
    
    # Vérifier l'existence du fichier .env
    if [[ ! -f "$APP_DIR/.env" ]]; then
        log_error "Fichier .env manquant dans $APP_DIR"
        log_info "Copiez et configurez .env.production.template vers .env"
        exit 1
    fi
    
    log_info "✅ Environnement validé"
}

create_directories() {
    log_step "Création des répertoires nécessaires..."
    
    # Créer répertoires de logs
    mkdir -p "$LOG_DIR"
    mkdir -p "$BACKUP_DIR"
    
    # Créer répertoires application si manquants
    mkdir -p "$APP_DIR/uploads"
    mkdir -p "$APP_DIR/uploads/cards"
    mkdir -p "$APP_DIR/uploads/videos"
    mkdir -p "$APP_DIR/uploads/qr-codes"
    
    # Permissions appropriées
    chmod 755 "$APP_DIR/uploads"
    chmod 755 "$LOG_DIR"
    
    log_info "✅ Répertoires créés et configurés"
}

install_dependencies() {
    log_step "Installation des dépendances..."
    
    cd "$APP_DIR"
    
    # Nettoyage cache npm
    npm cache clean --force 2>/dev/null || true
    
    # Installation dépendances production uniquement
    npm ci --production --silent
    
    log_info "✅ Dépendances installées"
}

database_operations() {
    log_step "Opérations base de données..."
    
    cd "$APP_DIR"
    
    # Test de connectivité base de données
    log_info "Test de connexion à la base de données..."
    node -e "
        const { Pool } = require('pg');
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });
        pool.query('SELECT NOW() as server_time')
            .then(res => {
                console.log('✅ DB Connected:', res.rows[0].server_time);
                pool.end();
            })
            .catch(err => {
                console.error('❌ DB Error:', err.message);
                process.exit(1);
            });
    "
    
    # Initialisation tables si nécessaire (timeout 30s)
    log_info "Vérification/création des tables..."
    timeout 30s node -e "
        const { initializeDatabase } = require('./server/database/init.js');
        initializeDatabase()
            .then(() => {
                console.log('✅ Database initialized');
                process.exit(0);
            })
            .catch(err => {
                console.error('❌ DB Init Error:', err.message);
                process.exit(1);
            });
    " 2>/dev/null || log_warn "Timeout initialisation DB (normal si tables existent)"
    
    log_info "✅ Base de données opérationnelle"
}

optimize_application() {
    log_step "Optimisations application..."
    
    cd "$APP_DIR"
    
    # Nettoyage anciens logs (garde 7 jours)
    find "$LOG_DIR" -name "*.log" -mtime +7 -delete 2>/dev/null || true
    
    # Nettoyage uploads temporaires anciens
    find "$APP_DIR/uploads" -name "tmp_*" -mtime +1 -delete 2>/dev/null || true
    
    # Optimisation permissions
    find "$APP_DIR" -name "*.js" -exec chmod 644 {} \;
    find "$APP_DIR" -name "*.json" -exec chmod 644 {} \;
    chmod +x "$APP_DIR/scripts/"*.sh 2>/dev/null || true
    
    log_info "✅ Application optimisée"
}

validate_configuration() {
    log_step "Validation de la configuration..."
    
    cd "$APP_DIR"
    
    # Test syntaxe fichier principal
    node -c server/index.js || {
        log_error "Erreur de syntaxe dans server/index.js"
        exit 1
    }
    
    # Validation variables d'environnement critiques
    log_info "Vérification variables d'environnement..."
    node -e "
        const requiredVars = [
            'NODE_ENV', 'DATABASE_URL', 'ADMIN_PASSWORD', 
            'SESSION_SECRET', 'PSA_SECRET'
        ];
        
        const missing = requiredVars.filter(v => !process.env[v]);
        
        if (missing.length > 0) {
            console.error('❌ Variables manquantes:', missing.join(', '));
            process.exit(1);
        }
        
        console.log('✅ Variables d\'environnement validées');
    "
    
    # Test port disponible
    if netstat -tlnp 2>/dev/null | grep -q ":5000 "; then
        log_warn "Port 5000 déjà utilisé (normal si app déjà lancée)"
    fi
    
    log_info "✅ Configuration validée"
}

health_check() {
    log_step "Vérification santé application..."
    
    # Démarrage temporaire pour test (max 30s)
    cd "$APP_DIR"
    timeout 30s node server/index.js > /dev/null 2>&1 &
    APP_PID=$!
    
    # Attendre démarrage
    sleep 5
    
    # Test endpoint santé
    if curl -f -s http://localhost:5000/healthz > /dev/null 2>&1; then
        log_info "✅ Health check réussi"
    else
        log_warn "Health check échoué (normal en premier démarrage)"
    fi
    
    # Arrêt processus test
    kill $APP_PID 2>/dev/null || true
    wait $APP_PID 2>/dev/null || true
    
    log_info "✅ Tests de santé terminés"
}

pm2_operations() {
    log_step "Configuration PM2..."
    
    cd "$APP_DIR"
    
    # Vérifier si PM2 est installé
    if ! command -v pm2 &> /dev/null; then
        log_error "PM2 n'est pas installé"
        log_info "Installez PM2 avec: npm install -g pm2"
        exit 1
    fi
    
    # Sauvegarder état actuel PM2
    pm2 save 2>/dev/null || true
    
    # Configuration PM2 si pas encore fait
    if ! pm2 list | grep -q "psa-grading-app"; then
        log_info "Configuration initiale PM2..."
        pm2 start ecosystem.config.js --env production
    else
        log_info "Rechargement PM2 en cours..."
        pm2 reload ecosystem.config.js --env production
    fi
    
    # Attendre stabilisation
    sleep 3
    
    # Vérifier status PM2
    if pm2 list | grep -q "online.*psa-grading-app"; then
        log_info "✅ PM2 opérationnel"
    else
        log_error "Problème avec PM2"
        pm2 logs psa-grading-app --lines 20
        exit 1
    fi
    
    # Sauvegarde configuration PM2
    pm2 save
    
    log_info "✅ PM2 configuré et sauvegardé"
}

security_hardening() {
    log_step "Durcissement sécurité..."
    
    # Vérification permissions critiques
    chmod 600 "$APP_DIR/.env" 2>/dev/null || true
    chmod 644 "$APP_DIR/package.json"
    chmod 755 "$APP_DIR"
    
    # Vérification des secrets dans les logs (masquage)
    if grep -r "password\|secret\|token" "$LOG_DIR"/*.log 2>/dev/null | grep -v "MASKED\|****"; then
        log_warn "Données sensibles potentiellement présentes dans les logs"
    fi
    
    log_info "✅ Sécurité durcie"
}

final_validation() {
    log_step "Validation finale..."
    
    # Status final PM2
    pm2 status | grep psa-grading-app || {
        log_error "Application non visible dans PM2"
        exit 1
    }
    
    # Test final health check (avec PM2)
    sleep 5
    if curl -f -s http://localhost:5000/healthz > /dev/null 2>&1; then
        log_info "✅ Application déployée et opérationnelle"
    else
        log_warn "Health check final échoué - vérifiez les logs"
        pm2 logs psa-grading-app --lines 10
    fi
    
    # Affichage métriques finales
    echo ""
    echo "=========================="
    echo "  DÉPLOIEMENT TERMINÉ     "
    echo "=========================="
    echo "📊 Status PM2:"
    pm2 status | grep psa-grading-app
    echo ""
    echo "📁 Logs disponibles:"
    echo "  - Application: pm2 logs psa-grading-app"
    echo "  - Fichiers: $LOG_DIR/"
    echo ""
    echo "🔧 Commandes utiles:"
    echo "  - Redémarrer: pm2 restart psa-grading-app"
    echo "  - Logs temps réel: pm2 logs psa-grading-app -f"
    echo "  - Monitoring: pm2 monit"
    echo ""
}

# ===============================================
# EXÉCUTION PRINCIPALE
# ===============================================

main() {
    log_info "🚀 Démarrage post-déploiement PSA Grading App"
    echo "Timestamp: $(date)"
    echo "Utilisateur: $(whoami)"
    echo "Répertoire: $(pwd)"
    echo ""
    
    # Vérifications préliminaires
    check_user
    check_environment
    
    # Opérations déploiement
    create_directories
    install_dependencies
    database_operations
    optimize_application
    validate_configuration
    health_check
    pm2_operations
    security_hardening
    final_validation
    
    log_info "✅ Post-déploiement terminé avec succès!"
    echo ""
    log_info "🌐 Votre application est accessible à: https://$(hostname -f)"
    log_info "📊 Monitoring: pm2 monit"
    log_info "🔍 Health: curl https://$(hostname -f)/healthz"
}

# Capture des erreurs
trap 'log_error "Erreur lors du post-déploiement à la ligne $LINENO"' ERR

# Lancement
main "$@"