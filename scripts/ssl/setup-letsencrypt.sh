#!/bin/bash

# ===============================================
# CONFIGURATION SSL LET'S ENCRYPT - PSA GRADING APP
# ===============================================
# 🔐 Installation et configuration automatisée de Let's Encrypt
# 🔄 Renouvellement automatique et monitoring SSL

set -e

# Configuration
DOMAIN="${DOMAIN:-your-domain.com}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@your-domain.com}"
WEBROOT="/var/www/letsencrypt"
NGINX_CONF="/etc/nginx/sites-available/psa-grading"

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

# Vérifications préliminaires
check_prerequisites() {
    log_step "Vérification prérequis SSL..."
    
    if [[ $EUID -ne 0 ]]; then
        log_error "Ce script doit être exécuté en root"
        exit 1
    fi
    
    if [[ "$DOMAIN" == "your-domain.com" ]]; then
        log_error "Veuillez configurer la variable DOMAIN avec votre vrai domaine"
        log_info "Exemple: DOMAIN=psa.mondomaine.com ./setup-letsencrypt.sh"
        exit 1
    fi
    
    if [[ "$ADMIN_EMAIL" == "admin@your-domain.com" ]]; then
        log_error "Veuillez configurer la variable ADMIN_EMAIL"
        exit 1
    fi
    
    # Test résolution DNS
    if ! nslookup "$DOMAIN" >/dev/null 2>&1; then
        log_error "Le domaine $DOMAIN ne résout pas correctement"
        log_info "Vérifiez que votre DNS pointe vers ce serveur"
        exit 1
    fi
    
    # Test Nginx
    if ! systemctl is-active --quiet nginx; then
        log_error "Nginx n'est pas actif"
        exit 1
    fi
    
    log_info "✅ Prérequis validés"
}

# Installation Certbot
install_certbot() {
    log_step "Installation Certbot..."
    
    # Mise à jour des paquets
    apt update
    
    # Installation Certbot et plugin Nginx
    apt install -y certbot python3-certbot-nginx
    
    # Vérification installation
    if ! command -v certbot >/dev/null 2>&1; then
        log_error "Échec installation Certbot"
        exit 1
    fi
    
    log_info "✅ Certbot installé: $(certbot --version)"
}

# Préparation Nginx pour Let's Encrypt
prepare_nginx() {
    log_step "Préparation Nginx pour Let's Encrypt..."
    
    # Créer répertoire webroot pour validation
    mkdir -p "$WEBROOT/.well-known/acme-challenge"
    chown -R www-data:www-data "$WEBROOT"
    chmod -R 755 "$WEBROOT"
    
    # Configuration Nginx temporaire pour validation
    cat > "/etc/nginx/sites-available/psa-temp-ssl" << EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN www.$DOMAIN;
    
    # Let's Encrypt validation
    location /.well-known/acme-challenge/ {
        root $WEBROOT;
        allow all;
        try_files \$uri =404;
    }
    
    # Health check
    location = /healthz {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host \$host;
    }
    
    # Redirection temporaire vers HTTPS (après obtention du certificat)
    location / {
        return 301 https://\$server_name\$request_uri;
    }
}

# Configuration HTTPS de base (sera remplacée par la configuration complète)
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $DOMAIN www.$DOMAIN;
    
    # Certificats temporaires (seront remplacés par Let's Encrypt)
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
    
    # Activation configuration temporaire
    ln -sf /etc/nginx/sites-available/psa-temp-ssl /etc/nginx/sites-enabled/psa-grading
    
    # Test et rechargement
    nginx -t && systemctl reload nginx
    
    log_info "✅ Nginx préparé pour Let's Encrypt"
}

# Obtention du certificat SSL
obtain_ssl_certificate() {
    log_step "Obtention certificat SSL Let's Encrypt..."
    
    # Options Certbot
    local certbot_options=(
        --nginx
        --non-interactive
        --agree-tos
        --email "$ADMIN_EMAIL"
        --domains "$DOMAIN,www.$DOMAIN"
        --redirect
        --hsts
        --staple-ocsp
    )
    
    # Tentative d'obtention du certificat
    if certbot "${certbot_options[@]}"; then
        log_info "✅ Certificat SSL obtenu avec succès"
        
        # Vérification certificat
        local cert_info=$(openssl x509 -in "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" -text -noout 2>/dev/null || echo "ERROR")
        
        if [[ "$cert_info" != "ERROR" ]]; then
            local expiry=$(openssl x509 -in "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" -enddate -noout | cut -d= -f2)
            log_info "Certificat expire le: $expiry"
        fi
        
    else
        log_error "Échec obtention certificat SSL"
        log_info "Vérifiez que:"
        log_info "  • Le domaine $DOMAIN pointe vers ce serveur"
        log_info "  • Les ports 80 et 443 sont accessibles depuis internet"
        log_info "  • Le firewall autorise le trafic HTTP/HTTPS"
        exit 1
    fi
}

# Configuration avancée SSL
configure_advanced_ssl() {
    log_step "Configuration SSL avancée..."
    
    # Sauvegarde configuration Nginx générée par Certbot
    cp "/etc/nginx/sites-available/psa-grading" "/etc/nginx/sites-available/psa-grading.backup"
    
    # Configuration SSL avancée (remplace celle générée par Certbot)
    cat > "/etc/nginx/sites-available/psa-grading" << EOF
# Redirection HTTP vers HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN www.$DOMAIN;
    
    # Let's Encrypt validation
    location /.well-known/acme-challenge/ {
        root $WEBROOT;
        allow all;
    }
    
    # Redirection vers HTTPS
    location / {
        return 301 https://\$server_name\$request_uri;
    }
}

# Configuration HTTPS principale
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $DOMAIN www.$DOMAIN;
    
    # Certificats Let's Encrypt
    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_trusted_certificate /etc/letsencrypt/live/$DOMAIN/chain.pem;
    
    # Configuration SSL optimisée
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;
    
    # OCSP Stapling
    ssl_stapling on;
    ssl_stapling_verify on;
    resolver 8.8.8.8 8.8.4.4 valid=300s;
    resolver_timeout 5s;
    
    # Headers de sécurité
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    
    # Configuration proxy vers Node.js
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 30s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;
    }
    
    # Health check
    location = /healthz {
        proxy_pass http://127.0.0.1:5000;
        access_log off;
    }
    
    # Assets statiques avec cache
    location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        proxy_pass http://127.0.0.1:5000;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
EOF
    
    # Test et rechargement
    nginx -t && systemctl reload nginx
    
    log_info "✅ SSL avancé configuré"
}

# Configuration renouvellement automatique
setup_auto_renewal() {
    log_step "Configuration renouvellement automatique..."
    
    # Script de renouvellement personnalisé
    cat > "/usr/local/bin/psa-ssl-renew" << 'EOF'
#!/bin/bash
# Script de renouvellement SSL pour PSA Grading App

LOG_FILE="/var/log/psa-ssl-renew.log"

log_event() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> "$LOG_FILE"
}

# Renouvellement
log_event "Début vérification renouvellement SSL"

if certbot renew --quiet --post-hook "systemctl reload nginx"; then
    log_event "Renouvellement SSL réussi"
else
    log_event "ERREUR: Échec renouvellement SSL"
    
    # Notification par email
    if command -v mail >/dev/null 2>&1 && [[ -n "${ADMIN_EMAIL}" ]]; then
        echo "ALERTE: Échec du renouvellement automatique du certificat SSL pour PSA Grading App.
        
Serveur: $(hostname)
Date: $(date)
Log: $LOG_FILE

Vérification manuelle requise." | \
        mail -s "PSA SSL - Échec Renouvellement" "${ADMIN_EMAIL}"
    fi
    
    exit 1
fi

# Vérification validité certificat
DAYS_LEFT=$(openssl x509 -in "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" -enddate -noout | cut -d= -f2 | xargs -I {} date -d "{}" +%s | xargs -I {} echo $(( ( {} - $(date +%s) ) / 86400 )))

log_event "Certificat expire dans $DAYS_LEFT jours"

# Alerte si expiration proche (moins de 7 jours)
if [[ $DAYS_LEFT -lt 7 ]]; then
    log_event "ALERTE: Certificat expire dans moins de 7 jours"
    
    if command -v mail >/dev/null 2>&1 && [[ -n "${ADMIN_EMAIL}" ]]; then
        echo "ALERTE: Le certificat SSL du domaine $DOMAIN expire dans $DAYS_LEFT jours.

Veuillez vérifier le système de renouvellement automatique." | \
        mail -s "PSA SSL - Expiration Proche" "${ADMIN_EMAIL}"
    fi
fi

log_event "Vérification SSL terminée"
EOF
    
    chmod +x /usr/local/bin/psa-ssl-renew
    
    # Configuration cron pour renouvellement
    if ! crontab -l 2>/dev/null | grep -q "psa-ssl-renew"; then
        (crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/psa-ssl-renew") | crontab -
    fi
    
    # Test du renouvellement
    log_info "Test du renouvellement..."
    if certbot renew --dry-run --quiet; then
        log_info "✅ Test renouvellement réussi"
    else
        log_warn "⚠️ Test renouvellement échoué - vérification manuelle recommandée"
    fi
    
    log_info "✅ Renouvellement automatique configuré"
}

# Tests SSL finaux
run_ssl_tests() {
    log_step "Tests SSL finaux..."
    
    local tests_passed=0
    local total_tests=4
    
    # Test 1: Connectivité HTTPS
    if curl -f -s "https://$DOMAIN/healthz" >/dev/null 2>&1; then
        log_info "✅ Test connectivité HTTPS OK"
        ((tests_passed++))
    else
        log_error "❌ Test connectivité HTTPS échoué"
    fi
    
    # Test 2: Redirection HTTP vers HTTPS
    local redirect_status=$(curl -s -o /dev/null -w "%{http_code}" "http://$DOMAIN/")
    if [[ "$redirect_status" == "301" ]]; then
        log_info "✅ Test redirection HTTP vers HTTPS OK"
        ((tests_passed++))
    else
        log_error "❌ Test redirection échoué (code: $redirect_status)"
    fi
    
    # Test 3: Validité certificat
    local cert_status=$(echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null | \
                        openssl x509 -noout -dates 2>/dev/null | grep "notAfter" | cut -d= -f2)
    
    if [[ -n "$cert_status" ]]; then
        local days_left=$(( ($(date -d "$cert_status" +%s) - $(date +%s)) / 86400 ))
        if [[ $days_left -gt 30 ]]; then
            log_info "✅ Test validité certificat OK ($days_left jours restants)"
            ((tests_passed++))
        else
            log_warn "⚠️ Certificat expire bientôt ($days_left jours)"
        fi
    else
        log_error "❌ Test validité certificat échoué"
    fi
    
    # Test 4: Headers de sécurité
    if curl -s -I "https://$DOMAIN/" | grep -q "Strict-Transport-Security"; then
        log_info "✅ Test headers sécurité OK"
        ((tests_passed++))
    else
        log_error "❌ Test headers sécurité échoué"
    fi
    
    log_info "Tests SSL réussis: $tests_passed/$total_tests"
    
    if [[ $tests_passed -ge 3 ]]; then
        return 0
    else
        return 1
    fi
}

# Fonction principale
main() {
    log_info "🔐 Configuration SSL Let's Encrypt - PSA Grading App"
    log_info "================================================="
    log_info "Domaine: $DOMAIN"
    log_info "Email: $ADMIN_EMAIL"
    log_info ""
    
    check_prerequisites
    install_certbot
    prepare_nginx
    obtain_ssl_certificate
    configure_advanced_ssl
    setup_auto_renewal
    
    if run_ssl_tests; then
        log_info ""
        log_info "🎉 SSL CONFIGURÉ AVEC SUCCÈS!"
        log_info ""
        log_info "🔐 Votre site est maintenant sécurisé:"
        log_info "  • URL: https://$DOMAIN"
        log_info "  • Certificat: Let's Encrypt"
        log_info "  • Renouvellement: Automatique"
        log_info "  • Note SSL: Testez sur ssllabs.com"
        log_info ""
        log_info "🔧 Gestion:"
        log_info "  • Logs renouvellement: /var/log/psa-ssl-renew.log"
        log_info "  • Script renouvellement: /usr/local/bin/psa-ssl-renew"
        log_info "  • Test manuel: certbot renew --dry-run"
        log_info ""
        
    else
        log_error "Configuration SSL terminée avec des alertes"
        log_info "Vérification manuelle recommandée"
        exit 1
    fi
}

main "$@"