import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration des niveaux de logs
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4
};

// Configuration des couleurs pour la console
const logColors = {
  error: 'red',
  warn: 'yellow', 
  info: 'green',
  http: 'magenta',
  debug: 'blue'
};

winston.addColors(logColors);

// Fonction de masquage des données sensibles
const maskSensitiveData = (info) => {
  const sensitiveFields = [
    'password',
    'token',
    'secret',
    'api_key',
    'authorization',
    'cookie',
    'session',
    'csrf',
    'x-api-key',
    'psa_password',
    'admin_password',
    'session_secret',
    'psa_secret',
    'jwt_secret',
    'brevo_api_key'
  ];

  // Cloner l'objet pour éviter les mutations
  const maskedInfo = JSON.parse(JSON.stringify(info));
  
  const maskValue = (obj, key, value) => {
    if (typeof value === 'string' && value.length > 8) {
      return `${value.substring(0, 4)}****${value.substring(value.length - 4)}`;
    } else if (typeof value === 'string') {
      return '****';
    }
    return '[MASKED]';
  };

  const maskObject = (obj) => {
    if (typeof obj === 'object' && obj !== null) {
      Object.keys(obj).forEach(key => {
        const lowerKey = key.toLowerCase();
        
        if (sensitiveFields.some(field => lowerKey.includes(field))) {
          obj[key] = maskValue(obj, key, obj[key]);
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          maskObject(obj[key]);
        }
      });
    }
  };

  // Masquer dans le message principal
  if (maskedInfo.message && typeof maskedInfo.message === 'object') {
    maskObject(maskedInfo.message);
  }

  // Masquer dans les métadonnées
  maskObject(maskedInfo);
  
  return maskedInfo;
};

// Format personnalisé pour les logs JSON sécurisés
const jsonFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.printf(info => {
    const maskedInfo = maskSensitiveData(info);
    return JSON.stringify({
      timestamp: maskedInfo.timestamp,
      level: maskedInfo.level,
      message: maskedInfo.message,
      service: 'psa-grading-app',
      environment: process.env.NODE_ENV || 'development',
      ...(maskedInfo.stack && { stack: maskedInfo.stack }),
      ...(maskedInfo.meta && { meta: maskedInfo.meta })
    });
  })
);

// Format pour la console (développement uniquement)
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(info => {
    return `[${info.timestamp}] ${info.level}: ${info.message}${info.stack ? '\n' + info.stack : ''}`;
  })
);

// Configuration des transports
const transports = [];

// Console (uniquement en développement)
if (process.env.NODE_ENV !== 'production') {
  transports.push(
    new winston.transports.Console({
      level: 'debug',
      format: consoleFormat
    })
  );
}

// Fichiers de logs (production et développement)
const logDir = process.env.LOG_DIR || path.join(__dirname, '../../logs');

// Log d'erreurs (toujours)
transports.push(
  new winston.transports.File({
    level: 'error',
    filename: path.join(logDir, 'error.log'),
    format: jsonFormat,
    maxsize: 10485760, // 10MB
    maxFiles: 5,
    tailable: true
  })
);

// Log général (info et plus)
transports.push(
  new winston.transports.File({
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    filename: path.join(logDir, 'combined.log'),
    format: jsonFormat,
    maxsize: 10485760, // 10MB
    maxFiles: 10,
    tailable: true
  })
);

// Log HTTP (pour traçabilité des requêtes)
transports.push(
  new winston.transports.File({
    level: 'http',
    filename: path.join(logDir, 'access.log'),
    format: jsonFormat,
    maxsize: 10485760, // 10MB
    maxFiles: 7,
    tailable: true
  })
);

// Création du logger principal
const logger = winston.createLogger({
  levels: logLevels,
  transports,
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logDir, 'exceptions.log'),
      format: jsonFormat
    })
  ],
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logDir, 'rejections.log'),
      format: jsonFormat
    })
  ],
  exitOnError: false
});

// Middleware Express pour logs HTTP automatiques
export const httpLogger = (req, res, next) => {
  const start = Date.now();
  
  // Capturer la méthode originale res.end
  const originalEnd = res.end;
  
  res.end = function(...args) {
    const duration = Date.now() - start;
    
    // Ne pas logger les données sensibles dans l'URL ou headers
    const sanitizedHeaders = { ...req.headers };
    delete sanitizedHeaders.authorization;
    delete sanitizedHeaders.cookie;
    delete sanitizedHeaders['x-api-key'];
    delete sanitizedHeaders['csrf-token'];
    
    logger.log('http', {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      contentLength: res.get('content-length'),
      duration: `${duration}ms`,
      userAgent: req.get('user-agent'),
      ip: req.ip,
      timestamp: new Date().toISOString()
    });
    
    // Appeler la méthode originale
    originalEnd.apply(this, args);
  };
  
  next();
};

// Fonctions utilitaires pour logging sécurisé
export const logError = (message, error = null, meta = {}) => {
  logger.error(message, {
    error: error ? {
      name: error.name,
      message: error.message,
      stack: error.stack
    } : null,
    meta
  });
};

export const logWarning = (message, meta = {}) => {
  logger.warn(message, { meta });
};

export const logInfo = (message, meta = {}) => {
  logger.info(message, { meta });
};

export const logDebug = (message, meta = {}) => {
  if (process.env.NODE_ENV !== 'production') {
    logger.debug(message, { meta });
  }
};

// Log de sécurité spécialisé
export const logSecurity = (event, details = {}) => {
  logger.warn(`SECURITY_EVENT: ${event}`, {
    securityEvent: true,
    event,
    details: maskSensitiveData({ details }).details,
    timestamp: new Date().toISOString()
  });
};

// Log d'audit pour les actions critiques
export const logAudit = (action, user, details = {}) => {
  logger.info(`AUDIT: ${action}`, {
    audit: true,
    action,
    user: typeof user === 'string' ? user : 'anonymous',
    details,
    timestamp: new Date().toISOString()
  });
};

// Fonction de nettoyage des logs (appelée par cron)
export const cleanOldLogs = () => {
  const retentionDays = parseInt(process.env.LOG_RETENTION_DAYS) || 30;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  
  logInfo('Log cleanup initiated', {
    retentionDays,
    cutoffDate: cutoffDate.toISOString()
  });
  
  // La rotation automatique des fichiers via Winston gère déjà cela
  // Cette fonction peut être étendue pour un nettoyage custom si nécessaire
};

export default logger;