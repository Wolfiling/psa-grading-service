#!/bin/bash

# ===============================================
# SCRIPT HEALTH CHECK - PSA GRADING APP
# ===============================================
# 🩺 Vérification complète de la santé de l'application
# 📊 À utiliser pour monitoring et diagnostics

set -e

# Configuration
APP_NAME="psa-grading-app"
DOMAIN="${DOMAIN:-localhost}"
PORT="${PORT:-5000}"
TIMEOUT=10

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Compteurs
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0

# Fonctions utilitaires
log_info() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[!]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
}

log_check() {
    echo -e "${BLUE}[CHECK]${NC} $1"
    ((TOTAL_CHECKS++))
}

pass_check() {
    log_info "$1"
    ((PASSED_CHECKS++))
}

fail_check() {
    log_error "$1"
    ((FAILED_CHECKS++))
}

# Health checks individuels
check_pm2_status() {
    log_check "Status PM2 de l'application..."
    
    if command -v pm2 >/dev/null 2>&1; then
        if pm2 list | grep -q "$APP_NAME.*online"; then
            local cpu=$(pm2 list | grep "$APP_NAME" | awk '{print $9}')
            local memory=$(pm2 list | grep "$APP_NAME" | awk '{print $10}')
            pass_check "PM2 online - CPU: $cpu, Mémoire: $memory"
        else
            fail_check "Application non online dans PM2"
            pm2 list | grep "$APP_NAME" || echo "Application non trouvée dans PM2"
        fi
    else
        fail_check "PM2 non installé ou non accessible"
    fi
}

check_port_listening() {
    log_check "Port $PORT en écoute..."
    
    if netstat -tlnp 2>/dev/null | grep -q ":$PORT "; then
        local process=$(netstat -tlnp 2>/dev/null | grep ":$PORT " | awk '{print $7}')
        pass_check "Port $PORT ouvert - Processus: $process"
    else
        fail_check "Port $PORT non ouvert"
    fi
}

check_http_health() {
    log_check "Endpoint /healthz HTTP..."
    
    local url="http://${DOMAIN}:${PORT}/healthz"
    if curl -f -s --max-time $TIMEOUT "$url" >/dev/null 2>&1; then
        local response=$(curl -s --max-time $TIMEOUT "$url" | jq -r '.status' 2>/dev/null || echo "unknown")
        pass_check "HTTP health OK - Status: $response"
    else
        fail_check "Endpoint /healthz non accessible"
        curl -I -s --max-time $TIMEOUT "$url" 2>/dev/null | head -1 || echo "Pas de réponse HTTP"
    fi
}

check_database_connection() {
    log_check "Connexion base de données..."
    
    if [[ -f "/var/www/psa-grading-app/.env" ]]; then
        cd /var/www/psa-grading-app
        if node -e "
            const { Pool } = require('pg');
            const pool = new Pool({ connectionString: process.env.DATABASE_URL });
            pool.query('SELECT NOW()')
                .then(res => { console.log('DB_OK'); pool.end(); })
                .catch(err => { console.error('DB_ERROR:', err.message); process.exit(1); });
        " 2>/dev/null | grep -q "DB_OK"; then
            pass_check "Base de données accessible"
        else
            fail_check "Erreur de connexion base de données"
        fi
    else
        fail_check "Fichier .env non trouvé pour test DB"
    fi
}

check_disk_space() {
    log_check "Espace disque disponible..."
    
    local usage=$(df / | tail -1 | awk '{print $5}' | sed 's/%//')
    if [[ $usage -lt 90 ]]; then
        pass_check "Espace disque OK - Utilisé: ${usage}%"
    elif [[ $usage -lt 95 ]]; then
        log_warn "Espace disque faible - Utilisé: ${usage}%"
        ((PASSED_CHECKS++))
    else
        fail_check "Espace disque critique - Utilisé: ${usage}%"
    fi
}

check_memory_usage() {
    log_check "Utilisation mémoire..."
    
    local mem_percent=$(free | grep Mem | awk '{printf("%.0f", $3/$2 * 100.0)}')
    if [[ $mem_percent -lt 85 ]]; then
        pass_check "Mémoire OK - Utilisée: ${mem_percent}%"
    elif [[ $mem_percent -lt 95 ]]; then
        log_warn "Mémoire élevée - Utilisée: ${mem_percent}%"
        ((PASSED_CHECKS++))
    else
        fail_check "Mémoire critique - Utilisée: ${mem_percent}%"
    fi
}

check_load_average() {
    log_check "Charge système (load average)..."
    
    local load1=$(uptime | awk '{print $(NF-2)}' | sed 's/,//')
    local cpu_count=$(nproc)
    local load_percent=$(echo "$load1 $cpu_count" | awk '{printf("%.0f", $1/$2 * 100)}')
    
    if [[ $load_percent -lt 80 ]]; then
        pass_check "Charge système OK - ${load1}/${cpu_count} CPUs (${load_percent}%)"
    elif [[ $load_percent -lt 100 ]]; then
        log_warn "Charge système élevée - ${load1}/${cpu_count} CPUs (${load_percent}%)"
        ((PASSED_CHECKS++))
    else
        fail_check "Charge système critique - ${load1}/${cpu_count} CPUs (${load_percent}%)"
    fi
}

check_logs_errors() {
    log_check "Erreurs récentes dans les logs..."
    
    local error_count=0
    local log_dir="/var/log/psa-grading"
    
    if [[ -d "$log_dir" ]]; then
        # Compter erreurs des 10 dernières minutes
        error_count=$(find "$log_dir" -name "*.log" -mmin -10 -exec grep -i "error\|exception\|fatal" {} \; 2>/dev/null | wc -l)
    fi
    
    # Ajouter erreurs PM2 récentes
    if command -v pm2 >/dev/null 2>&1; then
        local pm2_errors=$(pm2 logs "$APP_NAME" --lines 100 --raw 2>/dev/null | grep -i "error\|exception\|fatal" | tail -10 | wc -l)
        error_count=$((error_count + pm2_errors))
    fi
    
    if [[ $error_count -eq 0 ]]; then
        pass_check "Aucune erreur récente détectée"
    elif [[ $error_count -lt 5 ]]; then
        log_warn "Quelques erreurs récentes détectées ($error_count)"
        ((PASSED_CHECKS++))
    else
        fail_check "Nombreuses erreurs récentes détectées ($error_count)"
    fi
}

check_ssl_certificate() {
    log_check "Certificat SSL (si HTTPS activé)..."
    
    if [[ "$DOMAIN" != "localhost" ]] && command -v openssl >/dev/null 2>&1; then
        local cert_info=$(echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null | openssl x509 -noout -dates 2>/dev/null || echo "NO_SSL")
        
        if [[ "$cert_info" != "NO_SSL" ]]; then
            local expiry_date=$(echo "$cert_info" | grep "notAfter" | cut -d= -f2)
            local days_left=$(( ($(date -d "$expiry_date" +%s) - $(date +%s)) / 86400 ))
            
            if [[ $days_left -gt 30 ]]; then
                pass_check "Certificat SSL valide - Expire dans $days_left jours"
            elif [[ $days_left -gt 7 ]]; then
                log_warn "Certificat SSL expire bientôt - $days_left jours restants"
                ((PASSED_CHECKS++))
            else
                fail_check "Certificat SSL expire très bientôt - $days_left jours restants"
            fi
        else
            log_warn "SSL non configuré ou non accessible"
            ((PASSED_CHECKS++))
        fi
    else
        log_warn "Test SSL ignoré (localhost ou openssl manquant)"
        ((PASSED_CHECKS++))
    fi
}

check_backup_status() {
    log_check "Status des backups..."
    
    local backup_dir="/var/backups/psa-grading"
    if [[ -d "$backup_dir" ]]; then
        local latest_backup=$(find "$backup_dir" -name "*.sql" -o -name "*.tar.gz" | head -1)
        if [[ -n "$latest_backup" ]]; then
            local backup_age_hours=$(( ($(date +%s) - $(stat -c %Y "$latest_backup")) / 3600 ))
            if [[ $backup_age_hours -lt 48 ]]; then
                pass_check "Backup récent trouvé (${backup_age_hours}h)"
            else
                log_warn "Backup ancien (${backup_age_hours}h)"
                ((PASSED_CHECKS++))
            fi
        else
            fail_check "Aucun backup trouvé"
        fi
    else
        fail_check "Répertoire backup non configuré"
    fi
}

# Diagnostic détaillé en cas d'échec
detailed_diagnosis() {
    echo ""
    echo "==============================================="
    echo "  🔍 DIAGNOSTIC DÉTAILLÉ"
    echo "==============================================="
    
    echo "📊 Processus système:"
    ps aux | grep -E "(node|pm2)" | grep -v grep || echo "Aucun processus Node.js détecté"
    
    echo ""
    echo "🌐 Ports réseau:"
    netstat -tlnp | grep -E ":$PORT|:443|:80" || echo "Ports principaux non ouverts"
    
    echo ""
    echo "💾 Mémoire détaillée:"
    free -h
    
    echo ""
    echo "💽 Espace disque:"
    df -h
    
    echo ""
    echo "📋 Logs récents PM2:"
    if command -v pm2 >/dev/null 2>&1; then
        pm2 logs "$APP_NAME" --lines 20 --raw 2>/dev/null || echo "Logs PM2 non disponibles"
    fi
    
    echo ""
    echo "🔧 Services système:"
    systemctl is-active nginx 2>/dev/null || echo "Nginx: non disponible"
    systemctl is-active postgresql 2>/dev/null || echo "PostgreSQL: non disponible (normal si externe)"
}

# Génération rapport JSON
generate_json_report() {
    local status="healthy"
    if [[ $FAILED_CHECKS -gt 0 ]]; then
        status="unhealthy"
    elif [[ $PASSED_CHECKS -lt $TOTAL_CHECKS ]]; then
        status="warning"
    fi
    
    cat > /tmp/health-report.json << EOF
{
  "timestamp": "$(date -Iseconds)",
  "status": "$status",
  "summary": {
    "total_checks": $TOTAL_CHECKS,
    "passed": $PASSED_CHECKS,
    "failed": $FAILED_CHECKS,
    "success_rate": "$(( PASSED_CHECKS * 100 / TOTAL_CHECKS ))%"
  },
  "system": {
    "uptime": "$(uptime -p)",
    "load_average": "$(uptime | awk '{print $(NF-2)" "$(NF-1)" "$(NF)}' | sed 's/,//g')",
    "memory_usage": "$(free | grep Mem | awk '{printf("%.1f%%", $3/$2 * 100.0)}')",
    "disk_usage": "$(df / | tail -1 | awk '{print $5}')"
  },
  "application": {
    "pm2_status": "$(pm2 list 2>/dev/null | grep "$APP_NAME" | awk '{print $10}' || echo 'unknown')",
    "port_listening": $(netstat -tlnp 2>/dev/null | grep -q ":$PORT " && echo "true" || echo "false")
  }
}
EOF
    
    echo "📄 Rapport JSON généré: /tmp/health-report.json"
}

# ===============================================
# EXÉCUTION PRINCIPALE
# ===============================================

main() {
    echo "🩺 HEALTH CHECK - PSA GRADING APP"
    echo "======================================"
    echo "Timestamp: $(date)"
    echo "Domaine: $DOMAIN"
    echo "Port: $PORT"
    echo ""
    
    # Exécution des checks
    check_pm2_status
    check_port_listening
    check_http_health
    check_database_connection
    check_disk_space
    check_memory_usage
    check_load_average
    check_logs_errors
    check_ssl_certificate
    check_backup_status
    
    echo ""
    echo "======================================"
    echo "  📊 RÉSULTATS FINAUX"
    echo "======================================"
    
    local success_rate=$(( PASSED_CHECKS * 100 / TOTAL_CHECKS ))
    
    echo "Total checks: $TOTAL_CHECKS"
    echo "Réussis: $PASSED_CHECKS"
    echo "Échoués: $FAILED_CHECKS"
    echo "Taux de succès: ${success_rate}%"
    echo ""
    
    # Status final
    if [[ $FAILED_CHECKS -eq 0 ]]; then
        log_info "✅ APPLICATION EN BONNE SANTÉ"
        generate_json_report
        exit 0
    elif [[ $success_rate -ge 80 ]]; then
        log_warn "⚠️ APPLICATION PARTIELLEMENT OPÉRATIONNELLE"
        detailed_diagnosis
        generate_json_report
        exit 1
    else
        log_error "❌ APPLICATION EN ÉTAT CRITIQUE"
        detailed_diagnosis
        generate_json_report
        exit 2
    fi
}

# Gestion arguments ligne de commande
while [[ $# -gt 0 ]]; do
    case $1 in
        --domain)
            DOMAIN="$2"
            shift 2
            ;;
        --port)
            PORT="$2"
            shift 2
            ;;
        --timeout)
            TIMEOUT="$2"
            shift 2
            ;;
        --json)
            JSON_OUTPUT=true
            shift
            ;;
        --help)
            echo "Usage: $0 [options]"
            echo "Options:"
            echo "  --domain DOMAIN    Domaine à tester (défaut: localhost)"
            echo "  --port PORT        Port à tester (défaut: 5000)"
            echo "  --timeout SECONDS  Timeout HTTP (défaut: 10)"
            echo "  --json             Génère aussi un rapport JSON"
            echo "  --help             Affiche cette aide"
            exit 0
            ;;
        *)
            echo "Option inconnue: $1"
            exit 1
            ;;
    esac
done

# Lancement
main