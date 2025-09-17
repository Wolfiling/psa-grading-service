import express from 'express';
import { pool } from '../database/init.js';
import {
  createCustomerAccount,
  loginCustomer,
  validateCustomerToken,
  validateCustomerInvitationToken,
  useCustomerInvitationToken,
  getCustomerOrders,
  linkOrderToCustomer,
  createCustomerInvitationToken
} from '../utils/clientAuth.js';
import { sendEmail } from '../utils/emailService.js';

/**
 * ROUTES API POUR L'ESPACE CLIENT PSA
 * Toutes les routes commencent par /api/client
 */

export function createClientRoutes() {
  const router = express.Router();

  /**
   * MIDDLEWARE D'AUTHENTIFICATION CLIENT
   */
  const requireCustomerAuth = async (req, res, next) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '') || 
                   req.cookies?.client_token;

      if (!token) {
        return res.status(401).json({
          success: false,
          message: 'Token d\'authentification requis',
          code: 'AUTH_REQUIRED'
        });
      }

      const customer = await validateCustomerToken(token);
      if (!customer) {
        return res.status(401).json({
          success: false,
          message: 'Token invalide ou expiré',
          code: 'INVALID_TOKEN'
        });
      }

      req.customer = customer;
      next();
    } catch (error) {
      console.error('[CLIENT] Erreur authentification:', error);
      return res.status(500).json({
        success: false,
        message: 'Erreur d\'authentification',
        code: 'AUTH_ERROR'
      });
    }
  };

  /**
   * POST /api/client/register
   * Création de compte client
   */
  router.post('/register', async (req, res) => {
    try {
      const { email, password, first_name, last_name, phone, invitation_token } = req.body;

      // Validation des données
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: 'Email et mot de passe requis',
          code: 'MISSING_FIELDS'
        });
      }

      // Validation token d'invitation si fourni
      let invitationData = null;
      if (invitation_token) {
        try {
          invitationData = await validateCustomerInvitationToken(invitation_token);
          
          // Vérifier que l'email correspond
          if (email.toLowerCase() !== invitationData.customer_email.toLowerCase()) {
            return res.status(400).json({
              success: false,
              message: 'L\'email ne correspond pas à l\'invitation',
              code: 'EMAIL_MISMATCH'
            });
          }
        } catch (error) {
          return res.status(400).json({
            success: false,
            message: error.message,
            code: 'INVALID_INVITATION'
          });
        }
      }

      // Créer le compte avec support de liaison automatique
      const result = await createCustomerAccount({
        email,
        password,
        first_name,
        last_name,
        phone,
        invitation_token // ✅ Nouveau paramètre pour distinguer inscription libre vs invitation
      });

      // Si invitation valide, lier la commande spécifique au nouveau client
      if (invitationData) {
        await linkOrderToCustomer(result.customer.id, invitationData.grading_request_id);
        await useCustomerInvitationToken(invitation_token);
        
        console.log(`[CLIENT] ✅ Compte créé via invitation pour ${email}, commande ${invitationData.submission_id} liée`);
      }
      // Note: Les commandes existantes sont maintenant liées automatiquement dans createCustomerAccount()

      // ✅ SÉCURITÉ CRITIQUE: Configurer le cookie de session avec protection CSRF
      res.cookie('client_token', result.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax', // ✅ Protection CSRF
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 jours
      });

      res.json({
        success: true,
        message: 'Compte créé avec succès',
        customer: result.customer,
        token: result.token,
        has_linked_order: !!invitationData,
        // ✅ NOUVEAU: Informations sur les commandes liées automatiquement
        linked_orders: result.linked_orders || [],
        registration_type: result.registration_type,
        linking_error: result.linking_error || false
      });

    } catch (error) {
      console.error('[CLIENT] Erreur création compte:', error);
      
      if (error.message.includes('existe déjà')) {
        return res.status(409).json({
          success: false,
          message: error.message,
          code: 'EMAIL_EXISTS'
        });
      }

      res.status(400).json({
        success: false,
        message: error.message || 'Erreur lors de la création du compte',
        code: 'REGISTRATION_ERROR'
      });
    }
  });

  /**
   * POST /api/client/login
   * Connexion client
   */
  router.post('/login', async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: 'Email et mot de passe requis',
          code: 'MISSING_CREDENTIALS'
        });
      }

      const result = await loginCustomer(
        email, 
        password, 
        req.ip, 
        req.get('User-Agent')
      );

      // ✅ SÉCURITÉ CRITIQUE: Configurer le cookie de session avec protection CSRF
      res.cookie('client_token', result.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax', // ✅ Protection CSRF
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 jours
      });

      console.log(`[CLIENT] ✅ Connexion réussie pour ${email}`);

      res.json({
        success: true,
        message: 'Connexion réussie',
        customer: result.customer,
        token: result.token
      });

    } catch (error) {
      console.error('[CLIENT] Erreur connexion:', error);
      
      res.status(401).json({
        success: false,
        message: error.message || 'Erreur de connexion',
        code: 'LOGIN_ERROR'
      });
    }
  });

  /**
   * POST /api/client/logout
   * Déconnexion client
   */
  router.post('/logout', (req, res) => {
    res.clearCookie('client_token');
    res.json({
      success: true,
      message: 'Déconnexion réussie'
    });
  });

  /**
   * GET /api/client/me
   * Informations du client connecté
   */
  router.get('/me', requireCustomerAuth, async (req, res) => {
    res.json({
      success: true,
      customer: req.customer
    });
  });

  /**
   * GET /api/client/orders
   * Récupérer les commandes du client
   */
  router.get('/orders', requireCustomerAuth, async (req, res) => {
    try {
      const orders = await getCustomerOrders(req.customer.id);

      console.log(`[CLIENT] ✅ ${orders.length} commandes récupérées pour client ${req.customer.id}`);

      res.json({
        success: true,
        orders,
        count: orders.length
      });

    } catch (error) {
      console.error('[CLIENT] Erreur récupération commandes:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des commandes',
        code: 'ORDERS_ERROR'
      });
    }
  });

  /**
   * GET /api/client/orders/:submission_id
   * Détails d'une commande spécifique
   */
  router.get('/orders/:submission_id', requireCustomerAuth, async (req, res) => {
    try {
      const { submission_id } = req.params;

      const result = await pool.query(`
        SELECT 
          gr.*,
          c.email as customer_email,
          c.first_name,
          c.last_name
        FROM grading_requests gr
        LEFT JOIN customers c ON gr.customer_id = c.id
        WHERE gr.submission_id = $1 
        AND (gr.customer_id = $2 OR gr.customer_email = $3)
      `, [submission_id, req.customer.id, req.customer.email]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Commande non trouvée',
          code: 'ORDER_NOT_FOUND'
        });
      }

      const order = result.rows[0];

      console.log(`[CLIENT] ✅ Détails commande ${submission_id} récupérés pour client ${req.customer.id}`);

      res.json({
        success: true,
        order
      });

    } catch (error) {
      console.error('[CLIENT] Erreur détails commande:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des détails',
        code: 'ORDER_DETAILS_ERROR'
      });
    }
  });

  /**
   * GET /api/client/invitation/:token
   * Valider un token d'invitation
   */
  router.get('/invitation/:token', async (req, res) => {
    try {
      const { token } = req.params;

      const invitationData = await validateCustomerInvitationToken(token);

      console.log(`[CLIENT] ✅ Token d'invitation validé pour ${invitationData.customer_email}`);

      res.json({
        success: true,
        invitation: {
          customer_email: invitationData.customer_email,
          submission_id: invitationData.submission_id,
          card_name: invitationData.card_name,
          grading_type: invitationData.grading_type,
          price: invitationData.price,
          order_created_at: invitationData.order_created_at
        }
      });

    } catch (error) {
      console.error('[CLIENT] Erreur validation invitation:', error);
      res.status(400).json({
        success: false,
        message: error.message,
        code: 'INVALID_INVITATION'
      });
    }
  });

  /**
   * POST /api/client/orders
   * Créer une nouvelle commande (depuis l'espace client)
   */
  router.post('/orders', requireCustomerAuth, async (req, res) => {
    try {
      const { grading_type, card_source = 'client', items = [], comments = '' } = req.body;

      // Validation
      if (!grading_type || !['value', 'regular', 'express'].includes(grading_type)) {
        return res.status(400).json({
          success: false,
          message: 'Type de grading invalide',
          code: 'INVALID_GRADING_TYPE'
        });
      }

      if (!items || items.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Au moins une carte est requise',
          code: 'NO_ITEMS'
        });
      }

      if (items.length > 20) {
        return res.status(400).json({
          success: false,
          message: 'Maximum 20 cartes par commande',
          code: 'TOO_MANY_ITEMS'
        });
      }

      // Calculer le prix
      const pricePerCard = grading_type === 'value' ? 27 : grading_type === 'regular' ? 35 : 50;
      const totalPrice = items.length * pricePerCard;

      // Générer ID de soumission unique
      const submission_id = `PSA${Date.now()}${Math.floor(Math.random() * 100000)}`;

      // Créer la commande principale
      const result = await pool.query(`
        INSERT INTO grading_requests (
          shop_domain, customer_email, customer_id, grading_type, card_source,
          comments, status, submission_id, price, estimated_completion,
          items_count, total_price, is_multi_card, card_name, card_series, card_number
        ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING id, submission_id, created_at
      `, [
        'psa-client-portal.com',
        req.customer.email,
        req.customer.id,
        grading_type,
        card_source,
        comments,
        submission_id,
        totalPrice,
        new Date(Date.now() + 45 * 24 * 60 * 60 * 1000), // 45 jours
        items.length,
        totalPrice,
        items.length > 1,
        items.length === 1 ? items[0].name : `Lot de ${items.length} cartes`,
        items.length === 1 ? items[0].series : 'Mixte',
        items.length === 1 ? items[0].number : ''
      ]);

      const order = result.rows[0];

      // Si plusieurs cartes, créer les entrées détaillées (optionnel pour tracking)
      if (items.length > 1) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          await pool.query(`
            INSERT INTO grading_requests (
              shop_domain, customer_email, customer_id, grading_type, card_source,
              card_name, card_series, card_number, card_rarity, card_year,
              comments, status, submission_id, price, estimated_completion
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', $12, $13, $14)
          `, [
            'psa-client-portal.com',
            req.customer.email,
            req.customer.id,
            grading_type,
            card_source,
            item.name,
            item.series,
            item.number,
            item.rarity || '',
            item.year || null,
            item.notes || '',
            `${submission_id}_ITEM_${i + 1}`,
            pricePerCard,
            new Date(Date.now() + 45 * 24 * 60 * 60 * 1000)
          ]);
        }
      }

      console.log(`[CLIENT] ✅ Commande ${submission_id} créée pour client ${req.customer.email} - ${items.length} cartes, ${totalPrice}€`);

      res.json({
        success: true,
        message: 'Commande créée avec succès',
        order: {
          id: order.id,
          submission_id: order.submission_id,
          created_at: order.created_at,
          total_price: totalPrice,
          items_count: items.length,
          grading_type
        }
      });

    } catch (error) {
      console.error('[CLIENT] Erreur création commande:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la création de la commande',
        code: 'ORDER_CREATION_ERROR'
      });
    }
  });

  /**
   * GET /api/client/video/:submission_id/token
   * Générer token pour visualisation vidéo client
   */
  router.get('/video/:submission_id/token', requireCustomerAuth, async (req, res) => {
    try {
      const { submission_id } = req.params;

      // Vérifier que le client a accès à cette commande
      const result = await pool.query(`
        SELECT id, video_url, video_status 
        FROM grading_requests 
        WHERE submission_id = $1 
        AND (customer_id = $2 OR customer_email = $3)
        AND video_url IS NOT NULL
      `, [submission_id, req.customer.id, req.customer.email]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Vidéo non trouvée ou accès non autorisé',
          code: 'VIDEO_NOT_FOUND'
        });
      }

      // Utiliser le même système de token que pour l'admin mais pour les clients
      const timestamp = Date.now();
      const crypto = await import('crypto');
      const token = crypto.default.createHmac('sha256', process.env.PSA_SECRET || 'dev-fallback-key')
        .update(`${submission_id}-${timestamp}-client_access`)
        .digest('hex')
        .substring(0, 32);

      const video_url = `/api/video/file/${submission_id}?token=${token}&ts=${timestamp}&type=client`;

      console.log(`[CLIENT] ✅ Token vidéo généré pour client ${req.customer.email}, commande ${submission_id}`);

      res.json({
        success: true,
        video_url,
        expires_at: timestamp + (60 * 60 * 1000) // 1 heure
      });

    } catch (error) {
      console.error('[CLIENT] Erreur génération token vidéo:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur génération token vidéo',
        code: 'VIDEO_TOKEN_ERROR'
      });
    }
  });

  console.log('✅ Client routes initialized');
  return router;
}