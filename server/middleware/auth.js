import crypto from 'crypto';

// ✅ SECURITY: No fallback secrets in production
const SESSION_SECRET = process.env.SESSION_SECRET || (() => {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ FATAL: SESSION_SECRET required in production');
    process.exit(1);
  }
  console.warn('⚠️ DEVELOPMENT: Using fallback SESSION_SECRET. Configure SESSION_SECRET for production!');
  return 'dev-session-secret-auth-' + Date.now();
})();

// Rate limiting pour tentatives de connexion
const loginAttempts = new Map(); // IP -> { attempts, blockedUntil }
const MAX_LOGIN_ATTEMPTS = 5;
const BLOCK_DURATION = 15 * 60 * 1000; // 15 minutes

// Store des sessions en mémoire (pour développement)
const activeSessions = new Map();

/**
 * Middleware d'authentification pour l'interface admin
 */
export function requireAdminAuth(req, res, next) {
  const authToken = req.headers.authorization?.replace('Bearer ', '') || 
                   req.cookies?.admin_token ||
                   req.session?.admin_token;

  if (!authToken) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required',
      code: 'AUTH_REQUIRED'
    });
  }

  // Vérifier la validité du token
  const session = activeSessions.get(authToken);
  if (!session || session.expires < Date.now()) {
    // Nettoyer le token expiré
    if (session) activeSessions.delete(authToken);
    
    return res.status(401).json({
      success: false,
      message: 'Session expired',
      code: 'SESSION_EXPIRED'
    });
  }

  // Renouveler la session (24h)
  session.expires = Date.now() + (24 * 60 * 60 * 1000);
  activeSessions.set(authToken, session);

  // Ajouter les infos admin à la requête
  req.admin = session.user;
  next();
}

/**
 * Endpoint de connexion admin
 */
export function adminLogin(req, res) {
  const { password } = req.body;
  const clientIP = req.ip;

  // ✅ FIX: Utiliser ADMIN_PASSWORD au lieu de PSA_PASSWORD
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  
  // Vérification critique : ADMIN_PASSWORD obligatoire
  if (!ADMIN_PASSWORD) {
    console.error('❌ FATAL: ADMIN_PASSWORD environment variable is required!');
    return res.status(500).json({
      success: false,
      message: 'Server configuration error - admin password not set',
      code: 'CONFIG_ERROR'
    });
  }

  // Vérifier le rate limiting
  const attemptData = loginAttempts.get(clientIP);
  if (attemptData && attemptData.blockedUntil > Date.now()) {
    const minutesLeft = Math.ceil((attemptData.blockedUntil - Date.now()) / 60000);
    return res.status(429).json({
      success: false,
      message: `Too many login attempts. Try again in ${minutesLeft} minutes.`,
      code: 'RATE_LIMITED'
    });
  }

  if (!password) {
    return res.status(400).json({
      success: false,
      message: 'Password required'
    });
  }

  // Vérifier le mot de passe
  if (password !== ADMIN_PASSWORD) {
    // Incrémenter le compteur de tentatives
    const attempts = (attemptData?.attempts || 0) + 1;
    if (attempts >= MAX_LOGIN_ATTEMPTS) {
      loginAttempts.set(clientIP, {
        attempts: attempts,
        blockedUntil: Date.now() + BLOCK_DURATION
      });
      console.warn('🚨 IP bloquée pour tentatives de connexion multiples:', {
        ip: clientIP,
        attempts: attempts,
        blockedUntil: new Date(Date.now() + BLOCK_DURATION).toISOString()
      });
    } else {
      loginAttempts.set(clientIP, {
        attempts: attempts,
        blockedUntil: 0
      });
    }
    // Log de tentative de connexion non autorisée
    console.warn('🚨 Tentative de connexion admin échouée:', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString()
    });

    return res.status(401).json({
      success: false,
      message: 'Invalid password'
    });
  }

  // Générer un token sécurisé
  const token = crypto.randomBytes(32).toString('hex');
  const session = {
    user: { 
      id: 'admin', 
      email: 'admin@psa-grading.com',
      role: 'admin'
    },
    created: Date.now(),
    expires: Date.now() + (24 * 60 * 60 * 1000), // 24h
    ip: req.ip,
    userAgent: req.get('User-Agent')
  };

  // Stocker la session
  activeSessions.set(token, session);

  // Log de connexion réussie
  console.log('✅ Connexion admin réussie:', {
    ip: req.ip,
    timestamp: new Date().toISOString()
  });

  // Nettoyer les sessions expirées (housekeeping)
  cleanExpiredSessions();

  // Définir le cookie sécurisé
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie('admin_token', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000, // 24 heures
    path: '/'
  });

  // Réinitialiser le compteur de tentatives pour cette IP
  loginAttempts.delete(req.ip);

  res.json({
    success: true,
    token: token,
    user: session.user,
    expires: session.expires
  });
}

/**
 * Endpoint de déconnexion admin
 */
export function adminLogout(req, res) {
  const authToken = req.headers.authorization?.replace('Bearer ', '') || 
                   req.cookies?.admin_token ||
                   req.session?.admin_token;

  if (authToken) {
    activeSessions.delete(authToken);
    console.log('🚪 Déconnexion admin:', {
      ip: req.ip,
      timestamp: new Date().toISOString()
    });
  }

  // Supprimer le cookie admin_token
  res.clearCookie('admin_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/'
  });

  res.json({
    success: true,
    message: 'Logged out successfully'
  });
}

/**
 * Endpoint pour vérifier l'état de la session
 */
export function adminStatus(req, res) {
  const authToken = req.headers.authorization?.replace('Bearer ', '') || 
                   req.cookies?.admin_token ||
                   req.session?.admin_token;

  if (!authToken) {
    return res.json({
      success: true,
      authenticated: false
    });
  }

  const session = activeSessions.get(authToken);
  if (!session || session.expires < Date.now()) {
    if (session) activeSessions.delete(authToken);
    
    return res.json({
      success: true,
      authenticated: false
    });
  }

  res.json({
    success: true,
    authenticated: true,
    user: session.user,
    expires: session.expires
  });
}

/**
 * Nettoyer les sessions expirées
 */
function cleanExpiredSessions() {
  const now = Date.now();
  const expiredTokens = [];
  
  for (const [token, session] of activeSessions.entries()) {
    if (session.expires < now) {
      expiredTokens.push(token);
    }
  }
  
  expiredTokens.forEach(token => activeSessions.delete(token));
  
  if (expiredTokens.length > 0) {
    console.log(`🧹 ${expiredTokens.length} sessions expirées nettoyées`);
  }
}

// Nettoyer les sessions toutes les heures
setInterval(cleanExpiredSessions, 60 * 60 * 1000);

/**
 * Middleware pour servir l'interface admin avec vérification d'auth
 */
export function serveAdminInterface(req, res, next) {
  // ✅ CRITICAL: Headers anti-cache pour empêcher la mise en cache par le proxy Replit
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Vary', 'Cookie');
  
  // Pour les requêtes API, utiliser le middleware d'auth normal
  if (req.path.startsWith('/api/')) {
    return requireAdminAuth(req, res, next);
  }

  // Pour l'interface HTML, vérifier l'auth mais rediriger vers login si nécessaire
  const authToken = req.cookies?.admin_token;
  
  if (!authToken) {
    // Rediriger vers page de login ou servir une page de login
    return res.send(getLoginPageHTML());
  }

  const session = activeSessions.get(authToken);
  if (!session || session.expires < Date.now()) {
    if (session) activeSessions.delete(authToken);
    return res.send(getLoginPageHTML());
  }

  // Renouveler la session
  session.expires = Date.now() + (24 * 60 * 60 * 1000);
  activeSessions.set(authToken, session);

  // Continuer vers l'interface admin
  next();
}

/**
 * Générer la page de login HTML
 */
function getLoginPageHTML() {
  return `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Connexion Admin - PSA Grading</title>
    <link rel="icon" type="image/png" href="/shopify-psa-logo.png">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #003366, #0066cc);
            height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .login-container {
            background: white;
            padding: 3rem;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            width: 100%;
            max-width: 400px;
            text-align: center;
        }

        .logo {
            font-size: 2rem;
            margin-bottom: 2rem;
            color: #003366;
        }

        .form-group {
            margin-bottom: 1.5rem;
            text-align: left;
        }

        .form-label {
            display: block;
            margin-bottom: 0.5rem;
            font-weight: 600;
            color: #374151;
        }

        .form-input {
            width: 100%;
            padding: 0.75rem;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            font-size: 1rem;
        }

        .btn {
            width: 100%;
            background: #003366;
            color: white;
            border: none;
            padding: 0.75rem;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            font-size: 1rem;
        }

        .btn:hover {
            background: #004080;
            transform: translateY(-1px);
        }

        .btn:disabled {
            background: #9ca3af;
            cursor: not-allowed;
            transform: none;
        }

        .error {
            color: #dc3545;
            margin-top: 1rem;
            font-size: 0.875rem;
        }

        .loading {
            display: none;
            margin-top: 1rem;
        }

        .spinner {
            width: 20px;
            height: 20px;
            border: 2px solid #e5e7eb;
            border-top: 2px solid #003366;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="logo">🏆 Admin PSA</div>
        <form id="loginForm">
            <div class="form-group">
                <label class="form-label" for="password">Mot de passe administrateur</label>
                <input type="password" id="password" class="form-input" required>
            </div>
            <button type="submit" class="btn">Se connecter</button>
            <div id="error" class="error" style="display: none;"></div>
            <div id="loading" class="loading">
                <div class="spinner"></div>
                <p>Connexion en cours...</p>
            </div>
        </form>
    </div>

    <script>
        const form = document.getElementById('loginForm');
        const passwordInput = document.getElementById('password');
        const submitBtn = form.querySelector('.btn');
        const errorDiv = document.getElementById('error');
        const loadingDiv = document.getElementById('loading');

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const password = passwordInput.value.trim();
            if (!password) {
                showError('Veuillez saisir un mot de passe');
                return;
            }

            showLoading(true);
            hideError();

            try {
                const response = await fetch('/api/admin/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ password })
                });

                const data = await response.json();

                if (data.success) {
                    // Stocker le token dans un cookie
                    document.cookie = \`admin_token=\${data.token}; path=/; max-age=86400; secure; samesite=strict\`;
                    
                    // Rediriger vers l'interface admin
                    window.location.href = '/admin';
                } else {
                    showError(data.message || 'Mot de passe incorrect');
                }
            } catch (error) {
                console.error('Erreur de connexion:', error);
                showError('Erreur de connexion. Veuillez réessayer.');
            } finally {
                showLoading(false);
            }
        });

        function showError(message) {
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
        }

        function hideError() {
            errorDiv.style.display = 'none';
        }

        function showLoading(show) {
            loadingDiv.style.display = show ? 'block' : 'none';
            submitBtn.disabled = show;
            if (show) {
                submitBtn.textContent = 'Connexion...';
            } else {
                submitBtn.textContent = 'Se connecter';
            }
        }

        // Focus sur le champ password
        passwordInput.focus();
    </script>
</body>
</html>
  `;
}