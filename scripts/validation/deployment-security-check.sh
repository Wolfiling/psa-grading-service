#!/bin/bash

# ===============================================
# VALIDATION DÉPLOIEMENT SÉCURISÉ PSA
# ===============================================
# 🔍 Validation complète des corrections de sécurité
# ✅ Vérification UFW, Nginx, Deploy Scripts

set -e

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${BLUE}[STEP]${NC} $1"; }

validation_passed=0
total_checks=0

check() {
    local description="$1"
    local command="$2"
    ((total_checks++))
    
    echo -n "⏳ $description... "
    if eval "$command" >/dev/null 2>&1; then
        echo -e "${GREEN}✅ PASS${NC}"
        ((validation_passed++))
    else
        echo -e "${RED}❌ FAIL${NC}"
        log_error "Échec: $description"
    fi
}

# VALIDATION SCRIPTS BASH
log_step "1. Validation syntaxe scripts bash"
check "UFW script syntax" "bash -n scripts/security/setup-ufw.sh"
check "Deploy script syntax" "bash -n scripts/deployment/deploy-to-ovh.sh"
check "Customize script syntax" "bash -n scripts/deployment/customize-for-deployment.sh"
check "SSL script syntax" "bash -n scripts/ssl/setup-letsencrypt.sh"

# VALIDATION UFW FIXES
log_step "2. Validation corrections UFW"
check "UFW IPv6 fix present" "grep -q '/etc/default/ufw' scripts/security/setup-ufw.sh"
check "UFW DDoS rules with --name" "grep -q 'recent --set --name' scripts/security/setup-ufw.sh"
check "UFW validation function" "grep -q 'validate_ufw_config' scripts/security/setup-ufw.sh"
check "UFW backup mechanism" "grep -q 'before.rules.backup' scripts/security/setup-ufw.sh"

# VALIDATION NGINX FIXES
log_step "3. Validation corrections Nginx"
check "Nginx 200M body size" "grep -q 'client_max_body_size 200M' scripts/nginx/psa-grading.conf"
check "Nginx extended timeouts" "grep -q 'proxy_send_timeout 600s' scripts/nginx/psa-grading.conf"
check "Nginx video upload section" "grep -q 'Upload de vidéos.*200M' scripts/nginx/psa-grading.conf"

# VALIDATION DEPLOY FIXES
log_step "4. Validation corrections Deploy"
check "Deploy htpasswd creation" "grep -q 'openssl passwd -6' scripts/deployment/deploy-to-ovh.sh"
check "Deploy nginx test" "grep -q 'if ! nginx -t' scripts/deployment/deploy-to-ovh.sh"
check "Deploy tools check" "grep -q 'certbot pg_dump htpasswd' scripts/deployment/deploy-to-ovh.sh"
check "Deploy rollback path fix" "grep -q 'SCRIPTS_DIR.*rollback.sh' scripts/deployment/deploy-to-ovh.sh"

# VALIDATION SÉCURITÉ
log_step "5. Validation sécurité"
check "No hardcoded credentials" "! grep -r 'password.*=' scripts/ | grep -v 'admin_password.*openssl'"
check "Secure file permissions" "grep -q 'chmod 600' scripts/deployment/deploy-to-ovh.sh"
check "Backup mechanisms" "grep -q 'backup.*$(date' scripts/deployment/deploy-to-ovh.sh"

# VALIDATION CONFIGURATION
log_step "6. Validation configuration"
check "Domain placeholder handling" "grep -q 'DOMAIN_PLACEHOLDER' scripts/nginx/psa-grading.conf"
check "Server name replacement" "grep -q 'server_name.*DOMAIN' scripts/deployment/deploy-to-ovh.sh"
check "SSL certificate paths" "grep -q 'letsencrypt/live' scripts/nginx/psa-grading.conf"

# RÉSULTATS
echo ""
log_step "RÉSULTATS VALIDATION"
echo "=============================="
log_info "Tests réussis: $validation_passed/$total_checks"

if [[ $validation_passed -eq $total_checks ]]; then
    log_info "🎉 TOUTES LES VALIDATIONS RÉUSSIES!"
    log_info ""
    log_info "✅ Corrections appliquées avec succès:"
    log_info "   • UFW: IPv6 via /etc/default/ufw + DDoS rules fixes"
    log_info "   • Nginx: 200MB uploads + timeouts étendus + .htpasswd sécurisé"
    log_info "   • Deploy: rollback absolu + outils checks + nginx test"
    log_info "   • Sécurité: Validation complète + backups + permissions"
    log_info ""
    log_info "🚀 Déploiement prêt pour production OVH"
    exit 0
else
    log_error "⚠️ ÉCHEC VALIDATION: $((total_checks - validation_passed)) tests échoués"
    log_error "Vérifiez les erreurs ci-dessus avant déploiement"
    exit 1
fi