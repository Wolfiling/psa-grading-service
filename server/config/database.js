import pkg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger, { logError, logInfo, logWarning } from './winston.js';

const { Pool } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Configuration sécurisée de la base de données pour production
 * Optimisée pour VPS OVH avec PostgreSQL
 */

// Configuration du pool optimisée pour production
const getPoolConfig = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  const config = {
    // URL de connexion depuis les variables d'environnement
    connectionString: process.env.DATABASE_URL,
    
    // Configuration du pool optimisée
    min: parseInt(process.env.DB_POOL_MIN) || (isProduction ? 5 : 2),
    max: parseInt(process.env.DB_POOL_MAX) || (isProduction ? 20 : 10),
    
    // Timeouts optimisés pour production
    idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT) || 30000,
    connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT) || 60000,
    acquireTimeoutMillis: 60000,
    
    // Configuration SSL pour OVH (obligatoire en production)
    ssl: isProduction ? {
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
      // Chemin vers le certificat CA OVH (si fourni)
      ca: process.env.DB_SSL_CA_PATH ? fs.readFileSync(process.env.DB_SSL_CA_PATH) : undefined
    } : false,
    
    // Paramètres de performance
    query_timeout: 30000,
    statement_timeout: 30000,
    idle_in_transaction_session_timeout: 30000,
    
    // Configuration d'application
    application_name: `psa-grading-${process.env.NODE_ENV || 'development'}`,
    
    // Fonction de validation des connexions
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000
  };
  
  // Validation de la configuration
  if (!config.connectionString) {
    throw new Error('DATABASE_URL is required in environment variables');
  }
  
  // Validation SSL en production
  if (isProduction && !config.ssl) {
    logWarning('SSL not configured for database in production environment');
  }
  
  return config;
};

// Création du pool avec configuration sécurisée
let pool = null;

const createPool = () => {
  if (pool) {
    return pool;
  }
  
  try {
    const config = getPoolConfig();
    pool = new Pool(config);
    
    // Gestionnaire d'événements pour monitoring
    pool.on('connect', (client) => {
      logInfo('New database connection established', {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount
      });
    });
    
    pool.on('remove', (client) => {
      logInfo('Database connection removed from pool', {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount
      });
    });
    
    pool.on('error', (err, client) => {
      logError('Unexpected database pool error', err, {
        client: client ? 'defined' : 'undefined',
        poolStats: {
          totalCount: pool.totalCount,
          idleCount: pool.idleCount,
          waitingCount: pool.waitingCount
        }
      });
    });
    
    // Gestion propre de l'arrêt
    const gracefulShutdown = async () => {
      if (pool) {
        logInfo('Closing database pool gracefully...');
        try {
          await pool.end();
          logInfo('Database pool closed successfully');
        } catch (err) {
          logError('Error closing database pool', err);
        }
      }
    };
    
    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
    process.on('exit', gracefulShutdown);
    
    return pool;
    
  } catch (error) {
    logError('Failed to create database pool', error);
    throw error;
  }
};

// Fonction utilitaire pour requête avec retry automatique
export const queryWithRetry = async (text, params = [], retries = 3) => {
  const dbPool = createPool();
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const start = Date.now();
      const result = await dbPool.query(text, params);
      const duration = Date.now() - start;
      
      // Log des requêtes lentes (> 1 seconde)
      if (duration > 1000) {
        logWarning('Slow database query detected', {
          duration: `${duration}ms`,
          query: text.substring(0, 100),
          attempt
        });
      }
      
      return result;
      
    } catch (error) {
      logError(`Database query failed (attempt ${attempt}/${retries})`, error, {
        query: text.substring(0, 100),
        paramsCount: params ? params.length : 0,
        errorCode: error.code,
        errorSeverity: error.severity
      });
      
      // Erreurs non récupérables
      const nonRetryableErrors = [
        '23505', // unique_violation
        '23503', // foreign_key_violation  
        '23502', // not_null_violation
        '42P01', // undefined_table
        '42703'  // undefined_column
      ];
      
      if (nonRetryableErrors.includes(error.code) || attempt === retries) {
        throw error;
      }
      
      // Délai exponentiel entre les tentatives
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

// Transaction sécurisée avec rollback automatique
export const withTransaction = async (callback) => {
  const dbPool = createPool();
  const client = await dbPool.connect();
  
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
    
  } catch (error) {
    await client.query('ROLLBACK');
    logError('Transaction rolled back due to error', error);
    throw error;
    
  } finally {
    client.release();
  }
};

// Health check de la base de données
export const healthCheck = async () => {
  try {
    const dbPool = createPool();
    const start = Date.now();
    const result = await dbPool.query('SELECT NOW() as server_time, version() as version');
    const duration = Date.now() - start;
    
    return {
      status: 'healthy',
      duration: `${duration}ms`,
      serverTime: result.rows[0]?.server_time,
      version: result.rows[0]?.version?.split(' ')[0],
      poolStats: {
        totalCount: dbPool.totalCount,
        idleCount: dbPool.idleCount,
        waitingCount: dbPool.waitingCount
      },
      ssl: process.env.NODE_ENV === 'production' ? 'enabled' : 'disabled'
    };
    
  } catch (error) {
    logError('Database health check failed', error);
    return {
      status: 'unhealthy',
      error: error.message,
      code: error.code
    };
  }
};

// Monitoring des performances
export const getPoolStats = () => {
  if (!pool) {
    return { status: 'not_initialized' };
  }
  
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
    maxPoolSize: pool.options.max,
    minPoolSize: pool.options.min
  };
};

// Fonction de backup (pour scripts externes)
export const createBackupSQL = () => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    command: 'pg_dump',
    args: [
      process.env.DATABASE_URL,
      '--no-password',
      '--format=custom',
      '--compress=9',
      '--verbose'
    ],
    outputFile: `psa-backup-${timestamp}.sql`
  };
};

// Configuration des indexes pour performance
export const ensureIndexes = async () => {
  const indexes = [
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grading_requests_status ON grading_requests(status)',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grading_requests_created_at ON grading_requests(created_at DESC)',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grading_requests_submission_id ON grading_requests(submission_id)',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grading_requests_customer_email ON grading_requests(customer_email)',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_email ON customers(email)',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_sessions_token ON customer_sessions(session_token)',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_auth_tokens_token ON customer_auth_tokens(token)',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_status ON notifications(status, created_at)'
  ];
  
  for (const indexSQL of indexes) {
    try {
      await queryWithRetry(indexSQL);
      logInfo(`Index created successfully: ${indexSQL.split(' ')[5]}`);
    } catch (error) {
      // Les index peuvent déjà exister
      if (error.code !== '42P07') { // duplicate_object
        logWarning(`Failed to create index: ${error.message}`);
      }
    }
  }
};

// Export du pool configuré
export const getPool = () => createPool();

// Export par défaut
export default {
  query: queryWithRetry,
  getPool,
  withTransaction,
  healthCheck,
  getPoolStats,
  createBackupSQL,
  ensureIndexes
};