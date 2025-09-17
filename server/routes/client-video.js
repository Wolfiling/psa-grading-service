import express from 'express';
import { pool } from '../database/init.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import {
  validatePartialEmail,
  generateClientAccessToken,
  validateClientAccessToken,
  checkClientRateLimit,
  recordClientAttempt,
  logClientAccess,
  verifySubmissionAccess,
  updateClientAccessStats,
  generateTicketNumber
} from '../utils/clientAuth.js';
import { sanitizeSubmissionId } from '../utils/videoProof.js';
import { sendEmail } from '../utils/brevo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createClientVideoRoutes() {
  const router = express.Router();

  // Middleware pour parser JSON
  router.use(express.json());

  /**
   * POST /api/client/verify-submission
   * Vérifie un numéro de soumission PSA et génère un token d'accès temporaire
   */
  router.post('/verify-submission', async (req, res) => {
    const startTime = Date.now();
    const clientIP = req.ip;
    const userAgent = req.get('User-Agent') || 'Unknown';
    
    try {
      const { submission_id, email_partial, simple_captcha } = req.body;

      console.log(`🔍 Client verification attempt: ${submission_id} from ${clientIP}`);

      // Validation basique des paramètres
      if (!submission_id || !email_partial) {
        return res.status(400).json({
          success: false,
          message: 'Numéro de soumission et email requis',
          code: 'MISSING_PARAMETERS'
        });
      }

      // Vérifier le rate limiting
      const rateLimitCheck = checkClientRateLimit(clientIP);
      if (!rateLimitCheck.allowed) {
        await logClientAccess({
          submissionId: submission_id,
          clientIP,
          userAgent,
          accessType: 'verification',
          accessGranted: false,
          failureReason: 'Rate limited'
        });

        return res.status(429).json({
          success: false,
          message: rateLimitCheck.message || 'Trop de tentatives',
          code: 'RATE_LIMITED',
          retry_after_minutes: rateLimitCheck.minutesLeft || 60
        });
      }

      // Simple captcha validation (basique)
      if (simple_captcha !== undefined) {
        const expectedCaptcha = '2024'; // Simple année en cours
        if (simple_captcha !== expectedCaptcha) {
          recordClientAttempt(clientIP, false);
          
          await logClientAccess({
            submissionId: submission_id,
            clientIP,
            userAgent,
            accessType: 'verification',
            accessGranted: false,
            failureReason: 'Invalid captcha'
          });

          return res.status(400).json({
            success: false,
            message: 'Vérification de sécurité échouée',
            code: 'INVALID_CAPTCHA'
          });
        }
      }

      // Sanitize et valider la soumission
      let sanitizedSubmissionId;
      try {
        sanitizedSubmissionId = sanitizeSubmissionId(submission_id);
      } catch (error) {
        recordClientAttempt(clientIP, false);
        
        await logClientAccess({
          submissionId: submission_id,
          clientIP,
          userAgent,
          accessType: 'verification',
          accessGranted: false,
          failureReason: 'Invalid submission ID format'
        });

        return res.status(400).json({
          success: false,
          message: 'Format de numéro de soumission invalide',
          code: 'INVALID_SUBMISSION_ID'
        });
      }

      // Vérifier que la soumission existe et est accessible
      const submissionCheck = await verifySubmissionAccess(sanitizedSubmissionId);
      if (!submissionCheck.valid) {
        recordClientAttempt(clientIP, false);
        
        await logClientAccess({
          submissionId: sanitizedSubmissionId,
          clientIP,
          userAgent,
          accessType: 'verification',
          accessGranted: false,
          failureReason: submissionCheck.reason
        });

        return res.status(404).json({
          success: false,
          message: submissionCheck.reason,
          code: 'SUBMISSION_NOT_FOUND'
        });
      }

      const submission = submissionCheck.submission;

      // Valider l'email partiel (4 derniers caractères avant @)
      const emailValid = validatePartialEmail(submission.customer_email, email_partial);
      if (!emailValid) {
        recordClientAttempt(clientIP, false);
        
        const emailDomain = submission.customer_email.split('@')[1];
        await logClientAccess({
          submissionId: sanitizedSubmissionId,
          clientIP,
          userAgent,
          emailDomain,
          accessType: 'verification',
          accessGranted: false,
          failureReason: 'Invalid email verification'
        });

        return res.status(401).json({
          success: false,
          message: 'Les derniers caractères de votre email ne correspondent pas',
          code: 'EMAIL_VERIFICATION_FAILED'
        });
      }

      // Générer un token d'accès temporaire
      const tokenData = generateClientAccessToken(
        sanitizedSubmissionId,
        submission.customer_email,
        clientIP
      );

      // Enregistrer le succès
      recordClientAttempt(clientIP, true);

      // Logger l'accès réussi
      const emailDomain = submission.customer_email.split('@')[1];
      await logClientAccess({
        submissionId: sanitizedSubmissionId,
        clientIP,
        userAgent,
        emailDomain,
        accessType: 'verification',
        accessGranted: true,
        tokenIssued: tokenData.token,
        tokenExpiresAt: new Date(tokenData.expires_at),
        sessionId: tokenData.session_id
      });

      // Mettre à jour les stats d'accès
      await updateClientAccessStats(submission.id);

      const processingTime = Date.now() - startTime;
      console.log(`✅ Client verification successful: ${sanitizedSubmissionId} (${processingTime}ms)`);

      res.json({
        success: true,
        message: 'Accès autorisé à votre vidéo de preuve',
        data: {
          access_token: tokenData.token,
          expires_at: tokenData.expires_at,
          expires_in_seconds: tokenData.valid_for_seconds,
          submission: {
            id: sanitizedSubmissionId,
            card_name: submission.card_name,
            grading_type: submission.grading_type,
            recording_date: submission.recording_date,
            created_date: submission.created_at,
            video_duration: submission.video_duration
          }
        }
      });

    } catch (error) {
      console.error('❌ Erreur verification client:', error);
      
      recordClientAttempt(clientIP, false);
      
      await logClientAccess({
        submissionId: req.body.submission_id,
        clientIP,
        userAgent,
        accessType: 'verification',
        accessGranted: false,
        failureReason: 'Internal server error'
      });

      res.status(500).json({
        success: false,
        message: 'Erreur interne du serveur',
        code: 'INTERNAL_ERROR'
      });
    }
  });

  /**
   * GET /api/client/video/:token
   * Sert le fichier vidéo avec token d'accès client temporaire
   */
  router.get('/video/:token', async (req, res) => {
    try {
      const { token } = req.params;
      const { submission_id } = req.query;
      const clientIP = req.ip;
      const userAgent = req.get('User-Agent') || 'Unknown';

      console.log(`🎬 Client video access: ${submission_id} with token from ${clientIP}`);

      if (!token || !submission_id) {
        return res.status(400).json({
          success: false,
          message: 'Token et ID de soumission requis',
          code: 'MISSING_PARAMETERS'
        });
      }

      // Sanitize submission ID
      let sanitizedSubmissionId;
      try {
        sanitizedSubmissionId = sanitizeSubmissionId(submission_id);
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: 'ID de soumission invalide',
          code: 'INVALID_SUBMISSION_ID'
        });
      }

      // Valider le token client
      const tokenValidation = validateClientAccessToken(token, sanitizedSubmissionId, clientIP);
      if (!tokenValidation.valid) {
        await logClientAccess({
          submissionId: sanitizedSubmissionId,
          clientIP,
          userAgent,
          accessType: 'video_access',
          accessGranted: false,
          failureReason: tokenValidation.reason
        });

        console.warn(`🚨 Invalid client video token: ${tokenValidation.reason}`);
        return res.status(401).json({
          success: false,
          message: tokenValidation.reason,
          code: 'INVALID_ACCESS_TOKEN'
        });
      }

      // Récupérer les détails de la vidéo
      const result = await pool.query(
        'SELECT video_url, video_status, card_name FROM grading_requests WHERE submission_id = $1',
        [sanitizedSubmissionId]
      );

      if (result.rows.length === 0 || !result.rows[0].video_url) {
        return res.status(404).json({
          success: false,
          message: 'Vidéo non trouvée',
          code: 'VIDEO_NOT_FOUND'
        });
      }

      const { video_url, video_status, card_name } = result.rows[0];

      if (video_status !== 'uploaded') {
        return res.status(404).json({
          success: false,
          message: 'Vidéo non disponible',
          code: 'VIDEO_NOT_AVAILABLE'
        });
      }

      // Construire le chemin du fichier
      const fullPath = path.join(__dirname, '../uploads', video_url);

      // Vérifier que le fichier existe
      try {
        await fs.access(fullPath);
      } catch {
        console.error(`❌ Fichier vidéo introuvable: ${fullPath}`);
        return res.status(404).json({
          success: false,
          message: 'Fichier vidéo introuvable',
          code: 'VIDEO_FILE_NOT_FOUND'
        });
      }

      // Logger l'accès vidéo réussi
      await logClientAccess({
        submissionId: sanitizedSubmissionId,
        clientIP,
        userAgent,
        accessType: 'video_access',
        accessGranted: true,
        sessionId: tokenValidation.session.sessionId
      });

      console.log(`✅ Client video access granted: ${sanitizedSubmissionId} - ${card_name}`);

      // Déterminer le type MIME
      const ext = path.extname(video_url).toLowerCase();
      const mimeType = ext === '.mp4' ? 'video/mp4' : 'video/webm';

      // Configurer les en-têtes de sécurité
      res.set({
        'Content-Type': mimeType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': 'default-src \'self\'',
        'X-Frame-Options': 'DENY'
      });

      // Support de range requests pour le streaming
      const stat = await fs.stat(fullPath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;

        res.status(206).set({
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
        });

        const videoStream = (await import('fs')).createReadStream(fullPath, { start, end });
        videoStream.pipe(res);
      } else {
        res.set('Content-Length', fileSize);
        const videoStream = (await import('fs')).createReadStream(fullPath);
        videoStream.pipe(res);
      }

    } catch (error) {
      console.error('❌ Erreur accès vidéo client:', error);
      
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Erreur interne lors de l\'accès à la vidéo',
          code: 'INTERNAL_ERROR'
        });
      }
    }
  });

  /**
   * POST /api/client/report-issue
   * Permet aux clients de signaler un problème avec leur vidéo
   */
  router.post('/report-issue', async (req, res) => {
    try {
      const {
        submission_id,
        client_email,
        issue_type,
        description,
        priority
      } = req.body;

      const clientIP = req.ip;
      const userAgent = req.get('User-Agent') || 'Unknown';

      console.log(`📋 Client issue report: ${submission_id} - ${issue_type}`);

      // Validation des paramètres
      if (!submission_id || !client_email || !issue_type || !description) {
        return res.status(400).json({
          success: false,
          message: 'Tous les champs obligatoires doivent être remplis',
          code: 'MISSING_REQUIRED_FIELDS'
        });
      }

      // Rate limiting pour les signalements
      const rateLimitCheck = checkClientRateLimit(clientIP);
      if (!rateLimitCheck.allowed) {
        return res.status(429).json({
          success: false,
          message: 'Trop de tentatives. Veuillez patienter.',
          code: 'RATE_LIMITED'
        });
      }

      // Sanitize submission ID
      let sanitizedSubmissionId;
      try {
        sanitizedSubmissionId = sanitizeSubmissionId(submission_id);
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: 'ID de soumission invalide',
          code: 'INVALID_SUBMISSION_ID'
        });
      }

      // Vérifier que la soumission existe
      const submissionCheck = await verifySubmissionAccess(sanitizedSubmissionId);
      if (!submissionCheck.valid) {
        return res.status(404).json({
          success: false,
          message: 'Numéro de soumission non trouvé',
          code: 'SUBMISSION_NOT_FOUND'
        });
      }

      // Générer un numéro de ticket unique
      const ticketNumber = generateTicketNumber();

      // Enregistrer le signalement en base
      const insertResult = await pool.query(`
        INSERT INTO client_reports (
          submission_id, ticket_number, client_email, issue_type,
          description, priority, client_ip
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, created_at
      `, [
        sanitizedSubmissionId,
        ticketNumber,
        client_email,
        issue_type,
        description.substring(0, 2000), // Limiter la taille
        priority || 'medium',
        clientIP
      ]);

      const reportId = insertResult.rows[0].id;
      const createdAt = insertResult.rows[0].created_at;

      // Envoyer une notification à l'équipe admin
      try {
        await sendEmail({
          to: 'admin@psa-grading.com', // À adapter selon votre config
          subject: `🚨 Nouveau signalement client - ${ticketNumber}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px;">
              <h2 style="color: #003d82;">Nouveau signalement client</h2>
              
              <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <h3>Détails du signalement</h3>
                <p><strong>Ticket:</strong> ${ticketNumber}</p>
                <p><strong>Soumission PSA:</strong> ${sanitizedSubmissionId}</p>
                <p><strong>Type de problème:</strong> ${issue_type}</p>
                <p><strong>Priorité:</strong> ${priority || 'medium'}</p>
                <p><strong>Email client:</strong> ${client_email}</p>
                <p><strong>Date:</strong> ${new Date(createdAt).toLocaleString('fr-FR')}</p>
              </div>
              
              <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <h4>Description du problème:</h4>
                <p>${description}</p>
              </div>
              
              <div style="background: #e9ecef; padding: 10px; border-radius: 8px; margin: 20px 0; font-size: 12px;">
                <p><strong>Informations techniques:</strong></p>
                <p>IP Client: ${clientIP}</p>
                <p>User-Agent: ${userAgent}</p>
              </div>
              
              <p style="color: #6c757d; font-size: 14px;">
                Connectez-vous à l'interface admin pour traiter ce signalement.
              </p>
            </div>
          `,
          text: `
            Nouveau signalement client
            
            Ticket: ${ticketNumber}
            Soumission PSA: ${sanitizedSubmissionId}
            Type: ${issue_type}
            Email: ${client_email}
            
            Description: ${description}
            
            Connectez-vous à l'interface admin pour traiter ce signalement.
          `
        });
      } catch (emailError) {
        console.error('❌ Erreur envoi email admin:', emailError);
        // Ne pas faire échouer la requête si l'email admin échoue
      }

      // Envoyer une confirmation au client
      try {
        await sendEmail({
          to: client_email,
          subject: `Confirmation de signalement PSA - ${ticketNumber}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px;">
              <div style="text-align: center; margin-bottom: 30px;">
                <img src="${process.env.REPL_URL || 'https://yourdomain.com'}/shopify-psa-logo.png" alt="PSA Grading" style="height: 60px;">
              </div>
              
              <h2 style="color: #003d82;">Signalement reçu</h2>
              
              <p>Bonjour,</p>
              
              <p>Nous avons bien reçu votre signalement concernant votre soumission PSA <strong>${sanitizedSubmissionId}</strong>.</p>
              
              <div style="background: #e3f2fd; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin-top: 0;">Référence de votre signalement</h3>
                <p style="font-size: 18px; font-weight: bold; color: #003d82;">${ticketNumber}</p>
                <p><strong>Type de problème:</strong> ${issue_type}</p>
                <p><strong>Date:</strong> ${new Date(createdAt).toLocaleString('fr-FR')}</p>
              </div>
              
              <p>Notre équipe va examiner votre signalement dans les plus brefs délais. Vous recevrez une réponse par email dès que nous aurons des informations à vous communiquer.</p>
              
              <p><strong>Que faire en attendant ?</strong></p>
              <ul>
                <li>Conservez ce numéro de ticket pour votre suivi</li>
                <li>Si vous avez des informations complémentaires, répondez à cet email</li>
                <li>Notre équipe vous contactera dans les 24-48h ouvrées</li>
              </ul>
              
              <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 0; font-size: 14px; color: #6c757d;">
                  <strong>Équipe PSA Grading Service</strong><br>
                  Support client & Qualité vidéo
                </p>
              </div>
              
              <p style="font-size: 12px; color: #6c757d;">
                Cet email a été envoyé automatiquement suite à votre signalement sur notre portail client.
              </p>
            </div>
          `,
          text: `
            Signalement reçu - PSA Grading Service
            
            Bonjour,
            
            Nous avons bien reçu votre signalement concernant votre soumission PSA ${sanitizedSubmissionId}.
            
            Référence de votre signalement: ${ticketNumber}
            Type de problème: ${issue_type}
            Date: ${new Date(createdAt).toLocaleString('fr-FR')}
            
            Notre équipe va examiner votre signalement dans les plus brefs délais.
            
            Conservez ce numéro de ticket pour votre suivi.
            
            Équipe PSA Grading Service
          `
        });
      } catch (emailError) {
        console.error('❌ Erreur envoi email client:', emailError);
        // Continuer même si l'email de confirmation échoue
      }

      console.log(`✅ Client report created: ${ticketNumber} for ${sanitizedSubmissionId}`);

      res.json({
        success: true,
        message: 'Votre signalement a été enregistré avec succès',
        data: {
          ticket_number: ticketNumber,
          created_at: createdAt,
          status: 'open',
          estimated_response_time: '24-48h ouvrées'
        }
      });

    } catch (error) {
      console.error('❌ Erreur création signalement:', error);
      
      res.status(500).json({
        success: false,
        message: 'Erreur interne lors de l\'enregistrement du signalement',
        code: 'INTERNAL_ERROR'
      });
    }
  });

  /**
   * GET /api/client/faq
   * Retourne la FAQ dynamique pour les clients
   */
  router.get('/faq', async (req, res) => {
    try {
      const faqData = {
        sections: [
          {
            title: "Qu'est-ce qu'une vidéo de preuve PSA ?",
            icon: "🎬",
            content: "La vidéo de preuve est un enregistrement réalisé lors de l'ouverture de votre colis, avant l'envoi de vos cartes pour gradation PSA. Elle garantit l'authenticité et l'état de vos cartes au moment de la réception."
          },
          {
            title: "Comment accéder à ma vidéo ?",
            icon: "🔑",
            content: "Utilisez votre numéro de soumission PSA (ex: PSA1757960...) et les 4 derniers caractères de votre email (avant le @). Ces informations sont disponibles dans votre confirmation de commande."
          },
          {
            title: "Combien de temps puis-je accéder à ma vidéo ?",
            icon: "⏰",
            content: "Une fois connecté, vous avez accès à votre vidéo pendant 1 heure. Vous pouvez vous reconnecter autant de fois que nécessaire."
          },
          {
            title: "Ma vidéo ne se charge pas, que faire ?",
            icon: "⚠️",
            content: "Vérifiez votre connexion internet. Si le problème persiste, utilisez le bouton 'Signaler un problème' pour nous alerter. Notre équipe vérifiera le fichier vidéo."
          },
          {
            title: "Puis-je télécharger ma vidéo ?",
            icon: "💾",
            content: "Pour des raisons de sécurité, le téléchargement n'est pas autorisé. Vous pouvez visionner votre vidéo autant de fois que nécessaire via notre portail sécurisé."
          },
          {
            title: "Qui peut voir ma vidéo ?",
            icon: "🔒",
            content: "Seuls vous et notre équipe PSA avons accès à votre vidéo. L'accès est sécurisé et tracé pour garantir la confidentialité de vos données."
          }
        ],
        contact: {
          support_email: "support@psa-grading.com",
          response_time: "24-48h ouvrées",
          phone: "Non disponible - Contact par email uniquement"
        },
        last_updated: new Date().toISOString()
      };

      res.json({
        success: true,
        data: faqData
      });
      
    } catch (error) {
      console.error('❌ Erreur récupération FAQ:', error);
      
      res.status(500).json({
        success: false,
        message: 'Erreur lors du chargement de la FAQ',
        code: 'INTERNAL_ERROR'
      });
    }
  });

  console.log('✅ Client video routes initialized');
  return router;
}