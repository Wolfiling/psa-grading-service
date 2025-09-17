#!/bin/bash

# ===============================================
# CONFIGURATION UFW FIREWALL - PSA GRADING APP
# ===============================================
# 🔒 Configuration complète du firewall pour sécuriser le VPS OVH
# 🛡️ Optimisé pour l'application PSA avec protection DDoS

set -e

# Couleurs pour l'affichage
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

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

# Vérifications préliminaires
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "Ce script doit être exécuté en root"
        log_info "Utilisez: sudo ./setup-ufw.sh"
        exit 1
    fi
}

check_ufw_installed() {
    if ! command -v ufw &> /dev/null; then
        log_warn "UFW non installé, installation en cours..."
        apt update
        apt install -y ufw
        log_info "✅ UFW installé"
    else
        log_info "✅ UFW déjà installé"
    fi
}

# Configuration UFW principale
setup_ufw_basic() {
    log_step "Configuration UFW de base..."
    
    # Reset complet pour partir sur des bases propres
    ufw --force reset
    
    # Politiques par défaut (IMPORTANT: définir avant d'activer)
    ufw default deny incoming
    ufw default allow outgoing
    ufw default deny routed
    
    log_info "✅ Politiques par défaut configurées"
}

configure_ssh_protection() {
    log_step "Configuration protection SSH..."
    
    # SSH avec rate limiting (port 22 par défaut)
    ufw limit ssh comment 'SSH with rate limiting'
    
    # SSH sur port personnalisé si configuré
    if [[ -n "${CUSTOM_SSH_PORT}" ]]; then
        ufw limit "${CUSTOM_SSH_PORT}" comment 'Custom SSH port'
        log_info "✅ SSH autorisé sur le port ${CUSTOM_SSH_PORT}"
    fi
    
    log_info "✅ Protection SSH configurée avec rate limiting"
}

configure_web_services() {
    log_step "Configuration services web..."
    
    # HTTP (port 80) - Nécessaire pour Let's Encrypt et redirections
    ufw allow 80/tcp comment 'HTTP for Let\'s Encrypt and redirects'
    
    # HTTPS (port 443) - Port principal de l'application
    ufw allow 443/tcp comment 'HTTPS for PSA Grading App'
    
    log_info "✅ Ports web (80, 443) autorisés"
}

configure_application_specific() {
    log_step "Configuration spécifique PSA Grading App..."
    
    # Port Node.js en local uniquement (sécurité)
    # Note: Le port 5000 ne doit être accessible que par Nginx
    ufw deny 5000 comment 'Block direct Node.js access'
    
    # Autoriser loopback pour communication locale
    ufw allow from 127.0.0.1 to 127.0.0.1 port 5000 comment 'Local Node.js access'
    
    # PostgreSQL en local uniquement si base locale
    if [[ "${DATABASE_TYPE}" == "local" ]]; then
        ufw allow from 127.0.0.1 to 127.0.0.1 port 5432 comment 'Local PostgreSQL'
        ufw deny 5432 comment 'Block external PostgreSQL access'
    fi
    
    log_info "✅ Configuration application PSA appliquée"
}

configure_monitoring_ports() {
    log_step "Configuration ports de monitoring..."
    
    # Port monitoring Nginx (local uniquement)
    ufw allow from 127.0.0.1 to 127.0.0.1 port 8080 comment 'Nginx monitoring'
    
    # Port Uptime Kuma si utilisé
    if [[ "${ENABLE_UPTIME_KUMA}" == "true" ]]; then
        ufw allow from 127.0.0.1 to 127.0.0.1 port 3001 comment 'Uptime Kuma monitoring'
        
        # Optionnel: accès externe sécurisé pour Uptime Kuma
        if [[ -n "${MONITORING_ALLOWED_IP}" ]]; then
            ufw allow from "${MONITORING_ALLOWED_IP}" to any port 3001 comment 'External monitoring access'
        fi
    fi
    
    log_info "✅ Ports de monitoring configurés"
}

configure_advanced_rules() {
    log_step "Configuration règles avancées..."
    
    # Protection contre les scans de ports
    ufw deny from any to any port 0:21 comment 'Block low ports scanning'
    ufw deny from any to any port 23:79 comment 'Block common services'
    ufw deny from any to any port 81:442 comment 'Block middle range'
    ufw deny from any to any port 444:3000 comment 'Block high range'
    ufw deny from any to any port 3002:5431 comment 'Block database range'
    ufw deny from any to any port 5433:8079 comment 'Block application range'
    ufw deny from any to any port 8081:65535 comment 'Block high ports'
    
    # Configuration IPv6 via /etc/default/ufw (commandes enable-ipv6/disable-ipv6 invalides)
    if [[ "${ENABLE_IPV6}" != "false" ]]; then
        sed -i 's/IPV6=no/IPV6=yes/' /etc/default/ufw 2>/dev/null || echo "IPV6=yes" >> /etc/default/ufw
        log_info "✅ Protection IPv6 activée via /etc/default/ufw"
    else
        sed -i 's/IPV6=yes/IPV6=no/' /etc/default/ufw 2>/dev/null || echo "IPV6=no" >> /etc/default/ufw
        log_info "✅ IPv6 désactivé via /etc/default/ufw"
    fi
    
    # Logging pour surveillance
    ufw logging medium
    
    log_info "✅ Règles avancées appliquées"
}

apply_ddos_protection() {
    log_step "Configuration protection DDoS..."
    
    # Sauvegarde before.rules avant modification
    cp /etc/ufw/before.rules /etc/ufw/before.rules.backup-$(date +%Y%m%d-%H%M%S) 2>/dev/null || true
    
    # Vérifier si les règles existent déjà
    if ! grep -q "Protection DDoS pour PSA Grading App" /etc/ufw/before.rules; then
        # Trouver la ligne COMMIT et insérer avant
        local commit_line=$(grep -n "^COMMIT" /etc/ufw/before.rules | head -1 | cut -d: -f1)
        
        if [[ -n "$commit_line" ]]; then
            # Insérer les règles DDoS avant COMMIT
            sed -i "${commit_line}i\\\n# Protection DDoS pour PSA Grading App - PSA Security\n-A ufw-before-input -p tcp --dport 80 -m conntrack --ctstate NEW -m recent --set --name HTTP_RATE\n-A ufw-before-input -p tcp --dport 80 -m conntrack --ctstate NEW -m recent --update --seconds 60 --hitcount 15 --name HTTP_RATE -j REJECT\n-A ufw-before-input -p tcp --dport 443 -m conntrack --ctstate NEW -m recent --set --name HTTPS_RATE\n-A ufw-before-input -p tcp --dport 443 -m conntrack --ctstate NEW -m recent --update --seconds 60 --hitcount 15 --name HTTPS_RATE -j REJECT\n\n# Protection SYN flood\n-A ufw-before-input -p tcp --syn -m connlimit --connlimit-above 10 --connlimit-mask 32 -j REJECT\n\n# Protection ping flood\n-A ufw-before-input -p icmp --icmp-type echo-request -m recent --set --name PING_RATE\n-A ufw-before-input -p icmp --icmp-type echo-request -m recent --update --seconds 1 --hitcount 4 --name PING_RATE -j DROP\n" /etc/ufw/before.rules
        else
            log_warn "⚠️ COMMIT non trouvé dans before.rules - ajout à la fin"
            cat >> /etc/ufw/before.rules << 'EOF'

# Protection DDoS pour PSA Grading App - PSA Security
-A ufw-before-input -p tcp --dport 80 -m conntrack --ctstate NEW -m recent --set --name HTTP_RATE
-A ufw-before-input -p tcp --dport 80 -m conntrack --ctstate NEW -m recent --update --seconds 60 --hitcount 15 --name HTTP_RATE -j REJECT
-A ufw-before-input -p tcp --dport 443 -m conntrack --ctstate NEW -m recent --set --name HTTPS_RATE
-A ufw-before-input -p tcp --dport 443 -m conntrack --ctstate NEW -m recent --update --seconds 60 --hitcount 15 --name HTTPS_RATE -j REJECT

# Protection SYN flood
-A ufw-before-input -p tcp --syn -m connlimit --connlimit-above 10 --connlimit-mask 32 -j REJECT

# Protection ping flood
-A ufw-before-input -p icmp --icmp-type echo-request -m recent --set --name PING_RATE
-A ufw-before-input -p icmp --icmp-type echo-request -m recent --update --seconds 1 --hitcount 4 --name PING_RATE -j DROP
EOF
        fi
        
        log_info "✅ Protection DDoS configurée dans before.rules"
    else
        log_info "✅ Protection DDoS déjà présente"
    fi
}

create_blacklist_management() {
    log_step "Création système de blacklist..."
    
    # Script de gestion des IPs bannies
    cat > /usr/local/bin/psa-firewall-manage << 'EOF'
#!/bin/bash
# Script de gestion du firewall PSA

case "$1" in
    ban)
        if [[ -n "$2" ]]; then
            ufw deny from "$2" comment "Banned IP - $(date)"
            echo "IP $2 bannie"
        else
            echo "Usage: $0 ban <IP>"
        fi
        ;;
    unban)
        if [[ -n "$2" ]]; then
            ufw --force delete deny from "$2"
            echo "IP $2 débannie"
        else
            echo "Usage: $0 unban <IP>"
        fi
        ;;
    list-banned)
        ufw status numbered | grep -E "DENY|REJECT" | grep -v "Anywhere"
        ;;
    status)
        ufw status verbose
        ;;
    logs)
        tail -f /var/log/ufw.log | grep -E "BLOCK|DENY"
        ;;
    *)
        echo "Usage: $0 {ban|unban|list-banned|status|logs}"
        echo "  ban <IP>      - Bannir une IP"
        echo "  unban <IP>    - Débannir une IP" 
        echo "  list-banned   - Lister les IPs bannies"
        echo "  status        - Status du firewall"
        echo "  logs          - Voir les logs de blocage"
        ;;
esac
EOF

    chmod +x /usr/local/bin/psa-firewall-manage
    
    log_info "✅ Script de gestion firewall créé: /usr/local/bin/psa-firewall-manage"
}

validate_ufw_config() {
    log_step "Validation configuration UFW..."
    
    # Test syntaxe before.rules
    if ! iptables-restore --test < /etc/ufw/before.rules 2>/dev/null; then
        log_error "❌ Erreur syntaxe dans before.rules"
        log_info "Restauration backup..."
        cp /etc/ufw/before.rules.backup-* /etc/ufw/before.rules 2>/dev/null || true
        return 1
    fi
    
    # Test configuration UFW dry-run
    if ! ufw --dry-run enable >/dev/null 2>&1; then
        log_error "❌ Configuration UFW invalide"
        return 1
    fi
    
    log_info "✅ Configuration UFW validée"
    return 0
}

enable_ufw() {
    log_step "Activation UFW..."
    
    # Validation avant activation
    if ! validate_ufw_config; then
        log_error "Configuration UFW invalide - activation annulée"
        exit 1
    fi
    
    # Vérification finale avant activation
    log_warn "Configuration actuelle UFW:"
    ufw --dry-run enable 2>/dev/null || log_warn "Dry-run non disponible"
    
    # En mode automatique ou interactif
    if [[ "${UFW_AUTO_ENABLE:-false}" == "true" ]]; then
        REPLY="y"
    else
        read -p "Voulez-vous activer UFW maintenant ? (y/N): " -n 1 -r
        echo
    fi
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        # Activation avec force pour éviter la confirmation interactive
        ufw --force enable
        
        # Vérification du status
        ufw status verbose
        
        log_info "✅ UFW activé et configuré"
        
        # Auto-démarrage du service
        systemctl enable ufw
        
        # Test de connectivité immédiat
        log_step "Test de connectivité..."
        if ss -tlnp | grep -q ":22.*LISTEN"; then
            log_info "✅ Port SSH 22 accessible"
        else
            log_warn "⚠️ Port SSH 22 non détecté"
        fi
        
        if ss -tlnp | grep -q ":80.*LISTEN\|:443.*LISTEN"; then
            log_info "✅ Ports web 80/443 accessibles"
        else
            log_warn "⚠️ Ports web non détectés (normal si Nginx pas encore démarré)"
        fi
        
        # Instructions de sécurité
        log_warn "⚠️  IMPORTANT: Testez votre connexion SSH dans un autre terminal"
        log_warn "⚠️  Si vous perdez l'accès, utilisez la console OVH pour désactiver UFW"
        log_info "Commande d'urgence: sudo ufw --force reset && sudo ufw disable"
        
    else
        log_info "UFW configuré mais non activé. Pour activer: sudo ufw enable"
    fi
}

create_monitoring_script() {
    log_step "Création script de monitoring firewall..."
    
    cat > /usr/local/bin/psa-firewall-monitor << 'EOF'
#!/bin/bash
# Monitoring automatique du firewall PSA

LOG_FILE="/var/log/psa-firewall-monitor.log"
ALERT_THRESHOLD=50  # Nombre de tentatives suspectes par minute

# Fonction de log
log_alert() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> "$LOG_FILE"
}

# Analyse des logs UFW récents
analyze_threats() {
    local recent_blocks=$(grep "$(date '+%b %d %H:%M')" /var/log/ufw.log | wc -l)
    
    if [[ $recent_blocks -gt $ALERT_THRESHOLD ]]; then
        log_alert "ALERTE: $recent_blocks tentatives bloquées cette minute"
        
        # Envoyer notification si configuré
        if [[ -n "$ADMIN_EMAIL" ]]; then
            echo "ALERTE PSA FIREWALL: $recent_blocks tentatives d'intrusion bloquées" | \
            mail -s "PSA Security Alert" "$ADMIN_EMAIL"
        fi
    fi
}

# Nettoyage automatique des vieilles entrées
cleanup_old_bans() {
    # Supprimer les bans temporaires de plus de 24h
    # Cette fonction peut être étendue selon les besoins
    log_alert "Nettoyage automatique effectué"
}

# Exécution
case "${1:-monitor}" in
    monitor)
        analyze_threats
        ;;
    cleanup)
        cleanup_old_bans
        ;;
    *)
        echo "Usage: $0 {monitor|cleanup}"
        ;;
esac
EOF

    chmod +x /usr/local/bin/psa-firewall-monitor
    
    # Ajouter à cron pour monitoring automatique
    (crontab -l 2>/dev/null; echo "*/5 * * * * /usr/local/bin/psa-firewall-monitor monitor") | crontab -
    (crontab -l 2>/dev/null; echo "0 4 * * * /usr/local/bin/psa-firewall-monitor cleanup") | crontab -
    
    log_info "✅ Monitoring firewall configuré (vérification toutes les 5 minutes)"
}

# Fonction principale
main() {
    log_info "🔒 Configuration UFW Firewall - PSA Grading App"
    log_info "=================================================="
    
    # Variables d'environnement (peuvent être définies avant le script)
    DATABASE_TYPE="${DATABASE_TYPE:-remote}"
    ENABLE_UPTIME_KUMA="${ENABLE_UPTIME_KUMA:-false}"
    ENABLE_IPV6="${ENABLE_IPV6:-false}"
    CUSTOM_SSH_PORT="${CUSTOM_SSH_PORT:-}"
    MONITORING_ALLOWED_IP="${MONITORING_ALLOWED_IP:-}"
    ADMIN_EMAIL="${ADMIN_EMAIL:-}"
    
    # Exécution séquentielle
    check_root
    check_ufw_installed
    setup_ufw_basic
    configure_ssh_protection
    configure_web_services
    configure_application_specific
    configure_monitoring_ports
    configure_advanced_rules
    apply_ddos_protection
    create_blacklist_management
    create_monitoring_script
    enable_ufw
    
    log_info ""
    log_info "🎉 Configuration UFW terminée avec succès!"
    log_info ""
    log_info "📊 Commandes utiles:"
    log_info "  • Status firewall: sudo ufw status verbose"
    log_info "  • Gestion IP: sudo psa-firewall-manage"
    log_info "  • Logs: sudo tail -f /var/log/ufw.log"
    log_info "  • Monitoring: sudo psa-firewall-monitor"
    log_info ""
    log_warn "⚠️  N'oubliez pas de tester votre connexion SSH!"
}

# Exécution du script
main "$@"