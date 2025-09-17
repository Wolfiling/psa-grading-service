#!/bin/bash

# ===============================================
# GITHUB ACTIONS → VPS DEPLOYMENT SCRIPT
# PSA Grading App - Déploiement automatisé
# ===============================================
# 🚀 Script de déploiement depuis GitHub Actions vers serveur VPS
# 🔒 Sécurisé avec validation et rollback automatique
# 📊 Monitoring et notifications intégrés

set -e  # Exit on error
set -u  # Exit on undefined variable
set -o pipefail  # Exit on pipe failure

# ===============================================
# 🎯 CONFIGURATION GLOBALE
# ===============================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Variables d'environnement GitHub Actions
DEPLOYMENT_ENV="${DEPLOYMENT_ENV:-staging}"
DOCKER_IMAGE="${DOCKER_IMAGE:-}"
GITHUB_SHA="${GITHUB_SHA:-unknown}"
GITHUB_REF="${GITHUB_REF:-unknown}"
GITHUB_ACTOR="${GITHUB_ACTOR:-github-actions}"

# Configuration serveur
APP_DIR="/var/www/psa-grading-app"
BACKUP_DIR="/var/backups/psa-grading"
LOG_FILE="/var/log/psa-grading/deployment.log"

# Configuration déploiement
MAX_RETRIES=3
HEALTH_CHECK_TIMEOUT=120
ROLLBACK_TIMEOUT=30

# Couleurs pour output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ===============================================
# 🛠️ FONCTIONS UTILITAIRES
# ===============================================
log() {
    local level=$1
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    echo -e "${timestamp} [${level}] ${message}" | tee -a "$LOG_FILE"
    
    case $level in
        "ERROR")   echo -e "${RED}❌ ${message}${NC}" ;;
        "SUCCESS") echo -e "${GREEN}✅ ${message}${NC}" ;;
        "WARNING") echo -e "${YELLOW}⚠️  ${message}${NC}" ;;
        "INFO")    echo -e "${BLUE}ℹ️  ${message}${NC}" ;;
    esac
}

# Fonction de nettoyage en cas d'erreur
cleanup() {
    local exit_code=$?
    if [ $exit_code -ne 0 ]; then
        log "ERROR" "Deployment failed with exit code $exit_code"
        log "INFO" "Starting emergency cleanup..."
        
        # Arrêt des processus en cours si nécessaire
        pkill -f "docker pull" || true
        pkill -f "docker-compose up" || true
        
        log "INFO" "Cleanup completed"
    fi
    exit $exit_code
}

trap cleanup EXIT

# Validation des prérequis
validate_prerequisites() {
    log "INFO" "Validating deployment prerequisites..."
    
    # Vérifier Docker
    if ! command -v docker &> /dev/null; then
        log "ERROR" "Docker is not installed or not in PATH"
        exit 1
    fi
    
    # Vérifier Docker Compose
    if ! command -v docker-compose &> /dev/null; then
        log "ERROR" "Docker Compose is not installed or not in PATH"
        exit 1
    fi
    
    # Vérifier variables d'environnement critiques
    if [ -z "$DOCKER_IMAGE" ]; then
        log "ERROR" "DOCKER_IMAGE environment variable is required"
        exit 1
    fi
    
    # Vérifier répertoires
    if [ ! -d "$APP_DIR" ]; then
        log "ERROR" "Application directory $APP_DIR does not exist"
        exit 1
    fi
    
    # Vérifier fichier de configuration environnement
    if [ ! -f "$APP_DIR/.env" ]; then
        log "ERROR" "Environment file $APP_DIR/.env is missing"
        exit 1
    fi
    
    # Créer répertoires nécessaires
    sudo mkdir -p "$BACKUP_DIR" "$(dirname "$LOG_FILE")" || true
    sudo chmod 755 "$BACKUP_DIR" "$(dirname "$LOG_FILE")" || true
    
    log "SUCCESS" "Prerequisites validation completed"
}

# ===============================================
# 💾 BACKUP AVANT DÉPLOIEMENT
# ===============================================
create_backup() {
    log "INFO" "Creating pre-deployment backup..."
    
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_name="backup_${DEPLOYMENT_ENV}_${timestamp}_${GITHUB_SHA:0:7}"
    
    # Backup base de données
    if docker-compose -f "$APP_DIR/docker-compose.$DEPLOYMENT_ENV.yml" exec -T postgres pg_isready -q; then
        log "INFO" "Creating database backup..."
        docker-compose -f "$APP_DIR/docker-compose.$DEPLOYMENT_ENV.yml" exec -T postgres \
            pg_dump -U postgres psa_grading > "$BACKUP_DIR/db_${backup_name}.sql"
        
        if [ -f "$BACKUP_DIR/db_${backup_name}.sql" ]; then
            log "SUCCESS" "Database backup created: db_${backup_name}.sql"
        else
            log "WARNING" "Database backup failed, but continuing deployment"
        fi
    else
        log "WARNING" "Database not accessible for backup, continuing deployment"
    fi
    
    # Backup configuration actuelle
    if [ -f "$APP_DIR/docker-compose.$DEPLOYMENT_ENV.yml" ]; then
        cp "$APP_DIR/docker-compose.$DEPLOYMENT_ENV.yml" "$BACKUP_DIR/compose_${backup_name}.yml"
        log "SUCCESS" "Docker Compose backup created"
    fi
    
    # Backup fichier .env (sanitizé)
    if [ -f "$APP_DIR/.env" ]; then
        # Sauvegarder .env en masquant les secrets
        sed 's/=.*/=***MASKED***/' "$APP_DIR/.env" > "$BACKUP_DIR/env_${backup_name}.backup"
        log "SUCCESS" "Environment configuration backup created (sanitized)"
    fi
    
    log "SUCCESS" "Backup completed: $backup_name"
    echo "$backup_name" > /tmp/current_backup_name
}

# ===============================================
# 🐳 DÉPLOIEMENT DOCKER
# ===============================================
deploy_application() {
    log "INFO" "Starting application deployment..."
    log "INFO" "Environment: $DEPLOYMENT_ENV"
    log "INFO" "Docker Image: $DOCKER_IMAGE"
    log "INFO" "Git SHA: $GITHUB_SHA"
    log "INFO" "Git Ref: $GITHUB_REF"
    log "INFO" "Triggered by: $GITHUB_ACTOR"
    
    cd "$APP_DIR"
    
    # Login Docker Registry (GitHub Container Registry)
    if [ -n "${DOCKER_REGISTRY_TOKEN:-}" ]; then
        log "INFO" "Logging in to Docker registry..."
        echo "$DOCKER_REGISTRY_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin
    fi
    
    # Pull nouvelle image Docker
    log "INFO" "Pulling Docker image: $DOCKER_IMAGE"
    for i in $(seq 1 $MAX_RETRIES); do
        if docker pull "$DOCKER_IMAGE"; then
            log "SUCCESS" "Docker image pulled successfully"
            break
        else
            log "WARNING" "Docker pull attempt $i/$MAX_RETRIES failed"
            if [ $i -eq $MAX_RETRIES ]; then
                log "ERROR" "Failed to pull Docker image after $MAX_RETRIES attempts"
                exit 1
            fi
            sleep 10
        fi
    done
    
    # Tag image pour utilisation locale
    docker tag "$DOCKER_IMAGE" "psa-grading-app:latest"
    
    # Mettre à jour variables d'environnement déploiement
    export DOCKER_IMAGE="$DOCKER_IMAGE"
    export GITHUB_SHA="$GITHUB_SHA"
    export DEPLOYMENT_TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    
    # Déploiement avec Docker Compose
    local compose_file="docker-compose.$DEPLOYMENT_ENV.yml"
    
    if [ ! -f "$compose_file" ]; then
        log "ERROR" "Compose file not found: $compose_file"
        exit 1
    fi
    
    log "INFO" "Deploying with Docker Compose: $compose_file"
    
    # Déploiement progressif (rolling update)
    if [ "$DEPLOYMENT_ENV" = "production" ]; then
        log "INFO" "Starting production rolling deployment..."
        
        # Scale up avec nouvelle image
        docker-compose -f "$compose_file" up -d --scale app=2 --remove-orphans
        
        # Attendre stabilisation
        sleep 30
        
    else
        log "INFO" "Starting staging deployment..."
        docker-compose -f "$compose_file" up -d --remove-orphans
    fi
    
    log "SUCCESS" "Docker deployment completed"
}

# ===============================================
# 🏥 HEALTH CHECK
# ===============================================
perform_health_check() {
    log "INFO" "Performing health check..."
    
    local health_endpoint="http://localhost:5000/healthz"
    local max_wait_time=$HEALTH_CHECK_TIMEOUT
    local wait_interval=10
    local elapsed_time=0
    
    while [ $elapsed_time -lt $max_wait_time ]; do
        log "INFO" "Health check attempt (${elapsed_time}s/${max_wait_time}s)..."
        
        if curl -f -s "$health_endpoint" > /dev/null 2>&1; then
            log "SUCCESS" "Application health check passed!"
            
            # Health check détaillé
            local response=$(curl -s "$health_endpoint")
            log "INFO" "Health check response: $response"
            
            return 0
        fi
        
        sleep $wait_interval
        elapsed_time=$((elapsed_time + wait_interval))
    done
    
    log "ERROR" "Health check failed after ${max_wait_time} seconds"
    
    # Collecter logs pour debugging
    log "INFO" "Collecting logs for debugging..."
    docker-compose -f "docker-compose.$DEPLOYMENT_ENV.yml" logs --tail=50 app || true
    
    return 1
}

# ===============================================
# 🔄 ROLLBACK AUTOMATIQUE
# ===============================================
rollback_deployment() {
    log "WARNING" "Initiating automatic rollback..."
    
    local backup_name=$(cat /tmp/current_backup_name 2>/dev/null || echo "unknown")
    
    # Arrêter services actuels
    cd "$APP_DIR"
    docker-compose -f "docker-compose.$DEPLOYMENT_ENV.yml" down || true
    
    # Restaurer configuration précédente si disponible
    if [ -f "$BACKUP_DIR/compose_${backup_name}.yml" ]; then
        cp "$BACKUP_DIR/compose_${backup_name}.yml" "docker-compose.$DEPLOYMENT_ENV.yml"
        log "INFO" "Docker Compose configuration restored from backup"
    fi
    
    # Redémarrer avec configuration précédente
    docker-compose -f "docker-compose.$DEPLOYMENT_ENV.yml" up -d || {
        log "ERROR" "Rollback failed - manual intervention required"
        exit 1
    }
    
    # Attendre stabilisation
    sleep 30
    
    # Vérifier que le rollback a fonctionné
    if perform_health_check; then
        log "SUCCESS" "Rollback completed successfully"
        
        # Notifier l'équipe du rollback
        notify_rollback "$backup_name"
        
        return 0
    else
        log "ERROR" "Rollback health check failed - critical situation"
        exit 1
    fi
}

# ===============================================
# 🧹 POST-DÉPLOIEMENT
# ===============================================
post_deployment_tasks() {
    log "INFO" "Running post-deployment tasks..."
    
    # Nettoyage des images Docker anciennes
    log "INFO" "Cleaning up old Docker images..."
    docker image prune -f --filter "until=24h" || true
    
    # Nettoyage des backups anciens (garder 7 derniers)
    log "INFO" "Cleaning up old backups..."
    find "$BACKUP_DIR" -name "backup_${DEPLOYMENT_ENV}_*" -type f -mtime +7 -delete || true
    
    # Mise à jour des permissions logs
    sudo chown -R "$(whoami):$(whoami)" "$(dirname "$LOG_FILE")" || true
    
    # Rotation des logs application si nécessaire
    if [ -f "$LOG_FILE" ] && [ $(stat -f%z "$LOG_FILE" 2>/dev/null || stat -c%s "$LOG_FILE") -gt 10485760 ]; then
        mv "$LOG_FILE" "${LOG_FILE}.old"
        touch "$LOG_FILE"
        log "INFO" "Log file rotated"
    fi
    
    log "SUCCESS" "Post-deployment tasks completed"
}

# ===============================================
# 📧 NOTIFICATIONS
# ===============================================
notify_success() {
    local deployment_info="Environment: $DEPLOYMENT_ENV, Image: $DOCKER_IMAGE, SHA: $GITHUB_SHA, Actor: $GITHUB_ACTOR"
    
    log "SUCCESS" "🎉 DEPLOYMENT SUCCESSFUL 🎉"
    log "INFO" "$deployment_info"
    
    # Webhook Slack si configuré
    if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
        curl -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"✅ PSA Grading App deployed successfully to $DEPLOYMENT_ENV\n$deployment_info\"}" \
            "$SLACK_WEBHOOK_URL" || true
    fi
    
    # Enregistrer succès dans métriques
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ),success,$DEPLOYMENT_ENV,$GITHUB_SHA,$GITHUB_ACTOR" >> "/var/log/psa-grading/deployment-metrics.csv"
}

notify_rollback() {
    local backup_name=$1
    local rollback_info="Environment: $DEPLOYMENT_ENV, Backup: $backup_name, SHA: $GITHUB_SHA"
    
    log "WARNING" "🚨 DEPLOYMENT ROLLED BACK 🚨"
    log "INFO" "$rollback_info"
    
    # Webhook Slack si configuré
    if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
        curl -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"🚨 PSA Grading App deployment failed and rolled back on $DEPLOYMENT_ENV\n$rollback_info\"}" \
            "$SLACK_WEBHOOK_URL" || true
    fi
    
    # Enregistrer rollback dans métriques
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ),rollback,$DEPLOYMENT_ENV,$GITHUB_SHA,$GITHUB_ACTOR" >> "/var/log/psa-grading/deployment-metrics.csv"
}

# ===============================================
# 🚀 MAIN DEPLOYMENT FLOW
# ===============================================
main() {
    log "INFO" "🚀 Starting GitHub Actions deployment process..."
    log "INFO" "Script version: 1.0.0"
    log "INFO" "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    
    # Phase 1: Validation
    validate_prerequisites
    
    # Phase 2: Backup
    create_backup
    
    # Phase 3: Déploiement
    if deploy_application; then
        log "SUCCESS" "Application deployment phase completed"
    else
        log "ERROR" "Application deployment failed"
        rollback_deployment
        exit 1
    fi
    
    # Phase 4: Health Check
    if perform_health_check; then
        log "SUCCESS" "Health check phase completed"
    else
        log "ERROR" "Health check failed"
        rollback_deployment
        exit 1
    fi
    
    # Phase 5: Post-déploiement
    post_deployment_tasks
    
    # Phase 6: Notification de succès
    notify_success
    
    log "SUCCESS" "🎉 GitHub Actions deployment completed successfully!"
    log "INFO" "Application is now running with image: $DOCKER_IMAGE"
    log "INFO" "Deployment logs saved to: $LOG_FILE"
}

# ===============================================
# 🎯 EXECUTION
# ===============================================
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    main "$@"
fi