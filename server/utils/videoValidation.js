import { pool } from '../database/init.js';
import { generateCompleteQRCode } from './videoProof.js';
import { sendEmail } from './brevo.js';

/**
 * SYSTÈME DE VALIDATION VIDÉO PSA
 * 
 * Ce module gère les vérifications automatisées pour s'assurer qu'une vidéo 
 * de preuve est présente avant l'envoi des cartes à PSA.
 */

// Configuration des seuils d'alerte
export const VIDEO_ALERT_CONFIG = {
  WARNING_HOURS: 48,      // Alerte après 48h sans vidéo
  CRITICAL_DAYS: 7,       // Alerte critique après 7 jours
  MAX_REMINDERS: 3,       // Maximum 3 rappels par commande
  REMINDER_INTERVAL_HOURS: 72  // Rappel tous les 3 jours
};

/**
 * Vérifie si une commande a une vidéo de preuve valide
 * @param {string} submissionId - ID de la soumission PSA
 * @returns {Promise<Object>} Résultat de la vérification
 */
export const checkVideoPresence = async (submissionId) => {
  try {
    const query = `
      SELECT 
        id,
        submission_id,
        video_status,
        video_url,
        created_at,
        customer_email,
        card_name,
        grading_type,
        recording_timestamp,
        video_file_size
      FROM grading_requests 
      WHERE submission_id = $1
    `;

    const result = await pool.query(query, [submissionId]);

    if (result.rows.length === 0) {
      return {
        valid: false,
        reason: 'SUBMISSION_NOT_FOUND',
        message: 'Soumission non trouvée'
      };
    }

    const request = result.rows[0];

    // Vérifier le statut vidéo
    if (!request.video_status || request.video_status === 'pending') {
      return {
        valid: false,
        reason: 'VIDEO_PENDING',
        message: 'Vidéo en attente d\'enregistrement',
        data: request
      };
    }

    if (request.video_status === 'error') {
      return {
        valid: false,
        reason: 'VIDEO_ERROR',
        message: 'Erreur lors de l\'enregistrement vidéo',
        data: request
      };
    }

    if (request.video_status === 'uploaded' && request.video_url) {
      return {
        valid: true,
        reason: 'VIDEO_PRESENT',
        message: 'Vidéo de preuve disponible',
        data: request
      };
    }

    return {
      valid: false,
      reason: 'VIDEO_MISSING',
      message: 'Statut vidéo incomplet',
      data: request
    };

  } catch (error) {
    console.error('❌ Erreur vérification vidéo:', error);
    return {
      valid: false,
      reason: 'VALIDATION_ERROR',
      message: `Erreur de validation: ${error.message}`
    };
  }
};

/**
 * Valide une commande avant envoi PSA avec vérification vidéo
 * @param {string} submissionId - ID de la soumission PSA
 * @param {Object} options - Options de validation
 * @returns {Promise<Object>} Résultat de la validation
 */
export const validateForPSAShipment = async (submissionId, options = {}) => {
  try {
    console.log(`🔍 Validation PSA pour soumission: ${submissionId}`);

    const videoCheck = await checkVideoPresence(submissionId);

    if (!videoCheck.valid) {
      // Enregistrer l'échec de validation
      await logValidationAttempt(submissionId, false, videoCheck.reason);

      return {
        canShip: false,
        blocked: true,
        reason: videoCheck.reason,
        message: videoCheck.message,
        requiresOverride: true,
        videoStatus: videoCheck.data?.video_status,
        recommendations: getValidationRecommendations(videoCheck.reason)
      };
    }

    // Vérifications supplémentaires
    const additionalChecks = await performAdditionalValidations(submissionId);

    if (!additionalChecks.valid) {
      await logValidationAttempt(submissionId, false, additionalChecks.reason);
      return {
        canShip: false,
        blocked: true,
        reason: additionalChecks.reason,
        message: additionalChecks.message,
        requiresOverride: false
      };
    }

    // Validation réussie
    await logValidationAttempt(submissionId, true, 'VALIDATION_SUCCESS');

    return {
      canShip: true,
      blocked: false,
      reason: 'VALIDATION_SUCCESS',
      message: 'Commande validée pour envoi PSA',
      videoData: videoCheck.data
    };

  } catch (error) {
    console.error(`❌ Erreur validation PSA ${submissionId}:`, error);
    return {
      canShip: false,
      blocked: true,
      reason: 'VALIDATION_ERROR',
      message: `Erreur de validation: ${error.message}`,
      requiresOverride: true
    };
  }
};

/**
 * Crée un override admin pour une validation vidéo échouée
 * @param {string} submissionId - ID de la soumission PSA
 * @param {string} adminId - ID de l'administrateur
 * @param {string} justification - Justification de l'override
 * @param {string} overrideType - Type d'override ('missing_video', 'urgent_shipment', etc.)
 * @returns {Promise<Object>} Résultat de l'override
 */
export const createVideoValidationOverride = async (submissionId, adminId, justification, overrideType = 'missing_video') => {
  try {
    console.log(`🔓 Création override admin pour ${submissionId}`);

    if (!justification || justification.trim().length < 10) {
      return {
        success: false,
        message: 'Justification obligatoire (minimum 10 caractères)'
      };
    }

    // Insérer l'override dans la base de données
    const query = `
      INSERT INTO video_check_overrides (
        submission_id,
        admin_id,
        override_type,
        justification,
        created_at
      ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      RETURNING *
    `;

    const result = await pool.query(query, [submissionId, adminId, overrideType, justification]);

    // Mettre à jour le statut de la commande
    await pool.query(`
      UPDATE grading_requests 
      SET 
        status = 'ready_for_psa',
        video_override_admin = $1,
        video_override_reason = $2,
        video_override_timestamp = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE submission_id = $3
    `, [adminId, justification, submissionId]);

    // Log de sécurité
    console.log(`✅ Override créé par ${adminId} pour ${submissionId}: ${overrideType}`);

    return {
      success: true,
      override: result.rows[0],
      message: 'Override créé avec succès'
    };

  } catch (error) {
    console.error(`❌ Erreur création override ${submissionId}:`, error);
    return {
      success: false,
      message: `Erreur création override: ${error.message}`
    };
  }
};

/**
 * Effectue des validations supplémentaires avant envoi PSA
 * @param {string} submissionId - ID de la soumission
 * @returns {Promise<Object>} Résultat des validations
 */
const performAdditionalValidations = async (submissionId) => {
  try {
    const query = `
      SELECT 
        card_name,
        grading_type,
        customer_email,
        payment_status,
        shopify_order_verified
      FROM grading_requests 
      WHERE submission_id = $1
    `;

    const result = await pool.query(query, [submissionId]);
    const request = result.rows[0];

    if (!request) {
      return {
        valid: false,
        reason: 'REQUEST_NOT_FOUND',
        message: 'Commande non trouvée'
      };
    }

    // Vérifier les informations obligatoires
    if (!request.card_name || request.card_name.trim().length === 0) {
      return {
        valid: false,
        reason: 'MISSING_CARD_NAME',
        message: 'Nom de la carte obligatoire'
      };
    }

    if (!request.grading_type) {
      return {
        valid: false,
        reason: 'MISSING_GRADING_TYPE',
        message: 'Type de gradation obligatoire'
      };
    }

    // Vérifier le statut de paiement si activé
    if (request.payment_status === 'failed' || request.payment_status === 'cancelled') {
      return {
        valid: false,
        reason: 'PAYMENT_ISSUE',
        message: 'Problème de paiement détecté'
      };
    }

    return {
      valid: true,
      reason: 'ADDITIONAL_CHECKS_PASSED',
      message: 'Validations supplémentaires réussies'
    };

  } catch (error) {
    return {
      valid: false,
      reason: 'ADDITIONAL_CHECK_ERROR',
      message: `Erreur validations supplémentaires: ${error.message}`
    };
  }
};

/**
 * Enregistre une tentative de validation pour audit
 * @param {string} submissionId - ID de la soumission
 * @param {boolean} success - Succès de la validation
 * @param {string} reason - Raison du résultat
 */
const logValidationAttempt = async (submissionId, success, reason) => {
  try {
    await pool.query(`
      INSERT INTO shipment_validations (
        submission_id,
        validation_success,
        validation_reason,
        validated_at
      ) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
    `, [submissionId, success, reason]);
  } catch (error) {
    console.error('❌ Erreur log validation:', error);
  }
};

/**
 * Génère des recommandations basées sur la raison d'échec
 * @param {string} reason - Raison de l'échec de validation
 * @returns {Array} Liste de recommandations
 */
const getValidationRecommendations = (reason) => {
  const recommendations = {
    'VIDEO_PENDING': [
      'Contacter le client pour enregistrer la vidéo',
      'Régénérer le QR code si nécessaire',
      'Vérifier les instructions d\'enregistrement'
    ],
    'VIDEO_ERROR': [
      'Régénérer un nouveau QR code',
      'Vérifier la connectivité client',
      'Proposer assistance technique'
    ],
    'VIDEO_MISSING': [
      'Envoyer rappel automatique au client',
      'Vérifier le statut de la commande',
      'Considérer un override si urgent'
    ]
  };

  return recommendations[reason] || [
    'Analyser le problème spécifique',
    'Contacter le support technique',
    'Documenter le cas pour amélioration'
  ];
};

/**
 * Identifie les commandes nécessitant des alertes vidéo
 * @param {Object} filters - Filtres pour la recherche
 * @returns {Promise<Object>} Commandes à alerter
 */
export const findCommandsRequiringVideoAlerts = async (filters = {}) => {
  try {
    const now = new Date();
    const warningThreshold = new Date(now.getTime() - (VIDEO_ALERT_CONFIG.WARNING_HOURS * 60 * 60 * 1000));
    const criticalThreshold = new Date(now.getTime() - (VIDEO_ALERT_CONFIG.CRITICAL_DAYS * 24 * 60 * 60 * 1000));

    const query = `
      SELECT 
        gr.*,
        COALESCE(ar.reminder_count, 0) as reminder_count,
        ar.last_reminder_sent
      FROM grading_requests gr
      LEFT JOIN automated_reminders ar ON gr.submission_id = ar.submission_id
      WHERE 
        gr.status IN ('pending', 'confirmed', 'in_preparation')
        AND (gr.video_status IS NULL OR gr.video_status IN ('pending', 'error'))
        AND gr.created_at < $1
        AND (ar.reminder_count IS NULL OR ar.reminder_count < $2)
      ORDER BY gr.created_at ASC
    `;

    const result = await pool.query(query, [warningThreshold, VIDEO_ALERT_CONFIG.MAX_REMINDERS]);

    const commands = result.rows.map(row => ({
      ...row,
      alertLevel: row.created_at < criticalThreshold ? 'critical' : 'warning',
      hoursSinceCreation: Math.floor((now - new Date(row.created_at)) / (1000 * 60 * 60)),
      canSendReminder: (row.reminder_count || 0) < VIDEO_ALERT_CONFIG.MAX_REMINDERS
    }));

    return {
      success: true,
      commands: commands,
      summary: {
        total: commands.length,
        warning: commands.filter(c => c.alertLevel === 'warning').length,
        critical: commands.filter(c => c.alertLevel === 'critical').length,
        canRemind: commands.filter(c => c.canSendReminder).length
      }
    };

  } catch (error) {
    console.error('❌ Erreur recherche alertes vidéo:', error);
    return {
      success: false,
      message: error.message
    };
  }
};

/**
 * Génère et envoie un rappel automatique pour une vidéo manquante
 * @param {string} submissionId - ID de la soumission
 * @param {Object} options - Options du rappel
 * @returns {Promise<Object>} Résultat de l'envoi
 */
export const sendVideoReminder = async (submissionId, options = {}) => {
  try {
    console.log(`📧 Envoi rappel vidéo pour ${submissionId}`);

    // Récupérer les données de la commande
    const query = `
      SELECT 
        id,
        submission_id,
        customer_email,
        card_name,
        grading_type,
        created_at
      FROM grading_requests 
      WHERE submission_id = $1
    `;

    const result = await pool.query(query, [submissionId]);

    if (result.rows.length === 0) {
      return {
        success: false,
        message: 'Commande non trouvée'
      };
    }

    const request = result.rows[0];

    // Régénérer le QR code
    const qrResult = await generateCompleteQRCode(submissionId, {
      card_name: request.card_name,
      customer_email: request.customer_email,
      grading_type: request.grading_type
    });

    if (!qrResult.success) {
      throw new Error(`Échec génération QR: ${qrResult.message}`);
    }

    // Préparer le contenu de l'email
    const daysSinceOrder = Math.floor((new Date() - new Date(request.created_at)) / (1000 * 60 * 60 * 24));
    
    const emailContent = generateReminderEmailContent({
      customerEmail: request.customer_email,
      cardName: request.card_name,
      submissionId: submissionId,
      recordingUrl: qrResult.recording_url,
      daysSinceOrder: daysSinceOrder,
      isUrgent: daysSinceOrder >= VIDEO_ALERT_CONFIG.CRITICAL_DAYS
    });

    // Envoyer l'email
    const emailResult = await sendEmail(emailContent);

    // Enregistrer le rappel envoyé
    await recordReminderSent(submissionId, 'video_missing', emailResult.messageId);

    console.log(`✅ Rappel vidéo envoyé pour soumission ${submissionId}`);

    return {
      success: true,
      message: 'Rappel envoyé avec succès',
      emailId: emailResult.messageId,
      qrRegenerated: true
    };

  } catch (error) {
    console.error(`❌ Erreur envoi rappel ${submissionId}:`, error);
    return {
      success: false,
      message: `Erreur envoi rappel: ${error.message}`
    };
  }
};

/**
 * Génère le contenu de l'email de rappel vidéo
 * @param {Object} data - Données pour l'email
 * @returns {Object} Contenu de l'email formaté
 */
const generateReminderEmailContent = (data) => {
  const urgentFlag = data.isUrgent ? '[URGENT] ' : '';
  const subject = `${urgentFlag}Vidéo de preuve requise - Commande PSA ${data.submissionId}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Rappel Vidéo PSA</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #1a472a; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
        .urgent { background: #d32f2f; }
        .card-info { background: white; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #1a472a; }
        .action-button { display: inline-block; background: #1a472a; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { text-align: center; color: #666; font-size: 14px; margin-top: 30px; }
        .warning { color: #d32f2f; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="header ${data.isUrgent ? 'urgent' : ''}">
        <h1>🎥 Vidéo de Preuve Requise</h1>
        <p>Service de Gradation PSA</p>
      </div>
      
      <div class="content">
        <p>Bonjour,</p>
        
        ${data.isUrgent ? 
          '<p class="warning">⚠️ ATTENTION: Votre commande risque d\'être retardée faute de vidéo de preuve.</p>' : 
          '<p>Nous remarquons qu\'aucune vidéo de preuve n\'a encore été enregistrée pour votre commande.</p>'
        }
        
        <div class="card-info">
          <h3>📋 Détails de votre commande</h3>
          <p><strong>Carte:</strong> ${data.cardName}</p>
          <p><strong>Numéro de commande:</strong> ${data.submissionId}</p>
          <p><strong>Commandée il y a:</strong> ${data.daysSinceOrder} jour(s)</p>
        </div>
        
        <h3>🎯 Action Requise</h3>
        <p>Pour traiter votre commande, nous avons besoin d'une vidéo de preuve montrant l'état de votre carte.</p>
        
        <p><strong>Comment procéder:</strong></p>
        <ol>
          <li>Cliquez sur le bouton ci-dessous</li>
          <li>Autorisez l'accès à votre caméra</li>
          <li>Filmez votre carte (recto/verso, 30-60 secondes)</li>
          <li>Confirmez l'envoi</li>
        </ol>
        
        <div style="text-align: center;">
          <a href="${data.recordingUrl}" class="action-button">
            🎥 ENREGISTRER LA VIDÉO
          </a>
        </div>
        
        ${data.isUrgent ? 
          '<p class="warning">⏰ Délai critique: Enregistrez votre vidéo dans les 48h pour éviter tout retard.</p>' : 
          '<p>💡 Plus tôt vous enregistrez, plus vite nous pourrons traiter votre commande.</p>'
        }
        
        <div class="footer">
          <p>Questions? Contactez-nous: support@psa-grading.com</p>
          <p>Service de Gradation PSA - Excellence & Authenticité</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return {
    to: data.customerEmail,
    subject: subject,
    html: html,
    from: {
      name: 'Service PSA Grading',
      email: process.env.BREVO_SENDER_EMAIL || 'noreply@psa-grading.com'
    }
  };
};

/**
 * Enregistre un rappel envoyé dans la base de données
 * @param {string} submissionId - ID de la soumission
 * @param {string} reminderType - Type de rappel
 * @param {string} emailId - ID de l'email envoyé
 */
const recordReminderSent = async (submissionId, reminderType, emailId) => {
  try {
    await pool.query(`
      INSERT INTO automated_reminders (
        submission_id,
        reminder_type,
        email_id,
        sent_at
      ) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (submission_id) 
      DO UPDATE SET 
        reminder_count = automated_reminders.reminder_count + 1,
        last_reminder_sent = CURRENT_TIMESTAMP,
        latest_email_id = $3
    `, [submissionId, reminderType, emailId]);
  } catch (error) {
    console.error('❌ Erreur enregistrement rappel:', error);
  }
};

export default {
  checkVideoPresence,
  validateForPSAShipment,
  createVideoValidationOverride,
  findCommandsRequiringVideoAlerts,
  sendVideoReminder,
  VIDEO_ALERT_CONFIG
};