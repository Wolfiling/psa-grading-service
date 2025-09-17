import { pool } from '../database/init.js';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import validator from 'validator';
import { sanitizeSubmissionId } from './videoProof.js';

// Configuration sécurisée pour les clients
const PSA_CLIENT_SECRET = process.env.PSA_CLIENT_SECRET || process.env.PSA_SECRET || 'psa-client-secret-change-in-production';
const CLIENT_TOKEN_TTL = 60 * 60 * 1000; // 1 heure pour l'accès client
const MAX_CLIENT_ATTEMPTS = 5; // Tentatives maximum par IP
const CLIENT_BLOCK_DURATION = 60 * 60 * 1000; // 1 heure de blocage

// Store des tentatives client en mémoire (par IP)
const clientAttempts = new Map(); // IP -> { attempts, blockedUntil, lastAttempt }
const activeClientSessions = new Map(); // token -> session data

/**
 * Valide l'email du client (derniers 4 caractères avant @)
 * @param {string} email - Email complet du client
 * @param {string} partial - 4 derniers caractères avant @ fournis par le client
 * @returns {boolean} Validation réussie
 */
export const validatePartialEmail = (email, partial) => {
  if (!email || !partial || partial.length !== 4) {
    return false;
  }
  
  const emailParts = email.toLowerCase().split('@');
  if (emailParts.length !== 2) {
    return false;
  }
  
  const username = emailParts[0];
  if (username.length < 4) {
    return false; // Email trop court pour validation partielle
  }
  
  const last4 = username.slice(-4).toLowerCase();
  return last4 === partial.toLowerCase();
};

/**
 * Génère un token d'accès client sécurisé
 * @param {string} submissionId - ID de soumission PSA
 * @param {string} clientEmail - Email du client 
 * @param {string} clientIP - IP du client
 * @returns {Object} Token data with expiration
 */
export const generateClientAccessToken = (submissionId, clientEmail, clientIP) => {
  const timestamp = Date.now();
  const sessionId = crypto.randomBytes(16).toString('hex');
  
  // Créer les données du token
  const tokenData = {
    sub: submissionId,
    email: clientEmail,
    ip: clientIP,
    ts: timestamp,
    sid: sessionId
  };
  
  // Générer le token sécurisé
  const tokenString = JSON.stringify(tokenData);
  const token = crypto
    .createHmac('sha256', PSA_CLIENT_SECRET)
    .update(tokenString)
    .digest('hex')
    .substring(0, 32);
  
  const expiresAt = timestamp + CLIENT_TOKEN_TTL;
  
  // Stocker la session
  const sessionData = {
    submissionId,
    clientEmail,
    clientIP,
    created: timestamp,
    expires: expiresAt,
    sessionId,
    used: false
  };
  
  activeClientSessions.set(token, sessionData);
  
  return {
    token,
    expires_at: expiresAt,
    session_id: sessionId,
    valid_for_seconds: Math.floor(CLIENT_TOKEN_TTL / 1000)
  };
};

/**
 * Valide un token d'accès client
 * @param {string} token - Token à valider
 * @param {string} submissionId - ID de soumission attendu
 * @param {string} clientIP - IP du client
 * @returns {Object} Résultat de validation
 */
export const validateClientAccessToken = (token, submissionId, clientIP) => {
  try {
    if (!token || !submissionId) {
      return {
        valid: false,
        reason: 'Token ou submission ID manquant'
      };
    }
    
    // Récupérer la session
    const session = activeClientSessions.get(token);
    if (!session) {
      return {
        valid: false,
        reason: 'Token invalide ou expiré'
      };
    }
    
    // Vérifier l'expiration
    if (Date.now() > session.expires) {
      activeClientSessions.delete(token);
      return {
        valid: false,
        reason: 'Token expiré'
      };
    }
    
    // Vérifier la cohérence submission ID
    if (session.submissionId !== submissionId) {
      return {
        valid: false,
        reason: 'Token non valide pour cette soumission'
      };
    }
    
    // Vérifier l'IP (sécurité supplémentaire)
    if (session.clientIP !== clientIP) {
      console.warn(`🚨 Client token used from different IP: ${clientIP} != ${session.clientIP}`);
      // Ne pas bloquer complètement car les IPs mobiles peuvent changer
    }
    
    return {
      valid: true,
      session: session,
      clientEmail: session.clientEmail
    };
  } catch (error) {
    console.error('❌ Erreur validation token client:', error);
    return {
      valid: false,
      reason: 'Erreur interne de validation'
    };
  }
};

/**
 * Vérifie le rate limiting pour un client
 * @param {string} clientIP - IP du client
 * @returns {Object} Statut du rate limiting
 */
export const checkClientRateLimit = (clientIP) => {
  const now = Date.now();
  const attemptData = clientAttempts.get(clientIP);
  
  if (!attemptData) {
    return { allowed: true, attempts: 0 };
  }
  
  // Vérifier si bloqué
  if (attemptData.blockedUntil && attemptData.blockedUntil > now) {
    const minutesLeft = Math.ceil((attemptData.blockedUntil - now) / 60000);
    return {
      allowed: false,
      blocked: true,
      attempts: attemptData.attempts,
      minutesLeft: minutesLeft,
      message: `Trop de tentatives. Réessayez dans ${minutesLeft} minute${minutesLeft > 1 ? 's' : ''}.`
    };
  }
  
  // Réinitialiser si le blocage est expiré
  if (attemptData.blockedUntil && attemptData.blockedUntil <= now) {
    clientAttempts.delete(clientIP);
    return { allowed: true, attempts: 0 };
  }
  
  return {
    allowed: attemptData.attempts < MAX_CLIENT_ATTEMPTS,
    attempts: attemptData.attempts,
    remaining: MAX_CLIENT_ATTEMPTS - attemptData.attempts
  };
};

/**
 * Enregistre une tentative d'accès client (réussie ou échouée)
 * @param {string} clientIP - IP du client
 * @param {boolean} success - Tentative réussie ou non
 */
export const recordClientAttempt = (clientIP, success = false) => {
  const now = Date.now();
  const attemptData = clientAttempts.get(clientIP) || { attempts: 0, lastAttempt: 0 };
  
  if (success) {
    // Réinitialiser le compteur en cas de succès
    clientAttempts.delete(clientIP);
    return;
  }
  
  // Incrémenter les tentatives échouées
  attemptData.attempts += 1;
  attemptData.lastAttempt = now;
  
  // Bloquer si trop de tentatives
  if (attemptData.attempts >= MAX_CLIENT_ATTEMPTS) {
    attemptData.blockedUntil = now + CLIENT_BLOCK_DURATION;
    console.warn(`🚨 Client IP bloquée pour tentatives multiples:`, {
      ip: clientIP,
      attempts: attemptData.attempts,
      blockedUntil: new Date(attemptData.blockedUntil).toISOString()
    });
  }
  
  clientAttempts.set(clientIP, attemptData);
};

/**
 * Enregistre un log d'accès client en base de données
 * @param {Object} logData - Données du log
 */
export const logClientAccess = async (logData) => {
  try {
    const {
      submissionId,
      clientIP,
      userAgent,
      emailDomain,
      accessType,
      accessGranted,
      tokenIssued,
      tokenExpiresAt,
      sessionId,
      failureReason
    } = logData;
    
    await pool.query(`
      INSERT INTO client_access_logs (
        submission_id, client_ip, user_agent, email_domain, 
        access_type, access_granted, token_issued, token_expires_at,
        session_id, failure_reason
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      submissionId,
      clientIP,
      userAgent,
      emailDomain,
      accessType,
      accessGranted,
      tokenIssued,
      tokenExpiresAt,
      sessionId,
      failureReason
    ]);
    
    console.log(`📝 Client access logged: ${submissionId} - ${accessGranted ? 'SUCCESS' : 'FAILED'}`);
  } catch (error) {
    console.error('❌ Erreur log client access:', error);
  }
};

/**
 * Vérifie si une soumission PSA est valide et accessible aux clients
 * @param {string} submissionId - ID de soumission PSA
 * @returns {Promise<Object>} Résultat de vérification
 */
export const verifySubmissionAccess = async (submissionId) => {
  try {
    const sanitizedId = sanitizeSubmissionId(submissionId);
    
    const result = await pool.query(`
      SELECT 
        id,
        customer_email,
        card_name,
        grading_type,
        video_url,
        video_status,
        client_access_enabled,
        created_at,
        video_duration,
        recording_timestamp
      FROM grading_requests 
      WHERE submission_id = $1
    `, [sanitizedId]);
    
    if (result.rows.length === 0) {
      return {
        valid: false,
        reason: 'Numéro de soumission non trouvé'
      };
    }
    
    const submission = result.rows[0];
    
    // Vérifier que l'accès client est autorisé
    if (submission.client_access_enabled === false) {
      return {
        valid: false,
        reason: 'Accès client désactivé pour cette soumission'
      };
    }
    
    // Vérifier qu'une vidéo existe
    if (!submission.video_url || submission.video_status !== 'uploaded') {
      return {
        valid: false,
        reason: 'Vidéo de preuve non disponible'
      };
    }
    
    return {
      valid: true,
      submission: {
        id: submission.id,
        submission_id: sanitizedId,
        customer_email: submission.customer_email,
        card_name: submission.card_name,
        grading_type: submission.grading_type,
        video_duration: submission.video_duration,
        recording_date: submission.recording_timestamp,
        created_at: submission.created_at
      }
    };
  } catch (error) {
    console.error('❌ Erreur vérification submission:', error);
    return {
      valid: false,
      reason: 'Erreur interne de vérification'
    };
  }
};

/**
 * Met à jour les statistiques d'accès client
 * @param {number} submissionDbId - ID de la soumission en base
 */
export const updateClientAccessStats = async (submissionDbId) => {
  try {
    await pool.query(`
      UPDATE grading_requests 
      SET 
        last_client_access = CURRENT_TIMESTAMP,
        client_access_count = COALESCE(client_access_count, 0) + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [submissionDbId]);
  } catch (error) {
    console.error('❌ Erreur mise à jour stats client:', error);
  }
};

/**
 * Génère un numéro de ticket unique pour les reports
 * @returns {string} Numéro de ticket (ex: PSA-REP-240915-001)
 */
export const generateTicketNumber = () => {
  const now = new Date();
  const dateStr = now.toISOString().slice(2, 10).replace(/-/g, ''); // YYMMDD
  const randomNum = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `PSA-REP-${dateStr}-${randomNum}`;
};

/**
 * Nettoie les sessions expirées (à appeler périodiquement)
 */
export const cleanupExpiredSessions = () => {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [token, session] of activeClientSessions.entries()) {
    if (session.expires < now) {
      activeClientSessions.delete(token);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`🧹 Nettoyage ${cleaned} sessions client expirées`);
  }
};

// Nettoyer les sessions expirées toutes les 10 minutes
setInterval(cleanupExpiredSessions, 10 * 60 * 1000);

// ================== SYSTÈME D'ESPACE CLIENT INTELLIGENT ==================

// Configuration pour le nouveau système client
const SALT_ROUNDS = 12;

// ✅ SÉCURITÉ CRITIQUE: JWT_SECRET obligatoire en production
const isDevelopment = process.env.NODE_ENV === 'development';
const JWT_SECRET = (() => {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }
  
  if (!isDevelopment) {
    console.error('❌ FATAL: JWT_SECRET est obligatoire en production !');
    console.error('   Définissez JWT_SECRET dans vos variables d\'environnement');
    process.exit(1);
  }
  
  console.warn('⚠️ DEVELOPMENT: Using fallback JWT_SECRET. Configure JWT_SECRET for production!');
  return PSA_CLIENT_SECRET || 'dev-jwt-secret-not-for-production';
})();

const JWT_EXPIRES_IN = '30d'; // Token JWT valide 30 jours
const INVITATION_TOKEN_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 jours

/**
 * CRÉER UN NOUVEAU COMPTE CLIENT
 */
export const createCustomerAccount = async (customerData) => {
  const { email, password, first_name, last_name, phone, invitation_token } = customerData;
  
  // Validation email
  if (!validator.isEmail(email)) {
    throw new Error('Format d\'email invalide');
  }
  
  // Validation mot de passe (minimum 6 caractères)
  if (!password || password.length < 6) {
    throw new Error('Le mot de passe doit contenir au moins 6 caractères');
  }
  
  // Vérifier si le client existe déjà
  const existingCustomer = await pool.query(
    'SELECT id FROM customers WHERE email = $1',
    [email.toLowerCase()]
  );
  
  if (existingCustomer.rows.length > 0) {
    throw new Error('Un compte existe déjà avec cet email');
  }
  
  // Hasher le mot de passe
  const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
  const email_verification_token = crypto.randomBytes(32).toString('hex');
  
  // Créer le client
  const result = await pool.query(`
    INSERT INTO customers (
      email, password_hash, first_name, last_name, phone, 
      email_verification_token, status
    ) VALUES ($1, $2, $3, $4, $5, $6, 'active')
    RETURNING id, email, first_name, last_name, phone, created_at, email_verified
  `, [
    email.toLowerCase(), 
    password_hash, 
    first_name || null, 
    last_name || null, 
    phone || null,
    email_verification_token
  ]);
  
  const customer = result.rows[0];
  
  // Générer token JWT
  const token = jwt.sign(
    { 
      id: customer.id, 
      email: customer.email,
      type: 'customer'
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
  
  // ✅ NOUVELLE LOGIQUE: Liaison automatique des commandes existantes lors d'inscription libre
  if (!invitation_token) {
    // Inscription libre - lier automatiquement les commandes existantes
    try {
      const linkedOrders = await linkExistingOrdersToNewCustomer(customer.id, email);
      
      if (linkedOrders.length > 0) {
        console.log(`[CLIENT] 🎯 INSCRIPTION LIBRE: ${linkedOrders.length} commandes existantes liées automatiquement pour ${email}`);
      } else {
        console.log(`[CLIENT] 📝 INSCRIPTION LIBRE: Aucune commande existante à lier pour ${email}`);
      }
      
      return {
        customer,
        token,
        email_verification_token,
        linked_orders: linkedOrders,
        registration_type: 'free_signup'
      };
      
    } catch (error) {
      // ⚠️ GESTION D'ERREUR ROBUSTE: Ne pas faire échouer l'inscription si la liaison échoue
      console.error(`[CLIENT] ❌ Erreur liaison commandes existantes pour ${email}:`, error);
      console.log(`[CLIENT] ⚠️ Inscription continue malgré l'erreur de liaison pour ${email}`);
      
      return {
        customer,
        token,
        email_verification_token,
        linked_orders: [],
        registration_type: 'free_signup',
        linking_error: true
      };
    }
  } else {
    // Inscription via invitation - logique existante inchangée
    console.log(`[CLIENT] 🎫 INSCRIPTION VIA INVITATION pour ${email}`);
    return {
      customer,
      token,
      email_verification_token,
      registration_type: 'invitation'
    };
  }
};

/**
 * CONNEXION CLIENT
 */
export const loginCustomer = async (email, password, ipAddress, userAgent) => {
  // Validation email
  if (!validator.isEmail(email)) {
    throw new Error('Format d\'email invalide');
  }
  
  // Récupérer le client
  const result = await pool.query(
    'SELECT id, email, password_hash, first_name, last_name, status, email_verified FROM customers WHERE email = $1',
    [email.toLowerCase()]
  );
  
  if (result.rows.length === 0) {
    throw new Error('Email ou mot de passe incorrect');
  }
  
  const customer = result.rows[0];
  
  // Vérifier le statut du compte
  if (customer.status !== 'active') {
    throw new Error('Compte désactivé');
  }
  
  // Vérifier le mot de passe
  const isValidPassword = await bcrypt.compare(password, customer.password_hash);
  if (!isValidPassword) {
    throw new Error('Email ou mot de passe incorrect');
  }
  
  // Générer token JWT
  const token = jwt.sign(
    { 
      id: customer.id, 
      email: customer.email,
      type: 'customer'
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
  
  // Créer une session
  const session_token = crypto.randomBytes(32).toString('hex');
  const expires_at = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)); // 30 jours
  
  await pool.query(`
    INSERT INTO customer_sessions (
      customer_id, session_token, expires_at, ip_address, user_agent
    ) VALUES ($1, $2, $3, $4, $5)
  `, [customer.id, session_token, expires_at, ipAddress || '', userAgent || '']);
  
  // Mettre à jour la date de dernière connexion
  await pool.query(
    'UPDATE customers SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
    [customer.id]
  );
  
  return {
    customer: {
      id: customer.id,
      email: customer.email,
      first_name: customer.first_name,
      last_name: customer.last_name,
      email_verified: customer.email_verified
    },
    token,
    session_token
  };
};

/**
 * VALIDER TOKEN JWT CLIENT avec vérification de révocation via sessions
 */
export const validateCustomerToken = async (token) => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    if (decoded.type !== 'customer') {
      return null;
    }
    
    // Vérifier que le client existe encore et est actif
    const customerResult = await pool.query(
      'SELECT id, email, first_name, last_name, status, email_verified FROM customers WHERE id = $1 AND status = $2',
      [decoded.id, 'active']
    );
    
    if (customerResult.rows.length === 0) {
      return null;
    }
    
    // ✅ SÉCURITÉ: Vérifier qu'il existe une session active pour ce client (révocation JWT)
    const sessionResult = await pool.query(
      'SELECT id FROM customer_sessions WHERE customer_id = $1 AND expires_at > CURRENT_TIMESTAMP LIMIT 1',
      [decoded.id]
    );
    
    if (sessionResult.rows.length === 0) {
      console.warn(`🚨 JWT token valide mais aucune session active pour client ${decoded.id} - token révoqué`);
      return null;
    }
    
    return customerResult.rows[0];
  } catch (error) {
    return null;
  }
};

/**
 * RÉVOQUER TOUS LES TOKENS JWT D'UN CLIENT (via suppression des sessions)
 */
export const revokeAllCustomerTokens = async (customerId) => {
  try {
    const result = await pool.query(
      'DELETE FROM customer_sessions WHERE customer_id = $1',
      [customerId]
    );
    
    console.log(`🔒 ${result.rowCount} sessions supprimées pour client ${customerId} - tokens JWT révoqués`);
    return result.rowCount;
  } catch (error) {
    console.error('❌ Erreur révocation tokens client:', error);
    throw error;
  }
};

/**
 * RÉVOQUER UN TOKEN JWT SPÉCIFIQUE (via suppression de session)
 */
export const revokeCustomerSession = async (sessionToken) => {
  try {
    const result = await pool.query(
      'DELETE FROM customer_sessions WHERE session_token = $1',
      [sessionToken]
    );
    
    console.log(`🔒 Session ${sessionToken} révoquée`);
    return result.rowCount > 0;
  } catch (error) {
    console.error('❌ Erreur révocation session:', error);
    throw error;
  }
};

/**
 * CRÉER TOKEN D'INVITATION POUR COMMANDE
 */
export const createCustomerInvitationToken = async (customerEmail, gradingRequestId, createdByAdmin) => {
  const token = crypto.randomBytes(32).toString('hex');
  const expires_at = new Date(Date.now() + INVITATION_TOKEN_DURATION);
  
  await pool.query(`
    INSERT INTO customer_auth_tokens (
      customer_email, grading_request_id, token, token_type, 
      expires_at, created_by_admin
    ) VALUES ($1, $2, $3, 'invitation', $4, $5)
  `, [customerEmail.toLowerCase(), gradingRequestId, token, expires_at, createdByAdmin]);
  
  return {
    token,
    expires_at,
    invitation_url: `/client/invitation/${token}`,
    grading_request_id: gradingRequestId
  };
};

/**
 * VALIDER TOKEN D'INVITATION
 */
export const validateCustomerInvitationToken = async (token) => {
  const result = await pool.query(`
    SELECT 
      cat.id,
      cat.customer_email,
      cat.grading_request_id,
      cat.expires_at,
      cat.used,
      gr.submission_id,
      gr.card_name,
      gr.grading_type,
      gr.status,
      gr.price,
      gr.created_at as order_created_at
    FROM customer_auth_tokens cat
    JOIN grading_requests gr ON cat.grading_request_id = gr.id
    WHERE cat.token = $1 AND cat.token_type = 'invitation'
  `, [token]);
  
  if (result.rows.length === 0) {
    throw new Error('Token d\'invitation invalide');
  }
  
  const tokenData = result.rows[0];
  
  // Vérifier l'expiration
  if (new Date() > new Date(tokenData.expires_at)) {
    throw new Error('Token d\'invitation expiré');
  }
  
  return tokenData;
};

/**
 * UTILISER TOKEN D'INVITATION (marquer comme utilisé)
 */
export const useCustomerInvitationToken = async (token) => {
  await pool.query(
    'UPDATE customer_auth_tokens SET used = true, used_at = CURRENT_TIMESTAMP WHERE token = $1',
    [token]
  );
};

/**
 * RÉCUPÉRER LES COMMANDES D'UN CLIENT
 */
export const getCustomerOrders = async (customerId) => {
  const customer = await pool.query('SELECT email FROM customers WHERE id = $1', [customerId]);
  
  if (customer.rows.length === 0) {
    throw new Error('Client non trouvé');
  }
  
  const customerEmail = customer.rows[0].email;
  
  const result = await pool.query(`
    SELECT 
      id,
      submission_id,
      card_name,
      card_series,
      card_number,
      grading_type,
      status,
      price,
      created_at,
      estimated_completion,
      tracking_number,
      psa_submission_number,
      video_url,
      video_status,
      payment_status,
      psa_status,
      psa_received_date,
      psa_estimated_date,
      psa_completed_date,
      whatnot_username,
      live_date
    FROM grading_requests
    WHERE customer_id = $1 OR customer_email = $2
    ORDER BY created_at DESC
  `, [customerId, customerEmail]);
  
  return result.rows;
};

/**
 * LIER AUTOMATIQUEMENT TOUTES LES COMMANDES EXISTANTES LORS D'INSCRIPTION LIBRE
 * @param {number} customerId - ID du nouveau client créé
 * @param {string} customerEmail - Email du client
 * @returns {Promise<Array>} Liste des commandes liées avec détails
 */
export const linkExistingOrdersToNewCustomer = async (customerId, customerEmail) => {
  try {
    // Rechercher et lier toutes les commandes orphelines pour cet email
    const result = await pool.query(`
      UPDATE grading_requests 
      SET customer_id = $1, updated_at = CURRENT_TIMESTAMP 
      WHERE customer_email = $2 
      AND customer_id IS NULL
      RETURNING id, submission_id, card_name, created_at, price, grading_type
    `, [customerId, customerEmail.toLowerCase()]);
    
    const linkedOrders = result.rows;
    
    if (linkedOrders.length > 0) {
      const submissionIds = linkedOrders.map(order => order.submission_id).join(', ');
      console.log(`[CLIENT] ✅ ${linkedOrders.length} commandes existantes liées automatiquement pour ${customerEmail}`);
      console.log(`[CLIENT] 📋 Commandes liées: ${submissionIds}`);
    }
    
    return linkedOrders.map(order => ({
      id: order.id,
      submission_id: order.submission_id,
      card_name: order.card_name,
      grading_type: order.grading_type,
      price: order.price,
      created_at: order.created_at
    }));
    
  } catch (error) {
    console.error(`[CLIENT] ❌ Erreur liaison commandes existantes pour ${customerEmail}:`, error);
    throw error; // Propager l'erreur pour gestion dans createCustomerAccount
  }
};

/**
 * LIER UNE COMMANDE À UN CLIENT (lors de la création de compte via invitation)
 */
export const linkOrderToCustomer = async (customerId, gradingRequestId) => {
  await pool.query(
    'UPDATE grading_requests SET customer_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [customerId, gradingRequestId]
  );
};

console.log('✅ Client authentication system initialized');