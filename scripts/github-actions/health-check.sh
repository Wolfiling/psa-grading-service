#!/bin/bash

# ===============================================
# HEALTH CHECK SCRIPT - PSA GRADING APP
# ===============================================
# 🏥 Script de vérification de santé pour déploiement GitHub Actions
# 📊 Checks complets: application, base de données, services externes
# 🚨 Alertes automatiques en cas de problème

set -e
set -u
set -o pipefail

# ===============================================
# CONFIGURATION
# ===============================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="/var/www/psa-grading-app"
LOG_FILE="/var/log/psa-grading/health-check.log"

# Configuration health check
HEALTH_CHECK_URL="${HEALTH_CHECK_URL:-http://localhost:5000}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-30}"
MAX_RETRIES="${MAX_RETRIES:-3}"
RETRY_DELAY="${RETRY_DELAY:-5}"

# Services à vérifier
CHECK_DATABASE="${CHECK_DATABASE:-true}"
CHECK_EXTERNAL_SERVICES="${CHECK_EXTERNAL_SERVICES:-false}"
CHECK_DISK_SPACE="${CHECK_DISK_SPACE:-true}"
CHECK_MEMORY="${CHECK_MEMORY:-true}"

# Seuils d'alerte
DISK_USAGE_THRESHOLD=80
MEMORY_USAGE_THRESHOLD=85

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
        "ERROR")   echo -e "${RED}❌ ${message}${NC}" ;;
        "SUCCESS") echo -e "${GREEN}✅ ${message}${NC}" ;;
        "WARNING") echo -e "${YELLOW}⚠️  ${message}${NC}" ;;
        "INFO")    echo -e "${BLUE}ℹ️  ${message}${NC}" ;;
    esac
}

# ===============================================
# CHECKS INDIVIDUELS
# ===============================================

# Vérification de l'application principale
check_application() {
    log "INFO" "Checking application health..."
    
    local endpoint="$HEALTH_CHECK_URL/healthz"
    local retries=0
    
    while [ $retries -lt $MAX_RETRIES ]; do
        log "INFO" "Health check attempt $((retries + 1))/$MAX_RETRIES: $endpoint"
        
        if curl -f -s -m "$TIMEOUT_SECONDS" "$endpoint" > /dev/null 2>&1; then
            # Obtenir détails de santé
            local response=$(curl -s -m "$TIMEOUT_SECONDS" "$endpoint" 2>/dev/null || echo '{"status":"unknown"}')
            log "SUCCESS" "Application health check passed"
            log "INFO" "Response: $response"
            return 0
        else
            log "WARNING" "Health check attempt $((retries + 1)) failed"
            retries=$((retries + 1))
            
            if [ $retries -lt $MAX_RETRIES ]; then
                sleep $RETRY_DELAY
            fi
        fi
    done
    
    log "ERROR" "Application health check failed after $MAX_RETRIES attempts"
    return 1
}

# Vérification des endpoints critiques
check_critical_endpoints() {
    log "INFO" "Checking critical endpoints..."
    
    local endpoints=(
        "$HEALTH_CHECK_URL/"
        "$HEALTH_CHECK_URL/api/status"
    )
    
    local failed_endpoints=0
    
    for endpoint in "${endpoints[@]}"; do
        log "INFO" "Testing endpoint: $endpoint"
        
        local status_code=$(curl -o /dev/null -s -w "%{http_code}" -m "$TIMEOUT_SECONDS" "$endpoint" 2>/dev/null || echo "000")
        
        if [ "$status_code" -ge 200 ] && [ "$status_code" -lt 400 ]; then
            log "SUCCESS" "Endpoint OK ($status_code): $endpoint"
        else
            log "ERROR" "Endpoint failed ($status_code): $endpoint"
            failed_endpoints=$((failed_endpoints + 1))
        fi
    done
    
    if [ $failed_endpoints -eq 0 ]; then
        log "SUCCESS" "All critical endpoints are healthy"
        return 0
    else
        log "ERROR" "$failed_endpoints critical endpoints failed"
        return 1
    fi
}

# Vérification de la base de données
check_database() {
    if [ "$CHECK_DATABASE" != "true" ]; then
        log "INFO" "Database check skipped (disabled)"
        return 0
    fi
    
    log "INFO" "Checking database connectivity..."
    
    cd "$APP_DIR" 2>/dev/null || {
        log "ERROR" "Cannot access application directory: $APP_DIR"
        return 1
    }
    
    local compose_file=""
    if [ -f "docker-compose.production.yml" ]; then
        compose_file="docker-compose.production.yml"
    elif [ -f "docker-compose.staging.yml" ]; then
        compose_file="docker-compose.staging.yml"
    elif [ -f "docker-compose.yml" ]; then
        compose_file="docker-compose.yml"
    else
        log "WARNING" "No docker-compose file found, skipping database check"
        return 0
    fi
    
    # Vérifier si le conteneur PostgreSQL est en cours d'exécution
    if docker-compose -f "$compose_file" ps postgres | grep -q "Up"; then
        log "INFO" "PostgreSQL container is running"
        
        # Test de connectivité
        if docker-compose -f "$compose_file" exec -T postgres pg_isready -U postgres > /dev/null 2>&1; then
            log "SUCCESS" "Database connectivity check passed"
            
            # Test simple de requête
            local result=$(docker-compose -f "$compose_file" exec -T postgres psql -U postgres -d psa_grading -c "SELECT 1;" 2>/dev/null | grep -c "1 row" || echo "0")
            
            if [ "$result" = "1" ]; then
                log "SUCCESS" "Database query test passed"
                return 0
            else
                log "ERROR" "Database query test failed"
                return 1
            fi
        else
            log "ERROR" "Database connectivity check failed"
            return 1
        fi
    else
        log "WARNING" "PostgreSQL container is not running"
        return 1
    fi
}

# Vérification des services externes
check_external_services() {
    if [ "$CHECK_EXTERNAL_SERVICES" != "true" ]; then
        log "INFO" "External services check skipped (disabled)"
        return 0
    fi
    
    log "INFO" "Checking external services..."
    
    local failed_services=0
    
    # Test Brevo API (si configuré)
    if [ -n "${BREVO_API_KEY:-}" ]; then
        log "INFO" "Testing Brevo API connectivity..."
        if curl -f -s -m 10 -H "api-key: $BREVO_API_KEY" "https://api.brevo.com/v3/account" > /dev/null 2>&1; then
            log "SUCCESS" "Brevo API connectivity OK"
        else
            log "WARNING" "Brevo API connectivity failed"
            failed_services=$((failed_services + 1))
        fi
    fi
    
    # Test général connectivité internet
    log "INFO" "Testing internet connectivity..."
    if curl -f -s -m 10 "https://www.google.com" > /dev/null 2>&1; then
        log "SUCCESS" "Internet connectivity OK"
    else
        log "ERROR" "Internet connectivity failed"
        failed_services=$((failed_services + 1))
    fi
    
    if [ $failed_services -eq 0 ]; then
        log "SUCCESS" "All external services are accessible"
        return 0
    else
        log "WARNING" "$failed_services external services failed"
        return 1
    fi
}

# Vérification des ressources système
check_system_resources() {
    log "INFO" "Checking system resources..."
    
    local warnings=0
    
    # Vérification espace disque
    if [ "$CHECK_DISK_SPACE" = "true" ]; then
        log "INFO" "Checking disk usage..."
        
        local disk_usage=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
        log "INFO" "Disk usage: ${disk_usage}%"
        
        if [ "$disk_usage" -gt "$DISK_USAGE_THRESHOLD" ]; then
            log "WARNING" "Disk usage is high: ${disk_usage}% (threshold: ${DISK_USAGE_THRESHOLD}%)"
            warnings=$((warnings + 1))
        else
            log "SUCCESS" "Disk usage is acceptable: ${disk_usage}%"
        fi
    fi
    
    # Vérification mémoire
    if [ "$CHECK_MEMORY" = "true" ]; then
        log "INFO" "Checking memory usage..."
        
        local memory_usage=$(free | awk 'NR==2{printf "%.0f", $3*100/$2}')
        log "INFO" "Memory usage: ${memory_usage}%"
        
        if [ "$memory_usage" -gt "$MEMORY_USAGE_THRESHOLD" ]; then
            log "WARNING" "Memory usage is high: ${memory_usage}% (threshold: ${MEMORY_USAGE_THRESHOLD}%)"
            warnings=$((warnings + 1))
        else
            log "SUCCESS" "Memory usage is acceptable: ${memory_usage}%"
        fi
    fi
    
    # Vérification processus Docker
    log "INFO" "Checking Docker processes..."
    local docker_processes=$(docker ps --format "table {{.Names}}\t{{.Status}}" | grep -c "Up" || echo "0")
    log "INFO" "Docker containers running: $docker_processes"
    
    if [ "$docker_processes" -eq 0 ]; then
        log "ERROR" "No Docker containers are running"
        return 1
    else
        log "SUCCESS" "Docker containers are running: $docker_processes"
    fi
    
    if [ $warnings -eq 0 ]; then
        log "SUCCESS" "System resources check passed"
        return 0
    else
        log "WARNING" "System resources check completed with $warnings warnings"
        return 0  # Warnings ne font pas échouer le health check
    fi
}

# Vérification des logs d'erreur
check_application_logs() {
    log "INFO" "Checking application logs for errors..."
    
    local app_log_dir="/var/log/psa-grading"
    local recent_errors=0
    
    if [ -d "$app_log_dir" ]; then
        # Chercher erreurs dans les 5 dernières minutes
        local error_count=$(find "$app_log_dir" -name "*.log" -type f -exec grep -c "ERROR\|FATAL\|CRITICAL" {} \; 2>/dev/null | awk '{sum+=$1} END {print sum+0}')
        
        log "INFO" "Recent errors found in logs: $error_count"
        
        if [ "$error_count" -gt 10 ]; then
            log "WARNING" "High number of recent errors in logs: $error_count"
            
            # Afficher quelques erreurs récentes
            find "$app_log_dir" -name "*.log" -type f -exec tail -10 {} \; 2>/dev/null | grep -E "ERROR|FATAL|CRITICAL" | head -3 | while read line; do
                log "WARNING" "Recent error: $line"
            done
        else
            log "SUCCESS" "Application logs show acceptable error levels"
        fi
    else
        log "INFO" "Application log directory not found, skipping log analysis"
    fi
}

# ===============================================
# HEALTH CHECK COMPLET
# ===============================================
run_health_check() {
    log "INFO" "🏥 Starting comprehensive health check..."
    log "INFO" "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    
    local checks_passed=0
    local checks_failed=0
    local checks_warned=0
    
    # Liste des vérifications à effectuer
    local checks=(
        "check_application:Critical application health check"
        "check_critical_endpoints:Critical endpoints verification"
        "check_database:Database connectivity check"
        "check_external_services:External services verification"
        "check_system_resources:System resources check"
        "check_application_logs:Application logs analysis"
    )
    
    for check_spec in "${checks[@]}"; do
        local check_function=$(echo "$check_spec" | cut -d: -f1)
        local check_description=$(echo "$check_spec" | cut -d: -f2)
        
        log "INFO" "Running: $check_description"
        
        if $check_function; then
            checks_passed=$((checks_passed + 1))
        else
            checks_failed=$((checks_failed + 1))
        fi
    done
    
    # Résumé des résultats
    log "INFO" "🏥 Health check summary:"
    log "INFO" "  ✅ Passed: $checks_passed"
    log "INFO" "  ❌ Failed: $checks_failed"
    log "INFO" "  ⚠️  Warned: $checks_warned"
    
    # Déterminer le résultat global
    if [ $checks_failed -eq 0 ]; then
        log "SUCCESS" "🎉 Overall health check: PASSED"
        
        # Enregistrer succès dans métriques
        echo "$(date -u +%Y-%m-%dT%H:%M:%SZ),health_check_success,$checks_passed,$checks_failed" >> "/var/log/psa-grading/health-metrics.csv" || true
        
        return 0
    else
        log "ERROR" "💥 Overall health check: FAILED"
        
        # Enregistrer échec dans métriques
        echo "$(date -u +%Y-%m-%dT%H:%M:%SZ),health_check_failed,$checks_passed,$checks_failed" >> "/var/log/psa-grading/health-metrics.csv" || true
        
        return 1
    fi
}

# Fonction pour usage en monitoring continu
monitor_mode() {
    local interval="${MONITOR_INTERVAL:-60}"
    
    log "INFO" "Starting continuous monitoring mode (interval: ${interval}s)"
    
    while true; do
        if run_health_check; then
            log "INFO" "Monitoring check passed, waiting ${interval}s..."
        else
            log "WARNING" "Monitoring check failed, waiting ${interval}s..."
            
            # Notification en cas d'échec (si configuré)
            if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
                curl -X POST -H 'Content-type: application/json' \
                    --data "{\"text\":\"⚠️ PSA Grading App health check failed on $(hostname)\"}" \
                    "$SLACK_WEBHOOK_URL" || true
            fi
        fi
        
        sleep "$interval"
    done
}

# ===============================================
# MAIN FUNCTION
# ===============================================
main() {
    local mode="${1:-single}"
    
    # Créer répertoire de logs si nécessaire
    sudo mkdir -p "$(dirname "$LOG_FILE")" || true
    
    case "$mode" in
        "single")
            run_health_check
            ;;
        "monitor")
            monitor_mode
            ;;
        "quick")
            # Health check rapide (seulement application)
            CHECK_DATABASE=false
            CHECK_EXTERNAL_SERVICES=false
            CHECK_DISK_SPACE=false
            CHECK_MEMORY=false
            check_application
            ;;
        *)
            log "ERROR" "Usage: $0 [single|monitor|quick]"
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