import express from 'express';
import { pool } from '../database/init.js';
import { requireAdminAuth } from '../middleware/auth.js';
import { 
  generateCompleteQRCode, 
  validateSecureVideoURL,
  sanitizeSubmissionId,
  generateSecureToken,
  validateSecureToken
} from '../utils/videoProof.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createAdminVideoRoutes() {
  const router = express.Router();

  router.use(express.json());
  router.use(express.urlencoded({ extended: true }));

  // Middleware d'authentification pour tous les endpoints
  router.use(requireAdminAuth);

  // ========================================
  // DASHBOARD & STATISTIQUES VIDÉO
  // ========================================

  /**
   * GET /admin/api/video-stats
   * Statistiques complètes du système vidéo
   */
  router.get('/video-stats', async (req, res) => {
    try {
      // Statistiques générales
      const totalStats = await pool.query(`
        SELECT 
          COUNT(*) as total_submissions,
          COUNT(CASE WHEN video_status = 'uploaded' THEN 1 END) as videos_present,
          COUNT(CASE WHEN video_status = 'pending' THEN 1 END) as videos_pending,
          COUNT(CASE WHEN video_status IS NULL OR video_status = 'pending' THEN 1 END) as videos_missing,
          COUNT(CASE WHEN qr_code_data IS NOT NULL THEN 1 END) as qr_codes_generated,
          SUM(video_file_size) as total_storage_bytes
        FROM grading_requests
      `);

      // Alertes critiques - soumissions anciennes sans vidéo
      const criticalAlerts = await pool.query(`
        SELECT 
          COUNT(*) as old_submissions_without_video
        FROM grading_requests 
        WHERE (video_status IS NULL OR video_status = 'pending')
          AND created_at < NOW() - INTERVAL '48 hours'
          AND status NOT IN ('cancelled', 'completed')
      `);

      // Statistiques par statut vidéo
      const statusBreakdown = await pool.query(`
        SELECT 
          COALESCE(video_status, 'not_set') as status,
          COUNT(*) as count
        FROM grading_requests
        GROUP BY video_status
        ORDER BY count DESC
      `);

      // Activité récente (derniers 7 jours)
      const recentActivity = await pool.query(`
        SELECT 
          DATE(recording_timestamp) as date,
          COUNT(*) as videos_uploaded
        FROM grading_requests
        WHERE recording_timestamp >= NOW() - INTERVAL '7 days'
          AND video_status = 'uploaded'
        GROUP BY DATE(recording_timestamp)
        ORDER BY date DESC
      `);

      // Calcul de l'espace disque utilisé
      const stats = totalStats.rows[0];
      const totalStorageMB = Math.round((parseInt(stats.total_storage_bytes) || 0) / 1024 / 1024);
      const totalStorageGB = (totalStorageMB / 1024).toFixed(2);

      res.json({
        success: true,
        stats: {
          // Chiffres principaux
          total_submissions: parseInt(stats.total_submissions),
          videos_present: parseInt(stats.videos_present),
          videos_pending: parseInt(stats.videos_pending), 
          videos_missing: parseInt(stats.videos_missing),
          qr_codes_generated: parseInt(stats.qr_codes_generated),
          
          // Stockage
          total_storage_mb: totalStorageMB,
          total_storage_gb: parseFloat(totalStorageGB),
          
          // Alertes
          critical_alerts: parseInt(criticalAlerts.rows[0].old_submissions_without_video),
          
          // Détails par statut
          status_breakdown: statusBreakdown.rows,
          
          // Activité récente
          recent_activity: recentActivity.rows,
          
          // Métriques calculées
          video_completion_rate: stats.total_submissions > 0 ? 
            ((stats.videos_present / stats.total_submissions) * 100).toFixed(1) : 0
        },
        generated_at: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Erreur récupération stats vidéo admin:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors du chargement des statistiques vidéo'
      });
    }
  });

  // ========================================
  // GESTION DES SOUMISSIONS AVEC FILTRES
  // ========================================

  /**
   * GET /admin/api/submissions
   * Liste filtrée des soumissions avec informations vidéo
   */
  router.get('/submissions', async (req, res) => {
    try {
      const {
        page = 1,
        limit = 20,
        search,
        video_status,
        date_from,
        date_to,
        grading_type,
        sort_by = 'created_at',
        sort_order = 'DESC'
      } = req.query;

      let whereConditions = ['1=1'];
      let queryParams = [];
      let paramCount = 0;

      // Filtre de recherche
      if (search && search.trim()) {
        paramCount++;
        whereConditions.push(`(
          submission_id ILIKE $${paramCount} OR 
          customer_email ILIKE $${paramCount} OR 
          card_name ILIKE $${paramCount}
        )`);
        queryParams.push(`%${search.trim()}%`);
      }

      // Filtre statut vidéo
      if (video_status) {
        if (video_status === 'missing') {
          whereConditions.push(`(video_status IS NULL OR video_status = 'pending')`);
        } else if (video_status === 'not_set') {
          whereConditions.push(`video_status IS NULL`);
        } else {
          paramCount++;
          whereConditions.push(`video_status = $${paramCount}`);
          queryParams.push(video_status);
        }
      }

      // Filtre dates
      if (date_from) {
        paramCount++;
        whereConditions.push(`created_at >= $${paramCount}`);
        queryParams.push(date_from);
      }

      if (date_to) {
        paramCount++;
        whereConditions.push(`created_at <= $${paramCount}`);
        queryParams.push(date_to);
      }

      // Filtre type gradation
      if (grading_type) {
        paramCount++;
        whereConditions.push(`grading_type = $${paramCount}`);
        queryParams.push(grading_type);
      }

      // Validation et sécurisation des paramètres de tri
      const allowedSortColumns = [
        'created_at', 'recording_timestamp', 'customer_email', 
        'card_name', 'video_status', 'grading_type'
      ];
      const sortColumn = allowedSortColumns.includes(sort_by) ? sort_by : 'created_at';
      const sortDirection = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      // Requête principale avec pagination
      const offset = (parseInt(page) - 1) * parseInt(limit);
      paramCount++;
      const limitParam = paramCount;
      queryParams.push(parseInt(limit));

      paramCount++;
      const offsetParam = paramCount;
      queryParams.push(offset);

      const query = `
        SELECT 
          id,
          submission_id,
          customer_email,
          card_name,
          card_series,
          grading_type,
          status,
          video_status,
          video_url,
          video_file_size,
          video_duration,
          recording_timestamp,
          qr_code_generated_at,
          qr_code_data IS NOT NULL as has_qr_code,
          created_at,
          price,
          psa_submission_number,
          psa_status
        FROM grading_requests 
        WHERE ${whereConditions.join(' AND ')}
        ORDER BY ${sortColumn} ${sortDirection}
        LIMIT $${limitParam} OFFSET $${offsetParam}
      `;

      const result = await pool.query(query, queryParams);

      // Requête de comptage pour pagination
      const countQuery = `
        SELECT COUNT(*) as total 
        FROM grading_requests 
        WHERE ${whereConditions.join(' AND ')}
      `;

      const countResult = await pool.query(countQuery, queryParams.slice(0, -2)); // Enlever limit et offset
      const totalCount = parseInt(countResult.rows[0].total);

      // Enrichir les données avec des infos calculées
      const enrichedSubmissions = result.rows.map(row => {
        const videoSizeMB = row.video_file_size ? Math.round(row.video_file_size / 1024 / 1024) : null;
        const daysWithoutVideo = row.video_status === 'pending' || !row.video_status ? 
          Math.floor((new Date() - new Date(row.created_at)) / (1000 * 60 * 60 * 24)) : null;

        return {
          ...row,
          video_size_mb: videoSizeMB,
          days_without_video: daysWithoutVideo,
          needs_attention: daysWithoutVideo > 2,
          video_access_url: row.video_status === 'uploaded' ? 
            `/api/video/file/${row.submission_id}` : null
        };
      });

      res.json({
        success: true,
        submissions: enrichedSubmissions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount,
          total_pages: Math.ceil(totalCount / parseInt(limit)),
          has_next: offset + parseInt(limit) < totalCount,
          has_prev: parseInt(page) > 1
        },
        filters: {
          search,
          video_status,
          date_from,
          date_to,
          grading_type,
          sort_by: sortColumn,
          sort_order: sortDirection
        }
      });

    } catch (error) {
      console.error('❌ Erreur récupération soumissions admin:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors du chargement des soumissions'
      });
    }
  });

  // ========================================
  // ACTIONS SUR LES VIDÉOS
  // ========================================

  /**
   * GET /admin/api/submission/:submission_id/details
   * Détails complets d'une soumission avec informations vidéo
   */
  router.get('/submission/:submission_id/details', async (req, res) => {
    try {
      const { submission_id } = req.params;
      
      let sanitizedId;
      try {
        sanitizedId = sanitizeSubmissionId(submission_id);
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: 'ID de soumission invalide'
        });
      }

      const result = await pool.query(`
        SELECT 
          *,
          qr_code_data IS NOT NULL as has_qr_code,
          video_url IS NOT NULL as has_video
        FROM grading_requests 
        WHERE submission_id = $1
      `, [sanitizedId]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Soumission non trouvée'
        });
      }

      const submission = result.rows[0];

      // Enrichir avec des métadonnées utiles
      const enrichedData = {
        ...submission,
        video_size_mb: submission.video_file_size ? 
          Math.round(submission.video_file_size / 1024 / 1024) : null,
        days_since_creation: Math.floor(
          (new Date() - new Date(submission.created_at)) / (1000 * 60 * 60 * 24)
        ),
        video_access_url: submission.video_status === 'uploaded' ? 
          `/api/video/file/${sanitizedId}` : null,
        qr_code_url: submission.qr_code_data ? 
          `/api/public/qr/${sanitizedId}` : null,
        recording_url: submission.qr_code_data ? 
          JSON.parse(submission.qr_code_data).recording_url : null
      };

      res.json({
        success: true,
        submission: enrichedData
      });

    } catch (error) {
      console.error('❌ Erreur récupération détails soumission:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors du chargement des détails'
      });
    }
  });

  /**
   * POST /admin/api/video/regenerate-qr/:submission_id
   * Régénérer le QR code pour une soumission
   */
  router.post('/video/regenerate-qr/:submission_id', async (req, res) => {
    try {
      const { submission_id } = req.params;
      
      let sanitizedId;
      try {
        sanitizedId = sanitizeSubmissionId(submission_id);
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: 'ID de soumission invalide'
        });
      }

      // Vérifier que la soumission existe
      const submissionResult = await pool.query(`
        SELECT id, customer_email, card_name, grading_type, qr_code_data
        FROM grading_requests 
        WHERE submission_id = $1
      `, [sanitizedId]);

      if (submissionResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Soumission non trouvée'
        });
      }

      const submission = submissionResult.rows[0];

      // Log de l'action admin
      console.log(`🔄 Admin régénère QR code pour ${sanitizedId}`);

      // Générer le nouveau QR code
      const qrResult = await generateCompleteQRCode(sanitizedId, {
        card_name: submission.card_name,
        customer_email: submission.customer_email,
        grading_type: submission.grading_type
      });

      if (!qrResult.success) {
        return res.status(500).json({
          success: false,
          message: `Erreur génération QR: ${qrResult.message}`
        });
      }

      // Mettre à jour la base de données
      await pool.query(`
        UPDATE grading_requests 
        SET 
          qr_code_data = $1,
          qr_code_generated_at = CURRENT_TIMESTAMP,
          qr_code_image_path = $2,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
      `, [
        qrResult.qr_code_data,
        qrResult.qr_code_image_path,
        submission.id
      ]);

      console.log(`✅ QR code régénéré avec succès pour ${sanitizedId}`);

      res.json({
        success: true,
        message: 'QR code régénéré avec succès',
        qr_data: {
          qr_code_url: qrResult.qr_code_url,
          recording_url: qrResult.recording_url,
          generated_at: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('❌ Erreur régénération QR code:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la régénération du QR code'
      });
    }
  });

  /**
   * DELETE /admin/api/video/delete/:submission_id
   * Supprimer la vidéo d'une soumission (avec confirmation)
   */
  router.delete('/video/delete/:submission_id', async (req, res) => {
    try {
      const { submission_id } = req.params;
      const { confirm } = req.body;

      if (!confirm) {
        return res.status(400).json({
          success: false,
          message: 'Confirmation requise pour suppression vidéo'
        });
      }

      let sanitizedId;
      try {
        sanitizedId = sanitizeSubmissionId(submission_id);
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: 'ID de soumission invalide'
        });
      }

      // Récupérer les infos de la vidéo
      const result = await pool.query(`
        SELECT id, video_url, video_file_size 
        FROM grading_requests 
        WHERE submission_id = $1 AND video_status = 'uploaded'
      `, [sanitizedId]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Vidéo non trouvée pour cette soumission'
        });
      }

      const { id, video_url, video_file_size } = result.rows[0];

      // Log de l'action critique
      console.warn(`🗑️ ADMIN DELETE: Suppression vidéo ${sanitizedId} (${Math.round(video_file_size / 1024 / 1024)}MB)`);

      // Supprimer le fichier physique
      if (video_url) {
        try {
          const filePath = path.join(__dirname, '../uploads', video_url);
          await fs.unlink(filePath);
          console.log(`📁 Fichier vidéo supprimé: ${filePath}`);
        } catch (fileError) {
          console.warn(`⚠️ Impossible de supprimer le fichier physique: ${fileError.message}`);
        }
      }

      // Mettre à jour la base de données
      await pool.query(`
        UPDATE grading_requests 
        SET 
          video_url = NULL,
          video_status = 'pending',
          video_file_size = NULL,
          video_duration = NULL,
          recording_timestamp = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [id]);

      console.log(`✅ Vidéo supprimée avec succès pour ${sanitizedId}`);

      res.json({
        success: true,
        message: 'Vidéo supprimée avec succès',
        deleted_data: {
          file_size_mb: Math.round(video_file_size / 1024 / 1024),
          deleted_at: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('❌ Erreur suppression vidéo:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la suppression de la vidéo'
      });
    }
  });

  // ========================================
  // OUTILS D'ADMINISTRATION
  // ========================================

  /**
   * POST /admin/api/video/cleanup
   * Nettoyage système - supprimer fichiers orphelins et anciens
   */
  router.post('/video/cleanup', async (req, res) => {
    try {
      const { 
        clean_orphans = false, 
        clean_old_files = false, 
        days_threshold = 180,
        dry_run = true 
      } = req.body;

      console.log(`🧹 ADMIN CLEANUP: Lancement nettoyage (dry_run: ${dry_run})`);

      let cleanupResults = {
        orphaned_files: [],
        old_files: [],
        database_mismatches: [],
        space_freed_mb: 0,
        errors: []
      };

      // 1. Identifier les fichiers orphelins (fichiers sans entrée DB)
      if (clean_orphans) {
        try {
          const videosDir = path.join(__dirname, '../uploads/videos');
          
          // Fonction récursive pour scanner tous les fichiers vidéo
          const findAllVideoFiles = async (dir, relativePath = '') => {
            let files = [];
            try {
              const items = await fs.readdir(dir, { withFileTypes: true });
              
              for (const item of items) {
                const itemPath = path.join(dir, item.name);
                const relativeItemPath = path.join(relativePath, item.name);
                
                if (item.isDirectory()) {
                  files = files.concat(await findAllVideoFiles(itemPath, relativeItemPath));
                } else if (item.name.match(/\.(webm|mp4|mov)$/i)) {
                  const stats = await fs.stat(itemPath);
                  files.push({
                    full_path: itemPath,
                    relative_path: relativeItemPath,
                    size: stats.size,
                    created: stats.birthtime
                  });
                }
              }
            } catch (error) {
              cleanupResults.errors.push(`Erreur scan dossier ${dir}: ${error.message}`);
            }
            return files;
          };

          const allVideoFiles = await findAllVideoFiles(videosDir);
          
          // Vérifier chaque fichier contre la DB
          for (const file of allVideoFiles) {
            const dbResult = await pool.query(
              'SELECT submission_id FROM grading_requests WHERE video_url = $1',
              [file.relative_path.replace(/\\/g, '/')]
            );

            if (dbResult.rows.length === 0) {
              cleanupResults.orphaned_files.push({
                ...file,
                age_days: Math.floor((new Date() - file.created) / (1000 * 60 * 60 * 24))
              });
              cleanupResults.space_freed_mb += Math.round(file.size / 1024 / 1024);
            }
          }

          // Supprimer les fichiers orphelins si pas en dry_run
          if (!dry_run && cleanupResults.orphaned_files.length > 0) {
            for (const file of cleanupResults.orphaned_files) {
              try {
                await fs.unlink(file.full_path);
                console.log(`🗑️ Fichier orphelin supprimé: ${file.relative_path}`);
              } catch (error) {
                cleanupResults.errors.push(`Impossible de supprimer ${file.relative_path}: ${error.message}`);
              }
            }
          }

        } catch (error) {
          cleanupResults.errors.push(`Erreur nettoyage orphelins: ${error.message}`);
        }
      }

      // 2. Identifier les anciens fichiers
      if (clean_old_files) {
        const thresholdDate = new Date();
        thresholdDate.setDate(thresholdDate.getDate() - parseInt(days_threshold));

        const oldFilesResult = await pool.query(`
          SELECT id, submission_id, video_url, video_file_size, recording_timestamp
          FROM grading_requests 
          WHERE video_status = 'uploaded' 
            AND recording_timestamp < $1
            AND status IN ('completed', 'cancelled')
        `, [thresholdDate]);

        cleanupResults.old_files = oldFilesResult.rows;
        
        if (!dry_run && cleanupResults.old_files.length > 0) {
          // Supprimer les anciens fichiers
          for (const row of cleanupResults.old_files) {
            try {
              const filePath = path.join(__dirname, '../uploads', row.video_url);
              await fs.unlink(filePath);
              
              // Mettre à jour la DB
              await pool.query(`
                UPDATE grading_requests 
                SET video_url = NULL, video_status = 'archived'
                WHERE id = $1
              `, [row.id]);
              
              cleanupResults.space_freed_mb += Math.round(row.video_file_size / 1024 / 1024);
              console.log(`📦 Ancien fichier archivé: ${row.submission_id}`);
            } catch (error) {
              cleanupResults.errors.push(`Erreur archivage ${row.submission_id}: ${error.message}`);
            }
          }
        }
      }

      // 3. Vérifier cohérence DB vs fichiers
      const dbVideos = await pool.query(`
        SELECT submission_id, video_url 
        FROM grading_requests 
        WHERE video_status = 'uploaded' AND video_url IS NOT NULL
      `);

      for (const row of dbVideos.rows) {
        const filePath = path.join(__dirname, '../uploads', row.video_url);
        try {
          await fs.access(filePath);
        } catch (error) {
          cleanupResults.database_mismatches.push({
            submission_id: row.submission_id,
            missing_file: row.video_url
          });
        }
      }

      console.log(`🧹 Nettoyage ${dry_run ? 'simulé' : 'effectué'} - Espace libérable: ${cleanupResults.space_freed_mb}MB`);

      res.json({
        success: true,
        dry_run,
        cleanup_results: cleanupResults,
        summary: {
          orphaned_files_count: cleanupResults.orphaned_files.length,
          old_files_count: cleanupResults.old_files.length,
          database_mismatches_count: cleanupResults.database_mismatches.length,
          total_space_freed_mb: cleanupResults.space_freed_mb,
          errors_count: cleanupResults.errors.length
        }
      });

    } catch (error) {
      console.error('❌ Erreur nettoyage système:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors du nettoyage système'
      });
    }
  });

  /**
   * GET /admin/api/video/system-status
   * État du système vidéo et métriques de performance
   */
  router.get('/video/system-status', async (req, res) => {
    try {
      // Calculs de stockage
      const storageStats = await pool.query(`
        SELECT 
          COUNT(*) as total_videos,
          SUM(video_file_size) as total_size,
          AVG(video_file_size) as avg_size,
          MIN(recording_timestamp) as oldest_video,
          MAX(recording_timestamp) as newest_video
        FROM grading_requests 
        WHERE video_status = 'uploaded' AND video_file_size IS NOT NULL
      `);

      // Vérifications d'intégrité
      const integrityChecks = {
        videos_without_qr: 0,
        qr_without_videos: 0,
        missing_files: 0
      };

      // Vidéos sans QR
      const videosWithoutQR = await pool.query(`
        SELECT COUNT(*) as count 
        FROM grading_requests 
        WHERE video_status = 'uploaded' AND qr_code_data IS NULL
      `);
      integrityChecks.videos_without_qr = parseInt(videosWithoutQR.rows[0].count);

      // QR sans vidéos
      const qrWithoutVideos = await pool.query(`
        SELECT COUNT(*) as count 
        FROM grading_requests 
        WHERE qr_code_data IS NOT NULL AND (video_status IS NULL OR video_status != 'uploaded')
      `);
      integrityChecks.qr_without_videos = parseInt(qrWithoutVideos.rows[0].count);

      const stats = storageStats.rows[0];

      res.json({
        success: true,
        system_status: {
          storage: {
            total_videos: parseInt(stats.total_videos) || 0,
            total_size_mb: Math.round((parseInt(stats.total_size) || 0) / 1024 / 1024),
            total_size_gb: ((parseInt(stats.total_size) || 0) / 1024 / 1024 / 1024).toFixed(2),
            average_video_mb: Math.round((parseInt(stats.avg_size) || 0) / 1024 / 1024),
            oldest_video: stats.oldest_video,
            newest_video: stats.newest_video
          },
          integrity: integrityChecks,
          health_score: calculateSystemHealthScore(integrityChecks),
          last_checked: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('❌ Erreur état système vidéo:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la vérification de l\'état système'
      });
    }
  });

  return router;
}

/**
 * Calculer un score de santé du système (0-100)
 */
function calculateSystemHealthScore(integrityChecks) {
  let score = 100;
  
  // Pénalités pour problèmes d'intégrité
  score -= integrityChecks.videos_without_qr * 2;
  score -= integrityChecks.qr_without_videos * 3;
  score -= integrityChecks.missing_files * 5;
  
  return Math.max(0, Math.min(100, score));
}