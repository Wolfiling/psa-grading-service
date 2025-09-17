import express from 'express';
import { pool } from '../database/init.js';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import crypto from 'crypto';
import { updateVideoStatus, validateVideoMetadata, sanitizeSubmissionId, validateSecureToken, generateUploadToken, generateSecureToken } from '../utils/videoProof.js';
import { requireAdminAuth } from '../middleware/auth.js';
import { fileTypeFromBuffer } from 'file-type';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createVideoRoutes() {
  const router = express.Router();

  /**
   * P0 SECURITY FIX: Middleware de pré-validation token (AVANT multer)
   * Empêche le traitement du fichier si token invalide
   */
  const validateUploadTokenMiddleware = async (req, res, next) => {
    try {
      const { submission_id } = req.params;
      const { token, ts } = req.query;
      
      // Vérifier si admin (bypass token)
      if (req.admin) {
        console.log(`✅ Admin bypass token validation pour: ${submission_id}`);
        return next();
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
      
      // Valider token AVANT traitement fichier
      if (!token || !ts) {
        console.warn(`🚨 Token upload manquant pour ${sanitizedSubmissionId}`);
        return res.status(401).json({
          success: false,
          message: 'Token de sécurité requis pour upload vidéo',
          code: 'AUTH_REQUIRED'
        });
      }
      
      const tokenValidation = validateSecureToken(sanitizedSubmissionId, token, ts, 'upload');
      if (!tokenValidation.valid) {
        console.warn(`🚨 Token upload PRE-VALIDATION échoué pour ${sanitizedSubmissionId}: ${tokenValidation.reason}`);
        return res.status(401).json({
          success: false,
          message: `Token invalide: ${tokenValidation.reason}`,
          code: 'INVALID_TOKEN'
        });
      }
      
      console.log(`✅ Token upload PRE-VALIDÉ pour: ${sanitizedSubmissionId}`);
      
      // Stocker le sanitized ID pour les handlers suivants
      req.sanitizedSubmissionId = sanitizedSubmissionId;
      next();
      
    } catch (error) {
      console.error('❌ Erreur validation token middleware:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur validation token',
        code: 'TOKEN_VALIDATION_ERROR'
      });
    }
  };

  // ✅ CRITICAL SECURITY FIX: Configuration Multer SÉCURISÉE avec validation contenu RÉEL
  const upload = multer({
    storage: multer.memoryStorage(), // ✅ CRITIQUE: Lire en mémoire d'abord pour validation
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB limite
    },
    fileFilter: function (req, file, cb) {
      // ✅ SÉCURITÉ: Validation extension de base (validation réelle se fait après)
      const allowedExtensions = ['.webm', '.mp4', '.mov'];
      const fileExt = path.extname(file.originalname).toLowerCase();
      
      if (!allowedExtensions.includes(fileExt)) {
        console.log(`❌ Extension vidéo refusée: ${fileExt}`);
        return cb(new Error(`Extension non supportée: ${fileExt}. Seuls .webm, .mp4, .mov sont acceptés.`), false);
      }
      
      console.log(`✅ Validation extension basique réussie: ${fileExt}`);
      cb(null, true);
    }
  });

  // ✅ CRITICAL SECURITY FIX: Fonction validation RÉELLE du contenu fichier
  async function validateAndSaveVideoFile(fileBuffer, originalName, submissionId) {
    try {
      // Détecter le type RÉEL du fichier via son contenu
      const detectedType = await fileTypeFromBuffer(fileBuffer);
      
      if (!detectedType) {
        throw new Error('Type de fichier non détectable - fichier potentiellement corrompu');
      }
      
      const validVideoTypes = ['webm', 'mp4', 'mov', 'avi', 'quicktime'];
      if (!validVideoTypes.includes(detectedType.ext)) {
        console.warn(`🚨 Type fichier détecté invalide: ${detectedType.ext} pour ${submissionId}`);
        throw new Error(`Type fichier non autorisé. Détecté: ${detectedType.ext}, MIME: ${detectedType.mime}`);
      }
      
      // Si validation réussie, sauvegarder le fichier
      const today = new Date().toISOString().split('T')[0];
      const uploadDir = path.join(__dirname, '../uploads/videos', today);
      
      await fs.mkdir(uploadDir, { recursive: true });
      
      const timestamp = Date.now();
      const ext = `.${detectedType.ext}`; // Utiliser l'extension DÉTECTÉE, pas celle déclarée
      const filename = `${submissionId}_${timestamp}${ext}`;
      const filePath = path.join(uploadDir, filename);
      
      await fs.writeFile(filePath, fileBuffer);
      
      console.log(`✅ Fichier vidéo validé et sauvegardé: ${filename} (type: ${detectedType.ext})`);
      
      return {
        filename,
        path: filePath,
        size: fileBuffer.length,
        detectedMime: detectedType.mime,
        detectedExt: detectedType.ext
      };
      
    } catch (error) {
      console.error(`❌ Erreur validation fichier vidéo:`, error);
      throw error;
    }
  }

  // Middleware pour parser JSON
  router.use(express.json());

  /**
   * POST /api/video/upload/:submission_id
   * Upload d'une vidéo de preuve pour une soumission PSA
   * P0 SECURITY FIX: Token validation AVANT multer
   */
  router.post('/upload/:submission_id', validateUploadTokenMiddleware, upload.single('video'), async (req, res) => {
    try {
      const { submission_id } = req.params;
      const { duration, startTime } = req.body;
      
      console.log(`🎬 Upload vidéo pour submission: ${submission_id}`);
      
      // P0 FIX: Utiliser l'ID déjà sanitized par le middleware
      const sanitizedSubmissionId = req.sanitizedSubmissionId || sanitizeSubmissionId(submission_id);
      
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({
          success: false,
          message: 'Aucun fichier vidéo fourni ou buffer manquant'
        });
      }
      
      // ✅ CRITICAL SECURITY FIX: Validation RÉELLE du contenu via validateAndSaveVideoFile
      let savedFileInfo;
      try {
        savedFileInfo = await validateAndSaveVideoFile(
          req.file.buffer, 
          req.file.originalname, 
          sanitizedSubmissionId
        );
        
        console.log(`✅ Fichier vidéo validé et sauvegardé: ${savedFileInfo.filename} (détecté: ${savedFileInfo.detectedExt})`);
        
      } catch (validationError) {
        console.error(`❌ Validation fichier échouée pour ${sanitizedSubmissionId}:`, validationError.message);
        return res.status(400).json({
          success: false,
          message: validationError.message,
          code: 'VALIDATION_FAILED'
        });
      }
      
      // Auth déjà validé par le middleware
      const isAdmin = req.admin; // Set by admin middleware if present
      
      if (isAdmin) {
        console.log(`✅ Upload admin autorisé pour submission: ${sanitizedSubmissionId}`);
      } else {
        console.log(`✅ Token upload validé pour submission: ${sanitizedSubmissionId}`);
      }

      // Vérifier que la soumission existe
      const submissionResult = await pool.query(
        'SELECT id, customer_email, card_name, grading_type, video_status FROM grading_requests WHERE submission_id = $1',
        [sanitizedSubmissionId]
      );

      if (submissionResult.rows.length === 0) {
        // Supprimer le fichier uploadé si soumission n'existe pas
        await fs.unlink(savedFileInfo.path).catch(console.error);
        return res.status(404).json({
          success: false,
          message: 'Soumission non trouvée'
        });
      }

      const submission = submissionResult.rows[0];
      
      // Vérifier si une vidéo existe déjà (bloquer si pas admin)
      if (submission.video_status === 'uploaded' && !isAdmin) {
        await fs.unlink(savedFileInfo.path).catch(console.error);
        console.warn(`🚨 Tentative de remplacement vidéo sans autorisation: ${sanitizedSubmissionId}`);
        return res.status(409).json({
          success: false,
          message: 'Vidéo déjà uploadée pour cette soumission. Contactez un administrateur pour remplacer.',
          code: 'VIDEO_ALREADY_EXISTS'
        });
      }
      
      if (submission.video_status === 'uploaded') {
        console.log(`⚠️ Vidéo existe déjà pour ${sanitizedSubmissionId}, remplacement admin autorisé`);
      }

      // Construire l'URL relative de la vidéo
      const today = new Date().toISOString().split('T')[0];
      const relativePath = path.join('videos', today, savedFileInfo.filename);
      const videoUrl = `/api/video/file/${sanitizedSubmissionId}`;

      // Valider les métadonnées vidéo
      const videoMetadata = {
        fileSize: savedFileInfo.size,
        duration: duration ? parseInt(duration) : null,
        format: savedFileInfo.detectedExt
      };

      const validation = validateVideoMetadata(videoMetadata);
      if (!validation.valid) {
        // Supprimer le fichier si validation échoue
        await fs.unlink(savedFileInfo.path).catch(console.error);
        return res.status(400).json({
          success: false,
          message: `Vidéo invalide: ${validation.errors.join(', ')}`
        });
      }

      // Mettre à jour la base de données
      const updateResult = await updateVideoStatus(submission.id, 'uploaded', {
        video_url: relativePath,
        recording_timestamp: startTime ? new Date(startTime) : new Date(),
        video_file_size: savedFileInfo.size,
        video_duration: duration ? parseInt(duration) : null
      });

      if (!updateResult.success) {
        // Supprimer le fichier si mise à jour DB échoue
        await fs.unlink(savedFileInfo.path).catch(console.error);
        return res.status(500).json({
          success: false,
          message: updateResult.message
        });
      }

      console.log(`✅ Vidéo uploadée avec succès pour ${sanitizedSubmissionId}`);
      console.log(`📊 Taille: ${(savedFileInfo.size / 1024 / 1024).toFixed(2)}MB`);
      console.log(`⏱️ Durée: ${duration || 'N/A'}s`);

      res.json({
        success: true,
        message: 'Vidéo uploadée avec succès',
        video: {
          submission_id: sanitizedSubmissionId,
          filename: savedFileInfo.filename,
          size: savedFileInfo.size,
          detected_type: savedFileInfo.detectedExt,
          detected_mime: savedFileInfo.detectedMime,
          duration: duration,
          video_url: videoUrl,
          uploaded_at: new Date().toISOString()
        },
        submission: {
          customer_email: submission.customer_email,
          card_name: submission.card_name,
          grading_type: submission.grading_type
        }
      });

    } catch (error) {
      console.error('❌ Erreur upload vidéo:', error);
      
      // Nettoyer le fichier en cas d'erreur
      if (req.file) {
        await fs.unlink(req.file.path).catch(console.error);
      }

      res.status(500).json({
        success: false,
        message: 'Erreur interne lors de l\'upload de la vidéo'
      });
    }
  });

  /**
   * GET /api/video/:submission_id
   * Récupérer les informations d'une vidéo
   */
  router.get('/:submission_id', async (req, res) => {
    try {
      const { submission_id } = req.params;
      
      // Sanitize submission ID
      let sanitizedSubmissionId;
      try {
        sanitizedSubmissionId = sanitizeSubmissionId(submission_id);
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: 'ID de soumission invalide'
        });
      }
      
      const result = await pool.query(`
        SELECT 
          submission_id,
          video_url,
          video_status,
          video_file_size,
          video_duration,
          recording_timestamp,
          customer_email,
          card_name,
          grading_type
        FROM grading_requests 
        WHERE submission_id = $1
      `, [sanitizedSubmissionId]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Soumission non trouvée'
        });
      }

      const submission = result.rows[0];

      if (submission.video_status !== 'uploaded' || !submission.video_url) {
        return res.status(404).json({
          success: false,
          message: 'Aucune vidéo trouvée pour cette soumission'
        });
      }

      // Vérifier que le fichier existe
      const fullPath = path.join(__dirname, '../uploads', submission.video_url);
      try {
        await fs.access(fullPath);
      } catch {
        return res.status(404).json({
          success: false,
          message: 'Fichier vidéo introuvable'
        });
      }

      res.json({
        success: true,
        video: {
          submission_id: submission.submission_id,
          status: submission.video_status,
          file_size: submission.video_file_size,
          duration: submission.video_duration,
          recorded_at: submission.recording_timestamp,
          video_url: `/api/video/file/${sanitizedSubmissionId}`
        },
        submission: {
          customer_email: submission.customer_email,
          card_name: submission.card_name,
          grading_type: submission.grading_type
        }
      });

    } catch (error) {
      console.error('❌ Erreur récupération vidéo:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur interne lors de la récupération de la vidéo'
      });
    }
  });

  /**
   * GET /api/video/view-token/:submission_id
   * Générer un token sécurisé pour la visualisation vidéo (admin uniquement)
   */
  router.get('/view-token/:submission_id', requireAdminAuth, async (req, res) => {
    try {
      const { submission_id } = req.params;
      
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
      const submissionCheck = await pool.query(
        'SELECT id, video_url FROM grading_requests WHERE submission_id = $1',
        [sanitizedSubmissionId]
      );
      
      if (submissionCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Soumission non trouvée',
          code: 'SUBMISSION_NOT_FOUND'
        });
      }
      
      if (!submissionCheck.rows[0].video_url) {
        return res.status(404).json({
          success: false,
          message: 'Aucune vidéo disponible pour cette soumission',
          code: 'NO_VIDEO_AVAILABLE'
        });
      }
      
      // Générer le token de visualisation avec action 'access'
      const timestamp = Date.now();
      const accessToken = generateSecureToken(sanitizedSubmissionId, timestamp, 'access');
      
      const viewToken = {
        token: accessToken,
        timestamp: timestamp,
        expires_at: timestamp + (24 * 60 * 60 * 1000)
      };
      
      console.log(`✅ Token de visualisation vidéo généré pour admin: ${sanitizedSubmissionId}`);
      
      res.json({
        success: true,
        token: viewToken.token,
        timestamp: viewToken.timestamp,
        expires_at: viewToken.expires_at,
        video_url: `/api/video/file/${sanitizedSubmissionId}?token=${viewToken.token}&ts=${viewToken.timestamp}`
      });
      
    } catch (error) {
      console.error('❌ Erreur génération token visualisation:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la génération du token',
        code: 'TOKEN_GENERATION_ERROR'
      });
    }
  });

  /**
   * GET /api/video/file/:submission_id
   * Servir le fichier vidéo (sécurisé)
   * Requires secure token validation or admin authentication
   */
  router.get('/file/:submission_id', async (req, res) => {
    try {
      const { submission_id } = req.params;
      const { token, ts } = req.query;
      
      // Sanitize submission ID
      let sanitizedSubmissionId;
      try {
        sanitizedSubmissionId = sanitizeSubmissionId(submission_id);
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: 'ID de soumission invalide'
        });
      }
      
      // Check authentication: either valid access token or admin auth
      const isAdmin = req.admin; // Set by admin middleware if present
      
      if (!isAdmin) {
        // Require secure token for non-admin access
        if (!token || !ts) {
          return res.status(401).json({
            success: false,
            message: 'Token de sécurité requis pour accès vidéo',
            code: 'AUTH_REQUIRED'
          });
        }
        
        // Validate the access token with 'access' action
        const tokenValidation = validateSecureToken(sanitizedSubmissionId, token, ts, 'access');
        if (!tokenValidation.valid) {
          console.warn(`🚨 Token accès vidéo invalide pour ${sanitizedSubmissionId}: ${tokenValidation.reason}`);
          return res.status(401).json({
            success: false,
            message: `Token invalide: ${tokenValidation.reason}`,
            code: 'INVALID_TOKEN'
          });
        }
        
        console.log(`✅ Token accès vidéo validé pour: ${sanitizedSubmissionId}`);
      } else {
        console.log(`✅ Accès admin autorisé pour vidéo: ${sanitizedSubmissionId}`);
      }
      
      // Récupérer le chemin du fichier depuis la DB
      const result = await pool.query(
        'SELECT video_url, video_status FROM grading_requests WHERE submission_id = $1',
        [sanitizedSubmissionId]
      );

      if (result.rows.length === 0 || !result.rows[0].video_url) {
        return res.status(404).json({
          success: false,
          message: 'Vidéo non trouvée'
        });
      }

      const { video_url } = result.rows[0];
      const fullPath = path.join(__dirname, '../uploads', video_url);

      // Vérifier que le fichier existe
      try {
        await fs.access(fullPath);
      } catch {
        console.error(`❌ Fichier vidéo introuvable: ${fullPath}`);
        return res.status(404).json({
          success: false,
          message: 'Fichier vidéo introuvable'
        });
      }

      // Déterminer le type MIME
      const ext = path.extname(fullPath).toLowerCase();
      let contentType = 'video/webm';
      if (ext === '.mp4') contentType = 'video/mp4';
      if (ext === '.mov') contentType = 'video/quicktime';

      // Headers pour la vidéo
      res.set({
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, no-cache'
      });

      console.log(`🎬 Servir vidéo: ${sanitizedSubmissionId} (${contentType})`);
      
      // Stream du fichier vidéo
      const fs_sync = await import('fs');
      const videoStream = fs_sync.createReadStream(fullPath);
      
      videoStream.on('error', (error) => {
        console.error('❌ Erreur stream vidéo:', error);
        if (!res.headersSent) {
          res.status(500).json({ success: false, message: 'Erreur lecture fichier vidéo' });
        }
      });

      videoStream.pipe(res);

    } catch (error) {
      console.error('❌ Erreur servir fichier vidéo:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Erreur interne lors de la lecture de la vidéo'
        });
      }
    }
  });

  /**
   * DELETE /api/video/:submission_id
   * Supprimer une vidéo (admin seulement)
   */
  router.delete('/:submission_id', async (req, res) => {
    try {
      const { submission_id } = req.params;
      
      // Récupérer les informations de la vidéo
      const result = await pool.query(
        'SELECT id, video_url FROM grading_requests WHERE submission_id = $1',
        [submission_id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Soumission non trouvée'
        });
      }

      const { id: requestId, video_url } = result.rows[0];

      // Supprimer le fichier physique si il existe
      if (video_url) {
        const fullPath = path.join(__dirname, '../uploads', video_url);
        try {
          await fs.unlink(fullPath);
          console.log(`🗑️ Fichier vidéo supprimé: ${fullPath}`);
        } catch (error) {
          console.log(`⚠️ Fichier vidéo déjà absent: ${fullPath}`);
        }
      }

      // Mettre à jour la base de données
      const updateResult = await updateVideoStatus(requestId, 'pending', {
        video_url: null,
        recording_timestamp: null,
        video_file_size: null,
        video_duration: null
      });

      if (!updateResult.success) {
        return res.status(500).json({
          success: false,
          message: updateResult.message
        });
      }

      console.log(`✅ Vidéo supprimée pour submission: ${submission_id}`);

      res.json({
        success: true,
        message: 'Vidéo supprimée avec succès'
      });

    } catch (error) {
      console.error('❌ Erreur suppression vidéo:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur interne lors de la suppression de la vidéo'
      });
    }
  });

  /**
   * GET /api/video/stats
   * Statistiques du système vidéo
   */
  router.get('/stats', async (req, res) => {
    try {
      const stats = await pool.query(`
        SELECT 
          COUNT(*) as total_submissions,
          COUNT(*) FILTER (WHERE video_status = 'pending') as pending_videos,
          COUNT(*) FILTER (WHERE video_status = 'recording') as recording_videos,
          COUNT(*) FILTER (WHERE video_status = 'uploaded') as uploaded_videos,
          COALESCE(AVG(video_duration), 0)::INTEGER as avg_duration_seconds,
          COALESCE(SUM(video_file_size), 0) as total_storage_bytes,
          COALESCE(MAX(recording_timestamp), null) as last_recording
        FROM grading_requests
        WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
      `);

      const recentUploads = await pool.query(`
        SELECT 
          submission_id,
          customer_email,
          card_name,
          video_duration,
          video_file_size,
          recording_timestamp
        FROM grading_requests
        WHERE video_status = 'uploaded'
        ORDER BY recording_timestamp DESC
        LIMIT 10
      `);

      res.json({
        success: true,
        stats: {
          ...stats.rows[0],
          total_storage_mb: Math.round(stats.rows[0].total_storage_bytes / 1024 / 1024),
          recent_uploads: recentUploads.rows
        }
      });

    } catch (error) {
      console.error('❌ Erreur statistiques vidéo:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des statistiques'
      });
    }
  });

  /**
   * GET /api/video/upload-token/:submission_id
   * Générer un token sécurisé pour l'upload vidéo
   */
  router.get('/upload-token/:submission_id', async (req, res) => {
    try {
      const { submission_id } = req.params;
      
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
      const submissionCheck = await pool.query(
        'SELECT id FROM grading_requests WHERE submission_id = $1',
        [sanitizedSubmissionId]
      );
      
      if (submissionCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Soumission non trouvée',
          code: 'SUBMISSION_NOT_FOUND'
        });
      }
      
      // Générer le token d'upload
      const uploadToken = generateUploadToken(sanitizedSubmissionId);
      
      console.log(`✅ Token d'upload généré pour: ${sanitizedSubmissionId}`);
      
      res.json({
        success: true,
        token: uploadToken.token,
        timestamp: uploadToken.timestamp,
        expires_at: uploadToken.expires_at,
        valid_for_ms: uploadToken.valid_for_ms
      });
      
    } catch (error) {
      console.error('❌ Erreur génération token upload:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la génération du token',
        code: 'TOKEN_GENERATION_ERROR'
      });
    }
  });

  return router;
}