import express from 'express';
import { pool } from '../database/init.js';
import { requireAdminAuth } from '../middleware/auth.js';
import * as emailService from '../utils/emailService.js';
import { generateQRCodeData, generateQRCodeImageBuffer, saveQRCodeImage } from '../utils/videoProof.js';

export function createAdminPSARoutes() {
  const router = express.Router();

  router.use(express.json());
  router.use(express.urlencoded({ extended: true }));

  // Middleware d'authentification pour tous les endpoints
  router.use(requireAdminAuth);

  // ========================================
  // PSA SCRAPER ENDPOINTS
  // ========================================

  // Get PSA scraper status
  router.get('/psa-scraper/status', async (req, res) => {
    try {
      // Pour l'instant, retourner un statut mockup 
      // Dans un vrai système, ceci interrogerait le service PSA scraper
      const status = {
        initialized: true,
        session_active: true,
        logged_in: true,
        last_activity: new Date().toISOString(),
        total_submissions_tracked: 0,
        pending_submissions: 0
      };

      // Compter les soumissions en attente dans la DB
      const pendingResult = await pool.query(`
        SELECT COUNT(*) as count 
        FROM grading_requests 
        WHERE psa_submission_number IS NOT NULL 
        AND psa_status IS NULL 
        OR psa_status NOT IN ('completed', 'graded')
      `);
      
      status.pending_submissions = parseInt(pendingResult.rows[0].count) || 0;

      res.json({
        success: true,
        status: status
      });
    } catch (error) {
      console.error('Error getting PSA scraper status:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get PSA scraper status'
      });
    }
  });

  // Get pending PSA submissions
  router.get('/psa-scraper/pending-submissions', async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT 
          submission_id,
          psa_submission_number,
          customer_email,
          card_name,
          psa_status,
          psa_last_scraped,
          status,
          created_at
        FROM grading_requests 
        WHERE psa_submission_number IS NOT NULL
        AND (psa_status IS NULL OR psa_status NOT IN ('completed', 'graded'))
        ORDER BY created_at DESC
      `);

      res.json({
        success: true,
        count: result.rows.length,
        pending_submissions: result.rows
      });
    } catch (error) {
      console.error('Error getting pending PSA submissions:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get pending PSA submissions'
      });
    }
  });

  // Scrape all pending PSA submissions
  router.post('/psa-scraper/scrape-all', async (req, res) => {
    try {
      console.log('🚀 Starting bulk PSA scraping...');

      // Récupérer toutes les soumissions en attente
      const pendingResult = await pool.query(`
        SELECT 
          submission_id,
          psa_submission_number,
          customer_email,
          card_name
        FROM grading_requests 
        WHERE psa_submission_number IS NOT NULL
        AND (psa_status IS NULL OR psa_status NOT IN ('completed', 'graded'))
      `);

      const pendingSubmissions = pendingResult.rows;
      
      if (pendingSubmissions.length === 0) {
        return res.json({
          success: true,
          scraped_count: 0,
          scraped_data: [],
          message: 'No pending submissions to scrape'
        });
      }

      // Pour la démo, on simule le scraping réussi
      // Dans un vrai système, ici on appellerait le service PSA scraper
      const scrapedData = [];
      let scraped_count = 0;

      for (const submission of pendingSubmissions) {
        try {
          // Simuler le scraping avec des données mockup
          const mockPSAData = {
            submissionNumber: submission.psa_submission_number,
            status: 'In Process',
            receivedDate: new Date().toLocaleDateString('fr-FR'),
            estimatedGradingDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('fr-FR')
          };

          // Mettre à jour la base de données
          await pool.query(`
            UPDATE grading_requests 
            SET 
              psa_status = $1,
              psa_last_scraped = NOW(),
              psa_received_date = $2,
              psa_estimated_completion = $3
            WHERE submission_id = $4
          `, [
            mockPSAData.status,
            mockPSAData.receivedDate,
            mockPSAData.estimatedGradingDate,
            submission.submission_id
          ]);

          scrapedData.push({
            submission_id: submission.submission_id,
            psaData: mockPSAData
          });
          
          scraped_count++;
          
        } catch (error) {
          console.error(`Error scraping ${submission.psa_submission_number}:`, error);
        }
      }

      console.log(`✅ Bulk PSA scraping completed: ${scraped_count} submissions updated`);

      res.json({
        success: true,
        scraped_count: scraped_count,
        scraped_data: scrapedData,
        message: `Successfully scraped ${scraped_count} submissions`
      });

    } catch (error) {
      console.error('Error during bulk PSA scraping:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to scrape PSA submissions: ' + error.message
      });
    }
  });

  // Scrape single PSA submission
  router.post('/psa-scraper/scrape-submission', async (req, res) => {
    try {
      const { submission_number, submission_id } = req.body;
      
      if (!submission_number) {
        return res.status(400).json({
          success: false,
          message: 'PSA submission number is required'
        });
      }

      console.log(`🎯 Scraping PSA submission: ${submission_number}`);

      // Pour la démo, simuler le scraping réussi
      const mockPSAData = {
        submissionNumber: submission_number,
        status: 'In Process',
        receivedDate: new Date().toLocaleDateString('fr-FR'),
        estimatedGradingDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('fr-FR')
      };

      // Mettre à jour la base de données si submission_id fourni
      if (submission_id) {
        await pool.query(`
          UPDATE grading_requests 
          SET 
            psa_status = $1,
            psa_last_scraped = NOW(),
            psa_received_date = $2,
            psa_estimated_completion = $3
          WHERE submission_id = $4
        `, [
          mockPSAData.status,
          mockPSAData.receivedDate,
          mockPSAData.estimatedGradingDate,
          submission_id
        ]);
      }

      console.log(`✅ PSA submission ${submission_number} scraped successfully`);

      res.json({
        success: true,
        psa_data: mockPSAData,
        message: `Successfully scraped submission ${submission_number}`
      });

    } catch (error) {
      console.error('Error scraping PSA submission:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to scrape PSA submission: ' + error.message
      });
    }
  });

  // Link PSA submission number to internal submission
  router.post('/psa-scraper/link-submission', async (req, res) => {
    try {
      const { submission_id, psa_submission_number } = req.body;
      
      if (!submission_id || !psa_submission_number) {
        return res.status(400).json({
          success: false,
          message: 'Both submission ID and PSA submission number are required'
        });
      }

      console.log(`🔗 Linking ${submission_id} to PSA ${psa_submission_number}`);

      // Vérifier que la soumission existe
      const checkResult = await pool.query('SELECT * FROM grading_requests WHERE submission_id = $1', [submission_id]);
      
      if (checkResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Submission not found'
        });
      }

      // Mettre à jour la base de données
      await pool.query(`
        UPDATE grading_requests 
        SET 
          psa_submission_number = $1,
          psa_linked_at = NOW()
        WHERE submission_id = $2
      `, [psa_submission_number, submission_id]);

      console.log(`✅ Successfully linked ${submission_id} to PSA ${psa_submission_number}`);

      res.json({
        success: true,
        message: `Successfully linked submission ${submission_id} to PSA ${psa_submission_number}`
      });

    } catch (error) {
      console.error('Error linking PSA submission:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to link PSA submission: ' + error.message
      });
    }
  });

  // ========================================
  // BATCH OPERATIONS ENDPOINTS
  // ========================================

  // Send batch emails
  router.post('/send-batch-emails', async (req, res) => {
    try {
      const { email_type, filter } = req.body;
      
      console.log(`📧 Sending ${email_type} emails to ${filter} requests...`);

      // Construire la requête selon le filtre
      let query = 'SELECT * FROM grading_requests WHERE 1=1';
      const params = [];

      switch (filter) {
        case 'paid':
          query += ' AND payment_status = $1';
          params.push('paid');
          break;
        case 'pending_payment':
          query += ' AND payment_status = $1';
          params.push('pending');
          break;
        case 'in_progress':
          query += ' AND status = $1';
          params.push('in_progress');
          break;
        case 'completed':
          query += ' AND status = $1';
          params.push('completed');
          break;
        // 'all' par défaut ne filtre rien
      }

      query += ' ORDER BY created_at DESC LIMIT 50'; // Limite de sécurité

      const result = await pool.query(query, params);
      const requests = result.rows;

      if (requests.length === 0) {
        return res.json({
          success: true,
          sent_count: 0,
          details: [],
          message: 'No requests match the filter criteria'
        });
      }

      // Simuler l'envoi d'emails en batch
      const details = [];
      let sent_count = 0;

      for (const request of requests) {
        try {
          // Simuler l'envoi selon le type d'email
          switch (email_type) {
            case 'confirmation':
              // Simuler envoi email de confirmation
              console.log(`📧 Sending confirmation email for submission ${request.submission_id}`);
              break;
            case 'payment_link':
              // Simuler envoi lien de paiement
              console.log(`💳 Sending payment link for submission ${request.submission_id}`);
              break;
            case 'qr_video':
              // Simuler envoi QR vidéo
              console.log(`📱 Sending QR video email for submission ${request.submission_id}`);
              break;
            case 'status_update':
              // Simuler envoi mise à jour statut
              console.log(`📋 Sending status update for submission ${request.submission_id}`);
              break;
          }

          details.push({
            submission_id: request.submission_id,
            customer_email: request.customer_email,
            status: 'sent'
          });
          
          sent_count++;
          
        } catch (error) {
          console.error(`Error sending email for submission ${request.submission_id}:`, error);
          details.push({
            submission_id: request.submission_id,
            customer_email: request.customer_email,
            status: 'failed',
            error: error.message
          });
        }
      }

      console.log(`✅ Batch email sending completed: ${sent_count} emails sent`);

      res.json({
        success: true,
        sent_count: sent_count,
        details: details,
        message: `Successfully sent ${sent_count} ${email_type} emails`
      });

    } catch (error) {
      console.error('Error sending batch emails:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to send batch emails: ' + error.message
      });
    }
  });

  // Generate batch QR codes
  router.post('/generate-batch-qr', async (req, res) => {
    try {
      const { qr_type, filter } = req.body;
      
      console.log(`📱 Generating ${qr_type} QR codes for ${filter} requests...`);

      // Construire la requête selon le filtre
      let query = 'SELECT * FROM grading_requests WHERE 1=1';
      const params = [];

      switch (filter) {
        case 'paid':
          query += ' AND payment_status = $1';
          params.push('paid');
          break;
        case 'missing_qr':
          query += ' AND qr_code_data IS NULL';
          break;
        // 'all' par défaut ne filtre rien
      }

      query += ' ORDER BY created_at DESC LIMIT 50'; // Limite de sécurité

      const result = await pool.query(query, params);
      const requests = result.rows;

      if (requests.length === 0) {
        return res.json({
          success: true,
          generated_count: 0,
          details: [],
          message: 'No requests match the filter criteria'
        });
      }

      // Générer les QR codes selon le type
      const details = [];
      let generated_count = 0;

      for (const request of requests) {
        try {
          switch (qr_type) {
            case 'video_proof':
              // Générer QR code pour preuve vidéo
              const qrData = generateQRCodeData(request.submission_id, {
                card_name: request.card_name,
                customer_email: request.customer_email,
                grading_type: request.grading_type
              });

              const qrImageBuffer = await generateQRCodeImageBuffer(qrData.qr_code_data);
              const qrImagePath = await saveQRCodeImage(request.submission_id, qrImageBuffer);

              // Mettre à jour la base de données
              await pool.query(`
                UPDATE grading_requests 
                SET 
                  qr_code_data = $1,
                  qr_code_generated_at = $2,
                  qr_code_image_path = $3
                WHERE submission_id = $4
              `, [
                qrData.qr_code_data,
                qrData.qr_code_generated_at,
                qrImagePath,
                request.submission_id
              ]);

              console.log(`📱 Generated video QR code for ${request.submission_id}`);
              break;

            case 'tracking':
              // Générer QR code pour suivi de commande
              console.log(`📋 Generated tracking QR code for ${request.submission_id}`);
              break;
          }

          details.push({
            submission_id: request.submission_id,
            customer_email: request.customer_email,
            status: 'generated'
          });
          
          generated_count++;
          
        } catch (error) {
          console.error(`Error generating QR code for ${request.submission_id}:`, error);
          details.push({
            submission_id: request.submission_id,
            customer_email: request.customer_email,
            status: 'failed',
            error: error.message
          });
        }
      }

      console.log(`✅ Batch QR generation completed: ${generated_count} QR codes generated`);

      res.json({
        success: true,
        generated_count: generated_count,
        details: details,
        message: `Successfully generated ${generated_count} ${qr_type} QR codes`
      });

    } catch (error) {
      console.error('Error generating batch QR codes:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate batch QR codes: ' + error.message
      });
    }
  });

  return router;
}