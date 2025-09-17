/**
 * Configuration PM2 pour déploiement production PSA Grading App
 * Optimisée pour VPS OVH avec clustering et monitoring
 */

module.exports = {
  apps: [
    {
      // Configuration principale de l'application
      name: 'psa-grading-app',
      script: 'server/index.js',
      
      // Configuration des instances (clustering)
      instances: process.env.PM2_INSTANCES || 'max', // 'max' utilise tous les CPU disponibles
      exec_mode: 'cluster',
      
      // Configuration des ressources
      max_memory_restart: '512M', // Redémarrage si mémoire > 512MB
      min_uptime: '10s',
      max_restarts: 10,
      
      // Variables d'environnement
      env: {
        NODE_ENV: 'development',
        PORT: 5000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 5000,
        LOG_DIR: '/var/log/psa-grading',
        // Les autres variables seront lues depuis .env
      },
      
      // Configuration des logs
      log_file: '/var/log/psa-grading/pm2-combined.log',
      out_file: '/var/log/psa-grading/pm2-out.log',
      error_file: '/var/log/psa-grading/pm2-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      
      // Rotation des logs PM2
      log_type: 'json',
      
      // Configuration de redémarrage
      restart_delay: 4000,
      exponential_backoff_restart_delay: 100,
      
      // Monitoring et health check
      health_check_grace_period: 3000,
      health_check_fatal_exceptions: true,
      
      // Configuration des signaux
      kill_timeout: 5000,
      listen_timeout: 3000,
      
      // Auto restart sur changement de fichiers (désactivé en prod)
      watch: false,
      ignore_watch: ['node_modules', 'logs', '.git'],
      
      // Configuration avancée
      source_map_support: false,
      instance_var: 'INSTANCE_ID',
      
      // Gestion des erreurs
      catch_exceptions: true,
      
      // Configuration pour OVH
      node_args: [
        '--max-old-space-size=512',
        '--optimize-for-size'
      ],
      
      // Scripts de hooks
      pre_start: 'echo "Starting PSA Grading App..."',
      post_start: 'echo "PSA Grading App started successfully"'
    }
  ],
  
  // Configuration pour le déploiement
  deploy: {
    production: {
      user: 'psa-app', // Utilisateur non-privilégié pour la sécurité
      host: ['your-ovh-server.com'], // Remplacez par votre serveur OVH
      ref: 'origin/main',
      repo: 'https://github.com/your-username/psa-grading-app.git', // Remplacez par votre repo
      path: '/var/www/psa-grading-app',
      
      // Commandes de déploiement
      'pre-deploy': 'git fetch --all',
      'post-deploy': [
        'npm ci --production',
        'test -f .env || (echo "❌ ERREUR: Fichier .env manquant! Créez-le avec vos vraies variables" && exit 1)',
        'mkdir -p /var/log/psa-grading',
        'chmod +x scripts/post-deploy.sh',
        './scripts/post-deploy.sh',
        'pm2 startOrReload ecosystem.config.js --env production',
        'pm2 save'
      ].join(' && '),
      
      // Variables d'environnement pour le déploiement
      env: {
        NODE_ENV: 'production'
      }
    }
  }
};

// Configuration spécifique pour différents environnements
if (process.env.NODE_ENV === 'production') {
  // Optimisations pour production
  module.exports.apps[0].instances = process.env.PM2_INSTANCES || Math.max(1, require('os').cpus().length - 1);
  module.exports.apps[0].max_memory_restart = '1G';
  
  // Désactiver les logs détaillés en production
  module.exports.apps[0].log_level = 'warn';
  
} else if (process.env.NODE_ENV === 'staging') {
  // Configuration staging
  module.exports.apps[0].instances = 2;
  module.exports.apps[0].max_memory_restart = '256M';
  
} else {
  // Configuration développement
  module.exports.apps[0].instances = 1;
  module.exports.apps[0].watch = true;
  module.exports.apps[0].ignore_watch = [
    'node_modules',
    'logs',
    '.git',
    'uploads',
    '*.log'
  ];
}