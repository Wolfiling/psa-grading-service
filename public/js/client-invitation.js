/**
 * CLIENT INVITATION PAGE - JavaScript Logic
 * Handles token validation, order display, and client authentication
 */

// Global variables
let invitationData = null;
let invitationToken = null;

/**
 * Initialize the invitation page
 */
document.addEventListener('DOMContentLoaded', async function() {
    console.log('[CLIENT-INVITATION] 🎯 Initializing invitation page...');
    
    // Extract token from URL
    invitationToken = extractTokenFromURL();
    
    if (!invitationToken) {
        showError('Token d\'invitation manquant dans l\'URL');
        return;
    }

    console.log('[CLIENT-INVITATION] 🔗 Token trouvé:', invitationToken.substring(0, 8) + '...');

    // Validate invitation token
    await validateInvitation(invitationToken);
    
    // Setup event listeners
    setupEventListeners();
});

/**
 * Extract invitation token from URL
 */
function extractTokenFromURL() {
    const pathParts = window.location.pathname.split('/');
    const tokenIndex = pathParts.indexOf('invitation') + 1;
    
    if (tokenIndex > 0 && tokenIndex < pathParts.length) {
        return pathParts[tokenIndex];
    }
    
    // Alternative: check URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('token');
}

/**
 * Validate invitation token and load order data
 */
async function validateInvitation(token) {
    try {
        console.log('[CLIENT-INVITATION] 🔍 Validating token...');
        
        const response = await fetch(`/api/client/validate-invitation/${token}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (data.success) {
            console.log('[CLIENT-INVITATION] ✅ Token valid:', data);
            invitationData = data;
            
            // Display order information
            displayOrderDetails(data.grading_request);
            
            // Pre-fill email in forms
            prefillEmail(data.invitation.customer_email);
            
            // Show main content
            hideLoading();
            showMainContent();
            
        } else {
            console.error('[CLIENT-INVITATION] ❌ Token validation failed:', data.message);
            
            // Handle specific error cases
            if (data.code === 'INVITATION_EXPIRED') {
                showError('Cette invitation a expiré. Veuillez contacter votre administrateur PSA pour recevoir une nouvelle invitation.');
            } else if (data.code === 'INVITATION_USED') {
                showError('Cette invitation a déjà été utilisée. Si vous avez un compte, vous pouvez vous connecter directement.');
            } else if (data.code === 'INVITATION_NOT_FOUND') {
                showError('Cette invitation n\'existe pas ou n\'est plus valide.');
            } else {
                showError(data.message || 'Invitation invalide');
            }
        }

    } catch (error) {
        console.error('[CLIENT-INVITATION] ❌ Network error:', error);
        showError('Erreur de connexion. Veuillez réessayer plus tard.');
    }
}

/**
 * Display order details in the UI
 */
function displayOrderDetails(gradingRequest) {
    if (!gradingRequest) {
        console.error('[CLIENT-INVITATION] ❌ No grading request data');
        return;
    }

    // Order ID
    document.getElementById('orderId').textContent = gradingRequest.submission_id;
    
    // Card name
    document.getElementById('cardName').textContent = gradingRequest.card_name || 'Non spécifié';
    
    // Grading type
    const gradingTypeText = getGradingTypeDisplayText(gradingRequest.grading_type);
    document.getElementById('gradingType').textContent = gradingTypeText;
    
    // Price
    document.getElementById('orderPrice').textContent = formatPrice(gradingRequest.price);
    
    // Creation date
    const createdDate = new Date(gradingRequest.created_at);
    document.getElementById('orderDate').textContent = createdDate.toLocaleDateString('fr-FR');
    
    // Status
    const statusText = getStatusDisplayText(gradingRequest.status);
    document.getElementById('orderStatus').textContent = statusText;
    
    console.log('[CLIENT-INVITATION] ✅ Order details displayed');
}

/**
 * Pre-fill email in both forms
 */
function prefillEmail(email) {
    document.getElementById('email').value = email;
    document.getElementById('loginEmail').value = email;
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    // Tab switching
    const tabs = document.querySelectorAll('.auth-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            switchTab(this.dataset.tab);
        });
    });

    // Form submissions
    document.getElementById('registerForm').addEventListener('submit', handleRegister);
    document.getElementById('loginForm').addEventListener('submit', handleLogin);

    // Password confirmation validation
    document.getElementById('confirmPassword').addEventListener('input', validatePasswordMatch);
    
    console.log('[CLIENT-INVITATION] ✅ Event listeners setup');
}

/**
 * Switch between register and login tabs
 */
function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    // Update form displays
    document.querySelectorAll('.auth-form').forEach(form => {
        form.classList.remove('active');
    });
    document.getElementById(`${tabName}Tab`).classList.add('active');

    // Hide any previous messages
    hideFormMessages();
}

/**
 * Handle user registration
 */
async function handleRegister(event) {
    event.preventDefault();
    
    const formData = new FormData(event.target);
    const firstName = formData.get('firstName') || document.getElementById('firstName').value;
    const lastName = formData.get('lastName') || document.getElementById('lastName').value;
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const acceptTerms = document.getElementById('acceptTerms').checked;

    // Validation
    if (!firstName || !lastName || !email || !password) {
        showFormError('Veuillez remplir tous les champs obligatoires');
        return;
    }

    if (password.length < 8) {
        showFormError('Le mot de passe doit contenir au moins 8 caractères');
        return;
    }

    if (password !== confirmPassword) {
        showFormError('Les mots de passe ne correspondent pas');
        return;
    }

    if (!acceptTerms) {
        showFormError('Vous devez accepter les conditions d\'utilisation');
        return;
    }

    const submitBtn = event.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    
    try {
        // Show loading state
        submitBtn.innerHTML = '⏳ Création du compte...';
        submitBtn.disabled = true;
        hideFormMessages();

        console.log('[CLIENT-INVITATION] 📝 Creating account for:', email);

        const response = await fetch('/api/client/register-with-invitation', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                invitation_token: invitationToken,
                first_name: firstName,
                last_name: lastName,
                email: email,
                password: password
            })
        });

        const data = await response.json();

        if (data.success) {
            console.log('[CLIENT-INVITATION] ✅ Account created successfully');
            showFormSuccess('Compte créé avec succès ! Redirection vers votre dashboard...');
            
            // Store authentication token
            if (data.auth_token) {
                localStorage.setItem('client_auth_token', data.auth_token);
            }
            
            // Redirect to client dashboard
            setTimeout(() => {
                window.location.href = '/client-dashboard.html';
            }, 2000);

        } else {
            console.error('[CLIENT-INVITATION] ❌ Registration failed:', data.message);
            
            if (data.code === 'EMAIL_EXISTS') {
                showFormError('Un compte avec cet email existe déjà. Essayez de vous connecter.');
                // Switch to login tab
                setTimeout(() => switchTab('login'), 2000);
            } else {
                showFormError(data.message || 'Erreur lors de la création du compte');
            }
        }

    } catch (error) {
        console.error('[CLIENT-INVITATION] ❌ Registration error:', error);
        showFormError('Erreur de connexion. Veuillez réessayer.');
    } finally {
        // Restore button
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
}

/**
 * Handle user login
 */
async function handleLogin(event) {
    event.preventDefault();
    
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    if (!email || !password) {
        showFormError('Veuillez remplir tous les champs');
        return;
    }

    const submitBtn = event.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    
    try {
        // Show loading state
        submitBtn.innerHTML = '⏳ Connexion...';
        submitBtn.disabled = true;
        hideFormMessages();

        console.log('[CLIENT-INVITATION] 🔑 Logging in:', email);

        const response = await fetch('/api/client/login-with-invitation', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                invitation_token: invitationToken,
                email: email,
                password: password
            })
        });

        const data = await response.json();

        if (data.success) {
            console.log('[CLIENT-INVITATION] ✅ Login successful');
            showFormSuccess('Connexion réussie ! Redirection vers votre dashboard...');
            
            // Store authentication token
            if (data.auth_token) {
                localStorage.setItem('client_auth_token', data.auth_token);
            }
            
            // Redirect to client dashboard
            setTimeout(() => {
                window.location.href = '/client-dashboard.html';
            }, 1500);

        } else {
            console.error('[CLIENT-INVITATION] ❌ Login failed:', data.message);
            
            if (data.code === 'INVALID_CREDENTIALS') {
                showFormError('Email ou mot de passe incorrect');
            } else if (data.code === 'ACCOUNT_NOT_FOUND') {
                showFormError('Aucun compte trouvé avec cet email. Essayez de créer un compte.');
                setTimeout(() => switchTab('register'), 2000);
            } else {
                showFormError(data.message || 'Erreur de connexion');
            }
        }

    } catch (error) {
        console.error('[CLIENT-INVITATION] ❌ Login error:', error);
        showFormError('Erreur de connexion. Veuillez réessayer.');
    } finally {
        // Restore button
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
}

/**
 * Validate password confirmation in real-time
 */
function validatePasswordMatch() {
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const confirmInput = document.getElementById('confirmPassword');

    if (confirmPassword && password !== confirmPassword) {
        confirmInput.style.borderColor = '#dc3545';
        confirmInput.style.boxShadow = '0 0 0 3px rgba(220, 53, 69, 0.1)';
    } else {
        confirmInput.style.borderColor = '#e9ecef';
        confirmInput.style.boxShadow = 'none';
    }
}

/**
 * Utility Functions
 */

function hideLoading() {
    document.getElementById('loadingOverlay').style.display = 'none';
}

function showMainContent() {
    document.getElementById('mainContent').style.display = 'block';
}

function showError(message) {
    hideLoading();
    document.getElementById('errorMessage').textContent = message;
    document.getElementById('errorState').style.display = 'flex';
}

function showFormError(message) {
    const errorDiv = document.getElementById('formError');
    const errorText = document.getElementById('formErrorText');
    errorText.textContent = message;
    errorDiv.style.display = 'block';
    document.getElementById('formSuccess').style.display = 'none';
    
    // Scroll to error message
    errorDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function showFormSuccess(message) {
    const successDiv = document.getElementById('formSuccess');
    const successText = document.getElementById('formSuccessText');
    successText.textContent = message;
    successDiv.style.display = 'block';
    document.getElementById('formError').style.display = 'none';
    
    // Scroll to success message
    successDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hideFormMessages() {
    document.getElementById('formError').style.display = 'none';
    document.getElementById('formSuccess').style.display = 'none';
}

function getGradingTypeDisplayText(gradingType) {
    const types = {
        'value': 'PSA Value',
        'regular': 'PSA Regular', 
        'express': 'PSA Express',
        'super_express': 'PSA Super Express'
    };
    return types[gradingType] || gradingType.toUpperCase();
}

function getStatusDisplayText(status) {
    const statuses = {
        'pending': 'En attente',
        'processing': 'En traitement',
        'shipped': 'Expédiée',
        'completed': 'Terminée',
        'cancelled': 'Annulée'
    };
    return statuses[status] || status;
}

function formatPrice(price) {
    if (!price) return 'Non défini';
    
    // Convert to number if string
    const numPrice = typeof price === 'string' ? parseFloat(price) : price;
    
    return new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'EUR'
    }).format(numPrice);
}

// Initialize when DOM is ready
console.log('[CLIENT-INVITATION] 🎯 Script loaded successfully');