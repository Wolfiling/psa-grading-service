#!/bin/bash

# ===============================================
# ROLLBACK AUTOMATIQUE - PSA GRADING APP
# ===============================================
# 🔄 Script de rollback automatique pour GitHub Actions
# 🚨 Restauration rapide en cas d'échec de déploiement
# 💾 Utilise les backups automatiques créés lors du déploiement

set -e
set -u
set -o pipefail

# ===============================================
# CONFIGURATION
# ===============================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="/var/www/psa-grading-app"
BACKUP_DIR="/var/backups/psa-grading"
LOG_FILE="/var/log/psa-grading/rollback.log"

# Variables GitHub Actions
DEPLOYMENT_ENV="${DEPLOYMENT_ENV:-staging}"
ROLLBACK_REASON="${ROLLBACK_REASON:-deployment_failed}"
GITHUB_SHA="${GITHUB_SHA:-unknown}"
GITHUB_ACTOR="${GITHUB_ACTOR:-github-actions}"

# Configuration rollback
ROLLBACK_TIMEOUT=300  # 5 minutes
MAX_ROLLBACK_ATTEMPTS=3
HEALTH_CHECK_RETRIES=5

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ===============================================
# FONCTIONS UTILITAIRES
# ===============================================
log() {
    local level=$1
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    echo -e "${timestamp} [${level}] ${message}" | tee -a "$LOG_FILE"
    
    case $level in
        "ERROR")   echo -e "${RED}🚨 ${message}${NC}" ;;
        "SUCCESS") echo -e "${GREEN}✅ ${message}${NC}" ;;
        "WARNING") echo -e "${YELLOW}⚠️  ${message}${NC}" ;;
        "INFO")    echo -e "${BLUE}ℹ️  ${message}${NC}" ;;
    esac
}

cleanup_rollback() {
    local exit_code=$?
    if [ $exit_code -ne 0 ]; then
        log "ERROR" "Rollback failed with exit code $exit_code"
        log "ERROR" "Manual intervention required!"
        
        # Notification d'échec rollback (critique)
        notify_critical_failure
    fi
    exit $exit_code
}

trap cleanup_rollback EXIT

# ===============================================
# DÉTECTION DU BACKUP À RESTAURER
# ===============================================
find_latest_backup() {
    log "INFO" "Searching for latest backup to restore..."
    
    local backup_name=""
    
    # Chercher backup le plus récent pour cet environnement
    if [ -f "$BACKUP_DIR/latest-backup.txt" ]; then
        backup_name=$(cat "$BACKUP_DIR/latest-backup.txt")
        log "INFO" "Found latest backup reference: $backup_name"
    else
        # Chercher le backup le plus récent par date
        backup_name=$(find "$BACKUP_DIR" -name "backup_${DEPLOYMENT_ENV}_*" -type d | sort -r | head -n 1 | xargs basename)
        if [ -z "$backup_name" ]; then
            log "ERROR" "No backup found for environment: $DEPLOYMENT_ENV"
            exit 1
        fi
        log "INFO" "Found latest backup by date: $backup_name"
    fi
    
    echo "$backup_name"
}

validate_backup() {
    local backup_name=$1
    log "INFO" "Validating backup: $backup_name"
    
    local backup_path="$BACKUP_DIR/$backup_name"
    
    # Vérifier existence des fichiers backup
    local backup_files=0
    
    if [ -f "${backup_path}-db.sql" ]; then
        log "INFO" "Database backup found: ${backup_path}-db.sql"
        backup_files=$((backup_files + 1))
    fi
    
    if [ -f "${backup_path}-compose.yml" ]; then
        log "INFO" "Docker Compose backup found: ${backup_path}-compose.yml"
        backup_files=$((backup_files + 1))
    fi
    
    if [ -f "${backup_path}-env.backup" ]; then
        log "INFO" "Environment backup found: ${backup_path}-env.backup"
        backup_files=$((backup_files + 1))
    fi
    
    if [ $backup_files -eq 0 ]; then
        log "ERROR" "No valid backup files found for: $backup_name"
        return 1
    fi
    
    log "SUCCESS" "Backup validation passed ($backup_files files found)"
    return 0
}

# ===============================================
# ARRÊT DES SERVICES ACTUELS
# ===============================================
stop_current_services() {
    log "INFO" "Stopping current services..."
    
    cd "$APP_DIR"
    local compose_file="docker-compose.$DEPLOYMENT_ENV.yml"
    
    if [ -f "$compose_file" ]; then
        log "INFO" "Stopping Docker Compose services..."
        docker-compose -f "$compose_file" down --remove-orphans || {
            log "WARNING" "Failed to stop some services gracefully"
            
            # Force stop containers
            docker ps --format "table {{.Names}}" | grep -E "(psa-app|psa-postgres|psa-nginx)" | xargs -r docker stop || true
        }
    else
        log "WARNING" "No compose file found: $compose_file"
    fi
    
    # Arrêter processus orphelins
    pkill -f "node.*server/index.js" || true
    pkill -f "npm.*start" || true
    
    log "SUCCESS" "Current services stopped"
}

# ===============================================
# RESTAURATION DE LA CONFIGURATION
# ===============================================
restore_configuration() {
    local backup_name=$1
    log "INFO" "Restoring configuration from backup: $backup_name"
    
    local backup_path="$BACKUP_DIR/$backup_name"
    
    # Restaurer Docker Compose configuration
    if [ -f "${backup_path}-compose.yml" ]; then
        log "INFO" "Restoring Docker Compose configuration..."
        cp "${backup_path}-compose.yml" "$APP_DIR/docker-compose.$DEPLOYMENT_ENV.yml"
        log "SUCCESS" "Docker Compose configuration restored"
    else
        log "WARNING" "No Docker Compose backup to restore"
    fi
    
    # Restaurer configuration environnement (si disponible)
    if [ -f "${backup_path}-env.backup" ]; then
        log "INFO" "Environment backup found but not restored (security measure)"
        log "INFO" "Manual review required for environment variables"
    fi
    
    log "SUCCESS" "Configuration restoration completed"
}

# ===============================================
# RESTAURATION BASE DE DONNÉES
# ===============================================
restore_database() {
    local backup_name=$1
    log "INFO" "Restoring database from backup: $backup_name"
    
    local backup_path="$BACKUP_DIR/$backup_name"
    local db_backup="${backup_path}-db.sql"
    
    if [ ! -f "$db_backup" ]; then
        log "WARNING" "No database backup to restore: $db_backup"
        return 0
    fi
    
    cd "$APP_DIR"
    local compose_file="docker-compose.$DEPLOYMENT_ENV.yml"
    
    # Vérifier que la base de données est accessible
    log "INFO" "Checking database accessibility..."
    local retries=0
    while [ $retries -lt 10 ]; do
        if docker-compose -f "$compose_file" exec -T postgres pg_isready -q; then
            log "SUCCESS" "Database is accessible"
            break
        fi
        retries=$((retries + 1))
        log "INFO" "Waiting for database... (attempt $retries/10)"
        sleep 5
    done
    
    if [ $retries -eq 10 ]; then
        log "ERROR" "Database not accessible for restore"
        return 1
    fi
    
    # Restaurer la base de données
    log "INFO" "Restoring database from: $db_backup"
    
    # Créer une sauvegarde avant restauration
    log "INFO" "Creating safety backup before restore..."
    docker-compose -f "$compose_file" exec -T postgres \
        pg_dump -U postgres psa_grading > "$BACKUP_DIR/pre-rollback-$(date +%Y%m%d_%H%M%S).sql" || true
    
    # Restauration
    if cat "$db_backup" | docker-compose -f "$compose_file" exec -T postgres \
        psql -U postgres -d psa_grading; then
        log "SUCCESS" "Database restored successfully"
    else
        log "ERROR" "Database restoration failed"
        return 1
    fi
    
    return 0
}

# ===============================================
# REDÉMARRAGE DES SERVICES
# ===============================================
restart_services() {
    log "INFO" "Restarting services with restored configuration..."
    
    cd "$APP_DIR"
    local compose_file="docker-compose.$DEPLOYMENT_ENV.yml"
    
    if [ ! -f "$compose_file" ]; then
        log "ERROR" "Compose file not found after restore: $compose_file"
        return 1
    fi
    
    # Redémarrage avec configuration restaurée
    log "INFO" "Starting services with restored configuration..."
    
    for attempt in $(seq 1 $MAX_ROLLBACK_ATTEMPTS); do
        log "INFO" "Service restart attempt $attempt/$MAX_ROLLBACK_ATTEMPTS"
        
        if docker-compose -f "$compose_file" up -d --remove-orphans; then
            log "SUCCESS" "Services started successfully"
            
            # Attendre stabilisation
            sleep 30
            return 0
        else
            log "WARNING" "Service restart attempt $attempt failed"
            if [ $attempt -lt $MAX_ROLLBACK_ATTEMPTS ]; then
                sleep 10
            fi
        fi
    done
    
    log "ERROR" "All service restart attempts failed"
    return 1
}

# ===============================================
# VÉRIFICATION POST-ROLLBACK
# ===============================================
verify_rollback() {
    log "INFO" "Verifying rollback success..."
    
    local health_endpoint="http://localhost:5000/healthz"
    local retries=0
    
    while [ $retries -lt $HEALTH_CHECK_RETRIES ]; do
        log "INFO" "Health check attempt $((retries + 1))/$HEALTH_CHECK_RETRIES"
        
        if curl -f -s -m 15 "$health_endpoint" > /dev/null 2>&1; then
            local response=$(curl -s -m 15 "$health_endpoint" 2>/dev/null)
            log "SUCCESS" "Application is healthy after rollback"
            log "INFO" "Health response: $response"
            
            # Vérification supplémentaire: endpoint principal
            if curl -f -s -m 15 "http://localhost:5000/" > /dev/null 2>&1; then
                log "SUCCESS" "Main endpoint is also responding"
                return 0
            else
                log "WARNING" "Health endpoint OK but main endpoint not responding"
            fi
        fi
        
        retries=$((retries + 1))
        if [ $retries -lt $HEALTH_CHECK_RETRIES ]; then
            sleep 15
        fi
    done
    
    log "ERROR" "Rollback verification failed - application not healthy"
    
    # Collecter logs pour diagnostic
    log "INFO" "Collecting logs for diagnosis..."
    docker-compose -f "docker-compose.$DEPLOYMENT_ENV.yml" logs --tail=20 app || true
    
    return 1
}

# ===============================================
# NETTOYAGE POST-ROLLBACK
# ===============================================
cleanup_after_rollback() {
    log "INFO" "Performing post-rollback cleanup..."
    
    # Nettoyage images Docker orphelines
    docker image prune -f --filter "until=1h" || true
    
    # Rotation logs si nécessaire
    find "/var/log/psa-grading" -name "*.log" -size +50M -exec truncate -s 10M {} \; || true
    
    # Mise à jour métadonnées rollback
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ),rollback_success,$DEPLOYMENT_ENV,$GITHUB_SHA,$GITHUB_ACTOR,$ROLLBACK_REASON" >> \
        "/var/log/psa-grading/rollback-metrics.csv" || true
    
    log "SUCCESS" "Post-rollback cleanup completed"
}

# ===============================================
# NOTIFICATIONS
# ===============================================
notify_rollback_success() {
    local backup_name=$1
    
    log "SUCCESS" "🔄 ROLLBACK COMPLETED SUCCESSFULLY"
    log "INFO" "Backup used: $backup_name"
    log "INFO" "Environment: $DEPLOYMENT_ENV"
    log "INFO" "Original deployment SHA: $GITHUB_SHA"
    log "INFO" "Rollback reason: $ROLLBACK_REASON"
    
    # Webhook Slack si configuré
    if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
        local message="🔄 PSA Grading App rollback completed successfully on $DEPLOYMENT_ENV"
        message+="\n• Backup used: $backup_name"
        message+="\n• Original SHA: $GITHUB_SHA"
        message+="\n• Reason: $ROLLBACK_REASON"
        message+="\n• Actor: $GITHUB_ACTOR"
        
        curl -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"$message\"}" \
            "$SLACK_WEBHOOK_URL" || true
    fi
    
    # Email si configuré
    if [ -n "${ADMIN_EMAIL:-}" ] && command -v mail >/dev/null 2>&1; then
        echo "Rollback completed successfully on $DEPLOYMENT_ENV

Backup used: $backup_name
Original deployment SHA: $GITHUB_SHA
Rollback reason: $ROLLBACK_REASON
Actor: $GITHUB_ACTOR
Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)

Application is now running with the previous stable version.
" | mail -s "PSA Grading App - Rollback Success" "$ADMIN_EMAIL" || true
    fi
}

notify_critical_failure() {
    log "ERROR" "🚨 CRITICAL: ROLLBACK FAILED"
    log "ERROR" "Manual intervention is immediately required!"
    
    # Notification critique
    if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
        local message="🚨 CRITICAL: PSA Grading App rollback FAILED on $DEPLOYMENT_ENV"
        message+="\n• Manual intervention required immediately"
        message+="\n• Environment: $DEPLOYMENT_ENV"
        message+="\n• Failed SHA: $GITHUB_SHA"
        message+="\n• Contact DevOps team urgently"
        
        curl -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"$message\"}" \
            "$SLACK_WEBHOOK_URL" || true
    fi
}

# ===============================================
# ROLLBACK PRINCIPAL
# ===============================================
execute_rollback() {
    log "INFO" "🔄 Starting emergency rollback process..."
    log "INFO" "Environment: $DEPLOYMENT_ENV"
    log "INFO" "Reason: $ROLLBACK_REASON"
    log "INFO" "Original SHA: $GITHUB_SHA"
    log "INFO" "Triggered by: $GITHUB_ACTOR"
    
    # Phase 1: Trouver et valider backup
    local backup_name
    backup_name=$(find_latest_backup)
    
    if ! validate_backup "$backup_name"; then
        log "ERROR" "No valid backup found for rollback"
        exit 1
    fi
    
    # Phase 2: Arrêt services actuels
    stop_current_services
    
    # Phase 3: Restauration configuration
    restore_configuration "$backup_name"
    
    # Phase 4: Restauration base de données
    if ! restore_database "$backup_name"; then
        log "WARNING" "Database restoration failed, continuing with config rollback"
    fi
    
    # Phase 5: Redémarrage services
    if ! restart_services; then
        log "ERROR" "Failed to restart services after rollback"
        exit 1
    fi
    
    # Phase 6: Vérification
    if ! verify_rollback; then
        log "ERROR" "Rollback verification failed"
        exit 1
    fi
    
    # Phase 7: Nettoyage
    cleanup_after_rollback
    
    # Phase 8: Notification succès
    notify_rollback_success "$backup_name"
    
    log "SUCCESS" "🎉 Emergency rollback completed successfully!"
    return 0
}

# ===============================================
# ROLLBACK INTERACTIF
# ===============================================
interactive_rollback() {
    echo "🔄 PSA Grading App - Interactive Rollback"
    echo "========================================="
    echo "Current environment: $DEPLOYMENT_ENV"
    echo "Available backups:"
    
    # Lister backups disponibles
    find "$BACKUP_DIR" -name "backup_${DEPLOYMENT_ENV}_*" -type d -printf "%f\n" | sort -r | head -5
    
    echo ""
    read -p "Confirm rollback? This will restore the previous version. (y/N): " -n 1 -r
    echo
    
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log "INFO" "Rollback cancelled by user"
        exit 0
    fi
    
    ROLLBACK_REASON="manual_rollback"
    execute_rollback
}

# ===============================================
# MAIN FUNCTION
# ===============================================
main() {
    local mode="${1:-auto}"
    
    # Créer répertoire de logs si nécessaire
    sudo mkdir -p "$(dirname "$LOG_FILE")" || true
    
    log "INFO" "🔄 PSA Grading App Rollback Script"
    log "INFO" "Mode: $mode"
    log "INFO" "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    
    case "$mode" in
        "auto"|"automatic")
            # Rollback automatique (depuis GitHub Actions)
            execute_rollback
            ;;
        "interactive"|"manual")
            # Rollback interactif
            interactive_rollback
            ;;
        "list")
            # Lister backups disponibles
            echo "Available backups for $DEPLOYMENT_ENV:"
            find "$BACKUP_DIR" -name "backup_${DEPLOYMENT_ENV}_*" -type d -printf "%f\t" -exec stat -c "%y" {} \; | sort -r
            ;;
        *)
            echo "Usage: $0 [auto|interactive|list]"
            echo ""
            echo "  auto        - Automatic rollback (used by GitHub Actions)"
            echo "  interactive - Interactive rollback with confirmation"
            echo "  list        - List available backups"
            exit 1
            ;;
    esac
}

# ===============================================
# EXECUTION
# ===============================================
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    main "$@"
fi