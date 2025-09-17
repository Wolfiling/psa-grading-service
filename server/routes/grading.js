import express from 'express';
import { pool } from '../database/init.js';
import crypto from 'crypto';

export function createGradingRequestRoutes() {
  const router = express.Router();

  // Middleware to parse JSON
  router.use(express.json());

  // Get all grading requests with items count and summary
  router.get('/', async (req, res) => {
    try {
      // ✅ IMPROVEMENT: Include items count and basic multi-card support
      const result = await pool.query(`
        SELECT 
          gr.*,
          CASE 
            WHEN gr.is_multi_card = true THEN gr.items_count 
            ELSE 1 
          END as items_count,
          CASE 
            WHEN gr.is_multi_card = true THEN gr.total_price 
            ELSE gr.price 
          END as effective_price
        FROM grading_requests gr 
        ORDER BY gr.created_at DESC
      `);

      res.json({
        success: true,
        requests: result.rows,
        total_count: result.rows.length,
        multi_card_count: result.rows.filter(r => r.is_multi_card).length
      });
    } catch (error) {
      console.error('Error fetching grading requests:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch grading requests'
      });
    }
  });

  // Get single grading request with items automatically included
  router.get('/:id', async (req, res) => {
    try {
      const { id } = req.params;

      // ✅ IMPROVEMENT: Always include grading_items for unified API
      const requestResult = await pool.query(
        'SELECT * FROM grading_requests WHERE id = $1',
        [id]
      );

      if (requestResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Grading request not found'
        });
      }

      const request = requestResult.rows[0];

      // Always fetch associated items (will be empty array for single-card)
      const itemsResult = await pool.query(
        'SELECT * FROM grading_items WHERE grading_request_id = $1 ORDER BY created_at ASC',
        [id]
      );

      // ✅ UNIFIED RESPONSE: Always include items array
      const response = {
        ...request,
        items: itemsResult.rows,
        is_legacy_format: itemsResult.rows.length === 0 && !request.is_multi_card
      };

      res.json({
        success: true,
        request: response
      });
    } catch (error) {
      console.error('Error fetching grading request:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch grading request'
      });
    }
  });

  // Create new grading request (✅ UNIFIED: supports both single-card and multi-card)
  router.post('/', async (req, res) => {
    try {
      const {
        customer_email,
        grading_type,
        card_source,
        card_name,
        card_series,
        card_number,
        card_rarity,
        card_year,
        order_number,
        whatnot_username,
        live_date,
        whatnot_order_number,
        comments,
        items // ✅ NEW: Optional items array for multi-card
      } = req.body;

      // ✅ DETECTION AUTOMATIQUE: Multi-card vs Single-card
      const isMultiCard = items && Array.isArray(items) && items.length > 0;
      console.log(`📦 ${isMultiCard ? 'Multi-card' : 'Single-card'} request detected`);

      // Generate unique submission ID
      const submission_id = `PSA${Date.now()}${crypto.randomInt(1000, 9999)}`;

      // Récupérer les prix et délais depuis la base de données
      const priceQuery = await pool.query(`
        SELECT service_id, price, estimated_days 
        FROM psa_shopify_templates 
        WHERE service_id = $1 AND is_active = true
      `, [grading_type]);
      
      if (priceQuery.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: `Type de grading non configuré dans psa_shopify_templates: ${grading_type}`
        });
      }

      const serviceInfo = priceQuery.rows[0];
      const pricePerCard = parseFloat(serviceInfo.price);
      const estimatedDays = serviceInfo.estimated_days;

      const estimated_completion = new Date();
      estimated_completion.setDate(estimated_completion.getDate() + estimatedDays);

      // Nettoyer et valider les dates avant insertion
      const cleanLiveDate = live_date && live_date !== 'Invalid Date' && !live_date.includes('NaN') 
        ? new Date(live_date) 
        : null;

      if (isMultiCard) {
        // ✅ MULTI-CARD PROCESSING: Delegate to multi-card logic
        const validatedItems = items.map((item, index) => ({
          source: item.source || 'manual',
          tm_card_id: item.tm_card_id || null,
          name: item.name || `Carte ${index + 1}`,
          series: item.series || '',
          number: item.number || '',
          rarity: item.rarity || '',
          year: item.year || null,
          notes: item.notes || '',
          image_path: item.image_path || null,
          price_each: pricePerCard
        }));

        const totalPrice = validatedItems.length * pricePerCard;

        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          // Créer le grading_request principal
          const gradingResult = await client.query(`
            INSERT INTO grading_requests (
              shop_domain, customer_email, grading_type, card_source, 
              order_number, whatnot_username, live_date, whatnot_order_number, 
              comments, submission_id, estimated_completion,
              is_multi_card, items_count, total_price, price
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
            ) RETURNING *
          `, [
            'psa-grading-service.com', customer_email, grading_type, card_source || 'website',
            order_number, whatnot_username, cleanLiveDate, whatnot_order_number,
            comments, submission_id, estimated_completion,
            true, validatedItems.length, totalPrice, totalPrice
          ]);

          const gradingRequestId = gradingResult.rows[0].id;

          // Créer les grading_items
          const itemInsertPromises = validatedItems.map(item => 
            client.query(`
              INSERT INTO grading_items (
                grading_request_id, source, tm_card_id, name, series, 
                number, rarity, year, notes, image_path, price_each
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
              RETURNING *
            `, [
              gradingRequestId, item.source, item.tm_card_id, item.name, 
              item.series, item.number, item.rarity, item.year, 
              item.notes, item.image_path, item.price_each
            ])
          );

          const itemResults = await Promise.all(itemInsertPromises);
          const createdItems = itemResults.map(result => result.rows[0]);

          await client.query('COMMIT');

          console.log(`✅ Multi-card request créé: ${submission_id} (${validatedItems.length} items, ${totalPrice}€)`);

          res.json({
            success: true,
            request: {
              ...gradingResult.rows[0],
              items: createdItems
            },
            message: `Demande multi-carte créée avec succès (${validatedItems.length} cartes)`
          });

        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }

      } else {
        // ✅ SINGLE-CARD PROCESSING: Traditional single-card logic  
        const result = await pool.query(`
          INSERT INTO grading_requests (
            shop_domain, customer_email, grading_type, card_source, card_name,
            card_series, card_number, card_rarity, card_year, order_number,
            whatnot_username, live_date, whatnot_order_number, comments,
            submission_id, price, estimated_completion, is_multi_card, items_count
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
          ) RETURNING *
        `, [
          'psa-grading-service.com', customer_email, grading_type, card_source, card_name,
          card_series, card_number, card_rarity, card_year, order_number,
          whatnot_username, cleanLiveDate, whatnot_order_number, comments,
          submission_id, pricePerCard, estimated_completion, false, 1
        ]);

        console.log(`✅ Single-card request créé: ${submission_id} (${pricePerCard}€)`);

        res.json({
          success: true,
          request: {
            ...result.rows[0],
            items: [] // Empty items array for consistency
          },
          message: 'Demande single-card créée avec succès'
        });
      }
    } catch (error) {
      console.error('Error creating grading request:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create grading request'
      });
    }
  });

  // Update grading request status
  router.put('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const {
        status,
        tracking_number,
        psa_submission_number,
        comments,
        admin_override,
        override_reason
      } = req.body;

      // HOOK PRÉ-ENVOI PSA : Validation vidéo requise
      if (status === 'sent_to_psa') {
        const { validateForPSAShipment } = await import('../utils/videoValidation.js');
        
        // Récupérer submission_id pour validation
        const submissionQuery = await pool.query('SELECT submission_id FROM grading_requests WHERE id = $1', [id]);
        if (submissionQuery.rows.length === 0) {
          return res.status(404).json({
            success: false,
            message: 'Commande non trouvée'
          });
        }

        const submissionId = submissionQuery.rows[0].submission_id;
        console.log(`🔍 Validation PSA requise pour ${submissionId} (ID: ${id})`);

        // Valider la commande pour envoi PSA
        const validation = await validateForPSAShipment(submissionId);

        if (!validation.canShip && !admin_override) {
          console.log(`❌ Validation échouée pour ${submissionId}: ${validation.reason}`);
          return res.status(400).json({
            success: false,
            message: `Envoi PSA bloqué: ${validation.message}`,
            validation_failed: true,
            reason: validation.reason,
            requires_override: validation.requiresOverride,
            recommendations: validation.recommendations || []
          });
        }

        if (admin_override && validation.requiresOverride) {
          if (!override_reason || override_reason.trim().length < 10) {
            return res.status(400).json({
              success: false,
              message: 'Justification obligatoire pour override admin (minimum 10 caractères)'
            });
          }

          const { createVideoValidationOverride } = await import('../utils/videoValidation.js');
          const adminId = req.headers['admin-id'] || 'unknown-admin';
          
          const overrideResult = await createVideoValidationOverride(
            submissionId, 
            adminId, 
            override_reason, 
            'psa_shipment_override'
          );

          if (!overrideResult.success) {
            return res.status(500).json({
              success: false,
              message: `Erreur création override: ${overrideResult.message}`
            });
          }

          console.log(`✅ Override admin approuvé pour ${submissionId} par ${adminId}`);
        }

        console.log(`✅ Validation PSA réussie pour ${submissionId}`);
      }

      // Procéder à la mise à jour du statut
      const result = await pool.query(`
        UPDATE grading_requests 
        SET status = $1, tracking_number = $2, psa_submission_number = $3, 
            comments = $4, updated_at = CURRENT_TIMESTAMP
        WHERE id = $5
        RETURNING *
      `, [status, tracking_number, psa_submission_number, comments, id]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Grading request not found'
        });
      }

      res.json({
        success: true,
        request: result.rows[0],
        message: 'Grading request updated successfully',
        validation_passed: status === 'sent_to_psa'
      });
    } catch (error) {
      console.error('Error updating grading request:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update grading request'
      });
    }
  });

  // Delete grading request
  router.delete('/:id', async (req, res) => {
    try {
      const { id } = req.params;

      const result = await pool.query(
        'DELETE FROM grading_requests WHERE id = $1 RETURNING *',
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Grading request not found'
        });
      }

      res.json({
        success: true,
        message: 'Grading request deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting grading request:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete grading request'
      });
    }
  });

  // Create new multi-card grading request
  router.post('/multi-card', async (req, res) => {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      const {
        customer_email,
        grading_type,
        card_source,
        items,
        order_number,
        whatnot_username,
        live_date,
        whatnot_order_number,
        comments
      } = req.body;

      // Validation des données d'entrée
      if (!customer_email || !grading_type || !items || !Array.isArray(items)) {
        return res.status(400).json({
          success: false,
          message: 'Champs obligatoires manquants: customer_email, grading_type, items'
        });
      }

      if (items.length === 0 || items.length > 20) {
        return res.status(400).json({
          success: false,
          message: 'Nombre d\'items invalide: minimum 1, maximum 20'
        });
      }

      // Validation email
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(customer_email)) {
        return res.status(400).json({
          success: false,
          message: 'Format d\'email invalide'
        });
      }

      // Récupérer les prix et délais depuis la base de données
      const priceQuery = await client.query(`
        SELECT service_id, price, estimated_days 
        FROM psa_shopify_templates 
        WHERE service_id = $1 AND is_active = true
      `, [grading_type]);
      
      if (priceQuery.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: `Type de grading non disponible: ${grading_type}`
        });
      }

      const serviceInfo = priceQuery.rows[0];
      const pricePerCard = parseFloat(serviceInfo.price);
      const estimatedDays = serviceInfo.estimated_days;

      // ✅ VALIDATIONS DOUBLONS ET CHAMPS OBLIGATOIRES
      const tmCardIds = [];
      const cardNames = [];
      
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        // Validation nom obligatoire et longueur
        if (!item.name || typeof item.name !== 'string' || item.name.trim().length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: `Item ${i + 1}: nom obligatoire`
          });
        }
        
        if (item.name.trim().length > 200) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: `Item ${i + 1}: nom trop long (maximum 200 caractères)`
          });
        }
        
        const normalizedName = item.name.trim().toLowerCase();
        if (cardNames.includes(normalizedName)) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: `Item ${i + 1}: carte dupliquée détectée (${item.name}). Chaque carte doit être unique.`
          });
        }
        cardNames.push(normalizedName);
        
        // Validation source
        if (!item.source || !['taskmaster', 'manual'].includes(item.source)) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: `Item ${i + 1}: source doit être 'taskmaster' ou 'manual'`
          });
        }
        
        // Validation TaskMaster ID obligatoire + prévention doublons TM
        if (item.source === 'taskmaster') {
          if (!item.tm_card_id || typeof item.tm_card_id !== 'string') {
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: `Item ${i + 1}: tm_card_id obligatoire pour source TaskMaster`
            });
          }
          
          if (tmCardIds.includes(item.tm_card_id)) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: `Item ${i + 1}: tm_card_id dupliqué détecté (${item.tm_card_id}). Chaque TaskMaster ID doit être unique.`
            });
          }
          
          tmCardIds.push(item.tm_card_id);
        }
      }
      
      // Validation des items et construction
      const validatedItems = [];
      let totalPrice = 0;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        // Les validations ont déjà été faites ci-dessus
        validatedItems.push({
          source: item.source,
          tm_card_id: item.tm_card_id || null,
          name: item.name.trim(),
          series: item.series?.trim() || null,
          number: item.number?.trim() || null,
          rarity: item.rarity?.trim() || null,
          year: item.year ? parseInt(item.year) : null,
          notes: item.notes?.trim() || null,
          image_path: item.image_url?.trim() || null,
          price_each: pricePerCard
        });

        totalPrice += pricePerCard;
      }

      // Génération du submission_id unique
      const submission_id = `PSA${Date.now()}${crypto.randomInt(1000, 9999)}`;

      // Calcul de la date d'estimation
      const estimated_completion = new Date();
      estimated_completion.setDate(estimated_completion.getDate() + estimatedDays);

      // Nettoyage de la date live
      const cleanLiveDate = live_date && live_date !== 'Invalid Date' && !live_date.includes('NaN') 
        ? new Date(live_date) 
        : null;

      // Création du grading_request principal
      const gradingResult = await client.query(`
        INSERT INTO grading_requests (
          shop_domain, customer_email, grading_type, card_source, 
          order_number, whatnot_username, live_date, whatnot_order_number, 
          comments, submission_id, estimated_completion,
          is_multi_card, items_count, total_price, price
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
        ) RETURNING *
      `, [
        'psa-grading-service.com', customer_email, grading_type, card_source || 'website',
        order_number, whatnot_username, cleanLiveDate, whatnot_order_number,
        comments, submission_id, estimated_completion,
        true, items.length, totalPrice, totalPrice
      ]);

      const gradingRequestId = gradingResult.rows[0].id;

      // Création des grading_items
      const itemInsertPromises = validatedItems.map(item => 
        client.query(`
          INSERT INTO grading_items (
            grading_request_id, source, tm_card_id, name, series, 
            number, rarity, year, notes, image_path, price_each
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING *
        `, [
          gradingRequestId, item.source, item.tm_card_id, item.name, 
          item.series, item.number, item.rarity, item.year, 
          item.notes, item.image_path, item.price_each
        ])
      );

      const itemResults = await Promise.all(itemInsertPromises);
      const createdItems = itemResults.map(result => result.rows[0]);

      await client.query('COMMIT');

      // Préparation de la réponse
      const response = {
        ...gradingResult.rows[0],
        items: createdItems
      };

      console.log(`✅ Multi-card grading request créé: ${submission_id} (${items.length} items, ${totalPrice}€)`);

      res.json({
        success: true,
        request: response,
        message: `Demande multi-carte créée avec succès (${items.length} cartes)`
      });

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error creating multi-card grading request:', error);
      res.status(500).json({
        success: false,
        message: 'Échec de la création de la demande multi-carte'
      });
    } finally {
      client.release();
    }
  });

  // Get grading request with items (supports both single and multi-card)
  router.get('/:id/with-items', async (req, res) => {
    try {
      const { id } = req.params;

      // Récupérer le grading_request principal
      const requestResult = await pool.query(
        'SELECT * FROM grading_requests WHERE id = $1',
        [id]
      );

      if (requestResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Grading request not found'
        });
      }

      const request = requestResult.rows[0];

      // Récupérer les items associés (s'il y en a)
      const itemsResult = await pool.query(
        'SELECT * FROM grading_items WHERE grading_request_id = $1 ORDER BY created_at ASC',
        [id]
      );

      res.json({
        success: true,
        request: {
          ...request,
          items: itemsResult.rows
        }
      });
    } catch (error) {
      console.error('Error fetching grading request with items:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch grading request with items'
      });
    }
  });

  // Get stats
  router.get('/stats/overview', async (req, res) => {
    try {
      const stats = await pool.query(`
        SELECT 
          COUNT(*) as total_requests,
          COUNT(*) FILTER (WHERE status = 'pending') as pending_requests,
          COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress_requests,
          COUNT(*) FILTER (WHERE status = 'completed') as completed_requests,
          COALESCE(SUM(CASE WHEN is_multi_card THEN total_price ELSE price END), 0) as total_revenue,
          COUNT(*) FILTER (WHERE is_multi_card = true) as multi_card_requests,
          COALESCE(SUM(items_count), 0) as total_items_processed
        FROM grading_requests
      `);

      const gradingTypeStats = await pool.query(`
        SELECT 
          grading_type,
          COUNT(*) as count,
          COALESCE(SUM(CASE WHEN is_multi_card THEN total_price ELSE price END), 0) as revenue,
          COUNT(*) FILTER (WHERE is_multi_card = true) as multi_card_count
        FROM grading_requests 
        GROUP BY grading_type
      `);

      res.json({
        success: true,
        stats: stats.rows[0],
        grading_type_stats: gradingTypeStats.rows
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch stats'
      });
    }
  });

  return router;
}