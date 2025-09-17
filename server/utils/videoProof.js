import { pool } from '../database/init.js';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import QRCode from 'qrcode';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Secure token configuration - CRITICAL SECURITY
// Determine environment safely
const isProduction = process.env.NODE_ENV === 'production' || 
                     process.env.REPL_SLUG && process.env.REPL_SLUG.includes('prod');

// SECURITY CRITICAL: Fail-fast in production if PSA_SECRET missing
if (isProduction && !process.env.PSA_SECRET) {
  console.error('🚨 CRITICAL SECURITY ERROR: PSA_SECRET is required in production environment!');
  console.error('🚨 Cannot start application without secure PSA_SECRET.');
  console.error('🚨 Please configure PSA_SECRET environment variable.');
  process.exit(1);
}

// Use secure PSA_SECRET or development fallback
const PSA_SECRET = process.env.PSA_SECRET || 
  (isProduction ? null : 'dev-fallback-key-NOT-FOR-PRODUCTION-' + Date.now());

if (!process.env.PSA_SECRET) {
  if (isProduction) {
    // This should never execute due to process.exit(1) above
    throw new Error('PSA_SECRET required in production');
  } else {
    console.warn('⚠️ DEVELOPMENT: Using fallback PSA_SECRET. Configure PSA_SECRET for production!');
  }
} else {
  console.log('✅ PSA_SECRET configured securely from environment variable');
}

const TOKEN_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const VIDEO_ACCESS_TTL = 60 * 60 * 1000; // 1 hour for video access URLs

/**
 * Utilitaires pour le système de preuve vidéo PSA
 */

/**
 * Sanitize submission ID for secure filename usage
 * @param {string} submissionId - Raw submission ID
 * @returns {string} Sanitized submission ID (alphanumeric + dashes only)
 */
export const sanitizeSubmissionId = (submissionId) => {
  if (!submissionId || typeof submissionId !== 'string') {
    throw new Error('Invalid submission ID provided');
  }
  
  // Allow only alphanumeric characters and dashes
  const sanitized = submissionId.replace(/[^a-zA-Z0-9-]/g, '');
  
  if (sanitized.length === 0 || sanitized.length > 50) {
    throw new Error('Invalid submission ID format');
  }
  
  return sanitized;
};

/**
 * Generate secure HMAC token for video upload authorization
 * @param {string} submissionId - Submission ID
 * @param {number} timestamp - Token timestamp
 * @param {string} action - Action type ('upload', 'access')
 * @returns {string} HMAC token
 */
export const generateSecureToken = (submissionId, timestamp, action = 'upload') => {
  const data = `${submissionId}-${timestamp}-${action}`;
  return crypto
    .createHmac('sha256', PSA_SECRET)
    .update(data)
    .digest('hex')
    .substring(0, 32);
};

/**
 * Validate secure HMAC token
 * @param {string} submissionId - Submission ID
 * @param {string} token - Token to validate
 * @param {number} timestamp - Token timestamp
 * @param {string} action - Action type ('upload', 'access')
 * @returns {Object} Validation result
 */
export const validateSecureToken = (submissionId, token, timestamp, action = 'upload') => {
  try {
    const now = Date.now();
    const tokenTimestamp = parseInt(timestamp);
    
    // Check expiration based on action
    const ttl = action === 'access' ? VIDEO_ACCESS_TTL : TOKEN_TTL;
    if (now - tokenTimestamp > ttl) {
      return {
        valid: false,
        reason: 'Token expired'
      };
    }
    
    // Generate expected token
    const expectedToken = generateSecureToken(submissionId, timestamp, action);
    
    if (token !== expectedToken) {
      return {
        valid: false,
        reason: 'Invalid token signature'
      };
    }
    
    return {
      valid: true,
      timestamp: tokenTimestamp
    };
  } catch (error) {
    return {
      valid: false,
      reason: 'Token validation error'
    };
  }
};

/**
 * Generate upload token for video submission
 * @param {string} submissionId - Submission ID
 * @param {number} validFor - Validity period in milliseconds (default 24h)
 * @returns {Object} Token data
 */
export const generateUploadToken = (submissionId, validFor = TOKEN_TTL) => {
  const timestamp = Date.now();
  const token = generateSecureToken(submissionId, timestamp, 'upload');
  
  return {
    token,
    timestamp,
    expires_at: timestamp + validFor,
    valid_for_ms: validFor
  };
};

/**
 * Obtient l'URL de base du serveur (domaine public Replit ou localhost)
 * @returns {string} URL de base complète
 */
export const getBaseURL = () => {
  // Priorité aux domaines Replit publics
  if (process.env.REPLIT_DOMAINS) {
    const domains = process.env.REPLIT_DOMAINS.split(',');
    return `https://${domains[0].trim()}`;
  }
  
  // Fallback sur l'URL de développement
  return process.env.REPL_URL || 'http://localhost:5000';
};

/**
 * Génère une URL sécurisée pour l'enregistrement vidéo
 * @param {string} submission_id - ID de soumission PSA
 * @param {number} validFor - Période de validité en ms (défaut 24h)
 * @returns {string} URL d'enregistrement avec token de sécurité
 */
export const generateRecordingURL = (submission_id, validFor = TOKEN_TTL) => {
  const timestamp = Date.now();
  const token = generateSecureToken(submission_id, timestamp, 'recording');

  const baseURL = getBaseURL();
  return `${baseURL}/video-record?id=${submission_id}&token=${token}&ts=${timestamp}`;
};

/**
 * Génère les données complètes du QR code pour une soumission (UNIFIE)
 * @param {string} submission_id - ID de soumission PSA
 * @param {Object} requestData - Données de la demande
 * @returns {Object} Données structurées du QR code
 */
export const generateQRCodeData = (submission_id, requestData = {}) => {
  const recordingURL = generateRecordingURL(submission_id);
  const timestamp = new Date().toISOString();
  
  const qrData = {
    submission_id: submission_id,
    recording_url: recordingURL,
    created_at: timestamp, // Unified field name
    card_name: requestData.card_name || '',
    customer_email: requestData.customer_email || '',
    grading_type: requestData.grading_type || '',
    verification_hash: crypto
      .createHmac('sha256', PSA_SECRET)
      .update(`${submission_id}-${timestamp}-verify`)
      .digest('hex')
      .substring(0, 16),
    version: '2.0' // Updated version for unified system
  };

  return {
    qr_code_data: JSON.stringify(qrData),
    qr_code_generated_at: new Date(),
    recording_url: recordingURL
  };
};

/**
 * Génère un buffer d'image QR code à partir de données
 * @param {string} data - Données à encoder dans le QR code
 * @param {Object} options - Options de génération
 * @returns {Promise<Buffer>} Buffer de l'image QR en PNG
 */
export const generateQRCodeImageBuffer = async (data, options = {}) => {
  try {
    const defaultOptions = {
      type: 'png',
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      },
      errorCorrectionLevel: 'M'
    };

    const qrOptions = { ...defaultOptions, ...options };
    
    console.log(`🔄 Génération QR code - Taille: ${qrOptions.width}x${qrOptions.width}`);
    
    const buffer = await QRCode.toBuffer(data, qrOptions);
    
    console.log(`✅ QR code généré - Taille du buffer: ${buffer.length} bytes`);
    
    return buffer;
  } catch (error) {
    console.error('❌ Erreur génération QR code:', error);
    throw new Error(`Impossible de générer le QR code: ${error.message}`);
  }
};

/**
 * Sauvegarde l'image QR code sur le disque
 * @param {string} submission_id - ID de soumission PSA
 * @param {Buffer} imageBuffer - Buffer de l'image QR
 * @returns {Promise<string>} Chemin relatif du fichier sauvegardé
 */
export const saveQRCodeImage = async (submission_id, imageBuffer) => {
  try {
    const sanitizedId = sanitizeSubmissionId(submission_id);
    const timestamp = Date.now();
    const filename = `qr-${sanitizedId}-${timestamp}.png`;
    const qrDir = path.join(__dirname, '../uploads/qr-codes');
    const filepath = path.join(qrDir, filename);

    await fs.mkdir(qrDir, { recursive: true });
    await fs.writeFile(filepath, imageBuffer);

    console.log(`✅ QR code sauvegardé: ${filename}`);
    return `qr-codes/${filename}`;
  } catch (error) {
    console.error('❌ Erreur sauvegarde QR code:', error);
    throw new Error(`Impossible de sauvegarder le QR code: ${error.message}`);
  }
};

/**
 * Génère automatiquement le QR code complet pour une soumission (UNIFIE)
 * @param {string} submission_id - ID de soumission PSA
 * @param {Object} requestData - Données de la demande
 * @returns {Promise<Object>} Informations complètes du QR code généré
 */
export const generateCompleteQRCode = async (submission_id, requestData = {}) => {
  try {
    const sanitizedId = sanitizeSubmissionId(submission_id);
    console.log(`🎯 Génération QR code pour submission: ${sanitizedId}`);

    // 1. Générer les données du QR code
    const qrCodeData = generateQRCodeData(sanitizedId, requestData);
    
    // 2. Générer l'image QR avec l'URL directe (pas le JSON)
    const imageBuffer = await generateQRCodeImageBuffer(qrCodeData.recording_url);
    
    // 3. Sauvegarder l'image
    const imagePath = await saveQRCodeImage(sanitizedId, imageBuffer);
    
    // 4. CRITIQUE: Mettre à jour la base de données avec le nouveau QR code
    const updateResult = await pool.query(
      `UPDATE grading_requests 
       SET qr_code_image_path = $1,
           qr_code_data = $2,
           qr_code_generated_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE submission_id = $3`,
      [imagePath, JSON.stringify(qrCodeData.qr_code_data), sanitizedId]
    );

    if (updateResult.rowCount === 0) {
      throw new Error('Soumission non trouvée pour mise à jour');
    }

    console.log(`✅ Base de données mise à jour avec nouveau QR code pour ${sanitizedId}`);
    
    // 5. Construire l'URL complète pour accéder au QR code
    const qrCodeURL = `/api/public/qr/${sanitizedId}`;
    
    console.log(`✅ QR code complet généré pour ${sanitizedId}`);
    
    return {
      success: true,
      qr_code_data: qrCodeData.qr_code_data,
      qr_code_generated_at: qrCodeData.qr_code_generated_at,
      recording_url: qrCodeData.recording_url,
      qr_code_image_path: imagePath,
      qr_code_url: qrCodeURL,
      message: 'QR code généré avec succès'
    };
  } catch (error) {
    console.error(`❌ Erreur génération QR code pour ${submission_id}:`, error);
    return {
      success: false,
      message: `Erreur génération QR code: ${error.message}`
    };
  }
};

/**
 * Met à jour le statut vidéo d'une demande de grading
 * @param {number} requestId - ID de la demande
 * @param {string} status - Nouveau statut ('pending', 'recording', 'uploaded', 'error')
 * @param {Object} additionalData - Données supplémentaires (optionnel)
 * @returns {Promise<Object>} Résultat de la mise à jour
 */
export const updateVideoStatus = async (requestId, status, additionalData = {}) => {
  try {
    const updateFields = ['video_status = $2', 'updated_at = CURRENT_TIMESTAMP'];
    const values = [requestId, status];
    let paramCounter = 3;

    // Ajouter les champs supplémentaires si fournis
    if (additionalData.video_url) {
      updateFields.push(`video_url = $${paramCounter}`);
      values.push(additionalData.video_url);
      paramCounter++;
    }

    if (additionalData.recording_timestamp) {
      updateFields.push(`recording_timestamp = $${paramCounter}`);
      values.push(additionalData.recording_timestamp);
      paramCounter++;
    }

    if (additionalData.video_file_size) {
      updateFields.push(`video_file_size = $${paramCounter}`);
      values.push(additionalData.video_file_size);
      paramCounter++;
    }

    if (additionalData.video_duration) {
      updateFields.push(`video_duration = $${paramCounter}`);
      values.push(additionalData.video_duration);
      paramCounter++;
    }

    const query = `
      UPDATE grading_requests 
      SET ${updateFields.join(', ')}
      WHERE id = $1
      RETURNING *
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      throw new Error('Demande de grading non trouvée');
    }

    return {
      success: true,
      request: result.rows[0],
      message: `Statut vidéo mis à jour: ${status}`
    };
  } catch (error) {
    console.error('Erreur lors de la mise à jour du statut vidéo:', error);
    return {
      success: false,
      message: error.message
    };
  }
};

/**
 * Met à jour les données QR en base de données (UNIFIE)
 * @param {number} requestId - ID de la demande en base
 * @param {Object} qrData - Données QR à sauvegarder
 * @returns {Promise<Object>} Résultat de la mise à jour
 */
export const updateQRCodeData = async (requestId, qrData) => {
  try {
    const result = await pool.query(`
      UPDATE grading_requests 
      SET qr_code_data = $2, 
          qr_code_generated_at = $3,
          qr_code_image_path = $4,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `, [
      requestId, 
      qrData.qr_code_data, 
      qrData.qr_code_generated_at,
      qrData.qr_code_image_path || null
    ]);

    if (result.rows.length === 0) {
      throw new Error('Demande de grading non trouvée');
    }

    console.log(`✅ QR code mis à jour en base pour demande ID: ${requestId}`);
    
    return {
      success: true,
      request: result.rows[0],
      message: 'QR code mis à jour en base de données'
    };
  } catch (error) {
    console.error('❌ Erreur mise à jour QR en base:', error);
    return {
      success: false,
      message: error.message
    };
  }
};

/**
 * Récupère l'image QR code depuis le système de fichiers
 * @param {string} submission_id - ID de soumission
 * @returns {Promise<Object>} Buffer de l'image et métadonnées
 */
export const getQRCodeImage = async (submission_id) => {
  try {
    const sanitizedId = sanitizeSubmissionId(submission_id);
    
    // Récupérer les infos depuis la base de données
    const result = await pool.query(
      'SELECT qr_code_image_path, qr_code_data FROM grading_requests WHERE submission_id = $1 LIMIT 1',
      [sanitizedId]
    );

    if (result.rows.length === 0) {
      throw new Error('Soumission non trouvée');
    }

    const { qr_code_image_path } = result.rows[0];
    
    if (!qr_code_image_path) {
      throw new Error('QR code non généré pour cette soumission');
    }

    // Construire le chemin complet
    const fullPath = path.join(__dirname, '../uploads', qr_code_image_path);

    // Vérifier que le fichier existe
    try {
      await fs.access(fullPath);
    } catch {
      throw new Error('Fichier QR code non trouvé');
    }

    // Lire le fichier
    const imageBuffer = await fs.readFile(fullPath);

    return {
      success: true,
      imageBuffer: imageBuffer,
      mimeType: 'image/png',
      filename: path.basename(qr_code_image_path)
    };
  } catch (error) {
    console.error(`❌ Erreur récupération QR code pour ${submission_id}:`, error);
    return {
      success: false,
      message: error.message
    };
  }
};

/**
 * Valide les données d'un QR code scanné (UNIFIE)
 * @param {string} qrCodeData - Données JSON du QR code
 * @returns {Promise<Object>} Résultat de la validation
 */
export const validateQRCodeData = async (qrCodeData) => {
  try {
    const qrData = JSON.parse(qrCodeData);
    const { submission_id, verification_hash, recording_url, version } = qrData;

    if (!submission_id || !verification_hash) {
      throw new Error('QR code invalide: données manquantes');
    }

    // Validation version (support legacy)
    if (version && parseFloat(version) < 2.0) {
      console.warn(`QR code version ancienne détectée: ${version}`);
    }

    const sanitizedId = sanitizeSubmissionId(submission_id);
    
    const result = await pool.query(`
      SELECT * FROM grading_requests 
      WHERE submission_id = $1 
      AND qr_code_data IS NOT NULL
    `, [sanitizedId]);

    if (result.rows.length === 0) {
      throw new Error('Demande non trouvée pour ce QR code');
    }

    const request = result.rows[0];
    const storedQRData = JSON.parse(request.qr_code_data);
    
    // Vérifier le hash de vérification avec HMAC
    if (storedQRData.verification_hash !== verification_hash) {
      throw new Error('QR code invalide: hash de vérification incorrect');
    }

    console.log(`✅ QR code validé pour submission: ${sanitizedId}`);

    return {
      success: true,
      request: request,
      qr_data: storedQRData,
      submission_id: sanitizedId
    };
  } catch (error) {
    console.error('Erreur lors de la validation du QR code:', error);
    return {
      success: false,
      message: error.message
    };
  }
};

/**
 * Recherche une demande de grading par les données du QR code (ALIAS pour compatibilité)
 * @param {string} qrCodeData - Données JSON du QR code
 * @returns {Promise<Object>} Demande trouvée ou erreur
 */
export const findRequestByQRCode = validateQRCodeData;

/**
 * Génère une URL sécurisée pour accéder à une vidéo
 * @param {string} submissionId - Submission ID
 * @param {number} validFor - Validity period in milliseconds (default 1h)
 * @returns {Object} Secure URL data
 */
export const generateSecureVideoURL = (submissionId, validFor = VIDEO_ACCESS_TTL) => {
  const timestamp = Date.now();
  const token = generateSecureToken(submissionId, timestamp, 'access');
  
  return {
    url: `/api/video/file/${submissionId}?token=${token}&ts=${timestamp}`,
    token,
    timestamp,
    expires_at: timestamp + validFor,
    valid_for_ms: validFor
  };
};

/**
 * Valide une URL sécurisée de vidéo
 * @param {string} submissionId - Submission ID
 * @param {string} token - Token de sécurité
 * @param {string} timestamp - Horodatage
 * @returns {Object} Résultat de validation
 */
export const validateSecureVideoURL = (submissionId, token, timestamp) => {
  return validateSecureToken(submissionId, token, timestamp, 'access');
};

/**
 * Récupère les statistiques du système de preuve vidéo
 * @returns {Promise<Object>} Statistiques du système vidéo
 */
export const getVideoProofStats = async () => {
  try {
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_requests,
        COUNT(*) FILTER (WHERE video_status = 'pending') as pending_videos,
        COUNT(*) FILTER (WHERE video_status = 'recording') as recording_videos,
        COUNT(*) FILTER (WHERE video_status = 'uploaded') as uploaded_videos,
        COUNT(*) FILTER (WHERE video_status = 'error') as error_videos,
        COUNT(*) FILTER (WHERE qr_code_data IS NOT NULL) as qr_codes_generated,
        COALESCE(AVG(video_duration), 0)::INTEGER as avg_video_duration,
        COALESCE(SUM(video_file_size), 0) as total_storage_used
      FROM grading_requests
      WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
    `);

    const recentActivity = await pool.query(`
      SELECT 
        DATE(updated_at) as date,
        COUNT(*) FILTER (WHERE video_status = 'uploaded') as videos_uploaded,
        COUNT(*) FILTER (WHERE qr_code_data IS NOT NULL) as qr_codes_generated
      FROM grading_requests
      WHERE updated_at >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY DATE(updated_at)
      ORDER BY date DESC
    `);

    return {
      success: true,
      stats: stats.rows[0],
      recent_activity: recentActivity.rows
    };
  } catch (error) {
    console.error('Erreur lors de la récupération des statistiques vidéo:', error);
    return {
      success: false,
      message: error.message
    };
  }
};

/**
 * Nettoie les anciennes données vidéo (maintenance)
 * @param {number} daysOld - Nombre de jours pour considérer les données comme anciennes
 * @returns {Promise<Object>} Résultat du nettoyage
 */
export const cleanupOldVideoData = async (daysOld = 90) => {
  try {
    // Nettoyer les demandes avec statut 'error' anciennes
    const cleanupResult = await pool.query(`
      UPDATE grading_requests 
      SET video_url = NULL,
          video_file_size = NULL,
          video_duration = NULL
      WHERE video_status = 'error' 
      AND updated_at < CURRENT_DATE - INTERVAL '${daysOld} days'
      RETURNING id
    `);

    return {
      success: true,
      cleaned_requests: cleanupResult.rows.length,
      message: `${cleanupResult.rows.length} anciennes données vidéo nettoyées`
    };
  } catch (error) {
    console.error('Erreur lors du nettoyage des données vidéo:', error);
    return {
      success: false,
      message: error.message
    };
  }
};

/**
 * Valide les métadonnées d'une vidéo uploadée
 * @param {Object} videoMetadata - Métadonnées de la vidéo
 * @returns {Object} Résultat de la validation
 */
export const validateVideoMetadata = (videoMetadata) => {
  const errors = [];
  const { fileSize, duration, format, resolution } = videoMetadata;

  // Vérifier la taille du fichier (max 500MB)
  if (fileSize && fileSize > 500 * 1024 * 1024) {
    errors.push('Taille de fichier trop importante (max 500MB)');
  }

  // Vérifier la durée (max 10 minutes)
  if (duration && duration > 600) {
    errors.push('Durée de vidéo trop longue (max 10 minutes)');
  }

  // Vérifier le format
  const allowedFormats = ['mp4', 'webm', 'mov'];
  if (format && !allowedFormats.includes(format.toLowerCase())) {
    errors.push(`Format non supporté. Formats autorisés: ${allowedFormats.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
};