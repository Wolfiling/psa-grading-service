#!/bin/bash

# ===============================================
# SCRIPT DE CUSTOMISATION POUR DÉPLOIEMENT OVH
# PSA GRADING APP - REMPLACEMENT AUTOMATIQUE PLACEHOLDERS
# ===============================================
# 🔧 Personnalise automatiquement tous les fichiers pour le déploiement
# 📝 Remplace les placeholders par les vraies valeurs

set -e

# Configuration par défaut (peut être surchargée par arguments)
DOMAIN="${1:-}"
ADMIN_EMAIL="${2:-}"
GIT_REPO="${3:-}"
DB_URL="${4:-}"

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${BLUE}[STEP]${NC} $1"; }
log_success() { echo -e "${CYAN}[SUCCESS]${NC} $1"; }

# Affichage aide
show_help() {
    cat << EOF
🔧 SCRIPT DE CUSTOMISATION PSA GRADING APP

Usage:
    $0 <domaine> <email_admin> [git_repo] [db_url]

Exemples:
    $0 psa.mondomaine.com admin@mondomaine.com
    $0 my-psa.ovh.net admin@gmail.com https://github.com/user/psa-app.git
    $0 psa-service.fr contact@psa-service.fr https://github.com/user/repo.git postgresql://user:pass@db.ovh:5432/psa

Arguments:
    domaine     - Votre domaine (ex: psa.mondomaine.com)
    email_admin - Email administrateur pour alertes
    git_repo    - URL du repository Git (optionnel)
    db_url      - URL base de données PostgreSQL (optionnel)

Le script va personnaliser:
    • ecosystem.config.js (domaine, repo)
    • .env.production.template (domaine, email)
    • DEPLOYMENT_OVH_GUIDE.md (domaine)
    • Configurations Nginx (domaine)
    • Scripts de déploiement (domaine, email)
    • Documentation (domaine, contact)

EOF
}

# Validation des paramètres
validate_parameters() {
    if [[ -z "$DOMAIN" ]]; then
        log_error "Paramètre domaine manquant"
        show_help
        exit 1
    fi
    
    if [[ -z "$ADMIN_EMAIL" ]]; then
        log_error "Paramètre email administrateur manquant"
        show_help
        exit 1
    fi
    
    # Validation format domaine
    if [[ ! "$DOMAIN" =~ ^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$ ]]; then
        log_error "Format de domaine invalide: $DOMAIN"
        exit 1
    fi
    
    # Validation format email
    if [[ ! "$ADMIN_EMAIL" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; then
        log_error "Format d'email invalide: $ADMIN_EMAIL"
        exit 1
    fi
    
    # Valeurs par défaut
    GIT_REPO="${GIT_REPO:-https://github.com/YOUR-USERNAME/psa-grading-app.git}"
    DB_URL="${DB_URL:-postgresql://username:password@postgresql-host.ovh.net:5432/psa_grading_prod?sslmode=require}"
    
    log_info "Configuration validée:"
    log_info "  Domaine: $DOMAIN"
    log_info "  Email: $ADMIN_EMAIL"
    log_info "  Repo: $GIT_REPO"
}

# Sauvegarde des fichiers originaux
backup_original_files() {
    log_step "Sauvegarde des fichiers originaux..."
    
    local backup_dir="backup-templates-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$backup_dir"
    
    # Liste des fichiers à sauvegarder
    local files_to_backup=(
        "ecosystem.config.js"
        ".env.production.template"
        "DEPLOYMENT_OVH_GUIDE.md"
        "scripts/nginx/psa-grading.conf"
        "scripts/deployment/deploy-to-ovh.sh"
        "scripts/ssl/setup-letsencrypt.sh"
        "README.md"
        "replit.md"
    )
    
    for file in "${files_to_backup[@]}"; do
        if [[ -f "$file" ]]; then
            cp "$file" "$backup_dir/" 2>/dev/null || true
        fi
    done
    
    log_info "✅ Sauvegarde créée dans: $backup_dir"
}

# Génération de secrets sécurisés
generate_secure_secrets() {
    log_step "Génération de secrets sécurisés..."
    
    # Génération de secrets aléaoires
    SESSION_SECRET=$(openssl rand -base64 64 | tr -d '\n')
    PSA_SECRET=$(openssl rand -base64 64 | tr -d '\n')
    JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')
    CLIENT_SECRET=$(openssl rand -base64 64 | tr -d '\n')
    
    log_info "✅ Secrets générés"
}

# Personnalisation ecosystem.config.js
customize_ecosystem() {
    log_step "Personnalisation ecosystem.config.js..."
    
    if [[ -f "ecosystem.config.js" ]]; then
        # Remplacements dans ecosystem.config.js
        sed -i "s|host: \['your-ovh-server.com'\]|host: ['$DOMAIN']|g" ecosystem.config.js
        sed -i "s|your-ovh-server.com|$DOMAIN|g" ecosystem.config.js
        sed -i "s|https://github.com/your-username/psa-grading-app.git|$GIT_REPO|g" ecosystem.config.js
        sed -i "s|your-username|$(echo $GIT_REPO | sed 's|.*github.com/||' | sed 's|/.*||')|g" ecosystem.config.js
        
        log_info "✅ ecosystem.config.js personnalisé"
    else
        log_warn "ecosystem.config.js non trouvé"
    fi
}

# Personnalisation .env.production.template
customize_env_template() {
    log_step "Personnalisation .env.production.template..."
    
    if [[ -f ".env.production.template" ]]; then
        # Remplacements dans .env.production.template
        sed -i "s|DOMAIN=your-domain.com|DOMAIN=$DOMAIN|g" .env.production.template
        sed -i "s|PUBLIC_URL=https://your-domain.com|PUBLIC_URL=https://$DOMAIN|g" .env.production.template
        sed -i "s|https://your-domain.com|https://$DOMAIN|g" .env.production.template
        sed -i "s|admin@your-domain.com|$ADMIN_EMAIL|g" .env.production.template
        sed -i "s|noreply@your-domain.com|noreply@$DOMAIN|g" .env.production.template
        sed -i "s|monitoring@your-domain.com|monitoring@$DOMAIN|g" .env.production.template
        
        # Remplacement des secrets
        sed -i "s|GENERATE_SECURE_SESSION_SECRET_64_CHARS_MIN|$SESSION_SECRET|g" .env.production.template
        sed -i "s|GENERATE_SECURE_PSA_SECRET_64_CHARS_MIN|$PSA_SECRET|g" .env.production.template
        sed -i "s|GENERATE_SECURE_JWT_SECRET_64_CHARS_MIN|$JWT_SECRET|g" .env.production.template
        sed -i "s|GENERATE_SECURE_CLIENT_SECRET_64_CHARS_MIN|$CLIENT_SECRET|g" .env.production.template
        
        # Base de données
        sed -i "s|postgresql://username:password@postgresql-host.ovh.net:5432/psa_grading_prod?sslmode=require|$DB_URL|g" .env.production.template
        
        log_info "✅ .env.production.template personnalisé"
    else
        log_warn ".env.production.template non trouvé"
    fi
}

# Personnalisation guide de déploiement
customize_deployment_guide() {
    log_step "Personnalisation guide de déploiement..."
    
    if [[ -f "DEPLOYMENT_OVH_GUIDE.md" ]]; then
        # Remplacements dans le guide
        sed -i "s|your-domain.com|$DOMAIN|g" DEPLOYMENT_OVH_GUIDE.md
        sed -i "s|www.your-domain.com|www.$DOMAIN|g" DEPLOYMENT_OVH_GUIDE.md
        sed -i "s|admin@your-domain.com|$ADMIN_EMAIL|g" DEPLOYMENT_OVH_GUIDE.md
        sed -i "s|your-ovh-server.com|$DOMAIN|g" DEPLOYMENT_OVH_GUIDE.md
        sed -i "s|votre-domaine.com|$DOMAIN|g" DEPLOYMENT_OVH_GUIDE.md
        sed -i "s|https://github.com/your-username/psa-grading-app.git|$GIT_REPO|g" DEPLOYMENT_OVH_GUIDE.md
        
        log_info "✅ Guide de déploiement personnalisé"
    else
        log_warn "DEPLOYMENT_OVH_GUIDE.md non trouvé"
    fi
}

# Personnalisation configurations Nginx
customize_nginx_configs() {
    log_step "Personnalisation configurations Nginx..."
    
    if [[ -f "scripts/nginx/psa-grading.conf" ]]; then
        sed -i "s|DOMAIN_PLACEHOLDER|$DOMAIN|g" scripts/nginx/psa-grading.conf
        sed -i "s|server_name _;|server_name $DOMAIN www.$DOMAIN;|g" scripts/nginx/psa-grading.conf
        
        log_info "✅ Configuration Nginx personnalisée"
    else
        log_warn "Configuration Nginx non trouvée"
    fi
}

# Personnalisation scripts de déploiement
customize_deployment_scripts() {
    log_step "Personnalisation scripts de déploiement..."
    
    local scripts=(
        "scripts/deployment/deploy-to-ovh.sh"
        "scripts/ssl/setup-letsencrypt.sh"
        "scripts/monitoring/setup-monitoring.sh"
    )
    
    for script in "${scripts[@]}"; do
        if [[ -f "$script" ]]; then
            sed -i "s|your-domain.com|$DOMAIN|g" "$script"
            sed -i "s|admin@your-domain.com|$ADMIN_EMAIL|g" "$script"
            sed -i "s|https://github.com/your-username/psa-grading-app.git|$GIT_REPO|g" "$script"
            
            log_info "✅ $(basename "$script") personnalisé"
        fi
    done
}

# Personnalisation documentation
customize_documentation() {
    log_step "Personnalisation documentation..."
    
    local doc_files=(
        "README.md"
        "replit.md"
    )
    
    for doc_file in "${doc_files[@]}"; do
        if [[ -f "$doc_file" ]]; then
            sed -i "s|your-domain.com|$DOMAIN|g" "$doc_file"
            sed -i "s|admin@your-domain.com|$ADMIN_EMAIL|g" "$doc_file"
            
            # Ajouter section déploiement personnalisée
            if [[ "$doc_file" == "README.md" ]]; then
                cat >> README.md << EOF

## 🚀 Déploiement OVH

Cette instance est configurée pour le domaine: **$DOMAIN**

### Configuration rapide:
\`\`\`bash
# 1. Copier la configuration
cp .env.production.template .env

# 2. Configurer vos vraies valeurs dans .env
nano .env

# 3. Déployer
sudo ./scripts/deployment/deploy-to-ovh.sh
\`\`\`

### Support
- Email admin: $ADMIN_EMAIL
- Domaine: https://$DOMAIN
EOF
            fi
            
            log_info "✅ $(basename "$doc_file") personnalisé"
        fi
    done
}

# Création script de déploiement rapide personnalisé
create_quick_deploy() {
    log_step "Création script de déploiement rapide..."
    
    cat > "quick-deploy-$DOMAIN.sh" << EOF
#!/bin/bash
# 🚀 DÉPLOIEMENT RAPIDE PSA GRADING APP
# Domaine: $DOMAIN
# Email admin: $ADMIN_EMAIL

set -e

echo "🚀 Déploiement PSA Grading App pour $DOMAIN"
echo "============================================="

# Variables pré-configurées
export DOMAIN="$DOMAIN"
export ADMIN_EMAIL="$ADMIN_EMAIL"
export GIT_REPO="$GIT_REPO"

# Vérification root
if [[ \$EUID -ne 0 ]]; then
    echo "❌ Ce script doit être exécuté en root"
    exit 1
fi

# Copie .env si pas existant
if [[ ! -f ".env" ]]; then
    echo "📝 Création .env depuis template..."
    cp .env.production.template .env
    chmod 600 .env
    echo "⚠️  IMPORTANT: Éditez .env avec vos vraies valeurs!"
    echo "⚠️  Notamment: mots de passe, clés API, DATABASE_URL"
    read -p "Voulez-vous éditer .env maintenant? (y/N): " -n 1 -r
    echo
    if [[ \$REPLY =~ ^[Yy]\$ ]]; then
        nano .env
    fi
fi

# Déploiement automatique
echo "🚀 Lancement du déploiement automatique..."
./scripts/deployment/deploy-to-ovh.sh

echo ""
echo "🎉 Déploiement terminé!"
echo "🌐 URL: https://$DOMAIN"
echo "📧 Admin: $ADMIN_EMAIL"
echo ""
EOF

    chmod +x "quick-deploy-$DOMAIN.sh"
    
    log_info "✅ Script de déploiement rapide créé: quick-deploy-$DOMAIN.sh"
}

# Validation des modifications
validate_customization() {
    log_step "Validation des modifications..."
    
    local issues=0
    
    # Vérifier que les placeholders ont été remplacés
    local check_files=(
        "ecosystem.config.js"
        ".env.production.template"
        "DEPLOYMENT_OVH_GUIDE.md"
    )
    
    for file in "${check_files[@]}"; do
        if [[ -f "$file" ]]; then
            if grep -q "your-domain.com\|your-username\|admin@your-domain.com" "$file" 2>/dev/null; then
                log_warn "Placeholders restants dans $file"
                ((issues++))
            fi
        fi
    done
    
    # Vérifier que les scripts sont exécutables
    local scripts=(
        "scripts/deployment/deploy-to-ovh.sh"
        "scripts/security/setup-ufw.sh"
        "scripts/ssl/setup-letsencrypt.sh"
        "quick-deploy-$DOMAIN.sh"
    )
    
    for script in "${scripts[@]}"; do
        if [[ -f "$script" ]] && [[ ! -x "$script" ]]; then
            chmod +x "$script"
            log_info "Permissions corrigées pour $script"
        fi
    done
    
    if [[ $issues -eq 0 ]]; then
        log_success "✅ Validation réussie - Aucun problème détecté"
    else
        log_warn "⚠️ $issues problèmes détectés - vérification manuelle recommandée"
    fi
    
    return $issues
}

# Affichage résumé final
show_final_summary() {
    log_success ""
    log_success "🎉 CUSTOMISATION TERMINÉE AVEC SUCCÈS!"
    log_success "===================================="
    log_success ""
    log_success "📊 Configuration:"
    log_success "  • Domaine: $DOMAIN"
    log_success "  • Email admin: $ADMIN_EMAIL" 
    log_success "  • Repository: $GIT_REPO"
    log_success ""
    log_success "📝 Fichiers personnalisés:"
    log_success "  • ecosystem.config.js"
    log_success "  • .env.production.template"
    log_success "  • DEPLOYMENT_OVH_GUIDE.md"
    log_success "  • Configuration Nginx"
    log_success "  • Scripts de déploiement"
    log_success ""
    log_success "🚀 Déploiement rapide:"
    log_success "  sudo ./quick-deploy-$DOMAIN.sh"
    log_success ""
    log_success "📋 Prochaines étapes:"
    log_success "  1. Copier: cp .env.production.template .env"
    log_success "  2. Configurer .env avec vos vraies valeurs"
    log_success "  3. Lancer le déploiement"
    log_success ""
    log_success "🔧 Support:"
    log_success "  • Email: $ADMIN_EMAIL"
    log_success "  • Documentation: DEPLOYMENT_OVH_GUIDE.md"
    log_success ""
}

# Fonction principale
main() {
    log_info "🔧 CUSTOMISATION PSA GRADING APP POUR DÉPLOIEMENT OVH"
    log_info "==================================================="
    
    # Validation paramètres
    if [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]]; then
        show_help
        exit 0
    fi
    
    validate_parameters
    
    # Confirmation
    echo
    read -p "Confirmer la customisation pour $DOMAIN ? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Customisation annulée"
        exit 0
    fi
    
    # Exécution
    backup_original_files
    generate_secure_secrets
    customize_ecosystem
    customize_env_template
    customize_deployment_guide
    customize_nginx_configs
    customize_deployment_scripts
    customize_documentation
    create_quick_deploy
    
    if validate_customization; then
        show_final_summary
        exit 0
    else
        log_error "Validation échouée - vérification manuelle requise"
        exit 1
    fi
}

# Point d'entrée
main "$@"