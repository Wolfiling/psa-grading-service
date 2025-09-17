import express from 'express';
import { pool } from '../database/init.js';
import { requireAdminAuth, adminLogin, adminLogout, adminStatus } from '../middleware/auth.js';
import { createCustomerInvitationToken, validateCustomerInvitationToken } from '../utils/clientAuth.js';
import { sendEmail } from '../utils/emailService.js';

export function createAdminRoutes() {
  const router = express.Router();

  router.use(express.json());
  router.use(express.urlencoded({ extended: true }));

  // ========================================
  // ENDPOINTS D'AUTHENTIFICATION (publics)
  // ========================================

  // Login admin
  router.post('/login', adminLogin);

  // Logout admin
  router.post('/logout', adminLogout);

  // Vérifier le statut de la session
  router.get('/status', adminStatus);

  // ========================================
  // ENDPOINTS PROTÉGÉS PAR AUTHENTIFICATION
  // ========================================

  // Middleware d'authentification pour tous les endpoints suivants
  router.use(requireAdminAuth);

  // API endpoint to get pending payments stats
  router.get('/pending-payments-stats', async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT COUNT(DISTINCT customer_email) as count
        FROM grading_requests 
        WHERE payment_status = 'pending' 
        AND created_at >= CURRENT_DATE - INTERVAL '30 days'
      `);

      res.json({
        success: true,
        count: parseInt(result.rows[0].count) || 0
      });
    } catch (error) {
      console.error('Error getting pending payments stats:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get pending payments stats'
      });
    }
  });

  // API endpoint to get pending payments list
  router.get('/pending-payments', async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT submission_id, customer_email, grading_type, card_name, card_series, price, created_at, estimated_completion, payment_status
        FROM grading_requests 
        WHERE payment_status = 'pending' 
        ORDER BY created_at DESC
      `);

      res.json({
        success: true,
        requests: result.rows
      });
    } catch (error) {
      console.error('Error getting pending payments:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get pending payments'
      });
    }
  });

  // API endpoint to send payment link via email
  router.post('/send-payment-link', async (req, res) => {
    try {
      const { customer_email, requests } = req.body;

      if (!customer_email || !requests || !Array.isArray(requests) || requests.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Email and requests data required'
        });
      }

      // Créer un checkout instantané d'abord
      const firstRequest = requests[0];
      const totalPrice = requests.reduce((sum, req) => sum + parseFloat(req.price || 0), 0);
      
      try {
        const checkoutResponse = await fetch(`${req.protocol}://${req.get('host')}/api/shopify/create-instant-checkout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            template_id: firstRequest.grading_type,
            customer_info: {
              email: customer_email,
              first_name: customer_email.split('@')[0] || 'Client',
              last_name: 'PSA'
            },
            card_details: {
              name: firstRequest.card_name || 'Carte Pokémon',
              series: firstRequest.card_series || '',
              submission_id: firstRequest.submission_id
            }
          })
        });

        const checkoutData = await checkoutResponse.json();

        if (!checkoutData.success || !checkoutData.checkout_url) {
          throw new Error('Failed to create checkout: ' + (checkoutData.message || 'Unknown error'));
        }

        // Envoyer l'email avec le lien de paiement (service unifié avec fallback Brevo → replitmail)
        const { sendPaymentLinkEmail } = await import('../utils/emailService.js');

        const cards = requests.map(req => ({
          name: req.card_name || 'Carte',
          series: req.card_series || ''
        }));

        const paymentDetails = {
          checkout_url: checkoutData.checkout_url,
          submission_ids: requests.map(req => req.submission_id),
          cards: cards,
          grading_type: firstRequest.grading_type,
          total_price: totalPrice
        };

        console.log('📧 Envoi lien de paiement pour soumission:', firstRequest.submission_id);
        
        const emailResult = await sendPaymentLinkEmail(customer_email, paymentDetails);
        
        console.log('✅ Email lien de paiement envoyé - ID:', emailResult.messageId);

        res.json({
          success: true,
          checkout_url: checkoutData.checkout_url,
          email_sent: true,
          message: `Lien de paiement envoyé avec succès à ${customer_email}`
        });

      } catch (checkoutError) {
        console.error('❌ Erreur création checkout pour email:', checkoutError);
        res.status(500).json({
          success: false,
          message: 'Failed to create payment link: ' + checkoutError.message
        });
      }

    } catch (error) {
      console.error('Error sending payment link:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to send payment link: ' + error.message
      });
    }
  });

  // API endpoint to get all grading requests (admin view)
  router.get('/grading-requests', async (req, res) => {
    try {
      const { status, grading_type, search, page = 1, limit = 50 } = req.query;
      
      let query = 'SELECT * FROM grading_requests WHERE 1=1';
      const queryParams = [];
      let paramCount = 0;

      // Filtres
      if (status) {
        paramCount++;
        query += ` AND status = $${paramCount}`;
        queryParams.push(status);
      }

      if (grading_type) {
        paramCount++;
        query += ` AND grading_type = $${paramCount}`;
        queryParams.push(grading_type);
      }

      if (search) {
        paramCount++;
        query += ` AND (card_name ILIKE $${paramCount} OR customer_email ILIKE $${paramCount} OR submission_id ILIKE $${paramCount})`;
        queryParams.push(`%${search}%`);
      }

      // Pagination
      query += ' ORDER BY created_at DESC';
      
      const offset = (parseInt(page) - 1) * parseInt(limit);
      paramCount++;
      query += ` LIMIT $${paramCount}`;
      queryParams.push(parseInt(limit));
      
      paramCount++;
      query += ` OFFSET $${paramCount}`;
      queryParams.push(offset);

      const result = await pool.query(query, queryParams);

      // Compter le total pour la pagination
      let countQuery = 'SELECT COUNT(*) FROM grading_requests WHERE 1=1';
      const countParams = [];
      let countParamCount = 0;

      if (status) {
        countParamCount++;
        countQuery += ` AND status = $${countParamCount}`;
        countParams.push(status);
      }

      if (grading_type) {
        countParamCount++;
        countQuery += ` AND grading_type = $${countParamCount}`;
        countParams.push(grading_type);
      }

      if (search) {
        countParamCount++;
        countQuery += ` AND (card_name ILIKE $${countParamCount} OR customer_email ILIKE $${countParamCount} OR submission_id ILIKE $${countParamCount})`;
        countParams.push(`%${search}%`);
      }

      const countResult = await pool.query(countQuery, countParams);
      const totalRequests = parseInt(countResult.rows[0].count);

      res.json({
        success: true,
        requests: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalRequests,
          totalPages: Math.ceil(totalRequests / parseInt(limit))
        }
      });
    } catch (error) {
      console.error('Error fetching admin grading requests:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch grading requests'
      });
    }
  });

  // API endpoint to get dashboard statistics
  router.get('/stats', async (req, res) => {
    try {
      // Statistiques générales
      const totalResult = await pool.query('SELECT COUNT(*) as count FROM grading_requests');
      const pendingResult = await pool.query("SELECT COUNT(*) as count FROM grading_requests WHERE status = 'pending'");
      const progressResult = await pool.query("SELECT COUNT(*) as count FROM grading_requests WHERE status = 'in_progress'");
      const completedResult = await pool.query("SELECT COUNT(*) as count FROM grading_requests WHERE status = 'completed'");
      
      // Revenus totaux
      const revenueResult = await pool.query("SELECT SUM(price) as total FROM grading_requests WHERE status != 'cancelled'");
      
      // Paiements en attente
      const pendingPaymentsResult = await pool.query(`
        SELECT COUNT(DISTINCT customer_email) as count
        FROM grading_requests 
        WHERE payment_status = 'pending' 
        AND created_at >= CURRENT_DATE - INTERVAL '30 days'
      `);

      res.json({
        success: true,
        stats: {
          total: parseInt(totalResult.rows[0].count) || 0,
          pending: parseInt(pendingResult.rows[0].count) || 0,
          in_progress: parseInt(progressResult.rows[0].count) || 0,
          completed: parseInt(completedResult.rows[0].count) || 0,
          total_revenue: parseFloat(revenueResult.rows[0].total) || 0,
          pending_payments: parseInt(pendingPaymentsResult.rows[0].count) || 0
        }
      });
    } catch (error) {
      console.error('Error getting admin stats:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get statistics'
      });
    }
  });

  // API endpoint to get a single grading request (for details modal)
  router.get('/grading-requests/:id', async (req, res) => {
    try {
      const { id } = req.params;

      const result = await pool.query(
        'SELECT * FROM grading_requests WHERE submission_id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Request not found'
        });
      }

      res.json({
        success: true,
        request: result.rows[0]
      });
    } catch (error) {
      console.error('Error fetching single grading request:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch grading request'
      });
    }
  });

  // API endpoint to update request status
  router.put('/grading-requests/:id/status', async (req, res) => {
    try {
      const { id } = req.params;
      const { status, tracking_number, comments } = req.body;

      if (!status) {
        return res.status(400).json({
          success: false,
          message: 'Status is required'
        });
      }

      let updateQuery = 'UPDATE grading_requests SET status = $1, updated_at = CURRENT_TIMESTAMP';
      const queryParams = [status];
      let paramCount = 1;

      if (tracking_number) {
        paramCount++;
        updateQuery += `, tracking_number = $${paramCount}`;
        queryParams.push(tracking_number);
      }

      if (comments) {
        paramCount++;
        updateQuery += `, comments = $${paramCount}`;
        queryParams.push(comments);
      }

      paramCount++;
      updateQuery += ` WHERE id = $${paramCount} RETURNING *`;
      queryParams.push(id);

      const result = await pool.query(updateQuery, queryParams);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Grading request not found'
        });
      }

      console.log(`✅ Request ${id} status updated to ${status} by admin`);

      res.json({
        success: true,
        request: result.rows[0],
        message: 'Status updated successfully'
      });
    } catch (error) {
      console.error('Error updating request status:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update request status'
      });
    }
  });

  // API endpoint to delete a grading request
  router.delete('/grading-requests/:id', async (req, res) => {
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

      console.log(`🗑️ Request ${id} deleted by admin`);

      res.json({
        success: true,
        message: 'Request deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting request:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete request'
      });
    }
  });

  // ========================================
  // PSA SCRAPER INTEGRATION ROUTES
  // ========================================

  // Import PSA scraper at runtime to avoid circular dependencies
  let psaScraperInstance = null;
  
  const getPSAScraperInstance = async () => {
    if (!psaScraperInstance) {
      const { globalScraper } = await import('../services/psaScraper.js');
      psaScraperInstance = globalScraper;
    }
    return psaScraperInstance;
  };

  // Get PSA scraper status
  router.get('/psa-scraper/status', async (req, res) => {
    try {
      const scraper = await getPSAScraperInstance();
      
      const status = {
        initialized: !!scraper.browser,
        logged_in: scraper.isLoggedIn,
        last_activity: new Date().toISOString(),
        session_active: false
      };

      // Check session if logged in
      if (scraper.isLoggedIn) {
        try {
          status.session_active = await scraper.checkSessionActive();
        } catch (error) {
          status.session_active = false;
          status.error = error.message;
        }
      }

      res.json({
        success: true,
        status: status
      });
    } catch (error) {
      console.error('Error getting PSA scraper status:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get scraper status',
        error: error.message
      });
    }
  });

  // Scrape all pending PSA submissions
  router.post('/psa-scraper/scrape-all', async (req, res) => {
    try {
      console.log(`🚀 Admin initiating bulk PSA scrape`);
      
      const scraper = await getPSAScraperInstance();
      
      // Ensure active session
      await scraper.ensureActiveSession();
      
      // Start the scraping process
      const scrapedData = await scraper.scrapeAllPendingSubmissions();
      
      console.log(`✅ Bulk PSA scrape completed: ${scrapedData.length} submissions updated`);
      
      res.json({
        success: true,
        message: `Successfully scraped ${scrapedData.length} submissions`,
        scraped_count: scrapedData.length,
        scraped_data: scrapedData
      });
    } catch (error) {
      console.error('❌ Error during bulk PSA scrape:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to scrape PSA submissions',
        error: error.message
      });
    }
  });

  // Scrape specific PSA submission
  router.post('/psa-scraper/scrape-submission', async (req, res) => {
    try {
      const { submission_number, submission_id } = req.body;
      
      if (!submission_number) {
        return res.status(400).json({
          success: false,
          message: 'Submission number is required'
        });
      }

      console.log(`🎯 Admin scraping PSA submission: ${submission_number}`);
      
      const scraper = await getPSAScraperInstance();
      
      // Ensure active session
      await scraper.ensureActiveSession();
      
      // Scrape the specific submission
      const psaData = await scraper.scrapePSASubmission(submission_number);
      
      if (psaData) {
        // Update database if submission_id provided
        if (submission_id) {
          await scraper.updatePSADataInDatabase(submission_id, psaData);
        }
        
        console.log(`✅ PSA submission ${submission_number} scraped successfully`);
        
        res.json({
          success: true,
          message: `Successfully scraped submission ${submission_number}`,
          psa_data: psaData
        });
      } else {
        res.status(404).json({
          success: false,
          message: `No data found for submission ${submission_number}`
        });
      }
    } catch (error) {
      console.error(`❌ Error scraping PSA submission:`, error);
      res.status(500).json({
        success: false,
        message: 'Failed to scrape PSA submission',
        error: error.message
      });
    }
  });

  // Link submission to PSA number and update status
  router.post('/psa-scraper/link-submission', async (req, res) => {
    try {
      const { submission_id, psa_submission_number } = req.body;
      
      if (!submission_id || !psa_submission_number) {
        return res.status(400).json({
          success: false,
          message: 'Submission ID and PSA submission number are required'
        });
      }

      console.log(`🔗 Admin linking ${submission_id} to PSA ${psa_submission_number}`);
      
      // Update database with PSA number
      const updateQuery = `
        UPDATE grading_requests 
        SET 
          psa_submission_number = $1,
          status = 'sent_to_psa',
          updated_at = CURRENT_TIMESTAMP
        WHERE submission_id = $2
        RETURNING *
      `;
      
      const result = await pool.query(updateQuery, [psa_submission_number, submission_id]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Submission not found'
        });
      }

      // Try to scrape immediately
      try {
        const scraper = await getPSAScraperInstance();
        await scraper.ensureActiveSession();
        
        const psaData = await scraper.scrapePSASubmission(psa_submission_number);
        if (psaData) {
          await scraper.updatePSADataInDatabase(submission_id, psaData);
          console.log(`✅ PSA data immediately scraped for ${psa_submission_number}`);
        }
      } catch (scrapeError) {
        console.log(`⚠️ Could not immediately scrape PSA data: ${scrapeError.message}`);
      }
      
      res.json({
        success: true,
        message: `Successfully linked submission to PSA number ${psa_submission_number}`,
        request: result.rows[0]
      });
    } catch (error) {
      console.error('Error linking PSA submission:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to link PSA submission',
        error: error.message
      });
    }
  });

  // Get PSA submissions that need attention
  router.get('/psa-scraper/pending-submissions', async (req, res) => {
    try {
      const query = `
        SELECT 
          submission_id,
          psa_submission_number,
          customer_email,
          card_name,
          status,
          psa_status,
          psa_last_scraped,
          created_at
        FROM grading_requests 
        WHERE psa_submission_number IS NOT NULL 
        AND psa_submission_number != ''
        AND (psa_last_scraped IS NULL OR psa_last_scraped < CURRENT_TIMESTAMP - INTERVAL '6 hours')
        ORDER BY created_at DESC
        LIMIT 50
      `;
      
      const result = await pool.query(query);
      
      res.json({
        success: true,
        pending_submissions: result.rows,
        count: result.rows.length
      });
    } catch (error) {
      console.error('Error getting pending PSA submissions:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get pending submissions',
        error: error.message
      });
    }
  });

  // ========================================
  // EMAIL SYSTEM INTEGRATION ROUTES
  // ========================================

  // Send confirmation email to specific request
  router.post('/email/send-confirmation', async (req, res) => {
    try {
      const { submission_id } = req.body;
      
      if (!submission_id) {
        return res.status(400).json({
          success: false,
          message: 'Submission ID is required'
        });
      }

      console.log(`📧 Admin sending confirmation email for ${submission_id}`);
      
      // Get request details
      const requestQuery = `
        SELECT 
          customer_email, card_name, card_series, grading_type, 
          price, estimated_completion, submission_id
        FROM grading_requests 
        WHERE submission_id = $1
      `;
      
      const requestResult = await pool.query(requestQuery, [submission_id]);
      
      if (requestResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Request not found'
        });
      }
      
      const request = requestResult.rows[0];
      const { sendPSARequestNotification } = await import('../utils/brevo.js');
      
      const emailData = {
        submission_ids: [request.submission_id],
        cards: [{
          name: request.card_name,
          series: request.card_series || ''
        }],
        grading_type: request.grading_type,
        total_price: request.price,
        estimated_completion: request.estimated_completion,
        payment_option: 'immediate'
      };
      
      const emailResult = await sendPSARequestNotification(request.customer_email, emailData);
      
      console.log(`✅ Confirmation email sent - ID:`, emailResult.messageId);
      
      res.json({
        success: true,
        message: `Email de confirmation envoyé à ${request.customer_email}`,
        email_id: emailResult.messageId
      });
      
    } catch (error) {
      console.error('Error sending confirmation email:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to send confirmation email',
        error: error.message
      });
    }
  });

  // Send QR code email for video proof
  router.post('/email/send-qr-video', async (req, res) => {
    try {
      const { submission_id } = req.body;
      
      if (!submission_id) {
        return res.status(400).json({
          success: false,
          message: 'Submission ID is required'
        });
      }

      console.log(`📱 Admin sending QR video email for ${submission_id}`);
      
      // Get request details and generate QR if needed
      const requestQuery = `
        SELECT 
          customer_email, card_name, card_series, submission_id,
          qr_code_data, qr_code_image_path
        FROM grading_requests 
        WHERE submission_id = $1
      `;
      
      const requestResult = await pool.query(requestQuery, [submission_id]);
      
      if (requestResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Request not found'
        });
      }
      
      const request = requestResult.rows[0];
      
      // Generate QR code if not exists
      let qrData = request.qr_code_data;
      if (!qrData) {
        const { generateQRCodeData } = await import('../utils/videoProof.js');
        qrData = generateQRCodeData(submission_id, {
          card_name: request.card_name,
          card_series: request.card_series
        });
        
        // Update database with QR data
        await pool.query(
          `UPDATE grading_requests 
           SET qr_code_data = $1, qr_code_generated_at = CURRENT_TIMESTAMP 
           WHERE submission_id = $2`,
          [JSON.stringify(qrData), submission_id]
        );
      } else {
        qrData = JSON.parse(qrData);
      }
      
      // Send QR code email (this would use the email template for QR)
      const { sendPSARequestNotification } = await import('../utils/brevo.js');
      
      const emailData = {
        submission_ids: [request.submission_id],
        cards: [{
          name: request.card_name,
          series: request.card_series || ''
        }],
        qr_code_url: qrData.recording_url,
        video_instructions: true
      };
      
      // For now, send confirmation with QR info
      const emailResult = await sendPSARequestNotification(request.customer_email, emailData);
      
      console.log(`✅ QR video email sent - ID:`, emailResult.messageId);
      
      res.json({
        success: true,
        message: `Email QR code vidéo envoyé à ${request.customer_email}`,
        email_id: emailResult.messageId,
        qr_data: qrData
      });
      
    } catch (error) {
      console.error('Error sending QR video email:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to send QR video email',
        error: error.message
      });
    }
  });

  // Send bulk emails based on filters
  router.post('/email/send-bulk', async (req, res) => {
    try {
      const { email_type, status_filter, grading_type_filter } = req.body;
      
      if (!email_type) {
        return res.status(400).json({
          success: false,
          message: 'Email type is required'
        });
      }

      console.log(`📧 Admin sending bulk emails: ${email_type} for ${status_filter || 'all'}`);
      
      // Build query based on filters
      let query = 'SELECT * FROM grading_requests WHERE 1=1';
      const queryParams = [];
      let paramCount = 0;

      if (status_filter && status_filter !== 'all') {
        paramCount++;
        query += ` AND status = $${paramCount}`;
        queryParams.push(status_filter);
      }

      if (grading_type_filter && grading_type_filter !== 'all') {
        paramCount++;
        query += ` AND grading_type = $${paramCount}`;
        queryParams.push(grading_type_filter);
      }

      query += ' ORDER BY created_at DESC LIMIT 100';
      
      const result = await pool.query(query, queryParams);
      const requests = result.rows;
      
      if (requests.length === 0) {
        return res.json({
          success: true,
          message: 'Aucune demande trouvée avec les filtres spécifiés',
          sent_count: 0
        });
      }

      // Group by customer email to avoid spam
      const emailGroups = {};
      requests.forEach(req => {
        if (!emailGroups[req.customer_email]) {
          emailGroups[req.customer_email] = [];
        }
        emailGroups[req.customer_email].push(req);
      });

      let sentCount = 0;
      const { sendPSARequestNotification } = await import('../utils/brevo.js');
      
      for (const [email, customerRequests] of Object.entries(emailGroups)) {
        try {
          const emailData = {
            submission_ids: customerRequests.map(r => r.submission_id),
            cards: customerRequests.map(r => ({
              name: r.card_name,
              series: r.card_series || ''
            })),
            grading_type: customerRequests[0].grading_type,
            total_price: customerRequests.reduce((sum, r) => sum + parseFloat(r.price || 0), 0),
            estimated_completion: customerRequests[0].estimated_completion,
            payment_option: 'immediate'
          };
          
          await sendPSARequestNotification(email, emailData);
          sentCount++;
          
          // Small delay to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 500));
          
        } catch (emailError) {
          console.error(`❌ Failed to send email to ${email}:`, emailError);
        }
      }
      
      console.log(`✅ Bulk emails sent: ${sentCount} recipients`);
      
      res.json({
        success: true,
        message: `Emails envoyés avec succès à ${sentCount} destinataires`,
        sent_count: sentCount,
        total_requests: requests.length
      });
      
    } catch (error) {
      console.error('Error sending bulk emails:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to send bulk emails',
        error: error.message
      });
    }
  });

  // Get email sending stats/history
  router.get('/email/stats', async (req, res) => {
    try {
      // This would typically query email logs if we had them
      // For now, return basic stats
      const stats = {
        emails_sent_today: 0,
        emails_sent_week: 0,
        last_email_sent: null,
        pending_notifications: 0
      };
      
      res.json({
        success: true,
        stats: stats
      });
    } catch (error) {
      console.error('Error getting email stats:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get email stats',
        error: error.message
      });
    }
  });

  // ========================================
  // VIDEO SYSTEM INTEGRATION ROUTES  
  // ========================================

  // Generate QR codes for requests
  router.post('/video/generate-qr-codes', async (req, res) => {
    try {
      const { status_filter, force_regenerate = false } = req.body;
      
      console.log(`📱 Admin generating QR codes for ${status_filter || 'all'} requests`);
      
      // Build query for requests that need QR codes
      let query = `
        SELECT submission_id, customer_email, card_name, card_series, status, qr_code_data
        FROM grading_requests 
        WHERE 1=1
      `;
      const queryParams = [];
      let paramCount = 0;

      if (status_filter && status_filter !== 'all') {
        paramCount++;
        query += ` AND status = $${paramCount}`;
        queryParams.push(status_filter);
      }

      if (!force_regenerate) {
        query += ' AND (qr_code_data IS NULL OR qr_code_data = \'\')';
      }

      query += ' ORDER BY created_at DESC LIMIT 50';
      
      const result = await pool.query(query, queryParams);
      const requests = result.rows;
      
      if (requests.length === 0) {
        return res.json({
          success: true,
          message: 'Aucune demande nécessitant de QR code trouvée',
          generated_count: 0
        });
      }

      const { generateQRCodeData } = await import('../utils/videoProof.js');
      let generatedCount = 0;
      
      for (const request of requests) {
        try {
          const qrData = generateQRCodeData(request.submission_id, {
            card_name: request.card_name,
            card_series: request.card_series
          });
          
          // Update database with QR data
          await pool.query(
            `UPDATE grading_requests 
             SET qr_code_data = $1, qr_code_generated_at = CURRENT_TIMESTAMP 
             WHERE submission_id = $2`,
            [JSON.stringify(qrData), request.submission_id]
          );
          
          generatedCount++;
          
        } catch (qrError) {
          console.error(`❌ Failed to generate QR for ${request.submission_id}:`, qrError);
        }
      }
      
      console.log(`✅ QR codes generated: ${generatedCount} requests`);
      
      res.json({
        success: true,
        message: `QR codes générés pour ${generatedCount} demandes`,
        generated_count: generatedCount,
        total_requests: requests.length
      });
      
    } catch (error) {
      console.error('Error generating QR codes:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate QR codes',
        error: error.message
      });
    }
  });

  // Get video submission stats
  router.get('/video/stats', async (req, res) => {
    try {
      const statsQuery = `
        SELECT 
          COUNT(*) as total_requests,
          COUNT(CASE WHEN qr_code_data IS NOT NULL THEN 1 END) as qr_generated,
          COUNT(CASE WHEN video_url IS NOT NULL THEN 1 END) as videos_submitted,
          COUNT(CASE WHEN video_status = 'validated' THEN 1 END) as videos_validated
        FROM grading_requests
      `;
      
      const result = await pool.query(statsQuery);
      const stats = result.rows[0];
      
      res.json({
        success: true,
        stats: {
          total_requests: parseInt(stats.total_requests),
          qr_generated: parseInt(stats.qr_generated),
          videos_submitted: parseInt(stats.videos_submitted),
          videos_validated: parseInt(stats.videos_validated),
          qr_pending: parseInt(stats.total_requests) - parseInt(stats.qr_generated),
          videos_pending: parseInt(stats.qr_generated) - parseInt(stats.videos_submitted)
        }
      });
    } catch (error) {
      console.error('Error getting video stats:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get video stats',
        error: error.message
      });
    }
  });

  // ========================================
  // CUSTOMER INVITATION MANAGEMENT ROUTES
  // ========================================

  /**
   * POST /api/admin/invitations
   * Créer une invitation client pour une commande
   */
  router.post('/invitations', async (req, res) => {
    try {
      const { grading_request_id, customer_email, send_email = true } = req.body;

      // Validation des données
      if (!grading_request_id || !customer_email) {
        return res.status(400).json({
          success: false,
          message: 'ID de commande et email client requis',
          code: 'MISSING_FIELDS'
        });
      }

      // Vérifier que la commande existe
      const orderResult = await pool.query(
        'SELECT id, submission_id, card_name, grading_type, price, status FROM grading_requests WHERE id = $1',
        [grading_request_id]
      );

      if (orderResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Commande non trouvée',
          code: 'ORDER_NOT_FOUND'
        });
      }

      const order = orderResult.rows[0];

      // Vérifier si une invitation active existe déjà
      const existingInvitation = await pool.query(`
        SELECT token, expires_at, used 
        FROM customer_auth_tokens 
        WHERE customer_email = $1 AND grading_request_id = $2 
        AND token_type = 'invitation' AND expires_at > NOW() AND used = false
      `, [customer_email.toLowerCase(), grading_request_id]);

      if (existingInvitation.rows.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'Une invitation active existe déjà pour ce client',
          code: 'INVITATION_EXISTS',
          existing_invitation: {
            token: existingInvitation.rows[0].token,
            expires_at: existingInvitation.rows[0].expires_at
          }
        });
      }

      // Créer le token d'invitation
      const invitationData = await createCustomerInvitationToken(
        customer_email,
        grading_request_id,
        req.admin?.id || 'admin'
      );

      // Envoyer l'email si demandé
      if (send_email) {
        try {
          const invitationUrl = `${req.protocol}://${req.get('host')}/client/invitation/${invitationData.token}`;
          
          // Utiliser la fonction d'email d'invitation spécialisée
          const { sendCustomerInvitationEmail } = await import('../utils/brevo.js');
          
          const emailResult = await sendCustomerInvitationEmail({
            customer_email,
            invitation_token: invitationData.token,
            invitation_url: invitationUrl,
            grading_request: {
              submission_id: order.submission_id,
              card_name: order.card_name,
              grading_type: order.grading_type,
              price: order.price,
              created_at: invitationData.created_at
            },
            admin_name: req.admin?.name || 'Équipe PSA Grading'
          });

          console.log(`[ADMIN] ✅ Invitation envoyée à ${customer_email} pour commande ${order.submission_id} - ID: ${emailResult.messageId}`);
        } catch (emailError) {
          console.error('[ADMIN] ❌ Erreur envoi email invitation:', emailError);
          // Ne pas faire échouer la création d'invitation si l'email échoue
        }
      }

      res.json({
        success: true,
        message: 'Invitation créée avec succès',
        invitation: {
          token: invitationData.token,
          customer_email,
          grading_request_id,
          expires_at: invitationData.expires_at,
          invitation_url: `${req.protocol}://${req.get('host')}/client/invitation/${invitationData.token}`,
          email_sent: send_email
        }
      });

    } catch (error) {
      console.error('[ADMIN] Erreur création invitation:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la création de l\'invitation',
        code: 'INVITATION_ERROR'
      });
    }
  });

  /**
   * GET /api/admin/invitations/:grading_request_id
   * Récupérer les invitations pour une commande spécifique
   */
  router.get('/invitations/:grading_request_id', async (req, res) => {
    try {
      const { grading_request_id } = req.params;

      const result = await pool.query(`
        SELECT 
          cat.token,
          cat.customer_email,
          cat.expires_at,
          cat.used,
          cat.used_at,
          cat.created_at,
          cat.created_by_admin,
          c.id as customer_id,
          c.first_name,
          c.last_name,
          c.created_at as customer_registered_at
        FROM customer_auth_tokens cat
        LEFT JOIN customers c ON cat.customer_email = c.email
        WHERE cat.grading_request_id = $1 AND cat.token_type = 'invitation'
        ORDER BY cat.created_at DESC
      `, [grading_request_id]);

      const invitations = result.rows.map(row => ({
        token: row.token,
        customer_email: row.customer_email,
        expires_at: row.expires_at,
        used: row.used,
        used_at: row.used_at,
        created_at: row.created_at,
        created_by_admin: row.created_by_admin,
        status: row.used ? 'used' : 
               new Date() > new Date(row.expires_at) ? 'expired' : 'active',
        customer_info: row.customer_id ? {
          id: row.customer_id,
          first_name: row.first_name,
          last_name: row.last_name,
          registered_at: row.customer_registered_at
        } : null
      }));

      res.json({
        success: true,
        grading_request_id: parseInt(grading_request_id),
        invitations,
        count: invitations.length
      });

    } catch (error) {
      console.error('[ADMIN] Erreur récupération invitations:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des invitations',
        code: 'INVITATIONS_FETCH_ERROR'
      });
    }
  });

  /**
   * GET /api/admin/invitations
   * Historique global des invitations avec filtres
   */
  router.get('/invitations', async (req, res) => {
    try {
      const { 
        status = 'all', 
        customer_email, 
        limit = 50, 
        offset = 0 
      } = req.query;

      let whereClause = "WHERE cat.token_type = 'invitation'";
      const queryParams = [];
      let paramCount = 0;

      // Filtrer par email si fourni
      if (customer_email) {
        paramCount++;
        whereClause += ` AND cat.customer_email ILIKE $${paramCount}`;
        queryParams.push(`%${customer_email}%`);
      }

      // Filtrer par statut
      if (status !== 'all') {
        switch (status) {
          case 'active':
            whereClause += ' AND cat.used = false AND cat.expires_at > NOW()';
            break;
          case 'used':
            whereClause += ' AND cat.used = true';
            break;
          case 'expired':
            whereClause += ' AND cat.used = false AND cat.expires_at <= NOW()';
            break;
        }
      }

      const query = `
        SELECT 
          cat.token,
          cat.customer_email,
          cat.grading_request_id,
          cat.expires_at,
          cat.used,
          cat.used_at,
          cat.created_at,
          cat.created_by_admin,
          gr.submission_id,
          gr.card_name,
          gr.grading_type,
          gr.price,
          gr.status as order_status,
          c.id as customer_id,
          c.first_name,
          c.last_name
        FROM customer_auth_tokens cat
        JOIN grading_requests gr ON cat.grading_request_id = gr.id
        LEFT JOIN customers c ON cat.customer_email = c.email
        ${whereClause}
        ORDER BY cat.created_at DESC
        LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
      `;

      queryParams.push(parseInt(limit), parseInt(offset));

      const result = await pool.query(query, queryParams);

      // Compter le total pour la pagination
      const countQuery = `
        SELECT COUNT(*) as total
        FROM customer_auth_tokens cat
        JOIN grading_requests gr ON cat.grading_request_id = gr.id
        ${whereClause}
      `;

      const countResult = await pool.query(countQuery, queryParams.slice(0, -2));
      const total = parseInt(countResult.rows[0].total);

      const invitations = result.rows.map(row => ({
        token: row.token,
        customer_email: row.customer_email,
        grading_request_id: row.grading_request_id,
        expires_at: row.expires_at,
        used: row.used,
        used_at: row.used_at,
        created_at: row.created_at,
        created_by_admin: row.created_by_admin,
        status: row.used ? 'used' : 
               new Date() > new Date(row.expires_at) ? 'expired' : 'active',
        order: {
          submission_id: row.submission_id,
          card_name: row.card_name,
          grading_type: row.grading_type,
          price: row.price,
          status: row.order_status
        },
        customer_info: row.customer_id ? {
          id: row.customer_id,
          first_name: row.first_name,
          last_name: row.last_name
        } : null
      }));

      res.json({
        success: true,
        invitations,
        pagination: {
          total,
          limit: parseInt(limit),
          offset: parseInt(offset),
          has_next: (parseInt(offset) + parseInt(limit)) < total
        }
      });

    } catch (error) {
      console.error('[ADMIN] Erreur historique invitations:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération de l\'historique',
        code: 'INVITATIONS_HISTORY_ERROR'
      });
    }
  });

  /**
   * DELETE /api/admin/invitations/:token
   * Annuler/supprimer une invitation
   */
  router.delete('/invitations/:token', async (req, res) => {
    try {
      const { token } = req.params;

      // Vérifier que l'invitation existe et n'est pas utilisée
      const invitationResult = await pool.query(`
        SELECT 
          cat.id,
          cat.customer_email,
          cat.grading_request_id,
          cat.used,
          cat.expires_at,
          gr.submission_id
        FROM customer_auth_tokens cat
        JOIN grading_requests gr ON cat.grading_request_id = gr.id
        WHERE cat.token = $1 AND cat.token_type = 'invitation'
      `, [token]);

      if (invitationResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Invitation non trouvée',
          code: 'INVITATION_NOT_FOUND'
        });
      }

      const invitation = invitationResult.rows[0];

      if (invitation.used) {
        return res.status(400).json({
          success: false,
          message: 'Impossible de supprimer une invitation déjà utilisée',
          code: 'INVITATION_ALREADY_USED'
        });
      }

      // Supprimer l'invitation
      await pool.query(
        'DELETE FROM customer_auth_tokens WHERE token = $1',
        [token]
      );

      console.log(`[ADMIN] ✅ Invitation supprimée: ${token} pour ${invitation.customer_email}`);

      res.json({
        success: true,
        message: 'Invitation supprimée avec succès',
        deleted_invitation: {
          token,
          customer_email: invitation.customer_email,
          submission_id: invitation.submission_id
        }
      });

    } catch (error) {
      console.error('[ADMIN] Erreur suppression invitation:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la suppression de l\'invitation',
        code: 'INVITATION_DELETE_ERROR'
      });
    }
  });

  return router;
}