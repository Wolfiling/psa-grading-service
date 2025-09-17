import QRCode from 'qrcode';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { pool } from '../database/init.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Générateur QR pour le système de preuve vidéo PSA
 */

/**
 * Génère une URL sécurisée pour l'enregistrement vidéo
 * @param {string} submission_id - ID de soumission PSA
 * @returns {string} URL d'enregistrement avec token de sécurité
 */
export const generateRecordingURL = (submission_id) => {
  // Générer un token de sécurité basé sur l'ID et un timestamp
  const timestamp = Date.now();
  const token = crypto
    .createHash('sha256')
    .update(`${submission_id}-${timestamp}-${process.env.PSA_SECRET || 'psa-secret'}`)
    .digest('hex')
    .substring(0, 16);

  // URL complète incluant le domaine Replit
  // Priorité aux domaines Replit publics
  const baseURL = process.env.REPLIT_DOMAINS ? 
    `https://${process.env.REPLIT_DOMAINS.split(',')[0].trim()}` : 
    (process.env.REPL_URL || 'http://localhost:5000');
  return `${baseURL}/video-record?id=${submission_id}&token=${token}&ts=${timestamp}`;
};

/**
 * Génère les données complètes du QR code pour une soumission
 * @param {string} submission_id - ID de soumission PSA
 * @param {Object} requestData - Données de la demande (optionnel)
 * @returns {Object} Données structurées du QR code
 */
export const generateQRCodeDataForSubmission = (submission_id, requestData = {}) => {
  const recordingURL = generateRecordingURL(submission_id);
  
  const qrData = {
    submission_id: submission_id,
    recording_url: recordingURL,
    created_at: new Date().toISOString(),
    card_name: requestData.card_name || '',
    customer_email: requestData.customer_email || '',
    grading_type: requestData.grading_type || '',
    verification_hash: crypto
      .createHash('sha256')
      .update(`${submission_id}-${Date.now()}-verify`)
      .digest('hex')
      .substring(0, 16),
    version: '1.0'
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
export const getQRCodeImageBuffer = async (data, options = {}) => {
  try {
    const defaultOptions = {
      type: 'png',
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',  // Couleur des modules QR
        light: '#FFFFFF'  // Couleur de fond
      },
      errorCorrectionLevel: 'M' // Niveau de correction d'erreur moyen
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
    // Créer le nom de fichier sécurisé
    const timestamp = Date.now();
    const filename = `qr-${submission_id}-${timestamp}.png`;
    const qrDir = path.join(__dirname, '../uploads/qr-codes');
    const filepath = path.join(qrDir, filename);

    // Créer le dossier si nécessaire
    await fs.mkdir(qrDir, { recursive: true });

    // Sauvegarder l'image
    await fs.writeFile(filepath, imageBuffer);

    console.log(`✅ QR code sauvegardé: ${filename}`);

    // Retourner le chemin relatif pour stockage en base
    return `qr-codes/${filename}`;
  } catch (error) {
    console.error('❌ Erreur sauvegarde QR code:', error);
    throw new Error(`Impossible de sauvegarder le QR code: ${error.message}`);
  }
};

/**
 * Génère automatiquement le QR code complet pour une soumission
 * @param {string} submission_id - ID de soumission PSA
 * @param {Object} requestData - Données de la demande
 * @returns {Promise<Object>} Informations complètes du QR code généré
 */
export const generateQRCodeForSubmission = async (submission_id, requestData = {}) => {
  try {
    console.log(`🎯 Génération QR code pour submission: ${submission_id}`);

    // 1. Générer les données du QR code
    const qrCodeData = generateQRCodeDataForSubmission(submission_id, requestData);
    
    // 2. Générer l'image QR avec l'URL directe (pas le JSON)
    const imageBuffer = await getQRCodeImageBuffer(qrCodeData.recording_url);
    
    // 3. Sauvegarder l'image
    const imagePath = await saveQRCodeImage(submission_id, imageBuffer);
    
    // 4. Construire l'URL complète pour accéder au QR code
    const qrCodeURL = `/api/public/qr/${submission_id}`;
    
    console.log(`✅ QR code complet généré pour ${submission_id}`);
    
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
 * Met à jour les données QR en base de données
 * @param {number} requestId - ID de la demande en base
 * @param {Object} qrData - Données QR à sauvegarder
 * @returns {Promise<Object>} Résultat de la mise à jour
 */
export const updateQRCodeInDatabase = async (requestId, qrData) => {
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
      qrData.qr_code_image_path
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
 * Récupère l'image QR code depuis le système de fichiers (TOUJOURS LE PLUS RÉCENT)
 * @param {string} submission_id - ID de soumission
 * @returns {Promise<Object>} Buffer de l'image et métadonnées
 */
export const getQRCodeImage = async (submission_id) => {
  try {
    // Récupérer les infos depuis la base de données
    const result = await pool.query(
      'SELECT qr_code_image_path, qr_code_data FROM grading_requests WHERE submission_id = $1 LIMIT 1',
      [submission_id]
    );

    if (result.rows.length === 0) {
      throw new Error('Soumission non trouvée');
    }

    const { qr_code_image_path } = result.rows[0];
    
    if (!qr_code_image_path) {
      throw new Error('QR code non généré pour cette soumission');
    }

    // 🔧 CORRECTION: Chercher le fichier QR le plus récent pour cette soumission
    const qrDir = path.join(__dirname, '../uploads/qr-codes');
    const qrPattern = `qr-${submission_id}-`;
    
    try {
      const files = await fs.readdir(qrDir);
      const qrFiles = files
        .filter(file => file.startsWith(qrPattern) && file.endsWith('.png'))
        .map(file => ({
          name: file,
          path: path.join(qrDir, file),
          timestamp: parseInt(file.replace(qrPattern, '').replace('.png', ''))
        }))
        .sort((a, b) => b.timestamp - a.timestamp); // Plus récent en premier

      if (qrFiles.length === 0) {
        throw new Error('Aucun fichier QR code trouvé');
      }

      const mostRecentFile = qrFiles[0];
      console.log(`📁 QR code le plus récent: ${mostRecentFile.name}`);
      
      // Lire le fichier le plus récent
      const imageBuffer = await fs.readFile(mostRecentFile.path);

      return {
        success: true,
        imageBuffer: imageBuffer,
        mimeType: 'image/png',
        filename: mostRecentFile.name
      };
    } catch (fsError) {
      // Fallback: utiliser le chemin de la base de données
      const fullPath = path.join(__dirname, '../uploads', qr_code_image_path);
      const imageBuffer = await fs.readFile(fullPath);

      return {
        success: true,
        imageBuffer: imageBuffer,
        mimeType: 'image/png',
        filename: path.basename(qr_code_image_path)
      };
    }
  } catch (error) {
    console.error(`❌ Erreur récupération QR code pour ${submission_id}:`, error);
    return {
      success: false,
      message: error.message
    };
  }
};

/**
 * Valide les données d'un QR code scanné
 * @param {string} qrCodeData - Données JSON du QR code
 * @returns {Promise<Object>} Résultat de la validation
 */
export const validateQRCodeData = async (qrCodeData) => {
  try {
    // Parser les données du QR code
    const qrData = JSON.parse(qrCodeData);
    const { submission_id, verification_hash, recording_url } = qrData;

    if (!submission_id || !verification_hash) {
      throw new Error('QR code invalide: données manquantes');
    }

    // Vérifier que la soumission existe en base
    const result = await pool.query(`
      SELECT * FROM grading_requests 
      WHERE submission_id = $1 
      AND qr_code_data IS NOT NULL
    `, [submission_id]);

    if (result.rows.length === 0) {
      throw new Error('Soumission non trouvée ou QR code non généré');
    }

    const request = result.rows[0];
    
    // Vérifier le hash de vérification
    const storedQRData = JSON.parse(request.qr_code_data);
    if (storedQRData.verification_hash !== verification_hash) {
      throw new Error('QR code invalide: hash de vérification incorrect');
    }

    return {
      success: true,
      valid: true,
      submission_id: submission_id,
      recording_url: recording_url,
      request: request,
      qr_data: storedQRData
    };
  } catch (error) {
    console.error('❌ Erreur validation QR code:', error);
    return {
      success: false,
      valid: false,
      message: error.message
    };
  }
};

/**
 * Nettoie les anciens QR codes (maintenance)
 * @param {number} daysOld - Nombre de jours pour considérer les QR comme anciens
 * @returns {Promise<Object>} Résultat du nettoyage
 */
export const cleanupOldQRCodes = async (daysOld = 30) => {
  try {
    // Récupérer les anciens QR codes à supprimer
    const oldQRs = await pool.query(`
      SELECT id, submission_id, qr_code_image_path 
      FROM grading_requests 
      WHERE qr_code_generated_at < CURRENT_DATE - INTERVAL '${daysOld} days'
      AND qr_code_image_path IS NOT NULL
    `);

    let deletedFiles = 0;
    let errors = [];

    // Supprimer les fichiers du disque
    for (const qr of oldQRs.rows) {
      try {
        const fullPath = path.join(__dirname, '../uploads', qr.qr_code_image_path);
        await fs.unlink(fullPath);
        deletedFiles++;
        console.log(`🗑️ QR code supprimé: ${qr.submission_id}`);
      } catch (error) {
        errors.push(`Erreur suppression ${qr.submission_id}: ${error.message}`);
      }
    }

    // Nettoyer les références en base
    const cleanupResult = await pool.query(`
      UPDATE grading_requests 
      SET qr_code_image_path = NULL,
          qr_code_data = NULL,
          qr_code_generated_at = NULL
      WHERE qr_code_generated_at < CURRENT_DATE - INTERVAL '${daysOld} days'
      AND qr_code_image_path IS NOT NULL
      RETURNING id
    `);

    return {
      success: true,
      deleted_files: deletedFiles,
      cleaned_records: cleanupResult.rows.length,
      errors: errors,
      message: `Nettoyage terminé: ${deletedFiles} fichiers supprimés, ${cleanupResult.rows.length} enregistrements nettoyés`
    };
  } catch (error) {
    console.error('❌ Erreur nettoyage QR codes:', error);
    return {
      success: false,
      message: error.message
    };
  }
};

/**
 * Statistiques des QR codes générés
 * @returns {Promise<Object>} Statistiques du système QR
 */
export const getQRCodeStats = async () => {
  try {
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_requests,
        COUNT(*) FILTER (WHERE qr_code_data IS NOT NULL) as qr_codes_generated,
        COUNT(*) FILTER (WHERE qr_code_image_path IS NOT NULL) as qr_images_stored,
        DATE(MAX(qr_code_generated_at)) as last_qr_generated,
        COUNT(*) FILTER (WHERE qr_code_generated_at >= CURRENT_DATE - INTERVAL '24 hours') as qr_generated_today,
        COUNT(*) FILTER (WHERE qr_code_generated_at >= CURRENT_DATE - INTERVAL '7 days') as qr_generated_week
      FROM grading_requests
    `);

    return {
      success: true,
      stats: stats.rows[0]
    };
  } catch (error) {
    console.error('❌ Erreur statistiques QR codes:', error);
    return {
      success: false,
      message: error.message
    };
  }
};