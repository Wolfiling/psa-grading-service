#!/bin/bash

# ===============================================
# WEBHOOK NOTIFICATIONS - PSA GRADING APP
# ===============================================
# 📡 Script de notifications webhook pour GitHub Actions
# 🔔 Support Slack, Discord, Teams, Email et webhooks personnalisés
# 📊 Notifications contextuelles avec métriques de déploiement

set -e
set -u
set -o pipefail

# ===============================================
# CONFIGURATION
# ===============================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Variables GitHub Actions
GITHUB_SHA="${GITHUB_SHA:-unknown}"
GITHUB_REF="${GITHUB_REF:-unknown}"
GITHUB_ACTOR="${GITHUB_ACTOR:-github-actions}"
GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-psa-grading/psa-grading-app}"
GITHUB_RUN_ID="${GITHUB_RUN_ID:-unknown}"
GITHUB_RUN_NUMBER="${GITHUB_RUN_NUMBER:-unknown}"

# Variables de déploiement
DEPLOYMENT_ENV="${DEPLOYMENT_ENV:-staging}"
DEPLOYMENT_STATUS="${DEPLOYMENT_STATUS:-unknown}"
DEPLOYMENT_URL="${DEPLOYMENT_URL:-}"
DOCKER_IMAGE="${DOCKER_IMAGE:-}"

# Configuration notifications
NOTIFICATION_TYPE="${1:-deployment}"
NOTIFICATION_STATUS="${2:-info}"
NOTIFICATION_MESSAGE="${3:-Deployment notification}"

# URLs webhook (depuis secrets GitHub)
SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"
DISCORD_WEBHOOK_URL="${DISCORD_WEBHOOK_URL:-}"
TEAMS_WEBHOOK_URL="${TEAMS_WEBHOOK_URL:-}"
CUSTOM_WEBHOOK_URL="${CUSTOM_WEBHOOK_URL:-}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"

# Couleurs et emojis
declare -A STATUS_COLORS=(
    ["success"]="36"     # Cyan
    ["error"]="31"       # Red
    ["warning"]="33"     # Yellow
    ["info"]="34"        # Blue
    ["in_progress"]="35" # Magenta
)

declare -A STATUS_EMOJIS=(
    ["success"]="✅"
    ["error"]="❌"
    ["warning"]="⚠️"
    ["info"]="ℹ️"
    ["in_progress"]="🔄"
    ["rollback"]="🔄"
    ["critical"]="🚨"
)

# ===============================================
# FONCTIONS UTILITAIRES
# ===============================================
log() {
    local level=$1
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    local color_code=${STATUS_COLORS[$level]:-37}
    
    echo -e "\033[${color_code}m${timestamp} [${level^^}] ${message}\033[0m"
}

# Extraction des informations du commit
get_commit_info() {
    local commit_url="https://github.com/${GITHUB_REPOSITORY}/commit/${GITHUB_SHA}"
    local commit_message=""
    local commit_author=""
    
    # Tenter d'extraire info du commit (si possible)
    if command -v git >/dev/null 2>&1 && [ -d ".git" ]; then
        commit_message=$(git log -1 --pretty=format:'%s' 2>/dev/null || echo "")
        commit_author=$(git log -1 --pretty=format:'%an' 2>/dev/null || echo "$GITHUB_ACTOR")
    fi
    
    echo "${commit_message:-Deployment update}|${commit_author:-$GITHUB_ACTOR}|${commit_url}"
}

# Calcul de la durée de déploiement
calculate_deployment_duration() {
    local start_time_file="/tmp/deployment_start_time"
    local duration="unknown"
    
    if [ -f "$start_time_file" ]; then
        local start_time=$(cat "$start_time_file")
        local current_time=$(date +%s)
        local duration_seconds=$((current_time - start_time))
        
        if [ $duration_seconds -gt 60 ]; then
            duration="${duration_seconds}s ($(date -u -d @${duration_seconds} +%M:%S))"
        else
            duration="${duration_seconds}s"
        fi
    fi
    
    echo "$duration"
}

# ===============================================
# NOTIFICATIONS SLACK
# ===============================================
send_slack_notification() {
    if [ -z "$SLACK_WEBHOOK_URL" ]; then
        log "info" "Slack webhook not configured, skipping"
        return 0
    fi
    
    log "info" "Sending Slack notification..."
    
    local color=""
    case "$NOTIFICATION_STATUS" in
        "success") color="good" ;;
        "error"|"critical") color="danger" ;;
        "warning") color="warning" ;;
        *) color="#439FE0" ;;
    esac
    
    local emoji="${STATUS_EMOJIS[$NOTIFICATION_STATUS]:-📡}"
    local commit_info=$(get_commit_info)
    local commit_message=$(echo "$commit_info" | cut -d'|' -f1)
    local commit_author=$(echo "$commit_info" | cut -d'|' -f2)
    local commit_url=$(echo "$commit_info" | cut -d'|' -f3)
    local duration=$(calculate_deployment_duration)
    
    # Construction du payload Slack
    local payload=$(cat <<EOF
{
  "username": "PSA Grading Bot",
  "icon_emoji": ":rocket:",
  "attachments": [
    {
      "color": "$color",
      "pretext": "$emoji *PSA Grading App* - $NOTIFICATION_TYPE",
      "title": "$NOTIFICATION_MESSAGE",
      "title_link": "https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}",
      "fields": [
        {
          "title": "Environment",
          "value": "$DEPLOYMENT_ENV",
          "short": true
        },
        {
          "title": "Status",
          "value": "$NOTIFICATION_STATUS",
          "short": true
        },
        {
          "title": "Branch",
          "value": "$(echo $GITHUB_REF | sed 's/refs\/heads\///')",
          "short": true
        },
        {
          "title": "Commit",
          "value": "<$commit_url|${GITHUB_SHA:0:8}>",
          "short": true
        },
        {
          "title": "Author",
          "value": "$commit_author",
          "short": true
        },
        {
          "title": "Duration",
          "value": "$duration",
          "short": true
        }
      ],
      "footer": "GitHub Actions",
      "footer_icon": "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png",
      "ts": $(date +%s)
    }
  ]
}
EOF
)
    
    # Ajouter champs supplémentaires selon le contexte
    if [ -n "$DEPLOYMENT_URL" ]; then
        payload=$(echo "$payload" | jq --arg url "$DEPLOYMENT_URL" '.attachments[0].fields += [{"title": "URL", "value": $url, "short": false}]')
    fi
    
    if [ -n "$DOCKER_IMAGE" ]; then
        payload=$(echo "$payload" | jq --arg image "$DOCKER_IMAGE" '.attachments[0].fields += [{"title": "Docker Image", "value": $image, "short": false}]')
    fi
    
    if [ "$commit_message" != "Deployment update" ]; then
        payload=$(echo "$payload" | jq --arg msg "$commit_message" '.attachments[0].fields += [{"title": "Commit Message", "value": $msg, "short": false}]')
    fi
    
    # Envoi de la notification
    local response=$(curl -s -X POST -H 'Content-type: application/json' \
        --data "$payload" \
        "$SLACK_WEBHOOK_URL")
    
    if [ "$response" = "ok" ]; then
        log "success" "Slack notification sent successfully"
    else
        log "warning" "Slack notification failed: $response"
    fi
}

# ===============================================
# NOTIFICATIONS DISCORD
# ===============================================
send_discord_notification() {
    if [ -z "$DISCORD_WEBHOOK_URL" ]; then
        log "info" "Discord webhook not configured, skipping"
        return 0
    fi
    
    log "info" "Sending Discord notification..."
    
    local color=""
    case "$NOTIFICATION_STATUS" in
        "success") color=3066993 ;;      # Green
        "error"|"critical") color=15158332 ;;  # Red
        "warning") color=15105570 ;;     # Orange
        *) color=3447003 ;;              # Blue
    esac
    
    local emoji="${STATUS_EMOJIS[$NOTIFICATION_STATUS]:-📡}"
    local commit_info=$(get_commit_info)
    local commit_message=$(echo "$commit_info" | cut -d'|' -f1)
    local commit_author=$(echo "$commit_info" | cut -d'|' -f2)
    local commit_url=$(echo "$commit_info" | cut -d'|' -f3)
    
    local payload=$(cat <<EOF
{
  "username": "PSA Grading Bot",
  "avatar_url": "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png",
  "embeds": [
    {
      "title": "$emoji PSA Grading App - $NOTIFICATION_TYPE",
      "description": "$NOTIFICATION_MESSAGE",
      "color": $color,
      "url": "https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}",
      "fields": [
        {
          "name": "Environment",
          "value": "$DEPLOYMENT_ENV",
          "inline": true
        },
        {
          "name": "Status",
          "value": "$NOTIFICATION_STATUS",
          "inline": true
        },
        {
          "name": "Branch",
          "value": "$(echo $GITHUB_REF | sed 's/refs\/heads\///')",
          "inline": true
        },
        {
          "name": "Commit",
          "value": "[\`${GITHUB_SHA:0:8}\`]($commit_url)",
          "inline": true
        },
        {
          "name": "Author",
          "value": "$commit_author",
          "inline": true
        },
        {
          "name": "Run",
          "value": "#$GITHUB_RUN_NUMBER",
          "inline": true
        }
      ],
      "footer": {
        "text": "GitHub Actions • $(date -u +%Y-%m-%d\ %H:%M:%S\ UTC)"
      }
    }
  ]
}
EOF
)
    
    local response=$(curl -s -X POST -H 'Content-type: application/json' \
        --data "$payload" \
        "$DISCORD_WEBHOOK_URL")
    
    if [ -z "$response" ]; then
        log "success" "Discord notification sent successfully"
    else
        log "warning" "Discord notification failed: $response"
    fi
}

# ===============================================
# NOTIFICATIONS MICROSOFT TEAMS
# ===============================================
send_teams_notification() {
    if [ -z "$TEAMS_WEBHOOK_URL" ]; then
        log "info" "Teams webhook not configured, skipping"
        return 0
    fi
    
    log "info" "Sending Teams notification..."
    
    local theme_color=""
    case "$NOTIFICATION_STATUS" in
        "success") theme_color="00FF00" ;;
        "error"|"critical") theme_color="FF0000" ;;
        "warning") theme_color="FFA500" ;;
        *) theme_color="0078D4" ;;
    esac
    
    local emoji="${STATUS_EMOJIS[$NOTIFICATION_STATUS]:-📡}"
    local commit_info=$(get_commit_info)
    local commit_message=$(echo "$commit_info" | cut -d'|' -f1)
    local commit_author=$(echo "$commit_info" | cut -d'|' -f2)
    local commit_url=$(echo "$commit_info" | cut -d'|' -f3)
    
    local payload=$(cat <<EOF
{
  "@type": "MessageCard",
  "@context": "https://schema.org/extensions",
  "summary": "PSA Grading App Deployment",
  "themeColor": "$theme_color",
  "title": "$emoji PSA Grading App - $NOTIFICATION_TYPE",
  "text": "$NOTIFICATION_MESSAGE",
  "sections": [
    {
      "facts": [
        {
          "name": "Environment:",
          "value": "$DEPLOYMENT_ENV"
        },
        {
          "name": "Status:",
          "value": "$NOTIFICATION_STATUS"
        },
        {
          "name": "Branch:",
          "value": "$(echo $GITHUB_REF | sed 's/refs\/heads\///')"
        },
        {
          "name": "Commit:",
          "value": "${GITHUB_SHA:0:8}"
        },
        {
          "name": "Author:",
          "value": "$commit_author"
        },
        {
          "name": "Run Number:",
          "value": "#$GITHUB_RUN_NUMBER"
        }
      ]
    }
  ],
  "potentialAction": [
    {
      "@type": "OpenUri",
      "name": "View in GitHub",
      "targets": [
        {
          "os": "default",
          "uri": "https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
        }
      ]
    }
  ]
}
EOF
)
    
    if [ -n "$DEPLOYMENT_URL" ]; then
        payload=$(echo "$payload" | jq --arg url "$DEPLOYMENT_URL" '.potentialAction += [{"@type": "OpenUri", "name": "Open Application", "targets": [{"os": "default", "uri": $url}]}]')
    fi
    
    local response=$(curl -s -X POST -H 'Content-type: application/json' \
        --data "$payload" \
        "$TEAMS_WEBHOOK_URL")
    
    if [ "$response" = "1" ]; then
        log "success" "Teams notification sent successfully"
    else
        log "warning" "Teams notification may have failed: $response"
    fi
}

# ===============================================
# EMAIL NOTIFICATIONS
# ===============================================
send_email_notification() {
    if [ -z "$ADMIN_EMAIL" ] || ! command -v mail >/dev/null 2>&1; then
        log "info" "Email not configured or mail command unavailable, skipping"
        return 0
    fi
    
    log "info" "Sending email notification..."
    
    local status_icon="${STATUS_EMOJIS[$NOTIFICATION_STATUS]:-📡}"
    local commit_info=$(get_commit_info)
    local commit_message=$(echo "$commit_info" | cut -d'|' -f1)
    local commit_author=$(echo "$commit_info" | cut -d'|' -f2)
    local commit_url=$(echo "$commit_info" | cut -d'|' -f3)
    local duration=$(calculate_deployment_duration)
    
    local subject="$status_icon PSA Grading App - $NOTIFICATION_TYPE ($NOTIFICATION_STATUS)"
    
    local email_body=$(cat <<EOF
PSA Grading App Deployment Notification

$NOTIFICATION_MESSAGE

Deployment Details:
==================
Environment: $DEPLOYMENT_ENV
Status: $NOTIFICATION_STATUS
Branch: $(echo $GITHUB_REF | sed 's/refs\/heads\///')
Commit: ${GITHUB_SHA:0:8}
Author: $commit_author
Run Number: #$GITHUB_RUN_NUMBER
Duration: $duration

Commit Information:
==================
Message: $commit_message
URL: $commit_url

Links:
======
GitHub Actions: https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}
Repository: https://github.com/${GITHUB_REPOSITORY}
$([ -n "$DEPLOYMENT_URL" ] && echo "Application: $DEPLOYMENT_URL")

Timestamp: $(date -u +%Y-%m-%d\ %H:%M:%S\ UTC)

---
This is an automated notification from PSA Grading App deployment system.
EOF
)
    
    echo "$email_body" | mail -s "$subject" "$ADMIN_EMAIL" && {
        log "success" "Email notification sent successfully"
    } || {
        log "warning" "Email notification failed"
    }
}

# ===============================================
# WEBHOOK PERSONNALISÉ
# ===============================================
send_custom_webhook() {
    if [ -z "$CUSTOM_WEBHOOK_URL" ]; then
        log "info" "Custom webhook not configured, skipping"
        return 0
    fi
    
    log "info" "Sending custom webhook notification..."
    
    local commit_info=$(get_commit_info)
    local commit_message=$(echo "$commit_info" | cut -d'|' -f1)
    local commit_author=$(echo "$commit_info" | cut -d'|' -f2)
    local commit_url=$(echo "$commit_info" | cut -d'|' -f3)
    local duration=$(calculate_deployment_duration)
    
    local payload=$(cat <<EOF
{
  "service": "psa-grading-app",
  "event": "$NOTIFICATION_TYPE",
  "status": "$NOTIFICATION_STATUS",
  "message": "$NOTIFICATION_MESSAGE",
  "deployment": {
    "environment": "$DEPLOYMENT_ENV",
    "url": "$DEPLOYMENT_URL",
    "docker_image": "$DOCKER_IMAGE",
    "duration": "$duration"
  },
  "github": {
    "repository": "$GITHUB_REPOSITORY",
    "sha": "$GITHUB_SHA",
    "ref": "$GITHUB_REF",
    "actor": "$GITHUB_ACTOR",
    "run_id": "$GITHUB_RUN_ID",
    "run_number": "$GITHUB_RUN_NUMBER"
  },
  "commit": {
    "message": "$commit_message",
    "author": "$commit_author",
    "url": "$commit_url"
  },
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
)
    
    local response=$(curl -s -X POST -H 'Content-type: application/json' \
        -H 'User-Agent: PSA-Grading-Webhook/1.0' \
        --data "$payload" \
        "$CUSTOM_WEBHOOK_URL")
    
    if [ $? -eq 0 ]; then
        log "success" "Custom webhook sent successfully"
    else
        log "warning" "Custom webhook failed"
    fi
}

# ===============================================
# NOTIFICATIONS SPÉCIALISÉES
# ===============================================
send_deployment_start_notification() {
    # Sauvegarder l'heure de début pour calcul de durée
    echo "$(date +%s)" > /tmp/deployment_start_time
    
    NOTIFICATION_TYPE="deployment"
    NOTIFICATION_STATUS="in_progress"
    NOTIFICATION_MESSAGE="🚀 Deployment started for $DEPLOYMENT_ENV environment"
    
    send_all_notifications
}

send_deployment_success_notification() {
    NOTIFICATION_TYPE="deployment"
    NOTIFICATION_STATUS="success"
    NOTIFICATION_MESSAGE="🎉 Deployment completed successfully on $DEPLOYMENT_ENV"
    
    send_all_notifications
}

send_deployment_failure_notification() {
    local error_message="${1:-Unknown error}"
    
    NOTIFICATION_TYPE="deployment"
    NOTIFICATION_STATUS="error"
    NOTIFICATION_MESSAGE="💥 Deployment failed on $DEPLOYMENT_ENV: $error_message"
    
    send_all_notifications
}

send_rollback_notification() {
    local rollback_reason="${1:-Deployment failure}"
    
    NOTIFICATION_TYPE="rollback"
    NOTIFICATION_STATUS="warning"
    NOTIFICATION_MESSAGE="🔄 Rollback initiated on $DEPLOYMENT_ENV: $rollback_reason"
    
    send_all_notifications
}

send_critical_alert() {
    local alert_message="${1:-Critical system error}"
    
    NOTIFICATION_TYPE="alert"
    NOTIFICATION_STATUS="critical"
    NOTIFICATION_MESSAGE="🚨 CRITICAL ALERT: $alert_message"
    
    send_all_notifications
}

# ===============================================
# ENVOI GROUPÉ
# ===============================================
send_all_notifications() {
    log "info" "Sending notifications for: $NOTIFICATION_TYPE ($NOTIFICATION_STATUS)"
    
    # Envoyer vers tous les canaux configurés
    send_slack_notification &
    send_discord_notification &
    send_teams_notification &
    send_email_notification &
    send_custom_webhook &
    
    # Attendre que toutes les notifications soient envoyées
    wait
    
    log "success" "All notifications sent"
}

# ===============================================
# MAIN FUNCTION
# ===============================================
main() {
    local action="${1:-send}"
    
    case "$action" in
        "start")
            send_deployment_start_notification
            ;;
        "success")
            send_deployment_success_notification
            ;;
        "failure")
            local error_msg="${2:-Deployment failed}"
            send_deployment_failure_notification "$error_msg"
            ;;
        "rollback")
            local reason="${2:-Deployment failure}"
            send_rollback_notification "$reason"
            ;;
        "critical")
            local alert_msg="${2:-Critical system error}"
            send_critical_alert "$alert_msg"
            ;;
        "send"|"custom")
            send_all_notifications
            ;;
        "test")
            NOTIFICATION_MESSAGE="🧪 Test notification from PSA Grading App"
            NOTIFICATION_STATUS="info"
            send_all_notifications
            ;;
        *)
            echo "Usage: $0 [start|success|failure|rollback|critical|send|test] [message]"
            echo ""
            echo "Actions:"
            echo "  start     - Deployment started notification"
            echo "  success   - Deployment success notification"
            echo "  failure   - Deployment failure notification"
            echo "  rollback  - Rollback notification"
            echo "  critical  - Critical alert notification"
            echo "  send      - Send custom notification (use env vars)"
            echo "  test      - Send test notification"
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