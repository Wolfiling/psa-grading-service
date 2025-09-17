import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { logWarning, logSecurity } from '../config/winston.js';

/**
 * Middleware de performance et sécurité pour production
 * Optimisé pour VPS OVH avec nginx reverse proxy
 */

// ===============================================
// 1. COMPRESSION ADAPTATIVE
// ===============================================

export const compressionMiddleware = () => {
  return compression({
    // Niveau de compression (1-9, 6 est un bon compromis)
    level: parseInt(process.env.COMPRESSION_LEVEL) || 6,
    
    // Taille minimum pour déclencher la compression
    threshold: 1024, // 1KB
    
    // Filtres de compression
    filter: (req, res) => {
      // Ne pas compresser les réponses déjà compressées
      if (res.getHeader('content-encoding')) {
        return false;
      }
      
      // Ne pas compresser les fichiers déjà compressés
      const url = req.url.toLowerCase();
      const skipExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.webm', '.pdf', '.zip', '.gz'];
      if (skipExtensions.some(ext => url.includes(ext))) {
        return false;
      }
      
      // Appliquer la compression par défaut
      return compression.filter(req, res);
    },
    
    // Configuration de la mémoire
    chunkSize: 16384,
    windowBits: 15,
    memLevel: 8
  });
};

// ===============================================
// 2. HEADERS DE CACHE OPTIMISÉS
// ===============================================

export const cacheHeaders = () => {
  return (req, res, next) => {
    const url = req.url.toLowerCase();
    
    // Assets statiques (cache long)
    if (url.match(/\.(css|js|png|jpg|jpeg|gif|ico|svg|webp|woff2?|ttf|eot)$/)) {
      const maxAge = parseInt(process.env.STATIC_CACHE_MAX_AGE) || 31536000; // 1 an
      res.setHeader('Cache-Control', `public, max-age=${maxAge}, immutable`);
      res.setHeader('Expires', new Date(Date.now() + maxAge * 1000).toUTCString());
      
    // HTML et API (pas de cache ou cache court)
    } else if (url.match(/\.(html|htm)$/) || url.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      
    // Pages dynamiques (cache court)
    } else {
      res.setHeader('Cache-Control', 'private, max-age=300'); // 5 minutes
    }
    
    next();
  };
};

// ===============================================
// 3. SÉCURITÉ RENFORCÉE HELMET
// ===============================================

export const securityHeaders = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  return helmet({
    // Content Security Policy adapté
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: [
          "'self'",
          "'unsafe-inline'", // Nécessaire pour les styles inline existants
          "https://fonts.googleapis.com"
        ],
        fontSrc: [
          "'self'",
          "https://fonts.gstatic.com"
        ],
        scriptSrc: [
          "'self'",
          isProduction ? null : "'unsafe-inline'" // Inline scripts uniquement en dev
        ].filter(Boolean),
        imgSrc: [
          "'self'",
          "data:",
          "https:",
          "blob:" // Pour les uploads d'images
        ],
        connectSrc: [
          "'self'",
          "https://api.brevo.com", // API Brevo
          "wss:" // WebSockets si utilisés
        ],
        mediaSrc: ["'self'", "blob:"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"]
      },
      reportOnly: !isProduction
    },
    
    // Protection XSS
    crossOriginEmbedderPolicy: false, // Désactivé pour compatibilité Replit/iframe
    
    // HSTS en production uniquement
    hsts: isProduction ? {
      maxAge: 31536000, // 1 an
      includeSubDomains: true,
      preload: true
    } : false,
    
    // Headers de sécurité
    noSniff: true, // X-Content-Type-Options: nosniff
    frameguard: { action: 'deny' }, // X-Frame-Options: DENY
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    
    // Masquer les informations du serveur
    hidePoweredBy: true,
    
    // Configuration additionnelle pour OVH
    ...(isProduction && {
      expectCt: {
        maxAge: 86400,
        enforce: true
      }
    })
  });
};

// ===============================================
// 4. RATE LIMITING INTELLIGENT
// ===============================================

// Rate limiter général
export const generalRateLimit = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 900000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  message: {
    error: 'Trop de requêtes depuis cette IP, veuillez réessayer plus tard.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  
  // Fonction de génération de clé (support IPv6)
  keyGenerator: (req) => {
    return req.ip || req.connection.remoteAddress || 'anonymous';
  },
  
  // Handler personnalisé
  handler: (req, res) => {
    logSecurity('RATE_LIMIT_EXCEEDED', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.url,
      method: req.method
    });
    
    res.status(429).json({
      error: 'Trop de requêtes depuis cette IP',
      retryAfter: '15 minutes'
    });
  }
});

// Rate limiter strict pour l'authentification
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 tentatives max
  skipSuccessfulRequests: true,
  message: {
    error: 'Trop de tentatives de connexion, veuillez réessayer dans 15 minutes.',
    retryAfter: '15 minutes'
  },
  handler: (req, res) => {
    logSecurity('AUTH_RATE_LIMIT_EXCEEDED', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      endpoint: req.url
    });
    
    res.status(429).json({
      error: 'Trop de tentatives de connexion',
      retryAfter: '15 minutes'
    });
  }
});

// Rate limiter pour les uploads
export const uploadRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20, // 20 uploads max
  message: {
    error: 'Trop de tentatives d\'upload, veuillez patienter.',
    retryAfter: '5 minutes'
  }
});

// ===============================================
// 5. TRUST PROXY (IMPORTANT POUR OVH)
// ===============================================

export const configureTrustProxy = (app) => {
  if (process.env.TRUST_PROXY === 'true' || process.env.NODE_ENV === 'production') {
    // Configuration pour OVH avec load balancer/proxy
    app.set('trust proxy', ['127.0.0.1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']);
    
    logWarning('Trust proxy configured for production environment');
  }
};

// ===============================================
// 6. MONITORING DES PERFORMANCES
// ===============================================

export const performanceMonitoring = () => {
  return (req, res, next) => {
    const start = Date.now();
    
    // Intercepter la fin de la requête
    const originalEnd = res.end;
    res.end = function(...args) {
      const duration = Date.now() - start;
      
      // Logger les requêtes lentes
      if (duration > 5000) { // > 5 secondes
        logWarning('Slow request detected', {
          method: req.method,
          url: req.url,
          duration: `${duration}ms`,
          statusCode: res.statusCode,
          contentLength: res.get('content-length')
        });
      }
      
      // Ajouter header de performance
      res.setHeader('X-Response-Time', `${duration}ms`);
      
      originalEnd.apply(this, args);
    };
    
    next();
  };
};

// ===============================================
// 7. NETTOYAGE DES HEADERS
// ===============================================

export const cleanHeaders = () => {
  return (req, res, next) => {
    // Supprimer headers sensibles
    res.removeHeader('X-Powered-By');
    res.removeHeader('Server');
    
    // Ajouter headers de sécurité personnalisés
    res.setHeader('X-Application', 'PSA-Grading');
    res.setHeader('X-Version', process.env.npm_package_version || '1.0.0');
    
    next();
  };
};

// ===============================================
// 8. MIDDLEWARE COMBINÉ
// ===============================================

export const applyPerformanceMiddleware = (app) => {
  // Configuration du trust proxy en premier
  configureTrustProxy(app);
  
  // Headers de sécurité
  if (process.env.SECURITY_HEADERS !== 'false') {
    app.use(securityHeaders());
  }
  
  // Compression
  if (process.env.ENABLE_COMPRESSION !== 'false') {
    app.use(compressionMiddleware());
  }
  
  // Cache headers
  app.use(cacheHeaders());
  
  // Nettoyage headers
  app.use(cleanHeaders());
  
  // Monitoring performance
  app.use(performanceMonitoring());
  
  // Rate limiting général
  app.use(generalRateLimit);
};

export default {
  applyPerformanceMiddleware,
  authRateLimit,
  uploadRateLimit,
  generalRateLimit,
  compressionMiddleware,
  securityHeaders,
  cacheHeaders,
  performanceMonitoring
};