import express from 'express';
import { pool } from '../database/init.js';
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { fileTypeFromBuffer } from 'file-type';
import { getCardScraper } from '../services/cardScraper.js';
import { generateQRCodeForSubmission, getQRCodeImage, updateQRCodeInDatabase } from '../utils/qrGenerator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createPublicRoutes() {
  const router = express.Router();

  // Configuration Multer pour l'upload d'images avec validation magic bytes
  const storage = multer.memoryStorage(); // Utilise memory pour validation avant sauvegarde

  const upload = multer({
    storage: storage,
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB limite
    },
    fileFilter: async function (req, file, cb) {
      try {
        // Bloquer SVG et autres formats potentiellement dangereux
        if (file.mimetype === 'image/svg+xml' || 
            file.mimetype === 'image/svg' ||
            file.mimetype.includes('svg')) {
          return cb(new Error('❌ Format SVG non autorisé pour des raisons de sécurité'), false);
        }
        
        cb(null, true); // Validation finale se fera après avec magic bytes
      } catch (error) {
        cb(new Error('❌ Erreur validation fichier: ' + error.message), false);
      }
    }
  });

  router.use(express.json());
  router.use(express.urlencoded({ extended: true }));

  // Public endpoint for submitting grading requests (avec support upload et multi-cartes)
  router.post('/submit-grading', upload.single('cardImage'), async (req, res) => {
    try {
      // ✅ SÉCURITÉ CRITIQUE: Validation magic bytes RÉELLE avec fileTypeFromBuffer
      let card_image = null;
      
      if (req.file) {
        try {
          // Validation réelle avec magic bytes
          const fileType = await fileTypeFromBuffer(req.file.buffer);
          const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
          
          if (!fileType || !allowedTypes.includes(fileType.mime)) {
            return res.status(400).json({
              success: false,
              message: `❌ Type de fichier non autorisé. Magic bytes détectés: ${fileType ? fileType.mime : 'inconnu'}. Seuls JPEG, PNG et WebP sont acceptés.`
            });
          }
          
          // Bloquer spécifiquement SVG même si pas détecté dans fileType
          if (fileType.mime.includes('svg') || req.file.originalname.toLowerCase().includes('.svg')) {
            return res.status(400).json({
              success: false,
              message: '❌ Format SVG interdit pour des raisons de sécurité'
            });
          }
          
          // ✅ Fichier validé : Sauvegarder sur disque
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
          const extension = fileType.ext;
          const filename = 'cardImage-' + uniqueSuffix + '.' + extension;
          const filepath = path.join(__dirname, '../../uploads/cards/', filename);
          
          // Créer le dossier si nécessaire
          const fs = await import('fs');
          await fs.promises.mkdir(path.dirname(filepath), { recursive: true });
          
          // Sauvegarder le fichier validé
          await fs.promises.writeFile(filepath, req.file.buffer);
          card_image = filename;
          
        } catch (error) {
          console.error('Erreur validation fichier:', error);
          return res.status(400).json({
            success: false,
            message: '❌ Erreur lors de la validation du fichier: ' + error.message
          });
        }
      }

      const {
        customerEmail: customer_email,
        grading_type,
        cardSource: card_source,
        orderNumber: order_number,
        liveDate: live_date,
        whatnotUsername: whatnot_username,
        whatnotOrderNumber: whatnot_order_number,
        comments,
        total_cards,
        paymentOption: payment_option
      } = req.body;

      // Récupérer les cartes ajoutées via le nouveau système multi-cartes
      const cards = [];
      
      // Si total_cards existe, c'est le nouveau format multi-cartes
      if (total_cards && parseInt(total_cards) > 0) {
        const cardCount = parseInt(total_cards);
        
        // Essayer d'abord le format nested (body.cards est un array)
        if (req.body.cards && Array.isArray(req.body.cards)) {
          req.body.cards.forEach((card, index) => {
            if (card.name || card[0]) { // card[0] pour les cas où c'est un array mal formé
              const cardName = card.name || card[0] || '';
              const cardSeries = card.series || card[1] || '';
              const cardImage = card.image || card[2] || '';
              cards.push({
                name: cardName,
                series: cardSeries,
                image: cardImage
              });
            }
          });
        } else {
          // Format flat avec clés comme "cards[0][name]"
          for (let i = 0; i < cardCount; i++) {
            const cardName = req.body[`cards[${i}][name]`];
            const cardSeries = req.body[`cards[${i}][series]`];
            const cardImage = req.body[`cards[${i}][image]`];
            
            if (cardName) {
              cards.push({
                name: cardName,
                series: cardSeries || '',
                image: cardImage || ''
              });
            }
          }
        }
      } else {
        // Format legacy avec une seule carte
        const cardName = req.body.cardName;
        if (cardName) {
          cards.push({
            name: cardName,
            series: '',
            image: ''
          });
        }
      }

      // ✅ VALIDATIONS RENFORCÉES CÔTÉ SERVEUR
      if (!customer_email || !grading_type || !card_source || cards.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields or no cards provided'
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

      // Validation limite de cartes (1-20 maximum)
      if (cards.length < 1 || cards.length > 20) {
        return res.status(400).json({
          success: false,
          message: 'Nombre de cartes invalide: minimum 1, maximum 20'
        });
      }

      // Prévention des doublons de cartes
      const cardNames = cards.map(card => card.name.trim().toLowerCase());
      const uniqueNames = [...new Set(cardNames)];
      if (cardNames.length !== uniqueNames.length) {
        return res.status(400).json({
          success: false,
          message: 'Cartes dupliquées détectées. Chaque carte doit être unique.'
        });
      }

      // Validation champs requis par carte
      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        if (!card.name || typeof card.name !== 'string' || card.name.trim().length === 0) {
          return res.status(400).json({
            success: false,
            message: `Carte ${i + 1}: nom obligatoire`
          });
        }
        if (card.name.trim().length > 200) {
          return res.status(400).json({
            success: false,
            message: `Carte ${i + 1}: nom trop long (maximum 200 caractères)`
          });
        }
      }
      
      // Set default shop domain for simplified version
      const shop_domain = 'psa-grading-service.com';

      // Function to generate unique submission ID
      const generateUniqueSubmissionId = async () => {
        let submission_id;
        let attempts = 0;
        const maxAttempts = 5;
        
        do {
          // Utiliser timestamp + plus de randomisation + compteur d'attempts
          const timestamp = Date.now();
          const randomPart1 = crypto.randomInt(10000, 99999);
          const randomPart2 = crypto.randomInt(100, 999);
          submission_id = `PSA${timestamp}${randomPart1}${randomPart2}${attempts}`;
          
          // Vérifier l'unicité dans la base de données
          const existingCheck = await pool.query(
            'SELECT submission_id FROM grading_requests WHERE submission_id = $1 LIMIT 1',
            [submission_id]
          );
          
          if (existingCheck.rows.length === 0) {
            console.log(`✅ ID unique généré: ${submission_id} (tentatives: ${attempts + 1})`);
            return submission_id; // ID unique trouvé
          }
          
          attempts++;
          console.log(`⚠️ Collision détectée pour ${submission_id}, nouvelle tentative ${attempts}/${maxAttempts}`);
          
          // Petite pause pour éviter les collisions rapides
          await new Promise(resolve => setTimeout(resolve, Math.random() * 10 + 5));
          
        } while (attempts < maxAttempts);
        
        throw new Error('Impossible de générer un ID unique après plusieurs tentatives');
      };

      // ✅ CORRECTION CRITIQUE: Récupérer les prix et délais depuis la base de données
      const priceQuery = await pool.query(`
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
      const cardPrice = parseFloat(serviceInfo.price);
      const estimatedDays = serviceInfo.estimated_days;

      // Calculate estimated completion date
      const estimated_completion = new Date();
      estimated_completion.setDate(estimated_completion.getDate() + estimatedDays);

      // Calculer le prix total
      const totalPrice = cardPrice * cards.length;

      // Créer un enregistrement pour chaque carte avec un submission_id unique
      const results = [];
      const submission_ids = [];
      
      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        
        // Générer un ID unique pour chaque carte
        const card_submission_id = await generateUniqueSubmissionId();
        submission_ids.push(card_submission_id);
        
        const result = await pool.query(`
          INSERT INTO grading_requests (
            shop_domain, customer_email, grading_type, card_source, card_name,
            card_series, order_number, whatnot_username, live_date, whatnot_order_number,
            card_image, comments, submission_id, price, estimated_completion
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
          ) RETURNING *
        `, [
          shop_domain, customer_email, grading_type, card_source, card.name,
          card.series, order_number || null, whatnot_username || null, live_date || null, whatnot_order_number || null,
          i === 0 ? card_image : null, // Seule la première carte garde l'image uploadée
          comments, card_submission_id, cardPrice, estimated_completion
        ]);
        
        results.push(result.rows[0]);
        
        // 🎯 GÉNÉRATION AUTOMATIQUE QR CODE pour chaque carte
        try {
          console.log(`🔄 Génération QR code pour: ${card_submission_id}`);
          
          const qrResult = await generateQRCodeForSubmission(card_submission_id, {
            card_name: card.name,
            customer_email: customer_email,
            grading_type: grading_type
          });
          
          if (qrResult.success) {
            // Mettre à jour la base de données avec les infos QR
            await updateQRCodeInDatabase(result.rows[0].id, qrResult);
            console.log(`✅ QR code généré et sauvegardé pour: ${card_submission_id}`);
          } else {
            console.error(`❌ Erreur génération QR pour ${card_submission_id}:`, qrResult.message);
          }
        } catch (qrError) {
          console.error(`❌ Erreur critique QR pour ${card_submission_id}:`, qrError);
          // Ne pas bloquer le processus si le QR échoue
        }
      }

      // Gérer les deux flux selon l'option de paiement
      if (payment_option === 'pay_later') {
        // Flux "Payer plus tard" - Envoyer email au lieu de créer checkout
        try {
          const { sendPSARequestNotification } = await import('../utils/brevo.js');
          
          const emailDetails = {
            submission_ids: submission_ids,
            cards: cards,
            grading_type: grading_type,
            total_price: totalPrice,
            estimated_completion: estimated_completion,
            payment_option: 'pay_later'
          };
          
          console.log('📧 Envoi email "Payer plus tard" pour soumissions:', submission_ids.join(', '));
          
          const emailResult = await sendPSARequestNotification(customer_email, emailDetails);
          
          console.log('✅ Email envoyé avec succès:', emailResult.messageId);
          
          res.json({
            success: true,
            submission_ids: submission_ids,
            estimated_completion: estimated_completion,
            total_cards: cards.length,
            total_price: totalPrice,
            payment_option: 'pay_later',
            email_sent: true,
            message: `Demande PSA enregistrée pour ${cards.length} carte(s). Un email de confirmation avec les détails a été envoyé à ${customer_email}.`
          });
        } catch (emailError) {
          console.error('❌ Erreur envoi email:', emailError);
          
          // Même si l'email échoue, la demande a été créée avec succès
          res.json({
            success: true,
            submission_ids: submission_ids,
            estimated_completion: estimated_completion,
            total_cards: cards.length,
            total_price: totalPrice,
            payment_option: 'pay_later',
            email_sent: false,
            email_error: emailError.message,
            message: `Demande PSA enregistrée pour ${cards.length} carte(s). Attention: l'email de confirmation n'a pas pu être envoyé. Vos numéros de suivi: ${submission_ids.join(', ')}`
          });
        }
      } else {
        // Flux normal "Payer maintenant" - Comportement existant
        try {
          const { sendPSARequestNotification } = await import('../utils/brevo.js');
          
          const emailDetails = {
            submission_ids: submission_ids,
            cards: cards,
            grading_type: grading_type,
            total_price: totalPrice,
            estimated_completion: estimated_completion,
            payment_option: 'pay_now'
          };
          
          console.log('📧 Envoi email de confirmation "Payer maintenant" pour soumissions:', submission_ids.join(', '));
          
          // Envoyer email de confirmation même pour paiement immédiat
          await sendPSARequestNotification(customer_email, emailDetails);
          
          console.log('✅ Email de confirmation envoyé');
        } catch (emailError) {
          console.error('⚠️ Email de confirmation échoué (flux paiement immédiat):', emailError);
          // Ne pas bloquer le processus pour cela
        }
        
        res.json({
          success: true,
          submission_ids: submission_ids,
          estimated_completion: estimated_completion,
          total_cards: cards.length,
          total_price: totalPrice,
          payment_option: payment_option || 'pay_now',
          message: `Grading request submitted successfully for ${cards.length} card(s)`
        });
      }
    } catch (error) {
      console.error('Error creating public grading request:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to submit grading request: ' + error.message
      });
    }
  });

  // Public endpoint to check request status
  router.get('/status/:submission_id', async (req, res) => {
    try {
      const { submission_id } = req.params;

      const result = await pool.query(
        'SELECT submission_id, status, grading_type, card_name, estimated_completion, tracking_number FROM grading_requests WHERE submission_id = $1',
        [submission_id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Grading request not found'
        });
      }

      res.json({
        success: true,
        request: result.rows[0]
      });
    } catch (error) {
      console.error('Error checking request status:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to check request status'
      });
    }
  });

  // ✅ PUBLIC ENDPOINT: Recherche de cartes (accessible sans authentification)
  router.get('/cards/search', async (req, res) => {
    try {
      const { q: query } = req.query;
      
      if (!query || query.trim().length < 2) {
        return res.json({
          success: false,
          message: 'Veuillez saisir au moins 2 caractères pour la recherche'
        });
      }

      console.log(`🔍 Recherche publique de cartes: "${query}"`);
      
      const scraper = await getCardScraper();
      const cards = await scraper.searchCards(query.trim());
      
      res.json({
        success: true,
        cards: cards,
        total: cards.length
      });
    } catch (error) {
      console.error('❌ Erreur lors de la recherche publique de cartes:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la recherche de cartes'
      });
    }
  });

  // ✅ ENDPOINT QR CODE: Servir les images QR pour téléchargement/impression
  router.get('/qr/:submission_id', async (req, res) => {
    try {
      const { submission_id } = req.params;

      console.log(`🔍 Demande QR code pour: ${submission_id}`);

      // Récupérer l'image QR depuis le système de fichiers
      const qrResult = await getQRCodeImage(submission_id);

      if (!qrResult.success) {
        return res.status(404).json({
          success: false,
          message: qrResult.message
        });
      }

      // Configurer les headers pour l'image
      res.set({
        'Content-Type': qrResult.mimeType,
        'Content-Length': qrResult.imageBuffer.length,
        'Content-Disposition': `inline; filename="qr-code-${submission_id}.png"`,
        'Cache-Control': 'public, max-age=3600', // Cache 1 heure
        'Access-Control-Allow-Origin': '*'
      });

      console.log(`✅ QR code servi pour: ${submission_id} (${qrResult.imageBuffer.length} bytes)`);

      // Envoyer l'image
      res.end(qrResult.imageBuffer);
    } catch (error) {
      console.error('❌ Erreur endpoint QR code:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération du QR code'
      });
    }
  });

  // ✅ ENDPOINT QR CODE TÉLÉCHARGEMENT: Force le téléchargement (pour l'admin)
  router.get('/qr/:submission_id/download', async (req, res) => {
    try {
      const { submission_id } = req.params;

      console.log(`📥 Téléchargement QR code pour: ${submission_id}`);

      const qrResult = await getQRCodeImage(submission_id);

      if (!qrResult.success) {
        return res.status(404).json({
          success: false,
          message: qrResult.message
        });
      }

      // Headers pour forcer le téléchargement
      res.set({
        'Content-Type': 'application/octet-stream',
        'Content-Length': qrResult.imageBuffer.length,
        'Content-Disposition': `attachment; filename="PSA-QR-${submission_id}.png"`,
        'Access-Control-Allow-Origin': '*'
      });

      console.log(`✅ QR code téléchargé pour: ${submission_id}`);

      res.end(qrResult.imageBuffer);
    } catch (error) {
      console.error('❌ Erreur téléchargement QR code:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors du téléchargement du QR code'
      });
    }
  });

  // 🆕 NEW MULTI-CARD API: Soumissions multi-cartes avec saisie mixte (TaskMaster + manuelle)
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

      if (items.length === 0 || items.length > 50) {
        return res.status(400).json({
          success: false,
          message: 'Nombre d\'items invalide: minimum 1, maximum 50'
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

      // Validation des items
      const validatedItems = [];
      let totalPrice = 0;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        if (!item.name || typeof item.name !== 'string' || item.name.trim().length === 0) {
          return res.status(400).json({
            success: false,
            message: `Item ${i + 1}: nom obligatoire`
          });
        }

        if (!item.source || !['taskmaster', 'manual'].includes(item.source)) {
          return res.status(400).json({
            success: false,
            message: `Item ${i + 1}: source doit être 'taskmaster' ou 'manual'`
          });
        }

        if (item.source === 'taskmaster' && (!item.tm_card_id || typeof item.tm_card_id !== 'string')) {
          return res.status(400).json({
            success: false,
            message: `Item ${i + 1}: tm_card_id obligatoire pour source TaskMaster`
          });
        }

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
      const generateUniqueSubmissionId = async () => {
        let submission_id;
        let attempts = 0;
        const maxAttempts = 5;
        
        do {
          const timestamp = Date.now();
          const randomPart1 = crypto.randomInt(10000, 99999);
          const randomPart2 = crypto.randomInt(100, 999);
          submission_id = `PSA${timestamp}${randomPart1}${randomPart2}${attempts}`;
          
          const existingCheck = await client.query(
            'SELECT submission_id FROM grading_requests WHERE submission_id = $1 LIMIT 1',
            [submission_id]
          );
          
          if (existingCheck.rows.length === 0) {
            console.log(`✅ ID unique généré: ${submission_id} (tentatives: ${attempts + 1})`);
            return submission_id;
          }
          
          attempts++;
          await new Promise(resolve => setTimeout(resolve, Math.random() * 10 + 5));
          
        } while (attempts < maxAttempts);
        
        throw new Error('Impossible de générer un ID unique après plusieurs tentatives');
      };

      const submission_id = await generateUniqueSubmissionId();

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
          shop_domain, customer_email, grading_type, card_source, card_name,
          order_number, whatnot_username, live_date, whatnot_order_number, 
          comments, submission_id, estimated_completion,
          is_multi_card, items_count, total_price, price
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
        ) RETURNING *
      `, [
        'psa-grading-service.com', customer_email, grading_type, card_source || 'website',
        `Multi-cartes (${items.length} items)`, // card_name générique pour multi-cartes
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

      // 🎯 Génération automatique du QR code
      try {
        console.log(`🔄 Génération QR code pour multi-card: ${submission_id}`);
        
        const qrResult = await generateQRCodeForSubmission(submission_id, {
          card_name: `Multi-carte (${items.length} items)`,
          customer_email: customer_email,
          grading_type: grading_type,
          is_multi_card: true,
          items_count: items.length
        });
        
        if (qrResult.success) {
          await updateQRCodeInDatabase(gradingRequestId, qrResult);
          console.log(`✅ QR code généré et sauvegardé pour multi-card: ${submission_id}`);
        } else {
          console.error(`❌ Erreur génération QR pour multi-card ${submission_id}:`, qrResult.message);
        }
      } catch (qrError) {
        console.error(`❌ Erreur critique QR pour multi-card ${submission_id}:`, qrError);
        // Ne pas bloquer le processus si le QR échoue
      }

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

  // Endpoint pour récupérer les informations d'une soumission (pour l'interface vidéo)
  router.get('/submission/:submission_id', async (req, res) => {
    try {
      const { submission_id } = req.params;
      
      console.log(`🔍 Récupération infos soumission: ${submission_id}`);
      
      const result = await pool.query(`
        SELECT 
          id,
          submission_id,
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
          whatnot_order_number,
          comments,
          status,
          video_status,
          created_at,
          updated_at
        FROM grading_requests 
        WHERE submission_id = $1
      `, [submission_id]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Soumission non trouvée'
        });
      }

      const submission = result.rows[0];
      
      console.log(`✅ Soumission trouvée pour ${submission_id}: ${submission.card_name}`);

      res.json({
        success: true,
        submission: submission,
        message: 'Informations de soumission récupérées avec succès'
      });

    } catch (error) {
      console.error('❌ Erreur récupération soumission:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur interne lors de la récupération des informations'
      });
    }
  });

  return router;
}