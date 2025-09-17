#!/bin/bash

# ===============================================
# SETUP MONITORING - PSA GRADING APP
# ===============================================
# 📊 Installation et configuration complète du monitoring
# 🚨 Alertes email, monitoring système et application

set -e

# Configuration
MONITORING_USER="monitoring"
UPTIME_KUMA_PORT=3001
GRAFANA_PORT=3000
PROMETHEUS_PORT=9090

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

check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "Ce script doit être exécuté en root"
        exit 1
    fi
}

install_uptime_kuma() {
    log_step "Installation Uptime Kuma..."
    
    # Créer utilisateur dédié
    if ! id "$MONITORING_USER" &>/dev/null; then
        useradd --system --create-home --shell /bin/bash "$MONITORING_USER"
    fi
    
    # Installation Node.js si nécessaire
    if ! command -v node &>/dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
        apt-get install -y nodejs
    fi
    
    # Installation Uptime Kuma
    cd /home/$MONITORING_USER
    if [[ ! -d "uptime-kuma" ]]; then
        sudo -u $MONITORING_USER git clone https://github.com/louislam/uptime-kuma.git
        cd uptime-kuma
        sudo -u $MONITORING_USER npm ci --production
    fi
    
    # Configuration service systemd
    cat > /etc/systemd/system/uptime-kuma.service << EOF
[Unit]
Description=Uptime Kuma
After=network.target

[Service]
Type=simple
User=$MONITORING_USER
WorkingDirectory=/home/$MONITORING_USER/uptime-kuma
ExecStart=/usr/bin/node server/server.js
Restart=on-failure
RestartSec=5s
Environment=NODE_ENV=production
Environment=PORT=$UPTIME_KUMA_PORT

[Install]
WantedBy=multi-user.target
EOF
    
    systemctl daemon-reload
    systemctl enable uptime-kuma
    systemctl start uptime-kuma
    
    log_info "✅ Uptime Kuma installé sur port $UPTIME_KUMA_PORT"
}

setup_system_monitoring() {
    log_step "Configuration monitoring système..."
    
    # Installation outils monitoring
    apt install -y htop iotop nethogs sysstat mailutils
    
    # Configuration monitoring disque
    cat > /usr/local/bin/psa-disk-monitor << 'EOF'
#!/bin/bash
THRESHOLD=85
USAGE=$(df / | tail -1 | awk '{print $5}' | sed 's/%//')

if [ "$USAGE" -gt "$THRESHOLD" ]; then
    echo "ALERTE: Disque utilisé à ${USAGE}% (seuil: ${THRESHOLD}%)" | \
    mail -s "PSA - Alerte Disque Plein" "${ADMIN_EMAIL:-root@localhost}"
fi
EOF
    
    chmod +x /usr/local/bin/psa-disk-monitor
    
    # Configuration monitoring mémoire
    cat > /usr/local/bin/psa-memory-monitor << 'EOF'
#!/bin/bash
THRESHOLD=90
USAGE=$(free | grep Mem | awk '{printf("%.0f", $3/$2 * 100.0)}')

if [ "$USAGE" -gt "$THRESHOLD" ]; then
    echo "ALERTE: Mémoire utilisée à ${USAGE}% (seuil: ${THRESHOLD}%)" | \
    mail -s "PSA - Alerte Mémoire" "${ADMIN_EMAIL:-root@localhost}"
fi
EOF
    
    chmod +x /usr/local/bin/psa-memory-monitor
    
    # Configuration monitoring charge système
    cat > /usr/local/bin/psa-load-monitor << 'EOF'
#!/bin/bash
LOAD=$(uptime | awk '{print $(NF-2)}' | sed 's/,//')
CPU_COUNT=$(nproc)
THRESHOLD=$(echo "$CPU_COUNT * 2" | bc -l)

if (( $(echo "$LOAD > $THRESHOLD" | bc -l) )); then
    echo "ALERTE: Charge système élevée: ${LOAD} (seuil: ${THRESHOLD})" | \
    mail -s "PSA - Alerte Charge Système" "${ADMIN_EMAIL:-root@localhost}"
fi
EOF
    
    chmod +x /usr/local/bin/psa-load-monitor
    
    # Ajout aux crons
    (crontab -l 2>/dev/null; echo "*/15 * * * * /usr/local/bin/psa-disk-monitor") | crontab -
    (crontab -l 2>/dev/null; echo "*/10 * * * * /usr/local/bin/psa-memory-monitor") | crontab -
    (crontab -l 2>/dev/null; echo "*/5 * * * * /usr/local/bin/psa-load-monitor") | crontab -
    
    log_info "✅ Monitoring système configuré"
}

setup_application_monitoring() {
    log_step "Configuration monitoring application PSA..."
    
    # Script de monitoring de l'application
    cat > /usr/local/bin/psa-app-monitor << 'EOF'
#!/bin/bash
APP_URL="${1:-http://localhost:5000/healthz}"
TIMEOUT=10
LOG_FILE="/var/log/psa-app-monitor.log"

log_event() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> "$LOG_FILE"
}

# Test disponibilité application
if ! curl -f -s --max-time "$TIMEOUT" "$APP_URL" >/dev/null 2>&1; then
    log_event "ALERTE: Application PSA non accessible"
    
    # Tentative redémarrage PM2
    if command -v pm2 >/dev/null 2>&1; then
        log_event "Tentative redémarrage PM2..."
        pm2 restart psa-grading-app 2>/dev/null || true
        sleep 5
        
        # Re-test après redémarrage
        if curl -f -s --max-time "$TIMEOUT" "$APP_URL" >/dev/null 2>&1; then
            log_event "Application redémarrée avec succès"
            echo "L'application PSA a été redémarrée automatiquement après détection d'un problème." | \
            mail -s "PSA - Application Redémarrée" "${ADMIN_EMAIL:-root@localhost}"
        else
            log_event "CRITIQUE: Échec redémarrage application"
            echo "CRITIQUE: L'application PSA est inaccessible et le redémarrage automatique a échoué." | \
            mail -s "PSA - CRITIQUE - Application Down" "${ADMIN_EMAIL:-root@localhost}"
        fi
    else
        echo "ALERTE: Application PSA inaccessible (PM2 non trouvé)" | \
        mail -s "PSA - Application Inaccessible" "${ADMIN_EMAIL:-root@localhost}"
    fi
else
    log_event "Application OK"
fi

# Monitoring base de données
if [[ -f "/var/www/psa-grading-app/.env" ]]; then
    cd /var/www/psa-grading-app
    if ! node -e "
        const { Pool } = require('pg');
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });
        pool.query('SELECT 1')
            .then(() => { console.log('DB_OK'); pool.end(); })
            .catch(() => { console.log('DB_ERROR'); process.exit(1); });
    " 2>/dev/null | grep -q "DB_OK"; then
        log_event "ALERTE: Base de données inaccessible"
        echo "ALERTE: La base de données PSA est inaccessible." | \
        mail -s "PSA - Erreur Base de Données" "${ADMIN_EMAIL:-root@localhost}"
    fi
fi
EOF
    
    chmod +x /usr/local/bin/psa-app-monitor
    
    # Monitoring toutes les 2 minutes
    (crontab -l 2>/dev/null; echo "*/2 * * * * /usr/local/bin/psa-app-monitor") | crontab -
    
    log_info "✅ Monitoring application configuré"
}

setup_log_monitoring() {
    log_step "Configuration monitoring logs..."
    
    # Installation logwatch si pas installé
    apt install -y logwatch
    
    # Configuration monitoring erreurs Nginx
    cat > /usr/local/bin/psa-log-monitor << 'EOF'
#!/bin/bash
ERROR_THRESHOLD=10
LOG_FILE="/var/log/nginx/psa-error.log"

if [[ -f "$LOG_FILE" ]]; then
    # Compter erreurs des 10 dernières minutes
    ERROR_COUNT=$(tail -1000 "$LOG_FILE" | grep "$(date '+%Y/%m/%d %H:%M' -d '10 minutes ago')" | wc -l)
    
    if [[ $ERROR_COUNT -gt $ERROR_THRESHOLD ]]; then
        echo "ALERTE: $ERROR_COUNT erreurs détectées dans les logs Nginx" | \
        mail -s "PSA - Erreurs Nginx" "${ADMIN_EMAIL:-root@localhost}"
    fi
fi

# Monitoring erreurs PM2
if command -v pm2 >/dev/null 2>&1; then
    ERROR_COUNT=$(pm2 logs psa-grading-app --lines 100 --raw 2>/dev/null | \
                  grep -i "error\|exception\|fatal" | \
                  grep "$(date '+%Y-%m-%d %H:%M' -d '10 minutes ago')" | wc -l)
    
    if [[ $ERROR_COUNT -gt 5 ]]; then
        echo "ALERTE: $ERROR_COUNT erreurs détectées dans les logs PM2" | \
        mail -s "PSA - Erreurs Application" "${ADMIN_EMAIL:-root@localhost}"
    fi
fi
EOF
    
    chmod +x /usr/local/bin/psa-log-monitor
    
    # Monitoring logs toutes les 10 minutes
    (crontab -l 2>/dev/null; echo "*/10 * * * * /usr/local/bin/psa-log-monitor") | crontab -
    
    log_info "✅ Monitoring logs configuré"
}

create_dashboard() {
    log_step "Création tableau de bord monitoring..."
    
    # Page HTML de statut simple
    mkdir -p /var/www/monitoring
    cat > /var/www/monitoring/index.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <title>PSA Monitoring Dashboard</title>
    <meta charset="utf-8">
    <meta http-equiv="refresh" content="30">
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; }
        .card { background: white; padding: 20px; margin: 10px 0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .status-ok { color: #28a745; }
        .status-warning { color: #ffc107; }
        .status-error { color: #dc3545; }
        .metric { display: inline-block; margin: 10px 20px; }
        .metric-value { font-size: 24px; font-weight: bold; }
        .metric-label { font-size: 12px; color: #666; }
        pre { background: #f8f9fa; padding: 10px; border-radius: 4px; overflow-x: auto; }
    </style>
</head>
<body>
    <div class="container">
        <h1>📊 PSA Grading App - Monitoring Dashboard</h1>
        
        <div class="card">
            <h2>🚀 Services Status</h2>
            <div id="services-status">Loading...</div>
        </div>
        
        <div class="card">
            <h2>💾 System Metrics</h2>
            <div id="system-metrics">Loading...</div>
        </div>
        
        <div class="card">
            <h2>📋 Recent Logs</h2>
            <div id="recent-logs">Loading...</div>
        </div>
    </div>
    
    <script>
        // Simulation de données (à remplacer par vraies données via API)
        document.getElementById('services-status').innerHTML = `
            <div class="metric">
                <div class="metric-value status-ok">✅ Online</div>
                <div class="metric-label">PSA Application</div>
            </div>
            <div class="metric">
                <div class="metric-value status-ok">✅ Online</div>
                <div class="metric-label">Database</div>
            </div>
            <div class="metric">
                <div class="metric-value status-ok">✅ Online</div>
                <div class="metric-label">Nginx</div>
            </div>
        `;
        
        document.getElementById('system-metrics').innerHTML = `
            <div class="metric">
                <div class="metric-value">45%</div>
                <div class="metric-label">CPU Usage</div>
            </div>
            <div class="metric">
                <div class="metric-value">2.1 GB</div>
                <div class="metric-label">Memory Usage</div>
            </div>
            <div class="metric">
                <div class="metric-value">15 GB</div>
                <div class="metric-label">Disk Free</div>
            </div>
        `;
    </script>
</body>
</html>
EOF
    
    # Configuration Nginx pour tableau de bord
    cat > /etc/nginx/sites-available/psa-monitoring << 'EOF'
server {
    listen 8080;
    listen [::]:8080;
    server_name localhost;
    
    root /var/www/monitoring;
    index index.html;
    
    # Accès local uniquement
    allow 127.0.0.1;
    allow ::1;
    deny all;
    
    location / {
        try_files $uri $uri/ =404;
    }
    
    # API endpoint pour métriques (futur)
    location /api/metrics {
        return 200 '{"status": "ok", "timestamp": "2025-01-01T00:00:00Z"}';
        add_header Content-Type application/json;
    }
}
EOF
    
    ln -sf /etc/nginx/sites-available/psa-monitoring /etc/nginx/sites-enabled/
    
    log_info "✅ Tableau de bord créé (http://localhost:8080)"
}

main() {
    log_info "📊 Configuration Monitoring PSA Grading App"
    log_info "============================================="
    
    # Variables d'environnement
    ADMIN_EMAIL="${ADMIN_EMAIL:-root@localhost}"
    ENABLE_UPTIME_KUMA="${ENABLE_UPTIME_KUMA:-true}"
    
    check_root
    
    if [[ "$ENABLE_UPTIME_KUMA" == "true" ]]; then
        install_uptime_kuma
    fi
    
    setup_system_monitoring
    setup_application_monitoring  
    setup_log_monitoring
    create_dashboard
    
    # Redémarrage Nginx pour tableau de bord
    nginx -t && systemctl reload nginx
    
    log_info ""
    log_info "🎉 Monitoring configuré avec succès!"
    log_info ""
    log_info "📊 Accès:"
    if [[ "$ENABLE_UPTIME_KUMA" == "true" ]]; then
        log_info "  • Uptime Kuma: http://localhost:$UPTIME_KUMA_PORT"
    fi
    log_info "  • Dashboard: http://localhost:8080"
    log_info "  • Logs: /var/log/psa-*.log"
    log_info ""
    log_info "🔧 Configuration:"
    log_info "  • Alertes email: $ADMIN_EMAIL"
    log_info "  • Scripts: /usr/local/bin/psa-*-monitor"
    log_info "  • Crons: crontab -l"
}

main "$@"