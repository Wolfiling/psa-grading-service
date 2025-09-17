import express from 'express';
import { pool } from '../database/init.js';
import { PSAScraper, globalScraper } from '../services/psaScraper.js';

export function createPSARoutes() {
  const router = express.Router();

  // Endpoint public pour vérifier le statut d'une demande
  router.get('/status/:submissionId', async (req, res) => {
    try {
      const { submissionId } = req.params;

      const query = `
        SELECT 
          submission_id,
          customer_email,
          card_name,
          grading_type,
          price,
          status,
          psa_submission_number,
          psa_status,
          psa_scraping_data,
          psa_last_scraped,
          psa_received_date,
          psa_estimated_date,
          psa_completed_date,
          created_at,
          estimated_completion
        FROM grading_requests 
        WHERE submission_id = $1
      `;

      const result = await pool.query(query, [submissionId]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Demande de gradation non trouvée'
        });
      }

      const request = result.rows[0];

      // Calculer le statut global
      let globalStatus = 'submitted';
      let statusMessage = 'Demande soumise';

      if (request.psa_submission_number) {
        if (request.psa_status) {
          switch (request.psa_status.toLowerCase()) {
            case 'received':
            case 'reçu':
              globalStatus = 'received';
              statusMessage = 'Reçu par PSA';
              break;
            case 'grading':
            case 'en cours de gradation':
              globalStatus = 'grading';
              statusMessage = 'En cours de gradation';
              break;
            case 'quality assurance':
            case 'contrôle qualité':
              globalStatus = 'qa';
              statusMessage = 'Contrôle qualité';
              break;
            case 'completed':
            case 'terminé':
              globalStatus = 'completed';
              statusMessage = 'Gradation terminée';
              break;
            case 'shipped':
            case 'expédié':
              globalStatus = 'shipped';
              statusMessage = 'Expédié';
              break;
          }
        } else {
          globalStatus = 'sent_to_psa';
          statusMessage = 'Envoyé à PSA';
        }
      }

      const responseData = {
        success: true,
        submission: {
          id: request.submission_id,
          cardName: request.card_name,
          gradingType: request.grading_type,
          price: request.price,
          submittedAt: request.created_at,
          estimatedCompletion: request.estimated_completion,
          
          // Statut global
          globalStatus: globalStatus,
          statusMessage: statusMessage,
          
          // Données PSA
          psaSubmissionNumber: request.psa_submission_number,
          psaStatus: request.psa_status,
          psaLastUpdated: request.psa_last_scraped,
          psaReceivedDate: request.psa_received_date,
          psaEstimatedDate: request.psa_estimated_date,
          psaCompletedDate: request.psa_completed_date,
          
          // Données détaillées du scraping
          psaDetails: request.psa_scraping_data ? JSON.parse(request.psa_scraping_data) : null
        }
      };

      res.json(responseData);

    } catch (error) {
      console.error('Erreur lors de la récupération du statut:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération du statut'
      });
    }
  });

  // Endpoint admin pour lier une demande à un numéro PSA
  router.post('/link-submission', async (req, res) => {
    try {
      const { submissionId, psaSubmissionNumber } = req.body;

      if (!submissionId || !psaSubmissionNumber) {
        return res.status(400).json({
          success: false,
          message: 'ID de soumission et numéro PSA requis'
        });
      }

      // Mettre à jour la demande avec le numéro PSA
      const query = `
        UPDATE grading_requests 
        SET 
          psa_submission_number = $1,
          status = 'sent_to_psa',
          updated_at = CURRENT_TIMESTAMP
        WHERE submission_id = $2
        RETURNING *
      `;

      const result = await pool.query(query, [psaSubmissionNumber, submissionId]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Demande non trouvée'
        });
      }

      res.json({
        success: true,
        message: 'Numéro PSA lié avec succès',
        request: result.rows[0]
      });

    } catch (error) {
      console.error('Erreur lors de la liaison PSA:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la liaison'
      });
    }
  });

  // Endpoint admin pour forcer le scraping d'une soumission
  router.post('/force-scrape/:submissionId', async (req, res) => {
    try {
      const { submissionId } = req.params;

      // Récupérer le numéro PSA
      const query = `
        SELECT psa_submission_number, submission_id 
        FROM grading_requests 
        WHERE submission_id = $1
      `;
      
      const result = await pool.query(query, [submissionId]);

      if (result.rows.length === 0 || !result.rows[0].psa_submission_number) {
        return res.status(404).json({
          success: false,
          message: 'Demande non trouvée ou numéro PSA manquant'
        });
      }

      const psaNumber = result.rows[0].psa_submission_number;

      // Utiliser le scraper global ou créer une instance temporaire
      let scraper = globalScraper;
      let shouldClose = false;

      if (!scraper || !scraper.isLoggedIn) {
        scraper = new PSAScraper();
        await scraper.initialize();
        
        const username = process.env.PSA_USERNAME;
        const password = process.env.PSA_PASSWORD;
        
        if (!username || !password) {
          return res.status(500).json({
            success: false,
            message: 'Identifiants PSA non configurés'
          });
        }

        const loginSuccess = await scraper.loginToPSA(username, password);
        if (!loginSuccess) {
          return res.status(500).json({
            success: false,
            message: 'Échec de la connexion PSA'
          });
        }
        shouldClose = true;
      }

      // Scraper les données
      const psaData = await scraper.scrapePSASubmission(psaNumber);

      if (psaData) {
        await scraper.updatePSADataInDatabase(submissionId, psaData);
      }

      if (shouldClose) {
        await scraper.close();
      }

      res.json({
        success: true,
        message: 'Scraping effectué avec succès',
        data: psaData
      });

    } catch (error) {
      console.error('Erreur lors du scraping forcé:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors du scraping'
      });
    }
  });

  // Endpoint admin pour scraper toutes les soumissions en attente
  router.post('/scrape-all', async (req, res) => {
    try {
      // Toujours utiliser le scraper global persistent
      const scraper = globalScraper;

      if (!scraper) {
        return res.status(500).json({
          success: false,
          message: 'Scraper global PSA non disponible. Redémarrez le serveur.'
        });
      }

      // Vérifier et maintenir la connexion PSA Japan
      if (!scraper.isLoggedIn) {
        console.log('🔄 Reconnexion PSA Japan nécessaire pour scraping global...');
        
        const username = process.env.PSA_USERNAME;
        const password = process.env.PSA_PASSWORD;
        
        if (!username || !password) {
          return res.status(500).json({
            success: false,
            message: 'Identifiants PSA non configurés'
          });
        }

        const loginSuccess = await scraper.loginToPSA(username, password);
        if (!loginSuccess) {
          return res.status(500).json({
            success: false,
            message: 'Échec de la reconnexion PSA Japan'
          });
        }
        console.log('✅ Reconnexion PSA Japan réussie pour scraping global');
      } else {
        console.log('✅ Utilisation de la connexion PSA Japan existante pour scraping global');
      }

      const scrapedData = await scraper.scrapeAllPendingSubmissions();

      // Maintenir la connexion active pour les futurs scraping
      console.log('🔄 Connexion PSA Japan persistante maintenue');

      res.json({
        success: true,
        message: `${scrapedData.length} soumissions mises à jour`,
        data: scrapedData
      });

    } catch (error) {
      console.error('Erreur lors du scraping global:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors du scraping global'
      });
    }
  });

  // Endpoint pour scraper une soumission spécifique
  router.post('/scrape-submission/:submissionNumber', async (req, res) => {
    try {
      const { submissionNumber } = req.params;
      
      // Toujours utiliser le scraper global persistent
      let scraper = globalScraper;

      if (!scraper) {
        return res.status(500).json({
          success: false,
          message: 'Scraper global PSA non disponible. Redémarrez le serveur.'
        });
      }

      // Vérifier et maintenir la connexion PSA Japan
      if (!scraper.isLoggedIn) {
        console.log('🔄 Reconnexion PSA Japan nécessaire...');
        
        const username = process.env.PSA_USERNAME;
        const password = process.env.PSA_PASSWORD;
        
        if (!username || !password) {
          return res.status(500).json({
            success: false,
            message: 'Identifiants PSA non configurés'
          });
        }

        const loginSuccess = await scraper.loginToPSA(username, password);
        if (!loginSuccess) {
          return res.status(500).json({
            success: false,
            message: 'Échec de la reconnexion PSA Japan'
          });
        }
        console.log('✅ Reconnexion PSA Japan réussie');
      } else {
        console.log('✅ Utilisation de la connexion PSA Japan existante');
      }

      const psaData = await scraper.scrapePSASubmission(submissionNumber);

      // Mettre à jour toutes les commandes liées à ce numéro PSA
      if (psaData && psaData.submissionNumber) {
        await scraper.updatePSADataInDatabase(null, psaData);
      }

      // Ne jamais fermer la connexion - garder le scraper global actif
      console.log('🔄 Connexion PSA Japan maintenue active pour les prochains scraping');

      res.json({
        success: true,
        message: 'Scraping effectué avec succès',
        data: psaData
      });

    } catch (error) {
      console.error('Erreur lors du scraping de la soumission:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors du scraping de la soumission'
      });
    }
  });

  // Endpoint pour obtenir toutes les demandes avec leur statut PSA
  router.get('/all-submissions', async (req, res) => {
    try {
      const query = `
        SELECT 
          submission_id,
          customer_email,
          card_name,
          grading_type,
          status,
          psa_submission_number,
          psa_status,
          psa_last_scraped,
          created_at
        FROM grading_requests 
        ORDER BY created_at DESC
      `;

      const result = await pool.query(query);

      res.json({
        success: true,
        submissions: result.rows
      });

    } catch (error) {
      console.error('Erreur lors de la récupération des soumissions:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération'
      });
    }
  });

  return router;
}