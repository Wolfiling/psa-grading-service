import express from 'express';
import { pool } from '../database/init.js';
import { validateForPSAShipment } from '../utils/videoValidation.js';
import { getActiveAdminAlerts, resolveAdminAlert } from '../utils/alertSystem.js';
import { generateCompleteQRCode } from '../utils/videoProof.js';
import crypto from 'crypto';

/**
 * ROUTES ADMIN POUR CHECKLIST PRÉ-EXPÉDITION PSA
 * 
 * Gère la validation manuelle des commandes avant envoi PSA
 * avec vérifications vidéo automatisées et overrides admin.
 */

export function createAdminValidationRoutes() {
  const router = express.Router();

  // Récupérer la checklist des commandes prêtes pour PSA
  router.get('/shipment-checklist', async (req, res) => {
    try {
      const { status = 'ready_for_validation', include_override = false } = req.query;

      console.log('🔍 Récupération checklist expédition PSA...');

      let statusFilter = ['confirmed', 'in_preparation', 'ready_for_validation'];
      if (include_override === 'true') {
        statusFilter.push('ready_for_psa');
      }

      const query = `
        SELECT 
          gr.*,
          vco.override_type,
          vco.justification as override_reason,
          vco.created_at as override_timestamp,
          vco.admin_id as override_admin,
          ar.reminder_count,
          ar.last_reminder_sent,
          EXTRACT(HOURS FROM NOW() - gr.created_at) as hours_since_creation
        FROM grading_requests gr
        LEFT JOIN video_check_overrides vco ON gr.submission_id = vco.submission_id
        LEFT JOIN automated_reminders ar ON gr.submission_id = ar.submission_id
        WHERE gr.status = ANY($1)
        ORDER BY 
          CASE 
            WHEN gr.video_status = 'uploaded' THEN 1
            WHEN gr.video_override_admin IS NOT NULL THEN 2
            ELSE 3
          END,
          gr.created_at ASC
      `;

      const result = await pool.query(query, [statusFilter]);

      const commands = await Promise.all(result.rows.map(async (row) => {
        // Vérifier le statut de validation pour chaque commande
        const validation = await validateForPSAShipment(row.submission_id);
        
        return {
          ...row,
          validation_status: validation.canShip ? 'valid' : 'blocked',
          validation_reason: validation.reason,
          validation_message: validation.message,
          requires_override: validation.requiresOverride,
          recommendations: validation.recommendations || [],
          video_check: {
            has_video: row.video_status === 'uploaded',
            status: row.video_status || 'pending',
            url: row.video_url,
            file_size: row.video_file_size,
            duration: row.video_duration
          },
          override_info: row.override_type ? {
            type: row.override_type,
            reason: row.override_reason,
            admin: row.override_admin,
            timestamp: row.override_timestamp
          } : null,
          alert_level: row.hours_since_creation > (7 * 24) ? 'critical' : 
                       row.hours_since_creation > 48 ? 'warning' : 'normal'
        };
      }));

      const summary = {
        total: commands.length,
        valid: commands.filter(c => c.validation_status === 'valid').length,
        blocked: commands.filter(c => c.validation_status === 'blocked').length,
        with_video: commands.filter(c => c.video_check.has_video).length,
        with_override: commands.filter(c => c.override_info).length,
        critical_alerts: commands.filter(c => c.alert_level === 'critical').length,
        warning_alerts: commands.filter(c => c.alert_level === 'warning').length
      };

      console.log(`✅ Checklist récupérée: ${commands.length} commandes, ${summary.valid} valides`);

      res.json({
        success: true,
        commands: commands,
        summary: summary,
        message: `${commands.length} commandes en attente de validation`
      });

    } catch (error) {
      console.error('❌ Erreur récupération checklist:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération de la checklist'
      });
    }
  });

  // Valider une commande spécifique manuellement
  router.post('/validate-submission/:submissionId', async (req, res) => {
    try {
      const { submissionId } = req.params;
      const { admin_id, force_validation = false, notes } = req.body;

      console.log(`🔍 Validation manuelle commande ${submissionId} par ${admin_id}`);

      // Effectuer la validation
      const validation = await validateForPSAShipment(submissionId);

      if (!validation.canShip && !force_validation) {
        return res.status(400).json({
          success: false,
          message: `Validation échouée: ${validation.message}`,
          reason: validation.reason,
          requires_override: validation.requiresOverride,
          recommendations: validation.recommendations
        });
      }

      // Enregistrer la validation manuelle
      await pool.query(`
        INSERT INTO shipment_validations (
          submission_id,
          validation_success,
          validation_reason,
          validator_admin,
          notes
        ) VALUES ($1, $2, $3, $4, $5)
      `, [submissionId, true, validation.reason, admin_id, notes]);

      // Mettre à jour le statut de la commande
      await pool.query(`
        UPDATE grading_requests 
        SET 
          status = 'validated_for_psa',
          updated_at = CURRENT_TIMESTAMP
        WHERE submission_id = $1
      `, [submissionId]);

      console.log(`✅ Commande ${submissionId} validée par ${admin_id}`);

      res.json({
        success: true,
        message: 'Commande validée avec succès',
        validation_result: validation
      });

    } catch (error) {
      console.error(`❌ Erreur validation ${submissionId}:`, error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la validation'
      });
    }
  });

  // Créer un batch d'expédition PSA
  router.post('/create-shipment-batch', async (req, res) => {
    try {
      const { submission_ids, admin_id, notes } = req.body;

      if (!submission_ids || !Array.isArray(submission_ids) || submission_ids.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Liste de soumissions requise'
        });
      }

      console.log(`📦 Création batch expédition PSA: ${submission_ids.length} commandes par ${admin_id}`);

      const batch_id = `BATCH-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

      // Valider toutes les commandes du batch
      const validations = await Promise.all(
        submission_ids.map(async (submissionId) => {
          const validation = await validateForPSAShipment(submissionId);
          return {
            submission_id: submissionId,
            valid: validation.canShip,
            reason: validation.reason,
            has_override: validation.requiresOverride
          };
        })
      );

      const invalidCommands = validations.filter(v => !v.valid);
      
      if (invalidCommands.length > 0) {
        return res.status(400).json({
          success: false,
          message: `${invalidCommands.length} commandes non valides dans le batch`,
          invalid_commands: invalidCommands,
          suggestion: 'Utilisez des overrides admin ou retirez ces commandes'
        });
      }

      // Créer le batch en base
      const batchResult = await pool.query(`
        INSERT INTO psa_shipment_batches (
          batch_id,
          created_by,
          submission_count,
          video_validated_count,
          override_count,
          notes
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [
        batch_id,
        admin_id,
        submission_ids.length,
        validations.filter(v => v.valid && !v.has_override).length,
        validations.filter(v => v.has_override).length,
        notes
      ]);

      // Ajouter les items au batch
      for (const submissionId of submission_ids) {
        const validation = validations.find(v => v.submission_id === submissionId);
        
        await pool.query(`
          INSERT INTO psa_shipment_items (
            batch_id,
            submission_id,
            video_validated,
            has_override
          ) VALUES ($1, $2, $3, $4)
        `, [batch_id, submissionId, validation.valid, validation.has_override]);

        // Mettre à jour le statut des commandes
        await pool.query(`
          UPDATE grading_requests 
          SET 
            status = 'in_shipment_batch',
            updated_at = CURRENT_TIMESTAMP
          WHERE submission_id = $1
        `, [submissionId]);
      }

      console.log(`✅ Batch ${batch_id} créé avec ${submission_ids.length} commandes`);

      res.json({
        success: true,
        batch: batchResult.rows[0],
        validations: validations,
        message: `Batch ${batch_id} créé avec succès`
      });

    } catch (error) {
      console.error('❌ Erreur création batch:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la création du batch'
      });
    }
  });

  // Finaliser un batch et marquer comme expédié
  router.post('/finalize-shipment/:batchId', async (req, res) => {
    try {
      const { batchId } = req.params;
      const { tracking_number, admin_id, notes } = req.body;

      console.log(`📦 Finalisation batch expédition ${batchId} par ${admin_id}`);

      // Récupérer les commandes du batch
      const batchItems = await pool.query(`
        SELECT psi.submission_id
        FROM psa_shipment_items psi
        WHERE psi.batch_id = $1
      `, [batchId]);

      if (batchItems.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Batch non trouvé ou vide'
        });
      }

      // Mettre à jour le statut du batch
      await pool.query(`
        UPDATE psa_shipment_batches 
        SET 
          status = 'shipped',
          shipped_at = CURRENT_TIMESTAMP,
          tracking_number = $2,
          notes = COALESCE(notes, '') || $3
        WHERE batch_id = $1
      `, [batchId, tracking_number, notes ? `\n[Expédition] ${notes}` : '']);

      // Mettre à jour le statut de toutes les commandes
      for (const item of batchItems.rows) {
        await pool.query(`
          UPDATE grading_requests 
          SET 
            status = 'sent_to_psa',
            tracking_number = $2,
            updated_at = CURRENT_TIMESTAMP
          WHERE submission_id = $1
        `, [item.submission_id, tracking_number]);
      }

      console.log(`✅ Batch ${batchId} finalisé: ${batchItems.rows.length} commandes expédiées`);

      res.json({
        success: true,
        shipped_commands: batchItems.rows.length,
        tracking_number: tracking_number,
        message: `Batch expédié avec succès`
      });

    } catch (error) {
      console.error(`❌ Erreur finalisation batch ${batchId}:`, error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la finalisation'
      });
    }
  });

  // Récupérer les alertes actives pour le dashboard
  router.get('/admin-alerts', async (req, res) => {
    try {
      const alertsResult = await getActiveAdminAlerts();
      
      if (!alertsResult.success) {
        throw new Error(alertsResult.message);
      }

      res.json(alertsResult);

    } catch (error) {
      console.error('❌ Erreur récupération alertes:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des alertes'
      });
    }
  });

  // Résoudre une alerte admin
  router.post('/resolve-alert/:alertId', async (req, res) => {
    try {
      const { alertId } = req.params;
      const { admin_id } = req.body;

      const resolveResult = await resolveAdminAlert(parseInt(alertId), admin_id);
      
      if (!resolveResult.success) {
        return res.status(400).json(resolveResult);
      }

      res.json({
        success: true,
        alert: resolveResult.alert,
        message: 'Alerte résolue avec succès'
      });

    } catch (error) {
      console.error(`❌ Erreur résolution alerte ${alertId}:`, error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la résolution de l\'alerte'
      });
    }
  });

  // Régénérer un QR code pour une commande
  router.post('/regenerate-qr/:submissionId', async (req, res) => {
    try {
      const { submissionId } = req.params;
      const { admin_id } = req.body;

      console.log(`🔄 Régénération QR code pour ${submissionId} par ${admin_id}`);

      // Récupérer les infos de la commande
      const commandQuery = await pool.query(`
        SELECT 
          submission_id,
          card_name,
          customer_email,
          grading_type
        FROM grading_requests 
        WHERE submission_id = $1
      `, [submissionId]);

      if (commandQuery.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Commande non trouvée'
        });
      }

      const command = commandQuery.rows[0];

      // Régénérer le QR code
      const qrResult = await generateCompleteQRCode(submissionId, {
        card_name: command.card_name,
        customer_email: command.customer_email,
        grading_type: command.grading_type
      });

      if (!qrResult.success) {
        throw new Error(qrResult.message);
      }

      // Mettre à jour la commande
      await pool.query(`
        UPDATE grading_requests 
        SET 
          qr_code_data = $2,
          qr_code_image_path = $3,
          qr_code_generated_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE submission_id = $1
      `, [submissionId, qrResult.qr_code_data, qrResult.qr_code_image_path]);

      console.log(`✅ QR code régénéré pour ${submissionId}`);

      res.json({
        success: true,
        qr_data: qrResult,
        message: 'QR code régénéré avec succès'
      });

    } catch (error) {
      console.error(`❌ Erreur régénération QR ${submissionId}:`, error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la régénération du QR code'
      });
    }
  });

  return router;
}