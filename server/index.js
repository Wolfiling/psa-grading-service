import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import csrf from 'csrf';
import dotenv from 'dotenv';
// Force restart with PSA_SECRET environment variable
import path from 'path';
import { fileURLToPath } from 'url';
import { createGradingRequestRoutes } from './routes/grading.js';
import { createWebhookRoutes } from './routes/webhooks.js';
import { createPublicRoutes } from './routes/public.js';
import { createShopifyRoutes } from './routes/shopify.js';
import { createPSARoutes } from './routes/psa.js';
import { createCardRoutes } from './routes/cards.js';
import { createAdminRoutes } from './routes/admin.js';
import { createAdminVideoRoutes } from './routes/admin-video.js';
import { createAdminPSARoutes } from './routes/admin-psa.js';
import { createVideoRoutes } from './routes/video.js';
import { createClientVideoRoutes } from './routes/client-video.js';
import { createAdminValidationRoutes } from './routes/admin-validation.js';
import { createMetricsRoutes } from './routes/metrics.js';
import { createClientRoutes } from './routes/client.js';
import { serveAdminInterface, requireAdminAuth } from './middleware/auth.js';
import { initializeDatabase } from './database/init.js';
import { initializeGlobalScraper } from './services/psaScraper.js';
import cron from 'node-cron';
import cookieParser from 'cookie-parser';
import session from 'express-session';

// ES Module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure dotenv to look in parent directory for .env file
dotenv.config({ path: path.join(__dirname, '../.env') });

const PORT = process.env.PORT || 5000;
const isDevelopment = process.env.NODE_ENV === 'development';

// ✅ SÉCURITÉ CRITIQUE: Forcer ADMIN_PASSWORD obligatoire en production
if (!isDevelopment && !process.env.ADMIN_PASSWORD) {
  console.error('❌ FATAL: ADMIN_PASSWORD est obligatoire en production !');
  console.error('   Définissez ADMIN_PASSWORD dans vos variables d\'environnement');
  process.exit(1);
}

if (!process.env.ADMIN_PASSWORD) {
  console.error('❌ FATAL: ADMIN_PASSWORD environment variable is required!');
  console.error('   Please set ADMIN_PASSWORD in your .env file');
  process.exit(1);
}

const app = express();

// ✅ SECURITY: Configure trust proxy for HTTPS behind reverse proxy
app.set('trust proxy', 1);

// ✅ SECURITY: Disable X-Powered-By header explicitly
app.disable('x-powered-by');

// ✅ SECURITY: Enhanced Helmet configuration for production security
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false, // Allow iframe embedding for Replit
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  // HSTS configuration (forceHTTPS removed - not valid in Helmet)
  noSniff: true, // X-Content-Type-Options: nosniff
  frameguard: { action: 'deny' }, // X-Frame-Options: DENY
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

// ✅ SECURITY: General rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

// ✅ SECURITY: Granular rate limiting for critical endpoints (IPv6 safe)
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit to 5 login attempts per 15 minutes
  message: 'Too many admin login attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

const clientAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit to 10 auth attempts per 15 minutes
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

const uploadLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20, // Limit to 20 uploads per 5 minutes
  message: 'Too many upload attempts, please wait before uploading again.',
  standardHeaders: true,
  legacyHeaders: false
});

app.use(generalLimiter);

// ✅ SECURITY: Production-ready CORS configuration
const getAllowedOrigins = () => {
  // Base development origins
  const devOrigins = [
    'http://localhost:3000',
    'http://localhost:5000',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5000'
  ];
  
  // Production origins from environment variable
  const prodOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
    : [];
  
  // Current Replit domains (fallback for development)
  const replitOrigins = [
    'https://faeeb991-ce9a-47bf-99af-545acff0e03d-00-3i74k38gy2cmu.picard.replit.dev',
    /\.replit\.dev$/,
    /\.replit\.com$/
  ];
  
  // In production, prefer env origins, otherwise use dev + replit
  if (process.env.NODE_ENV === 'production' && prodOrigins.length > 0) {
    return [...prodOrigins, ...devOrigins]; // Include dev for testing
  }
  
  return [...devOrigins, ...replitOrigins, ...prodOrigins];
};

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = getAllowedOrigins();
    
    const isAllowed = allowedOrigins.some(allowed => {
      if (typeof allowed === 'string') {
        return origin === allowed;
      }
      return allowed.test && allowed.test(origin);
    });
    
    if (isAllowed || isDevelopment) {
      callback(null, true);
    } else {
      console.warn(`🚨 CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token']
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ✅ SECURITY: HTTPS redirection in production (Helmet forceHTTPS replacement)
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.hostname}${req.url}`);
    }
    next();
  });
}

// ✅ SECURITY: Apply specific rate limiters to sensitive endpoints BEFORE route configuration
app.use('/api/admin/login', adminLoginLimiter);
app.use('/api/client/register', clientAuthLimiter);
app.use('/api/client/login', clientAuthLimiter);
app.use('/api/video/upload', uploadLimiter);
app.use('/api/client/video/upload', uploadLimiter);

// ✅ SECURITY: Validate all required secrets in production
if (!isDevelopment) {
  const requiredSecrets = ['SESSION_SECRET', 'PSA_SECRET', 'PSA_CLIENT_SECRET', 'ADMIN_PASSWORD'];
  const missingSecrets = requiredSecrets.filter(secret => !process.env[secret]);
  
  if (missingSecrets.length > 0) {
    console.error('❌ FATAL: Missing required secrets in production:', missingSecrets.join(', '));
    console.error('   Set these environment variables before deploying to production');
    process.exit(1);
  }
}

// ✅ SECURITY: Enhanced session configuration
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || (() => {
    if (isDevelopment) {
      console.warn('⚠️ DEVELOPMENT: Using fallback SESSION_SECRET. Configure SESSION_SECRET for production!');
      return 'dev-session-secret-not-for-production';
    }
    throw new Error('SESSION_SECRET is required in production');
  })(),
  name: 'psa.sid', // Custom session name
  resave: false,
  saveUninitialized: false,
  rolling: true, // Reset expiration on activity
  cookie: {
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    httpOnly: true, // Prevent XSS
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax' // CSRF protection
  }
}));

// ✅ SECURITY: CSRF protection for admin routes
const tokens = csrf();

// CSRF token endpoint for frontend
app.get('/api/csrf-token', (req, res) => {
  const secret = req.session.csrfSecret || tokens.secretSync();
  req.session.csrfSecret = secret;
  const token = tokens.create(secret);
  res.json({ csrfToken: token });
});

// CSRF validation middleware
const csrfProtection = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  
  const secret = req.session.csrfSecret;
  if (!secret) {
    return res.status(403).json({ error: 'CSRF session not initialized' });
  }
  
  const token = req.headers['x-csrf-token'] || req.body._csrf;
  if (!token || !tokens.verify(secret, token)) {
    console.warn('🚨 CSRF token validation failed');
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  
  next();
};

// API Routes - Public routes (no CSRF protection needed)
app.use('/api/public', createPublicRoutes());
app.use('/api/video', createVideoRoutes());
app.use('/api/client', createClientRoutes());
app.use('/api/client/video', createClientVideoRoutes());
app.use('/api/shopify', createShopifyRoutes());

// ✅ SECURITY: Admin routes with CSRF protection and rate limiting
app.use('/api/grading', csrfProtection, requireAdminAuth, createGradingRequestRoutes());
app.use('/api/psa', csrfProtection, requireAdminAuth, createPSARoutes());
app.use('/api/cards', csrfProtection, requireAdminAuth, createCardRoutes());
app.use('/api/admin', csrfProtection, createAdminRoutes());
app.use('/api/admin', csrfProtection, createAdminPSARoutes());
app.use('/admin/api', csrfProtection, createAdminVideoRoutes());
app.use('/api/admin/validation', csrfProtection, requireAdminAuth, createAdminValidationRoutes());
app.use('/api/metrics', csrfProtection, requireAdminAuth, createMetricsRoutes());

// ✅ SECURITY: Rate limiters now applied BEFORE routes (see lines 196-200)

// ✅ SÉCURITÉ CRITIQUE: Bloquer l'accès direct à admin.html pour forcer l'authentification
app.get('/admin.html', (req, res) => {
  res.status(403).json({ 
    error: 'Accès non autorisé', 
    message: 'Utilisez /admin pour accéder à l\'interface administrateur sécurisée' 
  });
});

// Serve static files (for landing page assets)
app.use(express.static(path.join(__dirname, '../public')));

// Route spéciale pour les invitations client
app.get('/client/invitation/:token', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'client-invitation.html'));
});

// Route d'inscription libre
app.get('/signup', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, '..', 'public', 'signup.html'));
});

// ✅ SÉCURITÉ UPLOADS: Service sécurisé des fichiers avec headers protecteurs
app.use('/uploads', (req, res, next) => {
  // Headers de sécurité contre XSS
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  // Permettre l'affichage inline pour les images validées (pas d'attachment forcé)
  if (req.path.match(/\.(jpg|jpeg|png|webp)$/i)) {
    res.setHeader('Content-Type', 'image/*');
  }
  next();
}, express.static(path.join(__dirname, '../uploads')));

// Landing page route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Admin interface routes with authentication
app.get('/admin/video-proof', serveAdminInterface, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin-video.html'));
});

// ✅ FIX: Servir directement admin.html avec headers anti-cache
app.get('/admin*', serveAdminInterface, (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// Page de suivi client
app.get('/status', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/status.html'));
});

// Page d'enregistrement vidéo (personnel)
app.get('/video-record', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/video-record.html'));
});

// Portail client pour accès aux vidéos de preuve
app.get('/video-proof-client', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/video-proof-client.html'));
});

// Page d'aide client
app.get('/client-help', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/client-help.html'));
});

// Health check endpoint
app.get('/healthz', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    database: 'connected'
  });
});

// Fonction d'initialisation du scraper avec timeout non-bloquant
async function initializeScraperWithTimeout() {
  try {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Timeout scraper PSA (10s)')), 10000);
    });
    
    await Promise.race([
      initializeGlobalScraper(),
      timeoutPromise
    ]);
    
    console.log('✅ Global PSA Scraper initialized');
  } catch (error) {
    console.log('⚠️ Scraper PSA: ' + error.message + ' (serveur continue de fonctionner)');
    // Le serveur continue même si le scraper échoue
  }
}

// Initialize database and start server
async function startServer() {
  try {
    console.log('📊 Initialisation base de données...');
    await initializeDatabase();
    console.log('✅ Database initialized successfully');
    
    // Démarrer le serveur HTTP IMMÉDIATEMENT pour éviter les blocages
    app.listen(PORT, '0.0.0.0', () => {
      console.log('🚀 PSA Grading App running on:', `http://0.0.0.0:${PORT}`);
      console.log('📊 Environment:', process.env.NODE_ENV || 'development');
      console.log('💾 Database:', process.env.DATABASE_URL ? 'Connected' : 'Not configured');
      console.log('🔍 PSA Status Page:', `http://0.0.0.0:${PORT}/status`);
      console.log('🔍 Health Check:', `http://0.0.0.0:${PORT}/healthz`);
    });
    
    // Initialiser le scraper PSA en arrière-plan (non-bloquant)
    console.log('🤖 Initialisation scraper PSA en arrière-plan...');
    initializeScraperWithTimeout();

    // Configuration des tâches cron pour scraping automatique
    if (process.env.NODE_ENV === 'production') {
      // Scraping automatique toutes les 6 heures
      cron.schedule('0 */6 * * *', async () => {
        console.log('🔄 Début du scraping automatique PSA...');
        try {
          const { globalScraper } = await import('./services/psaScraper.js');
          if (globalScraper) {
            // 🔒 NOUVEAU : Utiliser la reconnexion automatique
            console.log('🔍 Vérification de la session PSA pour scraping automatique...');
            await globalScraper.ensureActiveSession();
            
            await globalScraper.scrapeAllPendingSubmissions();
            console.log('✅ Scraping automatique terminé avec session maintenue');
          } else {
            console.log('⚠️ Scraper global non disponible pour le scraping automatique');
          }
        } catch (error) {
          console.error('❌ Erreur lors du scraping automatique:', error);
          console.log('🔄 Le scraper tentera une reconnexion au prochain cycle');
        }
      });
      console.log('⏰ Scraping automatique PSA configuré (toutes les 6 heures)');
      
      // 🔒 NOUVEAU : Maintien de session toutes les 30 minutes
      cron.schedule('*/30 * * * *', async () => {
        try {
          const { globalScraper } = await import('./services/psaScraper.js');
          if (globalScraper && globalScraper.isLoggedIn) {
            await globalScraper.keepSessionAlive();
            console.log('💓 Session PSA maintenue automatiquement');
          }
        } catch (error) {
          console.log('⚠️ Erreur lors du maintien de session:', error.message);
        }
      });
      console.log('💓 Maintien de session PSA configuré (toutes les 30 minutes)');

      // 🎯 NOUVEAU : Vérification quotidienne des vidéos manquantes à 9h
      cron.schedule('0 9 * * *', async () => {
        console.log('🔍 Début vérification quotidienne vidéos PSA...');
        try {
          const { performDailyVideoCheck } = await import('./utils/alertSystem.js');
          const result = await performDailyVideoCheck();
          
          if (result.success) {
            console.log(`✅ Vérification quotidienne terminée: ${result.commands_processed} commandes analysées`);
            console.log(`📧 Alertes envoyées: ${result.alerts_sent} admin, ${result.reminders_sent} clients`);
          } else {
            console.error(`❌ Erreur vérification quotidienne: ${result.message}`);
          }
        } catch (error) {
          console.error('❌ Erreur lors de la vérification quotidienne:', error);
        }
      });
      console.log('📧 Vérification quotidienne vidéos PSA configurée (9h)');

      // 🎯 NOUVEAU : Nettoyage automatique des anciennes données (dimanche à 2h)
      cron.schedule('0 2 * * 0', async () => {
        console.log('🧹 Début nettoyage automatique des données...');
        try {
          const { cleanupOldVideoData } = await import('./utils/videoProof.js');
          const { cleanupOldQRCodes } = await import('./utils/qrGenerator.js');

          // Nettoyer les données vidéo anciennes (90 jours)
          const videoCleanup = await cleanupOldVideoData(90);
          console.log(`🗑️ Nettoyage vidéos: ${videoCleanup.message}`);

          // Nettoyer les QR codes anciens (30 jours)
          const qrCleanup = await cleanupOldQRCodes(30);
          console.log(`🗑️ Nettoyage QR codes: ${qrCleanup.message}`);

          console.log('✅ Nettoyage automatique terminé');
        } catch (error) {
          console.error('❌ Erreur lors du nettoyage automatique:', error);
        }
      });
      console.log('🧹 Nettoyage automatique configuré (dimanche 2h)');
    }
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();