#!/bin/bash

# ===============================================
# MONITORING SCRIPT - PSA GRADING APP
# ===============================================
# 📊 Script de monitoring continu pour GitHub Actions deployments
# 🔍 Surveillance proactive de l'application et infrastructure
# 📡 Alertes automatiques et métriques de performance

set -e
set -u
set -o pipefail

# ===============================================
# CONFIGURATION
# ===============================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="/var/www/psa-grading-app"
LOG_FILE="/var/log/psa-grading/monitoring.log"
METRICS_FILE="/var/log/psa-grading/metrics.json"

# Configuration monitoring
MONITORING_INTERVAL="${MONITORING_INTERVAL:-300}"  # 5 minutes
ALERT_THRESHOLD_CPU="${ALERT_THRESHOLD_CPU:-80}"
ALERT_THRESHOLD_MEMORY="${ALERT_THRESHOLD_MEMORY:-85}"
ALERT_THRESHOLD_DISK="${ALERT_THRESHOLD_DISK:-90}"
RESPONSE_TIME_THRESHOLD="${RESPONSE_TIME_THRESHOLD:-5000}"  # 5 seconds

# URLs à surveiller
DEPLOYMENT_ENV="${DEPLOYMENT_ENV:-staging}"
if [ "$DEPLOYMENT_ENV" = "production" ]; then
    MONITOR_URL="${MONITOR_URL:-https://${DOMAIN:-localhost}}"
else
    MONITOR_URL="${MONITOR_URL:-https://staging.${DOMAIN:-localhost}}"
fi

HEALTH_ENDPOINT="$MONITOR_URL/healthz"
API_ENDPOINT="$MONITOR_URL/api/status"

# Configuration alertes
SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ALERT_COOLDOWN=1800  # 30 minutes

# État des alertes
ALERT_STATE_FILE="/tmp/psa_alert_state"

# ===============================================
# FONCTIONS UTILITAIRES
# ===============================================
log() {
    local level=$1
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    echo -e "${timestamp} [${level}] ${message}" | tee -a "$LOG_FILE"
}

# Vérification si une alerte est en cooldown
is_alert_in_cooldown() {
    local alert_type=$1
    local cooldown_file="${ALERT_STATE_FILE}_${alert_type}"
    
    if [ -f "$cooldown_file" ]; then
        local last_alert=$(cat "$cooldown_file")
        local current_time=$(date +%s)
        local time_diff=$((current_time - last_alert))
        
        if [ $time_diff -lt $ALERT_COOLDOWN ]; then
            return 0  # En cooldown
        fi
    fi
    
    return 1  # Pas en cooldown
}

# Marquer une alerte comme envoyée
mark_alert_sent() {
    local alert_type=$1
    local cooldown_file="${ALERT_STATE_FILE}_${alert_type}"
    date +%s > "$cooldown_file"
}

# ===============================================
# MONITORING APPLICATION
# ===============================================
check_application_health() {
    log "INFO" "Checking application health: $HEALTH_ENDPOINT"
    
    local start_time=$(date +%s%3N)
    local http_code
    local response_time
    local health_status="unknown"
    
    # Test endpoint de santé
    http_code=$(curl -o /dev/null -s -w "%{http_code}" -m 10 "$HEALTH_ENDPOINT" 2>/dev/null || echo "000")
    local end_time=$(date +%s%3N)
    response_time=$((end_time - start_time))
    
    if [ "$http_code" = "200" ]; then
        health_status="healthy"
        log "INFO" "Application is healthy (${response_time}ms)"
        
        # Récupérer détails de santé si possible
        local health_details=$(curl -s -m 5 "$HEALTH_ENDPOINT" 2>/dev/null | jq -c '.' 2>/dev/null || echo '{}')
        
        # Vérifier temps de réponse
        if [ $response_time -gt $RESPONSE_TIME_THRESHOLD ]; then
            log "WARNING" "Slow response time: ${response_time}ms (threshold: ${RESPONSE_TIME_THRESHOLD}ms)"
            health_status="slow"
        fi
        
    else
        health_status="unhealthy"
        log "ERROR" "Application health check failed: HTTP $http_code"
        
        if ! is_alert_in_cooldown "health"; then
            send_health_alert "Application health check failed (HTTP $http_code)"
            mark_alert_sent "health"
        fi
    fi
    
    # Enregistrer métriques
    record_metric "health_check" "{\"status\":\"$health_status\",\"http_code\":$http_code,\"response_time\":$response_time}"
    
    return $([ "$health_status" = "healthy" ] && echo 0 || echo 1)
}

check_api_endpoints() {
    log "INFO" "Checking critical API endpoints"
    
    local endpoints=(
        "$MONITOR_URL/"
        "$API_ENDPOINT"
        "$MONITOR_URL/api/cards"
    )
    
    local failed_endpoints=0
    local total_endpoints=${#endpoints[@]}
    
    for endpoint in "${endpoints[@]}"; do
        local http_code=$(curl -o /dev/null -s -w "%{http_code}" -m 10 "$endpoint" 2>/dev/null || echo "000")
        
        if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 400 ]; then
            log "INFO" "Endpoint OK ($http_code): $endpoint"
        else
            log "WARNING" "Endpoint failed ($http_code): $endpoint"
            failed_endpoints=$((failed_endpoints + 1))
        fi
    done
    
    local success_rate=$(( (total_endpoints - failed_endpoints) * 100 / total_endpoints ))
    record_metric "api_endpoints" "{\"total\":$total_endpoints,\"failed\":$failed_endpoints,\"success_rate\":$success_rate}"
    
    if [ $failed_endpoints -gt 0 ] && ! is_alert_in_cooldown "api"; then
        send_api_alert "$failed_endpoints/$total_endpoints API endpoints are failing"
        mark_alert_sent "api"
    fi
    
    return $([ $failed_endpoints -eq 0 ] && echo 0 || echo 1)
}

# ===============================================
# MONITORING SYSTÈME
# ===============================================
check_system_resources() {
    log "INFO" "Checking system resources"
    
    local cpu_usage memory_usage disk_usage
    local alerts_sent=false
    
    # CPU Usage
    cpu_usage=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | awk -F'%' '{print $1}' | awk -F'us' '{print $1}' | tr -d ' ')
    [ -z "$cpu_usage" ] && cpu_usage=0
    
    # Memory Usage
    memory_usage=$(free | awk 'NR==2{printf "%.0f", $3*100/$2}')
    
    # Disk Usage
    disk_usage=$(df / | awk 'NR==2{print $5}' | sed 's/%//')
    
    log "INFO" "System metrics - CPU: ${cpu_usage}%, Memory: ${memory_usage}%, Disk: ${disk_usage}%"
    
    # Alertes seuils
    if [ "$cpu_usage" -gt "$ALERT_THRESHOLD_CPU" ] && ! is_alert_in_cooldown "cpu"; then
        send_resource_alert "High CPU usage: ${cpu_usage}% (threshold: ${ALERT_THRESHOLD_CPU}%)"
        mark_alert_sent "cpu"
        alerts_sent=true
    fi
    
    if [ "$memory_usage" -gt "$ALERT_THRESHOLD_MEMORY" ] && ! is_alert_in_cooldown "memory"; then
        send_resource_alert "High memory usage: ${memory_usage}% (threshold: ${ALERT_THRESHOLD_MEMORY}%)"
        mark_alert_sent "memory"
        alerts_sent=true
    fi
    
    if [ "$disk_usage" -gt "$ALERT_THRESHOLD_DISK" ] && ! is_alert_in_cooldown "disk"; then
        send_resource_alert "High disk usage: ${disk_usage}% (threshold: ${ALERT_THRESHOLD_DISK}%)"
        mark_alert_sent "disk"
        alerts_sent=true
    fi
    
    # Enregistrer métriques
    record_metric "system_resources" "{\"cpu\":$cpu_usage,\"memory\":$memory_usage,\"disk\":$disk_usage}"
    
    return $([ "$alerts_sent" = false ] && echo 0 || echo 1)
}

check_docker_containers() {
    log "INFO" "Checking Docker containers status"
    
    local containers_running containers_total
    containers_total=$(docker ps -a --format "table {{.Names}}" | grep -E "(psa-app|psa-postgres|psa-nginx)" | wc -l || echo 0)
    containers_running=$(docker ps --format "table {{.Names}}" | grep -E "(psa-app|psa-postgres|psa-nginx)" | wc -l || echo 0)
    
    log "INFO" "Docker containers: $containers_running/$containers_total running"
    
    if [ "$containers_running" -lt "$containers_total" ] && ! is_alert_in_cooldown "docker"; then
        local stopped_containers=$(docker ps -a --filter "status=exited" --format "{{.Names}}" | grep -E "(psa-app|psa-postgres|psa-nginx)" | tr '\n' ',' | sed 's/,$//')
        send_docker_alert "Some containers are stopped: $stopped_containers"
        mark_alert_sent "docker"
    fi
    
    record_metric "docker_containers" "{\"running\":$containers_running,\"total\":$containers_total}"
    
    return $([ "$containers_running" -eq "$containers_total" ] && echo 0 || echo 1)
}

# ===============================================
# MONITORING BASE DE DONNÉES
# ===============================================
check_database_connection() {
    log "INFO" "Checking database connectivity"
    
    cd "$APP_DIR" 2>/dev/null || return 1
    
    local compose_file="docker-compose.$DEPLOYMENT_ENV.yml"
    if [ ! -f "$compose_file" ]; then
        log "WARNING" "Compose file not found: $compose_file"
        return 1
    fi
    
    # Test connectivité PostgreSQL
    if docker-compose -f "$compose_file" exec -T postgres pg_isready -U postgres > /dev/null 2>&1; then
        log "INFO" "Database connectivity OK"
        
        # Test performance base de données
        local start_time=$(date +%s%3N)
        local query_result=$(docker-compose -f "$compose_file" exec -T postgres \
            psql -U postgres -d psa_grading -c "SELECT COUNT(*) FROM information_schema.tables;" 2>/dev/null | grep -o '[0-9]*' | head -1 || echo "0")
        local end_time=$(date +%s%3N)
        local query_time=$((end_time - start_time))
        
        log "INFO" "Database query performance: ${query_time}ms (tables: $query_result)"
        record_metric "database" "{\"status\":\"connected\",\"tables\":$query_result,\"query_time\":$query_time}"
        
        return 0
    else
        log "ERROR" "Database connectivity failed"
        
        if ! is_alert_in_cooldown "database"; then
            send_database_alert "Database connection failed"
            mark_alert_sent "database"
        fi
        
        record_metric "database" "{\"status\":\"disconnected\"}"
        return 1
    fi
}

# ===============================================
# MONITORING LOGS
# ===============================================
check_application_logs() {
    log "INFO" "Analyzing application logs for errors"
    
    local log_dir="/var/log/psa-grading"
    local recent_errors=0
    local critical_errors=0
    
    if [ -d "$log_dir" ]; then
        # Chercher erreurs dans les 10 dernières minutes
        recent_errors=$(find "$log_dir" -name "*.log" -type f -newermt '10 minutes ago' -exec grep -c "ERROR" {} \; 2>/dev/null | awk '{sum+=$1} END {print sum+0}')
        critical_errors=$(find "$log_dir" -name "*.log" -type f -newermt '10 minutes ago' -exec grep -c "CRITICAL\|FATAL" {} \; 2>/dev/null | awk '{sum+=$1} END {print sum+0}')
        
        log "INFO" "Recent errors in logs: $recent_errors (critical: $critical_errors)"
        
        if [ "$critical_errors" -gt 0 ] && ! is_alert_in_cooldown "critical_logs"; then
            send_logs_alert "Critical errors found in logs: $critical_errors"
            mark_alert_sent "critical_logs"
        elif [ "$recent_errors" -gt 20 ] && ! is_alert_in_cooldown "error_logs"; then
            send_logs_alert "High number of errors in logs: $recent_errors"
            mark_alert_sent "error_logs"
        fi
    else
        log "WARNING" "Log directory not found: $log_dir"
    fi
    
    record_metric "application_logs" "{\"recent_errors\":$recent_errors,\"critical_errors\":$critical_errors}"
    
    return $([ "$critical_errors" -eq 0 ] && echo 0 || echo 1)
}

# ===============================================
# MÉTRIQUES ET ENREGISTREMENT
# ===============================================
record_metric() {
    local metric_name=$1
    local metric_data=$2
    local timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    
    # Créer répertoire de métriques si nécessaire
    mkdir -p "$(dirname "$METRICS_FILE")"
    
    # Enregistrer métrique au format JSON
    local metric_entry="{\"timestamp\":\"$timestamp\",\"metric\":\"$metric_name\",\"environment\":\"$DEPLOYMENT_ENV\",\"data\":$metric_data}"
    
    echo "$metric_entry" >> "$METRICS_FILE"
    
    # Rotation du fichier de métriques si trop gros (>10MB)
    if [ -f "$METRICS_FILE" ] && [ $(stat -f%z "$METRICS_FILE" 2>/dev/null || stat -c%s "$METRICS_FILE") -gt 10485760 ]; then
        mv "$METRICS_FILE" "${METRICS_FILE}.old"
        touch "$METRICS_FILE"
    fi
}

generate_monitoring_report() {
    local timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    
    log "INFO" "Generating monitoring report"
    
    # Résumé des métriques des dernières 24h
    local report=$(cat <<EOF
{
  "timestamp": "$timestamp",
  "environment": "$DEPLOYMENT_ENV",
  "monitoring_interval": "$MONITORING_INTERVAL",
  "summary": {
    "health_checks": $(tail -100 "$METRICS_FILE" 2>/dev/null | grep -c "health_check" || echo 0),
    "alerts_sent": $(find /tmp -name "psa_alert_state_*" -newer /dev/null 2>/dev/null | wc -l || echo 0),
    "uptime": "$(uptime -p 2>/dev/null || echo 'unknown')"
  }
}
EOF
)
    
    echo "$report" > "/var/log/psa-grading/monitoring_report_$(date +%Y%m%d).json"
}

# ===============================================
# SYSTÈME D'ALERTES
# ===============================================
send_health_alert() {
    local message=$1
    log "WARNING" "ALERT: $message"
    
    # Slack
    if [ -n "$SLACK_WEBHOOK_URL" ]; then
        curl -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"🚨 PSA Grading App Health Alert ($DEPLOYMENT_ENV): $message\"}" \
            "$SLACK_WEBHOOK_URL" || true
    fi
    
    # Email
    if [ -n "$ADMIN_EMAIL" ] && command -v mail >/dev/null 2>&1; then
        echo "$message" | mail -s "PSA Health Alert - $DEPLOYMENT_ENV" "$ADMIN_EMAIL" || true
    fi
}

send_api_alert() {
    local message=$1
    log "WARNING" "ALERT: $message"
    
    if [ -n "$SLACK_WEBHOOK_URL" ]; then
        curl -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"⚠️ PSA Grading App API Alert ($DEPLOYMENT_ENV): $message\"}" \
            "$SLACK_WEBHOOK_URL" || true
    fi
}

send_resource_alert() {
    local message=$1
    log "WARNING" "ALERT: $message"
    
    if [ -n "$SLACK_WEBHOOK_URL" ]; then
        curl -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"📊 PSA Grading App Resource Alert ($DEPLOYMENT_ENV): $message\"}" \
            "$SLACK_WEBHOOK_URL" || true
    fi
}

send_docker_alert() {
    local message=$1
    log "WARNING" "ALERT: $message"
    
    if [ -n "$SLACK_WEBHOOK_URL" ]; then
        curl -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"🐳 PSA Grading App Docker Alert ($DEPLOYMENT_ENV): $message\"}" \
            "$SLACK_WEBHOOK_URL" || true
    fi
}

send_database_alert() {
    local message=$1
    log "ERROR" "ALERT: $message"
    
    if [ -n "$SLACK_WEBHOOK_URL" ]; then
        curl -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"🗄️ PSA Grading App Database Alert ($DEPLOYMENT_ENV): $message\"}" \
            "$SLACK_WEBHOOK_URL" || true
    fi
}

send_logs_alert() {
    local message=$1
    log "WARNING" "ALERT: $message"
    
    if [ -n "$SLACK_WEBHOOK_URL" ]; then
        curl -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"📝 PSA Grading App Logs Alert ($DEPLOYMENT_ENV): $message\"}" \
            "$SLACK_WEBHOOK_URL" || true
    fi
}

# ===============================================
# MONITORING PRINCIPAL
# ===============================================
run_monitoring_cycle() {
    log "INFO" "Starting monitoring cycle for $DEPLOYMENT_ENV"
    
    local checks_passed=0
    local checks_failed=0
    
    # Liste des vérifications
    local checks=(
        "check_application_health:Application health check"
        "check_api_endpoints:API endpoints check"
        "check_system_resources:System resources check"
        "check_docker_containers:Docker containers check"
        "check_database_connection:Database connection check"
        "check_application_logs:Application logs check"
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
    
    # Enregistrer résultats du cycle
    record_metric "monitoring_cycle" "{\"checks_passed\":$checks_passed,\"checks_failed\":$checks_failed}"
    
    log "INFO" "Monitoring cycle completed: $checks_passed passed, $checks_failed failed"
    
    # Générer rapport si nécessaire (une fois par jour)
    local current_hour=$(date +%H)
    if [ "$current_hour" = "06" ]; then  # 6h du matin
        generate_monitoring_report
    fi
    
    return $([ $checks_failed -eq 0 ] && echo 0 || echo 1)
}

# Mode monitoring continu
continuous_monitoring() {
    log "INFO" "Starting continuous monitoring mode (interval: ${MONITORING_INTERVAL}s)"
    
    # Créer répertoires nécessaires
    mkdir -p "$(dirname "$LOG_FILE")"
    mkdir -p "$(dirname "$METRICS_FILE")"
    
    while true; do
        if run_monitoring_cycle; then
            log "INFO" "Monitoring cycle passed, waiting ${MONITORING_INTERVAL}s"
        else
            log "WARNING" "Monitoring cycle detected issues, waiting ${MONITORING_INTERVAL}s"
        fi
        
        sleep "$MONITORING_INTERVAL"
    done
}

# ===============================================
# MAIN FUNCTION
# ===============================================
main() {
    local mode="${1:-single}"
    
    case "$mode" in
        "single")
            run_monitoring_cycle
            ;;
        "continuous")
            continuous_monitoring
            ;;
        "report")
            generate_monitoring_report
            cat "/var/log/psa-grading/monitoring_report_$(date +%Y%m%d).json" 2>/dev/null || echo "No report available"
            ;;
        "test-alerts")
            send_health_alert "Test alert from monitoring system"
            ;;
        *)
            echo "Usage: $0 [single|continuous|report|test-alerts]"
            echo ""
            echo "Modes:"
            echo "  single      - Run single monitoring cycle"
            echo "  continuous  - Run continuous monitoring"
            echo "  report      - Generate and show monitoring report"
            echo "  test-alerts - Send test alert"
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