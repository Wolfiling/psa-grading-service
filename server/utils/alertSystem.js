import { pool } from '../database/init.js';
import { sendEmail } from './brevo.js';
import { findCommandsRequiringVideoAlerts, sendVideoReminder } from './videoValidation.js';

/**
 * SYSTÈME D'ALERTES AUTOMATISÉES PSA
 * 
 * Gère les alertes automatiques pour les commandes sans vidéo
 * et notifications admin pour le suivi des workflow PSA.
 */

// Configuration des alertes
export const ALERT_CONFIG = {
  DAILY_CHECK_HOUR: 9,        // Vérification quotidienne à 9h
  ADMIN_EMAIL: process.env.PSA_ADMIN_EMAIL || 'admin@psa-grading.com',
  MAX_ALERTS_PER_BATCH: 50,   // Maximum d'alertes par batch
  ALERT_COOLDOWN_HOURS: 22    // Cooldown entre alertes pour même commande
};

/**
 * Effectue la vérification quotidienne des vidéos manquantes
 * @param {Object} options - Options de vérification
 * @returns {Promise<Object>} Résultat de la vérification
 */
export const performDailyVideoCheck = async (options = {}) => {
  try {
    console.log('🔍 Début vérification quotidienne vidéos PSA...');

    const startTime = Date.now();
    
    // Récupérer les commandes nécessitant des alertes
    const alertResult = await findCommandsRequiringVideoAlerts();
    
    if (!alertResult.success) {
      throw new Error(`Erreur recherche alertes: ${alertResult.message}`);
    }

    const { commands, summary } = alertResult;
    
    if (commands.length === 0) {
      console.log('✅ Aucune commande nécessitant d\'alertes vidéo');
      return {
        success: true,
        summary: { processed: 0, alerts_sent: 0, reminders_sent: 0 },
        message: 'Aucune alerte nécessaire'
      };
    }

    console.log(`📊 ${commands.length} commandes à analyser:`, summary);

    // Traiter les alertes par niveau
    const results = await processVideoAlerts(commands, options);

    const duration = Date.now() - startTime;
    console.log(`✅ Vérification quotidienne terminée en ${duration}ms`);

    return {
      success: true,
      duration_ms: duration,
      summary: results.summary,
      commands_processed: commands.length,
      alerts_sent: results.adminAlertsCount,
      reminders_sent: results.clientRemindersCount
    };

  } catch (error) {
    console.error('❌ Erreur vérification quotidienne:', error);
    return {
      success: false,
      message: error.message
    };
  }
};

/**
 * Traite les alertes vidéo par niveau de priorité
 * @param {Array} commands - Commandes à traiter
 * @param {Object} options - Options de traitement
 * @returns {Promise<Object>} Résultats du traitement
 */
const processVideoAlerts = async (commands, options = {}) => {
  const results = {
    adminAlertsCount: 0,
    clientRemindersCount: 0,
    errors: [],
    summary: {
      warning: 0,
      critical: 0,
      reminders_sent: 0,
      admin_alerts: 0
    }
  };

  // Grouper par niveau d'alerte
  const warningCommands = commands.filter(c => c.alertLevel === 'warning');
  const criticalCommands = commands.filter(c => c.alertLevel === 'critical');

  console.log(`🟡 ${warningCommands.length} alertes warning, 🔴 ${criticalCommands.length} alertes critical`);

  // Traiter les alertes warning (notification admin)
  if (warningCommands.length > 0) {
    const adminAlertResult = await sendAdminVideoAlert(warningCommands, 'warning');
    if (adminAlertResult.success) {
      results.adminAlertsCount++;
      results.summary.admin_alerts++;
    } else {
      results.errors.push(`Admin alert warning: ${adminAlertResult.message}`);
    }
  }

  // Traiter les alertes critical (notification admin + rappel client)
  if (criticalCommands.length > 0) {
    // Alert admin pour les critiques
    const adminCriticalResult = await sendAdminVideoAlert(criticalCommands, 'critical');
    if (adminCriticalResult.success) {
      results.adminAlertsCount++;
      results.summary.admin_alerts++;
    } else {
      results.errors.push(`Admin alert critical: ${adminCriticalResult.message}`);
    }

    // Envoyer rappels clients pour commandes éligibles
    for (const command of criticalCommands) {
      if (command.canSendReminder) {
        try {
          const reminderResult = await sendVideoReminder(command.submission_id);
          if (reminderResult.success) {
            results.clientRemindersCount++;
            results.summary.reminders_sent++;
            console.log(`📧 Rappel envoyé: ${command.submission_id}`);
          } else {
            results.errors.push(`Reminder ${command.submission_id}: ${reminderResult.message}`);
          }
        } catch (error) {
          results.errors.push(`Reminder error ${command.submission_id}: ${error.message}`);
        }
      }
    }
  }

  // Enregistrer les alertes en base
  await recordAlertSession(commands.length, results);

  return results;
};

/**
 * Envoie une alerte admin pour les vidéos manquantes
 * @param {Array} commands - Commandes concernées
 * @param {string} level - Niveau d'alerte ('warning', 'critical')
 * @returns {Promise<Object>} Résultat de l'envoi
 */
const sendAdminVideoAlert = async (commands, level) => {
  try {
    const alertContent = generateAdminAlertContent(commands, level);
    
    const emailResult = await sendEmail({
      to: ALERT_CONFIG.ADMIN_EMAIL,
      subject: alertContent.subject,
      html: alertContent.html,
      from: {
        name: 'Système PSA Grading',
        email: process.env.BREVO_SENDER_EMAIL || 'system@psa-grading.com'
      }
    });

    // Enregistrer l'alerte en base
    await pool.query(`
      INSERT INTO admin_alerts (
        alert_type,
        alert_level,
        message,
        metadata
      ) VALUES ($1, $2, $3, $4)
    `, [
      'video_missing_batch',
      level,
      `${commands.length} commandes sans vidéo nécessitent attention`,
      JSON.stringify({
        commands_count: commands.length,
        email_id: emailResult.messageId,
        commands: commands.map(c => ({
          submission_id: c.submission_id,
          hours_since_creation: c.hoursSinceCreation,
          customer_email: c.customer_email
        }))
      })
    ]);

    console.log(`✅ Alerte admin ${level} envoyée: ${commands.length} commandes`);

    return {
      success: true,
      level: level,
      commands_count: commands.length,
      email_id: emailResult.messageId
    };

  } catch (error) {
    console.error(`❌ Erreur alerte admin ${level}:`, error);
    return {
      success: false,
      message: error.message
    };
  }
};

/**
 * Génère le contenu de l'email d'alerte admin
 * @param {Array} commands - Commandes concernées
 * @param {string} level - Niveau d'alerte
 * @returns {Object} Contenu formaté de l'email
 */
const generateAdminAlertContent = (commands, level) => {
  const isUrgent = level === 'critical';
  const urgentFlag = isUrgent ? '[URGENT] ' : '[ATTENTION] ';
  const subject = `${urgentFlag}PSA: ${commands.length} commandes sans vidéo`;

  // Trier par ancienneté
  const sortedCommands = commands.sort((a, b) => b.hoursSinceCreation - a.hoursSinceCreation);

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Alerte Système PSA</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .header { background: ${isUrgent ? '#d32f2f' : '#ff9800'}; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
        .stats { display: flex; justify-content: space-around; margin: 20px 0; }
        .stat-card { background: white; padding: 15px; border-radius: 8px; text-align: center; flex: 1; margin: 0 10px; }
        .stat-number { font-size: 32px; font-weight: bold; color: ${isUrgent ? '#d32f2f' : '#ff9800'}; }
        .command-list { background: white; border-radius: 8px; overflow: hidden; margin: 20px 0; }
        .command-item { padding: 15px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }
        .command-item:last-child { border-bottom: none; }
        .command-urgent { background: #ffebee; }
        .command-warning { background: #fff3e0; }
        .action-button { display: inline-block; background: #1a472a; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin: 10px 5px; }
        .footer { text-align: center; color: #666; font-size: 14px; margin-top: 30px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${isUrgent ? '🚨' : '⚠️'} Alerte Vidéos Manquantes</h1>
        <p>Service de Gradation PSA - Système Automatisé</p>
      </div>
      
      <div class="content">
        <h2>📊 Résumé de l'alerte</h2>
        
        <div class="stats">
          <div class="stat-card">
            <div class="stat-number">${commands.length}</div>
            <div>Commandes</div>
          </div>
          <div class="stat-card">
            <div class="stat-number">${Math.max(...commands.map(c => c.hoursSinceCreation))}h</div>
            <div>Plus ancienne</div>
          </div>
          <div class="stat-card">
            <div class="stat-number">${commands.filter(c => c.canSendReminder).length}</div>
            <div>Rappels possibles</div>
          </div>
        </div>

        <h3>📋 Commandes nécessitant attention</h3>
        
        <div class="command-list">
          ${sortedCommands.slice(0, 20).map(command => `
            <div class="command-item ${command.alertLevel === 'critical' ? 'command-urgent' : 'command-warning'}">
              <div>
                <strong>${command.submission_id}</strong><br>
                <small>${command.card_name} - ${command.customer_email}</small>
              </div>
              <div style="text-align: right;">
                <strong>${command.hoursSinceCreation}h</strong><br>
                <small>Statut: ${command.video_status || 'pending'}</small>
              </div>
            </div>
          `).join('')}
          ${commands.length > 20 ? `
            <div class="command-item" style="text-align: center; font-style: italic;">
              ... et ${commands.length - 20} autres commandes
            </div>
          ` : ''}
        </div>

        <h3>🎯 Actions recommandées</h3>
        <ul>
          ${isUrgent ? '<li><strong>Urgence:</strong> Contacter immédiatement les clients concernés</li>' : ''}
          <li>Vérifier l\'état des QR codes et régénérer si nécessaire</li>
          <li>Analyser les causes récurrentes de vidéos manquantes</li>
          <li>Considérer des rappels personnalisés pour les cas critiques</li>
          ${isUrgent ? '<li>Envisager des overrides admin si délais serrés</li>' : ''}
        </ul>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.REPL_URL || 'http://localhost:5000'}/admin" class="action-button">
            🔧 ACCÉDER AU TABLEAU DE BORD
          </a>
          <a href="${process.env.REPL_URL || 'http://localhost:5000'}/admin/shipments" class="action-button">
            📦 GESTION EXPÉDITIONS
          </a>
        </div>

        <div class="footer">
          <p>Alerte générée automatiquement le ${new Date().toLocaleString('fr-FR')}</p>
          <p>Système PSA Grading - Monitoring Automatisé</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return { subject, html };
};

/**
 * Enregistre une session d'alerte pour audit
 * @param {number} commandsProcessed - Nombre de commandes traitées
 * @param {Object} results - Résultats du traitement
 */
const recordAlertSession = async (commandsProcessed, results) => {
  try {
    await pool.query(`
      INSERT INTO admin_alerts (
        alert_type,
        alert_level,
        message,
        metadata
      ) VALUES ($1, $2, $3, $4)
    `, [
      'daily_video_check',
      'info',
      `Session quotidienne: ${commandsProcessed} commandes analysées`,
      JSON.stringify({
        commands_processed: commandsProcessed,
        admin_alerts_sent: results.adminAlertsCount,
        client_reminders_sent: results.clientRemindersCount,
        errors_count: results.errors.length,
        errors: results.errors.slice(0, 10) // Garder max 10 erreurs
      })
    ]);
  } catch (error) {
    console.error('❌ Erreur enregistrement session alertes:', error);
  }
};

/**
 * Récupère les alertes actives pour le dashboard admin
 * @param {Object} filters - Filtres de recherche
 * @returns {Promise<Object>} Alertes actives
 */
export const getActiveAdminAlerts = async (filters = {}) => {
  try {
    const query = `
      SELECT 
        id,
        alert_type,
        alert_level,
        message,
        created_at,
        metadata,
        submission_id
      FROM admin_alerts 
      WHERE resolved = FALSE
      ORDER BY 
        CASE alert_level 
          WHEN 'critical' THEN 1 
          WHEN 'warning' THEN 2 
          ELSE 3 
        END,
        created_at DESC
      LIMIT 50
    `;

    const result = await pool.query(query);

    const alertsByLevel = {
      critical: result.rows.filter(a => a.alert_level === 'critical'),
      warning: result.rows.filter(a => a.alert_level === 'warning'),
      info: result.rows.filter(a => a.alert_level === 'info')
    };

    return {
      success: true,
      alerts: result.rows,
      summary: {
        total: result.rows.length,
        critical: alertsByLevel.critical.length,
        warning: alertsByLevel.warning.length,
        info: alertsByLevel.info.length
      },
      by_level: alertsByLevel
    };

  } catch (error) {
    console.error('❌ Erreur récupération alertes actives:', error);
    return {
      success: false,
      message: error.message
    };
  }
};

/**
 * Marque une alerte comme résolue
 * @param {number} alertId - ID de l'alerte
 * @param {string} resolvedBy - ID de l'administrateur
 * @returns {Promise<Object>} Résultat de la résolution
 */
export const resolveAdminAlert = async (alertId, resolvedBy) => {
  try {
    const result = await pool.query(`
      UPDATE admin_alerts 
      SET 
        resolved = TRUE,
        resolved_at = CURRENT_TIMESTAMP,
        resolved_by = $2
      WHERE id = $1 AND resolved = FALSE
      RETURNING *
    `, [alertId, resolvedBy]);

    if (result.rows.length === 0) {
      return {
        success: false,
        message: 'Alerte non trouvée ou déjà résolue'
      };
    }

    console.log(`✅ Alerte ${alertId} résolue par ${resolvedBy}`);

    return {
      success: true,
      alert: result.rows[0]
    };

  } catch (error) {
    console.error(`❌ Erreur résolution alerte ${alertId}:`, error);
    return {
      success: false,
      message: error.message
    };
  }
};

export default {
  performDailyVideoCheck,
  getActiveAdminAlerts,
  resolveAdminAlert,
  ALERT_CONFIG
};