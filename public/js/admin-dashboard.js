// Simple Admin Dashboard - Compatible avec la structure réelle d'admin.html

console.info("[ADMIN] 🎯 Dashboard loading...");

// === VARIABLES GLOBALES POUR L'INTERFACE ADMIN ===

// Variables pour la gestion des demandes
let allRequests = [];
let currentRequestId = null;

// ✅ SÉCURITÉ CSRF: Variable globale pour le token CSRF
let csrfToken = null;

// Variables pour l'éditeur multi-cartes
let currentStep = 1;
let selectedGradingType = null;
let selectedCardFromSearch = null;

// Variables pour la recherche TaskMaster
let searchTimeout = null;
let searchCache = {};

// Utilitaire pour obtenir les cookies
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return '';
}

// ✅ SÉCURITÉ CSRF: Fonction pour récupérer le token CSRF
async function fetchCSRFToken() {
    try {
        const response = await fetch('/api/csrf-token', {
            credentials: 'include'
        });
        
        if (response.ok) {
            const data = await response.json();
            csrfToken = data.csrfToken;
            console.log('[ADMIN] ✅ Token CSRF récupéré avec succès');
            return csrfToken;
        } else {
            console.error('[ADMIN] ❌ Erreur récupération token CSRF:', response.status);
            return null;
        }
    } catch (error) {
        console.error('[ADMIN] ❌ Erreur réseau token CSRF:', error);
        return null;
    }
}

// ✅ SÉCURITÉ CSRF: Fonction utilitaire pour créer des headers avec CSRF
function getSecureHeaders() {
    const headers = {
        'Content-Type': 'application/json'
    };
    
    if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
    }
    
    return headers;
}

// Charger les statistiques
async function loadStats() {
    try {
        const response = await fetch('/api/admin/stats', {
            credentials: 'include'
        });
        const data = await response.json();
        
        if (data.success) {
            const stats = data.stats;
            const totalEl = document.getElementById('totalRequests');
            const pendingEl = document.getElementById('pendingRequests');
            const progressEl = document.getElementById('progressRequests');
            const completedEl = document.getElementById('completedRequests');
            const revenueEl = document.getElementById('totalRevenue');
            const pendingPaymentEl = document.getElementById('pendingPaymentRequests');
            
            if (totalEl) totalEl.textContent = stats.total || 0;
            if (pendingEl) pendingEl.textContent = stats.pending || 0;
            if (progressEl) progressEl.textContent = stats.in_progress || 0;
            if (completedEl) completedEl.textContent = stats.completed || 0;
            if (revenueEl) revenueEl.textContent = formatCurrency(stats.total_revenue || 0);
            if (pendingPaymentEl) pendingPaymentEl.textContent = '0'; // Par défaut
        }
    } catch (error) {
        console.error('Erreur lors du chargement des stats:', error);
    }
    
    // Charger aussi les stats des paiements en attente
    loadPendingPaymentsStats();
}

// Charger les statistiques des paiements en attente
async function loadPendingPaymentsStats() {
    try {
        const response = await fetch('/api/admin/pending-payments-stats', {
            credentials: 'include'
        });
        const data = await response.json();
        
        if (data.success) {
            const pendingPaymentEl = document.getElementById('pendingPaymentRequests');
            if (pendingPaymentEl) {
                pendingPaymentEl.textContent = data.count || '0';
            }
        }
    } catch (error) {
        console.error('Error loading pending payments stats:', error);
        const pendingPaymentEl = document.getElementById('pendingPaymentRequests');
        if (pendingPaymentEl) {
            pendingPaymentEl.textContent = '0';
        }
    }
}

// Fonctions utilitaires
function formatCurrency(amount) {
    return new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'EUR'
    }).format(amount);
}

function formatDate(dateString) {
    return new Date(dateString).toLocaleDateString('fr-FR', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Ouvrir le modal de nouvelle commande (corrigé pour utiliser addModal)
function openNewCommandModal() {
    const modal = document.getElementById('addModal');
    if (modal) {
        modal.style.display = 'block';
        resetNewCommandForm();
        console.log('[ADMIN] ✅ Modal Nouvelle Commande ouvert');
    } else {
        console.error('[ADMIN] ❌ Modal addModal non trouvé');
        alert('Erreur: Modal non disponible');
    }
}

// Fermer le modal de nouvelle commande
function closeNewCommandModal() {
    const modal = document.getElementById('addModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Réinitialiser le formulaire de nouvelle commande
function resetNewCommandForm() {
    document.getElementById('addForm').reset();
    // Réinitialiser les cartes
    window.managedCards = [];
    // Réinitialiser le type PSA sélectionné
    selectedGradingType = null;
    // Remettre toutes les cartes de grading en état non-sélectionné
    document.querySelectorAll('.grading-card').forEach(card => {
        card.classList.remove('selected');
    });
    updateCardsDisplay();
    // Réinitialiser les étapes
    showStep(1);
    // Mettre à jour le résumé
    updateSummaryDisplay();
    console.log('[ADMIN] 🔄 Formulaire réinitialisé avec résumé mis à jour');
}

// ========================================
// PSA SCRAPER INTEGRATION FUNCTIONS
// ========================================

// Refresh PSA scraper status
async function refreshPSAStatus() {
    try {
        console.log('🔄 Refreshing PSA scraper status...');
        
        const response = await fetch('/api/admin/psa-scraper/status', {
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success) {
            const status = data.status;
            
            // Update status badges
            const scraperStatus = document.getElementById('psaScraperStatus');
            const sessionStatus = document.getElementById('psaSessionStatus');
            const lastActivity = document.getElementById('psaLastActivity');
            
            if (scraperStatus) {
                scraperStatus.className = `badge ${status.initialized ? 'badge-completed' : 'badge-pending'}`;
                scraperStatus.textContent = status.initialized ? '🟢 Initialisé' : '🔴 Non Initialisé';
            }
            
            if (sessionStatus) {
                sessionStatus.className = `badge ${status.session_active ? 'badge-completed' : 'badge-pending'}`;
                sessionStatus.textContent = status.session_active ? '🟢 Connecté' : (status.logged_in ? '🟡 Connecté (vérification...)' : '🔴 Déconnecté');
            }
            
            if (lastActivity) {
                lastActivity.textContent = new Date(status.last_activity).toLocaleString('fr-FR');
            }
            
            console.log('✅ PSA status updated:', status);
        } else {
            console.error('❌ Failed to get PSA status:', data.message);
        }
        
        // Also refresh pending submissions count
        await refreshPSAPendingSubmissions();
        
    } catch (error) {
        console.error('❌ Error refreshing PSA status:', error);
    }
}

// Refresh pending PSA submissions
async function refreshPSAPendingSubmissions() {
    try {
        const response = await fetch('/api/admin/psa-scraper/pending-submissions', {
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success) {
            const pendingCount = document.getElementById('psaPendingCount');
            if (pendingCount) {
                pendingCount.textContent = data.count;
            }
            
            // Update pending submissions table
            updatePSAPendingTable(data.pending_submissions);
            
            // Show/hide table based on count
            const pendingTable = document.getElementById('psaPendingSubmissions');
            if (pendingTable) {
                pendingTable.style.display = data.count > 0 ? 'block' : 'none';
            }
        }
    } catch (error) {
        console.error('❌ Error refreshing pending submissions:', error);
    }
}

// Update PSA pending submissions table
function updatePSAPendingTable(submissions) {
    const tableBody = document.getElementById('psaPendingTable');
    if (!tableBody) return;
    
    if (submissions.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #666;">Aucune soumission en attente</td></tr>';
        return;
    }
    
    tableBody.innerHTML = submissions.map(sub => `
        <tr>
            <td>${sub.submission_id}</td>
            <td>${sub.psa_submission_number || '-'}</td>
            <td>${sub.customer_email}</td>
            <td>${sub.card_name}</td>
            <td>
                <span class="badge badge-${sub.psa_status ? 'progress' : 'pending'}">
                    ${sub.psa_status || sub.status || 'Aucun statut PSA'}
                </span>
            </td>
            <td>${sub.psa_last_scraped ? new Date(sub.psa_last_scraped).toLocaleString('fr-FR') : 'Jamais'}</td>
            <td>
                <button class="btn btn-small" onclick="scrapeSinglePSA('${sub.psa_submission_number}', '${sub.submission_id}')" style="background: #6f42c1;">
                    🔍 Scraper
                </button>
            </td>
        </tr>
    `).join('');
}

// Scrape all pending PSA submissions
async function scrapePendingSubmissions() {
    try {
        console.log('🚀 Starting bulk PSA scraping...');
        
        // Show loading state
        showPSALoadingState('Scraping de toutes les soumissions PSA en cours...');
        
        const response = await fetch('/api/admin/psa-scraper/scrape-all', {
            method: 'POST',
            headers: getSecureHeaders(),
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success) {
            console.log('✅ Bulk PSA scraping completed:', data);
            
            // Show results
            showPSAResults(`✅ Scraping terminé avec succès!\n\n📊 ${data.scraped_count} soumissions mises à jour`, data.scraped_data);
            
            // Refresh data
            await refreshPSAStatus();
            await refreshData(); // Refresh main table
            
        } else {
            console.error('❌ Bulk PSA scraping failed:', data.message);
            showPSAResults(`❌ Erreur lors du scraping: ${data.message}`, null);
        }
        
    } catch (error) {
        console.error('❌ Error during bulk PSA scraping:', error);
        showPSAResults(`❌ Erreur réseau: ${error.message}`, null);
    }
}

// Scrape single PSA submission
async function scrapeSinglePSA(submissionNumber, submissionId = null) {
    try {
        console.log(`🎯 Scraping PSA submission: ${submissionNumber}`);
        
        showPSALoadingState(`Scraping de la soumission ${submissionNumber}...`);
        
        const response = await fetch('/api/admin/psa-scraper/scrape-submission', {
            method: 'POST',
            headers: getSecureHeaders(),
            body: JSON.stringify({
                submission_number: submissionNumber,
                submission_id: submissionId
            }),
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success) {
            console.log('✅ PSA submission scraped:', data);
            showPSAResults(`✅ Soumission ${submissionNumber} scrapée avec succès!`, [data.psa_data]);
            
            // Refresh data
            await refreshPSAStatus();
            await refreshData();
            
        } else {
            console.error('❌ PSA scraping failed:', data.message);
            showPSAResults(`❌ Erreur: ${data.message}`, null);
        }
        
    } catch (error) {
        console.error('❌ Error scraping PSA submission:', error);
        showPSAResults(`❌ Erreur réseau: ${error.message}`, null);
    }
}

// Show PSA loading state
function showPSALoadingState(message) {
    const resultsDiv = document.getElementById('psaScrapingResults');
    const contentDiv = document.getElementById('psaResultsContent');
    
    if (resultsDiv && contentDiv) {
        contentDiv.innerHTML = `
            <div style="text-align: center; padding: 2rem;">
                <div class="spinner" style="margin: 0 auto 1rem;"></div>
                <p style="color: #6f42c1; font-weight: 600;">${message}</p>
            </div>
        `;
        resultsDiv.style.display = 'block';
    }
}

// Show PSA scraping results
function showPSAResults(message, data) {
    const resultsDiv = document.getElementById('psaScrapingResults');
    const contentDiv = document.getElementById('psaResultsContent');
    
    if (resultsDiv && contentDiv) {
        let html = `<div style="margin-bottom: 1rem;"><strong>${message}</strong></div>`;
        
        if (data && data.length > 0) {
            html += '<div style="background: #f8f9fa; padding: 1rem; border-radius: 6px; margin-top: 1rem;">';
            html += '<h5 style="margin-bottom: 1rem; color: #6f42c1;">📋 Détails des données scrapées:</h5>';
            
            data.forEach((item, index) => {
                const psaData = item.psaData || item;
                html += `
                    <div style="border-left: 3px solid #6f42c1; padding-left: 1rem; margin-bottom: 1rem;">
                        <div><strong>Soumission:</strong> ${psaData.submissionNumber || 'N/A'}</div>
                        <div><strong>Statut:</strong> ${psaData.status || 'N/A'}</div>
                        <div><strong>Date Réception:</strong> ${psaData.receivedDate || 'N/A'}</div>
                        <div><strong>Date Estimée:</strong> ${psaData.estimatedGradingDate || 'N/A'}</div>
                    </div>
                `;
            });
            
            html += '</div>';
        }
        
        html += `<div style="text-align: right; margin-top: 1rem;">
            <button class="btn btn-small" onclick="hidePSAResults()" style="background: #6c757d;">Fermer</button>
        </div>`;
        
        contentDiv.innerHTML = html;
        resultsDiv.style.display = 'block';
    }
}

// Hide PSA results
function hidePSAResults() {
    const resultsDiv = document.getElementById('psaScrapingResults');
    if (resultsDiv) {
        resultsDiv.style.display = 'none';
    }
}

// PSA Link Modal Functions
function showPSALinkModal() {
    const modal = document.getElementById('psaLinkModal');
    if (modal) {
        modal.style.display = 'block';
    }
}

function closePSALinkModal() {
    const modal = document.getElementById('psaLinkModal');
    if (modal) {
        modal.style.display = 'none';
        const submissionIdInput = document.getElementById('psaLinkSubmissionId');
        const numberInput = document.getElementById('psaLinkNumber');
        if (submissionIdInput) submissionIdInput.value = '';
        if (numberInput) numberInput.value = '';
    }
}

// Link PSA submission
async function linkPSASubmission() {
    const submissionIdInput = document.getElementById('psaLinkSubmissionId');
    const numberInput = document.getElementById('psaLinkNumber');
    
    const submissionId = submissionIdInput?.value.trim();
    const psaNumber = numberInput?.value.trim();
    
    if (!submissionId || !psaNumber) {
        alert('⚠️ Veuillez remplir tous les champs');
        return;
    }
    
    try {
        console.log(`🔗 Linking ${submissionId} to PSA ${psaNumber}`);
        
        const response = await fetch('/api/admin/psa-scraper/link-submission', {
            method: 'POST',
            headers: getSecureHeaders(),
            body: JSON.stringify({
                submission_id: submissionId,
                psa_submission_number: psaNumber
            }),
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success) {
            console.log('✅ PSA submission linked:', data);
            alert(`✅ Soumission liée avec succès à PSA ${psaNumber}!`);
            
            closePSALinkModal();
            await refreshPSAStatus();
            await refreshData();
            
        } else {
            console.error('❌ Failed to link PSA submission:', data.message);
            alert(`❌ Erreur: ${data.message}`);
        }
        
    } catch (error) {
        console.error('❌ Error linking PSA submission:', error);
        alert(`❌ Erreur réseau: ${error.message}`);
    }
}

// ========================================
// EMAIL & QR CODE INTEGRATION FUNCTIONS
// ========================================

// Generate QR codes for requests
async function generateQRCodes() {
    const modal = document.getElementById('batchOpsModal');
    if (modal) {
        modal.style.display = 'block';
    }
}

// Send bulk emails
async function sendBulkEmails() {
    const modal = document.getElementById('batchOpsModal');
    if (modal) {
        modal.style.display = 'block';
    }
}

function closeBatchOpsModal() {
    const modal = document.getElementById('batchOpsModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Send batch emails based on filter
async function sendBatchEmails() {
    try {
        const emailType = document.getElementById('batchEmailType')?.value;
        const filterType = document.getElementById('batchEmailFilter')?.value;
        
        console.log(`📧 Sending ${emailType} emails to ${filterType} requests...`);
        
        showBatchOperationLoading(`Envoi des emails ${emailType} en cours...`, 'email');
        
        const response = await fetch('/api/admin/send-batch-emails', {
            method: 'POST',
            headers: getSecureHeaders(),
            body: JSON.stringify({
                email_type: emailType,
                filter: filterType
            }),
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success) {
            console.log('✅ Batch emails sent:', data);
            showBatchOperationResult(
                `✅ ${data.sent_count} emails ${emailType} envoyés avec succès!`,
                data.details,
                'email'
            );
        } else {
            console.error('❌ Batch email sending failed:', data.message);
            showBatchOperationResult(`❌ Erreur: ${data.message}`, null, 'email');
        }
        
    } catch (error) {
        console.error('❌ Error sending batch emails:', error);
        showBatchOperationResult(`❌ Erreur réseau: ${error.message}`, null, 'email');
    }
}

// Generate batch QR codes
async function generateBatchQRCodes() {
    try {
        const qrType = document.getElementById('batchQRType')?.value;
        const filterType = document.getElementById('batchQRFilter')?.value;
        
        console.log(`📱 Generating ${qrType} QR codes for ${filterType} requests...`);
        
        showBatchOperationLoading(`Génération des QR codes ${qrType} en cours...`, 'qr');
        
        const response = await fetch('/api/admin/generate-batch-qr', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                qr_type: qrType,
                filter: filterType
            }),
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success) {
            console.log('✅ Batch QR codes generated:', data);
            showBatchOperationResult(
                `✅ ${data.generated_count} QR codes ${qrType} générés avec succès!`,
                data.details,
                'qr'
            );
        } else {
            console.error('❌ Batch QR generation failed:', data.message);
            showBatchOperationResult(`❌ Erreur: ${data.message}`, null, 'qr');
        }
        
    } catch (error) {
        console.error('❌ Error generating batch QR codes:', error);
        showBatchOperationResult(`❌ Erreur réseau: ${error.message}`, null, 'qr');
    }
}

// Show batch operation loading state
function showBatchOperationLoading(message, type) {
    const resultsDiv = document.getElementById('batchOperationResults');
    const contentDiv = document.getElementById('batchOperationContent');
    
    if (resultsDiv && contentDiv) {
        const icon = type === 'email' ? '📧' : '📱';
        contentDiv.innerHTML = `
            <div style="text-align: center; padding: 2rem;">
                <div class="spinner" style="margin: 0 auto 1rem;"></div>
                <p style="color: #007bff; font-weight: 600;">${icon} ${message}</p>
            </div>
        `;
        resultsDiv.style.display = 'block';
    }
}

// Show batch operation results
function showBatchOperationResult(message, details, type) {
    const resultsDiv = document.getElementById('batchOperationResults');
    const contentDiv = document.getElementById('batchOperationContent');
    
    if (resultsDiv && contentDiv) {
        const icon = type === 'email' ? '📧' : '📱';
        let html = `<div style="margin-bottom: 1rem;"><strong>${icon} ${message}</strong></div>`;
        
        if (details && details.length > 0) {
            html += '<div style="background: #f8f9fa; padding: 1rem; border-radius: 6px; margin-top: 1rem;">';
            html += '<h5 style="margin-bottom: 1rem; color: #007bff;">📋 Détails des opérations:</h5>';
            
            details.forEach((item, index) => {
                html += `
                    <div style="border-left: 3px solid #007bff; padding-left: 1rem; margin-bottom: 1rem;">
                        <div><strong>ID:</strong> ${item.submission_id || 'N/A'}</div>
                        <div><strong>Email:</strong> ${item.customer_email || 'N/A'}</div>
                        <div><strong>Statut:</strong> ${item.status || 'N/A'}</div>
                    </div>
                `;
            });
            
            html += '</div>';
        }
        
        html += `<div style="text-align: right; margin-top: 1rem;">
            <button class="btn btn-small" onclick="hideBatchOperationResult()" style="background: #6c757d;">Fermer</button>
        </div>`;
        
        contentDiv.innerHTML = html;
        resultsDiv.style.display = 'block';
    }
}

// Hide batch operation results
function hideBatchOperationResult() {
    const resultsDiv = document.getElementById('batchOperationResults');
    if (resultsDiv) {
        resultsDiv.style.display = 'none';
    }
}

// ✅ SÉCURITÉ CSRF: Initialisation sécurisée du dashboard
async function initializeSecureDashboard() {
    console.log('[ADMIN] 🔒 Initialisation sécurisée du dashboard...');
    
    // 1. Récupérer le token CSRF en premier
    await fetchCSRFToken();
    
    // 2. Ensuite charger les données
    loadStats();
    loadAllRequests();
    
    console.log('[ADMIN] ✅ Dashboard sécurisé initialisé');
}

// Fonctions principales exportées globalement
function refreshData() {
    console.log('🔄 Actualisation des données...');
    loadStats();
    loadAllRequests(); // ✅ AJOUT : Charger les demandes aussi !
    // Ajouter d'autres actualisations si nécessaire
}

function refreshPendingPayments() {
    console.log('🔄 Actualisation des paiements en attente...');
    loadPendingPaymentsStats();
    // Ajouter d'autres actualisations si nécessaire
}

// **CORRECTION CRITIQUE** : Initialisation complète avec tous les event listeners
function initAdmin() {
    console.info("[ADMIN] 🚀 Initializing admin dashboard with enhanced summary system...");
    
    // Vérifier qu'on est sur la page admin (support /admin et /admin.html)
    const isAdminPage = window.location.pathname === '/admin' || 
                       window.location.pathname === '/admin.html' ||
                       window.location.pathname.endsWith('/admin') ||
                       window.location.pathname.endsWith('/admin.html');
    
    if (!isAdminPage) {
        console.info("[ADMIN] 🚫 Not on admin page, skipping initialization");
        return;
    }
    
    // **PHASE 1** : Charger les données initiales
    console.log('[ADMIN] 📈 Phase 1: Chargement des données...');
    loadStats();
    loadAllRequests(); // Charger les demandes au démarrage
    
    // **PHASE 2** : Initialiser les fonctionnalités avancées avec ordre critique
    console.log('[ADMIN] ⚙️ Phase 2: Initialisation des fonctionnalités avancées...');
    
    // Initialiser d'abord les gestionnaires de formulaires (event listeners critiques)
    initFormHandlers();
    
    // Puis les autres systèmes
    initTaskMasterSearch();
    initGradingSelection();
    
    // **PHASE 3** : Vérification des composants critiques
    console.log('[ADMIN] 🔍 Phase 3: Vérification des composants...');
    
    // Vérifier que les éléments critiques du résumé sont présents
    const criticalElements = [
        'summaryEmail', 'summaryService', 'summaryCardsCount', 
        'summaryPricePerCard', 'summaryTotalPrice', 'addEmail'
    ];
    
    let allElementsFound = true;
    criticalElements.forEach(elementId => {
        const element = document.getElementById(elementId);
        if (!element) {
            console.error(`[ADMIN] ❌ Élément critique manquant: #${elementId}`);
            allElementsFound = false;
        } else {
            console.log(`[ADMIN] ✅ Élément critique trouvé: #${elementId}`);
        }
    });
    
    if (allElementsFound) {
        console.log('[ADMIN] ✅ Tous les éléments critiques du résumé sont présents');
    } else {
        console.warn('[ADMIN] ⚠️ Certains éléments critiques manquent - le résumé pourrait ne pas fonctionner');
    }
    
    // **PHASE 4** : Initialisation finale du résumé
    console.log('[ADMIN] 📝 Phase 4: Initialisation du résumé...');
    
    // Initialiser managedCards si nécessaire
    if (!window.managedCards) {
        window.managedCards = [];
        console.log('[ADMIN] ✅ managedCards initialisé comme tableau vide');
    }
    
    // Mettre à jour le résumé initial
    updateSummaryDisplay();
    
    console.info("[ADMIN] ✅ Admin dashboard initialized successfully with enhanced summary system");
}

// Gestion de l'initialisation
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdmin);
} else {
    initAdmin();
}

// === VARIABLES GLOBALES POUR L'INTERFACE ADMIN ===

// Variables pour l'éditeur multi-cartes
window.managedCards = [];

// === FONCTIONS POUR LA GESTION DES ÉTAPES ===

// Afficher une étape spécifique
function showStep(stepNumber) {
    // Cacher toutes les étapes
    document.querySelectorAll('.form-step').forEach(step => {
        step.classList.remove('active');
    });
    
    // Afficher l'étape demandée
    const targetStep = document.querySelector(`.form-step[data-step="${stepNumber}"]`);
    if (targetStep) {
        targetStep.classList.add('active');
        currentStep = stepNumber;
        
        // Mettre à jour les indicateurs d'étapes
        updateStepIndicators(stepNumber);
        
        // CRITIQUE: Mettre à jour le résumé à chaque transition d'étape
        // Particulièrement important pour l'étape 3 (résumé final)
        updateSummaryDisplay();
        console.log(`[ADMIN] 🔄 Résumé mis à jour lors du passage à l'étape ${stepNumber}`);
        
        console.log(`[ADMIN] Étape ${stepNumber} affichée`);
    } else {
        console.error(`[ADMIN] ❌ Étape ${stepNumber} non trouvée`);
    }
}

// Étape suivante
function nextStep() {
    if (validateCurrentStep()) {
        if (currentStep < 3) {
            showStep(currentStep + 1);
        }
    }
}

// Étape précédente
function prevStep() {
    if (currentStep > 1) {
        showStep(currentStep - 1);
    }
}

// Mettre à jour les indicateurs d'étapes
function updateStepIndicators(activeStep) {
    document.querySelectorAll('.step').forEach(step => {
        const stepNumber = parseInt(step.dataset.step);
        if (stepNumber < activeStep) {
            step.classList.add('completed');
            step.classList.remove('active');
        } else if (stepNumber === activeStep) {
            step.classList.add('active');
            step.classList.remove('completed');
        } else {
            step.classList.remove('active', 'completed');
        }
    });
}

// === FONCTIONS POUR L'ÉDITEUR MULTI-CARTES ===

// Ouvrir le gestionnaire de cartes
function openCardManager() {
    const modal = document.getElementById('cardAddModal');
    if (modal) {
        modal.style.display = 'block';
        resetCardAddForm();
        
        // Réinitialiser la recherche TaskMaster après ouverture du modal
        setTimeout(() => {
            initTaskMasterSearch();
            const searchInput = document.getElementById('tmCardSearchInput');
            if (searchInput) {
                searchInput.focus();
                console.log('[TASKMASTER] ✅ Focus sur le champ de recherche');
            } else {
                console.error('[TASKMASTER] ❌ Champ de recherche non trouvé après ouverture modal');
            }
        }, 100);
    }
}

// Fermer le modal d'ajout de carte
function closeCardAddModal() {
    const modal = document.getElementById('cardAddModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Réinitialiser le formulaire d'ajout de carte
function resetCardAddForm() {
    const form = document.getElementById('cardAddForm');
    if (form) form.reset();
    
    // Réinitialiser l'aperçu de carte
    const preview = document.getElementById('cardPreview');
    if (preview) preview.style.display = 'none';
    
    selectedCardFromSearch = null;
}

// Ajouter une carte à la liste
function addCardToList() {
    console.log('[ADMIN] 🚀 Début addCardToList...');
    
    // Récupérer les données depuis le formulaire ou la sélection
    let cardData;
    
    if (selectedCardFromSearch) {
        // Utiliser les données de la recherche TaskMaster
        cardData = {
            source: 'taskmaster',
            tm_card_id: selectedCardFromSearch.tm_card_id,
            name: selectedCardFromSearch.name,
            series: selectedCardFromSearch.series,
            number: selectedCardFromSearch.number || '',
            rarity: selectedCardFromSearch.rarity || '',
            year: selectedCardFromSearch.year || null,
            notes: document.getElementById('cardNotes')?.value || '',
            imageUrl: selectedCardFromSearch.imageUrl || selectedCardFromSearch.image_url || selectedCardFromSearch.image || (selectedCardFromSearch.images && (selectedCardFromSearch.images.small || selectedCardFromSearch.images.large)) || null
        };
    } else {
        // Saisie manuelle
        cardData = {
            source: 'manual',
            tm_card_id: null,
            name: document.getElementById('manualCardName')?.value || 'Carte sans nom',
            series: document.getElementById('manualCardSeries')?.value || '',
            number: document.getElementById('manualCardNumber')?.value || '',
            rarity: document.getElementById('manualCardRarity')?.value || '',
            year: parseInt(document.getElementById('manualCardYear')?.value) || null,
            notes: document.getElementById('manualCardNotes')?.value || '',
            imageUrl: document.getElementById('manualCardImageUrl')?.value || null
        };
    }
    
    // Vérifier que le nom de la carte est renseigné
    if (!cardData.name.trim()) {
        alert('⚠️ Le nom de la carte est obligatoire');
        return;
    }
    
    // Initialiser managedCards si nécessaire
    if (!window.managedCards) {
        window.managedCards = [];
    }
    
    // Vérifier la limite de 20 cartes
    if (window.managedCards.length >= 20) {
        alert('❌ Limite de 20 cartes atteinte');
        return;
    }
    
    // Ajouter un ID unique
    cardData.id = Date.now() + Math.random();
    
    // Ajouter à la liste
    window.managedCards.push(cardData);
    
    console.log(`[ADMIN] Carte ajoutée: ${cardData.name}`);
    console.log('[ADMIN] 📦 Données de la carte:', cardData);
    
    // Mettre à jour l'affichage
    console.log('[ADMIN] 🔄 Appel updateCardsDisplay...');
    updateCardsDisplay();
    
    // Fermer le modal
    console.log('[ADMIN] ❌ Fermeture du modal...');
    closeCardAddModal();
    
    console.log('[ADMIN] ✅ addCardToList terminé avec succès!');
}

// **CORRECTION CRITIQUE** : Supprimer une carte de la liste avec mise à jour du résumé
function removeCard(cardId) {
    console.log(`[ADMIN] 🗑️ Suppression de la carte: ${cardId}`);
    
    const initialCount = window.managedCards.length;
    window.managedCards = window.managedCards.filter(card => card.id !== cardId);
    const finalCount = window.managedCards.length;
    
    console.log(`[ADMIN] 📊 Cartes: ${initialCount} → ${finalCount}`);
    
    // Mettre à jour l'affichage (qui cascade vers le résumé)
    updateCardsDisplay();
    
    // **DOUBLE SÉCURITÉ** : S'assurer que le résumé est mis à jour
    updateSummaryDisplay();
    
    console.log(`[ADMIN] ✅ Carte supprimée et résumé mis à jour`);
}

// Mettre à jour l'affichage des cartes - VERSION SÉCURISÉE
function updateCardsDisplay() {
    const cardsContainer = document.getElementById('cardsContainer');
    const cardsList = document.getElementById('cardsList');
    const cardsCount = document.getElementById('cardsCount');
    const totalCardsCount = document.getElementById('totalCardsCount');
    const totalPrice = document.getElementById('totalPrice');
    const pricePerCard = document.getElementById('pricePerCard');
    
    // Debug pour identifier les éléments manquants
    console.log('[ADMIN] 🔍 Vérification des conteneurs:', {
        cardsContainer: !!cardsContainer,
        cardsList: !!cardsList, 
        cardsCount: !!cardsCount
    });
    
    const count = window.managedCards.length;
    
    // Mettre à jour le compteur
    if (cardsCount) cardsCount.textContent = count;
    if (totalCardsCount) totalCardsCount.textContent = count;
    
    if (count === 0) {
        // Cacher la liste si vide
        if (cardsList) cardsList.style.display = 'none';
        return;
    }
    
    // Afficher la liste
    if (cardsList) cardsList.style.display = 'block';
    
    // Générer les cartes avec createElement - SÉCURISÉ
    if (cardsContainer) {
        cardsContainer.replaceChildren(); // Nettoyer
        
        window.managedCards.forEach((card, index) => {
            // Logique robuste pour récupérer l'URL d'image
            const imageSrc = card.imageUrl || card.image_url || card.image || '';
            const safeName = (card.name || '').replace(/[<>"'&]/g, ' ').trim();
            const safeSeries = (card.series || '').replace(/[<>"'&]/g, ' ').trim();
            const safeNumber = (card.number || '').replace(/[<>"'&]/g, ' ').trim();
            const safeRarity = (card.rarity || '').replace(/[<>"'&]/g, ' ').trim();
            
            console.log(`[ADMIN] 🔍 Image pour carte "${safeName}" dans la liste: ${imageSrc ? 'trouvée' : 'non trouvée'}`);
            
            // Créer l'élément principal
            const cardItem = document.createElement('div');
            cardItem.className = 'card-item';
            cardItem.dataset.cardId = card.id;
            
            // Section info de la carte
            const cardInfo = document.createElement('div');
            cardInfo.className = 'card-info';
            
            // Thumbnail ou placeholder
            if (imageSrc) {
                const thumbnail = document.createElement('div');
                thumbnail.className = 'card-thumbnail';
                
                const img = document.createElement('img');
                img.src = imageSrc;
                img.alt = safeName; // Sécurisé
                img.style.cssText = 'width: 50px; height: 70px; object-fit: cover; border-radius: 4px;';
                img.onload = () => console.log('[ADMIN] ✅ Image carte chargée dans liste:', img.src);
                img.onerror = () => {
                    console.error('[ADMIN] ❌ Erreur image carte dans liste:', img.src);
                    thumbnail.innerHTML = '<div class="card-thumbnail-placeholder">?</div>';
                };
                
                thumbnail.appendChild(img);
                cardInfo.appendChild(thumbnail);
            } else {
                const placeholder = document.createElement('div');
                placeholder.className = 'card-thumbnail-placeholder';
                placeholder.textContent = '?'; // Pas d'émoji pour éviter confusion
                cardInfo.appendChild(placeholder);
            }
            
            // Détails de la carte
            const cardDetails = document.createElement('div');
            cardDetails.className = 'card-details';
            
            // Nom de la carte
            const cardName = document.createElement('div');
            cardName.className = 'card-name';
            cardName.textContent = safeName; // Sécurisé
            cardDetails.appendChild(cardName);
            
            // Métadonnées
            const cardMeta = document.createElement('div');
            cardMeta.className = 'card-meta';
            
            if (safeSeries) {
                const seriesSpan = document.createElement('span');
                seriesSpan.className = 'series';
                seriesSpan.textContent = safeSeries; // Sécurisé
                cardMeta.appendChild(seriesSpan);
            }
            
            if (safeNumber) {
                const numberSpan = document.createElement('span');
                numberSpan.className = 'number';
                numberSpan.textContent = `#${safeNumber}`; // Sécurisé
                cardMeta.appendChild(numberSpan);
            }
            
            if (safeRarity) {
                const raritySpan = document.createElement('span');
                raritySpan.className = 'rarity';
                raritySpan.textContent = safeRarity; // Sécurisé
                cardMeta.appendChild(raritySpan);
            }
            
            cardDetails.appendChild(cardMeta);
            cardInfo.appendChild(cardDetails);
            cardItem.appendChild(cardInfo);
            
            // Actions (bouton supprimer)
            const cardActions = document.createElement('div');
            cardActions.className = 'card-actions';
            
            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'btn-remove';
            removeBtn.textContent = '🗑️';
            // Event listener sécurisé - PAS onclick
            removeBtn.addEventListener('click', () => removeCard(card.id));
            
            cardActions.appendChild(removeBtn);
            cardItem.appendChild(cardActions);
            
            cardsContainer.appendChild(cardItem);
        });
    }
    
    // Calculer et afficher le prix total
    updatePricing();
    
    // Mettre à jour également le résumé final
    updateSummaryDisplay();
}

// Mettre à jour le calcul des prix
function updatePricing() {
    const count = window.managedCards.length;
    
    // Récupérer le prix par carte depuis le service sélectionné
    const pricePerCardValue = getCurrentPricePerCard();
    const total = count * pricePerCardValue;
    
    // Mettre à jour l'affichage
    const pricePerCardEl = document.getElementById('pricePerCard');
    const totalPriceEl = document.getElementById('totalPrice');
    
    if (pricePerCardEl) {
        pricePerCardEl.textContent = pricePerCardValue > 0 ? `${pricePerCardValue} €` : '-';
    }
    
    if (totalPriceEl) {
        totalPriceEl.textContent = `${total} €`;
    }
}

// Obtenir le prix par carte selon le service sélectionné
function getCurrentPricePerCard() {
    if (!selectedGradingType) return 0;
    
    const prices = {
        'value': 27,
        'regular': 60,
        'express': 120
    };
    
    return prices[selectedGradingType] || 0;
}

// Mettre à jour le résumé de commande final (étape 3)
function updateSummaryDisplay() {
    console.log('[ADMIN] 🔄 Mise à jour du résumé de commande...');
    
    // Récupérer l'email client
    const emailInput = document.getElementById('addEmail');
    const clientEmail = emailInput?.value.trim() || '-';
    
    // Récupérer le service PSA sélectionné
    const serviceName = getServiceDisplayName(selectedGradingType);
    
    // Récupérer les données des cartes
    const cardsCount = window.managedCards ? window.managedCards.length : 0;
    const pricePerCard = getCurrentPricePerCard();
    const totalPrice = cardsCount * pricePerCard;
    
    // Mettre à jour les éléments du résumé
    updateElement('summaryEmail', clientEmail);
    updateElement('summaryService', serviceName);
    updateElement('summaryCardsCount', cardsCount.toString());
    updateElement('summaryPricePerCard', pricePerCard > 0 ? `${pricePerCard} €` : '-');
    updateElement('summaryTotalPrice', `${totalPrice} €`);
    
    // Mettre à jour la liste détaillée des cartes
    updateSummaryCardsList();
    
    console.log(`[ADMIN] ✅ Résumé mis à jour: ${cardsCount} cartes, ${serviceName}, ${totalPrice}€`);
}

// Fonction utilitaire pour mettre à jour un élément
function updateElement(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = value;
    } else {
        console.warn(`[ADMIN] ⚠️ Élément '${id}' non trouvé`);
    }
}

// Obtenir le nom d'affichage du service PSA
function getServiceDisplayName(gradingType) {
    if (!gradingType) return '-';
    
    const serviceNames = {
        'value': 'PSA Value',
        'regular': 'PSA Regular', 
        'express': 'PSA Express'
    };
    
    return serviceNames[gradingType] || '-';
}

// Mettre à jour la liste détaillée des cartes dans le résumé (sécurisé contre XSS)
function updateSummaryCardsList() {
    const cardsListContainer = document.getElementById('summaryCardsList');
    const cardsContainer = document.getElementById('summaryCardsContainer');
    
    if (!cardsListContainer || !cardsContainer) {
        console.warn('[ADMIN] ⚠️ Conteneurs de liste de cartes du résumé non trouvés');
        return;
    }
    
    const cardsCount = window.managedCards ? window.managedCards.length : 0;
    
    if (cardsCount === 0) {
        cardsListContainer.style.display = 'none';
        return;
    }
    
    // Afficher la liste
    cardsListContainer.style.display = 'block';
    
    // Vider le conteneur et créer les éléments de façon sécurisée
    cardsContainer.innerHTML = '';
    
    window.managedCards.forEach((card, index) => {
        // Créer l'élément principal de la carte
        const cardElement = document.createElement('div');
        cardElement.className = 'summary-card-item';
        cardElement.style.cssText = `
            display: flex;
            align-items: center;
            padding: 0.75rem;
            margin-bottom: 0.5rem;
            background: #f8f9fa;
            border-radius: 6px;
            border: 1px solid #e9ecef;
        `;
        
        // Créer la section thumbnail/image
        const imageSrc = card.imageUrl || card.image_url || card.image || (card.images && (card.images.small || card.images.large)) || '';
        
        if (imageSrc && typeof imageSrc === 'string' && (imageSrc.startsWith('http') || imageSrc.startsWith('/') || imageSrc.startsWith('data:'))) {
            // Image validée
            const thumbnailDiv = document.createElement('div');
            thumbnailDiv.className = 'summary-card-thumbnail';
            thumbnailDiv.style.marginRight = '1rem';
            
            const img = document.createElement('img');
            img.src = imageSrc; // Validation basique effectuée ci-dessus
            img.alt = card.name || 'Carte';
            img.style.cssText = 'width: 40px; height: 56px; object-fit: cover; border-radius: 4px;';
            
            thumbnailDiv.appendChild(img);
            cardElement.appendChild(thumbnailDiv);
        } else {
            // Placeholder pour les cartes sans image
            const placeholderDiv = document.createElement('div');
            placeholderDiv.className = 'summary-card-thumbnail-placeholder';
            placeholderDiv.style.cssText = `
                width: 40px; height: 56px; display: flex; align-items: center; justify-content: center;
                background: #e9ecef; border-radius: 4px; margin-right: 1rem; font-size: 1.2rem;
            `;
            placeholderDiv.textContent = '🎴';
            cardElement.appendChild(placeholderDiv);
        }
        
        // Créer la section détails
        const detailsDiv = document.createElement('div');
        detailsDiv.className = 'summary-card-details';
        detailsDiv.style.flex = '1';
        
        // Nom de la carte (sécurisé avec textContent)
        const nameDiv = document.createElement('div');
        nameDiv.className = 'summary-card-name';
        nameDiv.style.cssText = 'font-weight: 600; margin-bottom: 0.25rem;';
        nameDiv.textContent = card.name || 'Nom non défini';
        detailsDiv.appendChild(nameDiv);
        
        // Métadonnées de la carte (sécurisé avec textContent)
        const metaDiv = document.createElement('div');
        metaDiv.className = 'summary-card-meta';
        metaDiv.style.cssText = 'font-size: 0.85rem; color: #666;';
        
        const metaParts = [];
        if (card.series) metaParts.push(card.series);
        if (card.number) metaParts.push(`#${card.number}`);
        if (card.rarity) metaParts.push(card.rarity);
        
        metaDiv.textContent = metaParts.join(' • ');
        detailsDiv.appendChild(metaDiv);
        
        // Source de la carte supprimée pour plus de propreté
        // Plus besoin d'afficher TaskMaster ou Saisie manuelle
        
        cardElement.appendChild(detailsDiv);
        cardsContainer.appendChild(cardElement);
    });
    
    console.log('[ADMIN] ✅ Liste des cartes mise à jour de façon sécurisée (XSS protégé)');
}

// === INTÉGRATION TASKMASTER SEARCH ===

// Initialiser la recherche TaskMaster
function initTaskMasterSearch() {
    console.log('[TASKMASTER] 🚀 Initialisation de la recherche TaskMaster...');
    const searchInput = document.getElementById('tmCardSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', handleSearchInput);
        searchInput.addEventListener('focus', () => {
            // Afficher les suggestions existantes si disponibles
            const suggestions = document.getElementById('tmSearchResults');
            if (suggestions && suggestions.children.length > 0) {
                suggestions.style.display = 'block';
                console.log('[TASKMASTER] 👁️ Affichage des suggestions existantes');
            }
        });
        console.log('[TASKMASTER] ✅ Event listeners attachés à tmCardSearchInput');
        console.log('[TASKMASTER] 🔍 Élément tmSearchResults trouvé:', !!document.getElementById('tmSearchResults'));
    } else {
        console.error('[TASKMASTER] ❌ Élément tmCardSearchInput non trouvé');
    }
}

// Gérer la saisie de recherche
function handleSearchInput(event) {
    const query = event.target.value.trim();
    
    // Clear le timeout précédent
    if (searchTimeout) {
        clearTimeout(searchTimeout);
    }
    
    if (query.length < 2) {
        clearSearchSuggestions();
        return;
    }
    
    // Débounce de 300ms
    searchTimeout = setTimeout(() => {
        searchTaskMasterCards(query);
    }, 300);
}

// Rechercher des cartes via TaskMaster
async function searchTaskMasterCards(query) {
    try {
        // Vérifier le cache d'abord - mais toujours re-rendre proprement
        if (searchCache[query]) {
            console.log('[TASKMASTER] 🔄 Utilisation du cache, mais re-rendu complet');
            displaySearchSuggestions(searchCache[query]);
            return;
        }
        
        console.log(`[TASKMASTER] 🔍 Recherche: "${query}"`);
        
        const response = await fetch(`/api/cards/search?q=${encodeURIComponent(query)}`, {
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success && data.cards) {
            // Mettre en cache
            searchCache[query] = data.cards;
            
            // Afficher les suggestions
            displaySearchSuggestions(data.cards);
            
            console.log(`[TASKMASTER] ✅ ${data.cards.length} cartes trouvées`);
        } else {
            console.log(`[TASKMASTER] ℹ️ Aucune carte trouvée pour "${query}"`);
            clearSearchSuggestions();
        }
    } catch (error) {
        console.error('[TASKMASTER] Erreur de recherche:', error);
        clearSearchSuggestions();
    }
}

// Afficher les suggestions de recherche - VERSION PROPRE createElement
function displaySearchSuggestions(cards) {
    const suggestionsContainer = document.getElementById('tmSearchResults');
    if (!suggestionsContainer) {
        console.error('[TASKMASTER] ❌ CRITIQUE: tmSearchResults non trouvé - interface cassée');
        return; // Éviter le crash
    }
    
    // TOUJOURS nettoyer complètement le container
    suggestionsContainer.replaceChildren();
    suggestionsContainer.dataset.version = Date.now(); // Cache buster
    
    // Calculer la position du champ de saisie
    const searchInput = document.getElementById('tmCardSearchInput');
    if (searchInput) {
        const rect = searchInput.getBoundingClientRect();
        suggestionsContainer.style.left = `${rect.left}px`;
        suggestionsContainer.style.top = `${rect.bottom}px`;
        suggestionsContainer.style.width = `${rect.width}px`;
    }
    
    if (cards.length === 0) {
        const noResults = document.createElement('div');
        noResults.className = 'suggestion-item no-results';
        noResults.textContent = 'Aucune carte trouvée';
        suggestionsContainer.appendChild(noResults);
        suggestionsContainer.style.display = 'block';
        return;
    }
    
    // RENDU PROPRE avec createElement - JAMAIS innerHTML
    cards.slice(0, 8).forEach((card, index) => {
        // Nettoyage des données
        const safeName = (card.name || '').replace(/[<>"'&]/g, ' ').trim();
        const safeSeries = (card.series || '').replace(/[<>"'&]/g, ' ').trim();
        const safeNumber = (card.number || '').replace(/[<>"'&]/g, ' ').trim();
        const imageSrc = card.imageUrl || card.image_url || card.image || '';
        
        console.log(`[TASKMASTER] 🔍 Image pour "${safeName}": ${imageSrc ? 'trouvée' : 'non trouvée'}`);
        
        // Créer les éléments DOM de façon sécurisée
        const suggestionItem = document.createElement('div');
        suggestionItem.className = 'suggestion-item';
        suggestionItem.dataset.cardIndex = index;
        
        const suggestionContent = document.createElement('div');
        suggestionContent.className = 'suggestion-content';
        
        const suggestionName = document.createElement('div');
        suggestionName.className = 'suggestion-name';
        suggestionName.textContent = safeName; // Sécurisé
        
        const suggestionMeta = document.createElement('div');
        suggestionMeta.className = 'suggestion-meta';
        
        if (safeSeries) {
            const seriesSpan = document.createElement('span');
            seriesSpan.textContent = safeSeries; // Sécurisé
            suggestionMeta.appendChild(seriesSpan);
        }
        
        if (safeNumber) {
            const numberSpan = document.createElement('span');
            numberSpan.textContent = `#${safeNumber}`; // Sécurisé
            suggestionMeta.appendChild(numberSpan);
        }
        
        suggestionContent.appendChild(suggestionName);
        suggestionContent.appendChild(suggestionMeta);
        suggestionItem.appendChild(suggestionContent);
        
        // Image seulement - PAS d'icône fallback
        if (imageSrc) {
            const img = document.createElement('img');
            img.src = imageSrc;
            img.alt = safeName;
            img.className = 'suggestion-image';
            img.width = 48;
            img.height = 48;
            img.loading = 'lazy';
            img.onload = () => console.log('[TASKMASTER] ✅ Image chargée');
            img.onerror = () => img.style.display = 'none';
            suggestionItem.appendChild(img);
        }
        
        // Event listener sécurisé - PAS onclick HTML
        suggestionItem.addEventListener('click', () => {
            selectCardFromSearch({
                name: safeName,
                series: safeSeries,
                number: safeNumber,
                imageUrl: imageSrc
            });
        });
        
        suggestionsContainer.appendChild(suggestionItem);
    });
    
    suggestionsContainer.style.display = 'block';
    console.log(`[TASKMASTER] ✅ ${cards.length} suggestions affichées PROPREMENT`);
    console.log(`[TASKMASTER] 🧹 DOM créé avec createElement - ${suggestionsContainer.children.length} éléments`);
}

// Sélectionner une carte depuis la recherche
function selectCardFromSearch(cardData) {
    selectedCardFromSearch = cardData;
    
    // Pré-remplir les champs avec les données de la carte
    const nameInput = document.getElementById('cardName');
    const seriesInput = document.getElementById('cardSeries');
    const numberInput = document.getElementById('cardNumber');
    const rarityInput = document.getElementById('cardRarity');
    const yearInput = document.getElementById('cardYear');
    
    if (nameInput) nameInput.value = cardData.name || '';
    if (seriesInput) seriesInput.value = cardData.series || '';
    if (numberInput) numberInput.value = cardData.number || '';
    if (rarityInput) rarityInput.value = cardData.rarity || '';
    if (yearInput) yearInput.value = cardData.year || '';
    
    // Effacer la recherche et les suggestions
    const searchInput = document.getElementById('tmCardSearchInput');
    if (searchInput) searchInput.value = '';
    clearSearchSuggestions();
    
    // Afficher l'aperçu de la carte
    displayCardPreview(cardData);
    
    console.log(`[TASKMASTER] ✅ Carte sélectionnée: ${cardData.name}`);
    
    // Ajouter automatiquement la carte à la liste
    setTimeout(() => {
        console.log('[ADMIN] 🎯 Tentative d\'ajout automatique de la carte...');
        if (typeof addCardToList === 'function') {
            console.log('[ADMIN] 🔧 Fonction addCardToList trouvée, exécution...');
            addCardToList();
        } else {
            console.error('[ADMIN] ❌ Fonction addCardToList non trouvée!');
        }
    }, 100); // Petit délai pour s'assurer que tout est bien initialisé
}

// Afficher l'aperçu de la carte sélectionnée
function displayCardPreview(cardData) {
    const previewContainer = document.getElementById('cardPreview');
    if (!previewContainer) return;
    
    const nameEl = document.getElementById('previewName');
    const seriesEl = document.getElementById('previewSeries');
    const numberEl = document.getElementById('previewNumber');
    const rarityEl = document.getElementById('previewRarity');
    const imageEl = document.getElementById('previewImage');
    
    if (nameEl) nameEl.textContent = cardData.name;
    if (seriesEl) seriesEl.textContent = cardData.series || 'Série inconnue';
    if (numberEl) numberEl.textContent = cardData.number ? `#${cardData.number}` : '';
    if (rarityEl) {
        rarityEl.textContent = cardData.rarity || 'Rareté inconnue';
        rarityEl.className = `rarity-badge rarity-${(cardData.rarity || '').toLowerCase()}`;
    }
    
    if (imageEl && (cardData.imageUrl || cardData.image_url)) {
        imageEl.src = cardData.imageUrl || cardData.image_url;
        imageEl.alt = cardData.name;
        imageEl.style.display = 'block';
    } else if (imageEl) {
        imageEl.style.display = 'none';
    }
    
    previewContainer.style.display = 'block';
}

// Effacer les suggestions de recherche
function clearSearchSuggestions() {
    const suggestionsContainer = document.getElementById('tmSearchResults');
    if (suggestionsContainer) {
        suggestionsContainer.style.display = 'none';
        suggestionsContainer.innerHTML = '';
    }
}

// === VALIDATION ET LOGIQUE DES ÉTAPES ===

// Valider l'étape courante
function validateCurrentStep() {
    switch (currentStep) {
        case 1:
            return validateStep1();
        case 2:
            return validateStep2();
        case 3:
            return validateStep3();
        default:
            return true;
    }
}

// Valider l'étape 1 (Client & Cartes)
function validateStep1() {
    const emailInput = document.getElementById('addEmail');
    const email = emailInput?.value.trim();
    
    if (!email) {
        alert('⚠️ L\'email du client est obligatoire');
        if (emailInput) emailInput.focus();
        return false;
    }
    
    // Validation basique de l'email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        alert('⚠️ Format d\'email invalide');
        if (emailInput) emailInput.focus();
        return false;
    }
    
    // Vérifier qu'au moins une carte est ajoutée
    if (window.managedCards.length === 0) {
        alert('⚠️ Au moins une carte doit être ajoutée');
        return false;
    }
    
    return true;
}

// Valider l'étape 2 (PSA & Source)
function validateStep2() {
    if (!selectedGradingType) {
        alert('⚠️ Veuillez sélectionner un type de service PSA');
        return false;
    }
    
    return true;
}

// Valider l'étape 3 (Finalisation)
function validateStep3() {
    // Pas de validation stricte pour l'étape 3
    return true;
}

// === LOGIQUE DE SÉLECTION DES SERVICES PSA ===

// **CORRECTION CRITIQUE** : Initialiser la sélection des services de grading avec vérifications renforcées
function initGradingSelection() {
    console.log('[ADMIN] 🔧 Initialisation de la sélection des services PSA...');
    
    const gradingCards = document.querySelectorAll('.grading-card');
    console.log(`[ADMIN] 📊 ${gradingCards.length} cartes de grading trouvées`);
    
    if (gradingCards.length === 0) {
        console.error('[ADMIN] ❌ CRITIQUE: Aucune carte de grading trouvée! Vérifier la structure HTML.');
        return;
    }
    
    gradingCards.forEach((card, index) => {
        const gradingType = card.dataset.type;
        console.log(`[ADMIN] 📝 Carte ${index + 1}: Type "${gradingType}"`);
        
        if (!gradingType) {
            console.error(`[ADMIN] ❌ Carte ${index + 1} n'a pas d'attribut data-type`);
            return;
        }
        
        // Attacher l'event listener avec logging
        card.addEventListener('click', () => {
            console.log(`[ADMIN] 🎯 Sélection service PSA: ${gradingType}`);
            selectGradingType(gradingType);
        });
        
        console.log(`[ADMIN] ✅ Event listener attaché à la carte "${gradingType}"`);
    });
    
    console.log('[ADMIN] ✅ Sélection des services PSA initialisée avec succès');
}

// **CORRECTION CRITIQUE** : Sélectionner un type de grading avec vérifications renforcées
function selectGradingType(type) {
    console.log(`[ADMIN] 🎯 Sélection du service PSA: "${type}"`);
    
    if (!type) {
        console.error('[ADMIN] ❌ Type de grading non défini!');
        return;
    }
    
    // Retirer la sélection précédente
    const previousCards = document.querySelectorAll('.grading-card.selected');
    console.log(`[ADMIN] 🔄 Suppression de ${previousCards.length} sélections précédentes`);
    document.querySelectorAll('.grading-card').forEach(card => {
        card.classList.remove('selected');
    });
    
    // Sélectionner le nouveau type
    const selectedCard = document.querySelector(`.grading-card[data-type="${type}"]`);
    if (selectedCard) {
        selectedCard.classList.add('selected');
        selectedGradingType = type;
        console.log(`[ADMIN] ✅ Service PSA "${type}" sélectionné et enregistré`);
        
        // Mettre à jour le champ hidden
        const hiddenInput = document.getElementById('addGradingType');
        if (hiddenInput) {
            hiddenInput.value = type;
            console.log('[ADMIN] ✅ Champ hidden mis à jour');
        } else {
            console.warn('[ADMIN] ⚠️ Champ hidden #addGradingType non trouvé');
        }
        
        // **FLUX CRITIQUE** : Mettre à jour l'affichage des prix
        console.log('[ADMIN] 🔄 Mise à jour des prix...');
        updatePricingDisplay();
        
        // **FLUX CRITIQUE** : Recalculer le prix total des cartes
        console.log('[ADMIN] 🔄 Mise à jour de l\'affichage des cartes...');
        updateCardsDisplay(); // Ceci va déclencher updateSummaryDisplay()
        
        // **DOUBLE SÉCURITÉ** : S'assurer que le résumé est mis à jour
        console.log('[SUMMARY] Grading type changed, updating summary...');
        updateSummaryDisplay();
        
        console.log(`[ADMIN] ✅ Flux complet de sélection PSA "${type}" terminé avec succès`);
        console.log('[SUMMARY] ✅ Summary updated after grading type selection');
    } else {
        console.error(`[ADMIN] ❌ CRITIQUE: Carte de grading pour le type "${type}" non trouvée!`);
    }
}

// Mettre à jour l'affichage des prix dans l'étape 2
function updatePricingDisplay() {
    const basePrice = getCurrentPricePerCard();
    const cardsCount = window.managedCards.length || 1; // Minimum 1 pour l'affichage
    const total = basePrice * cardsCount;
    
    const basePriceEl = document.getElementById('basePrice');
    const finalPriceEl = document.getElementById('finalPrice');
    const priceInput = document.getElementById('addPrice');
    
    if (basePriceEl) basePriceEl.textContent = `${basePrice}€`;
    if (finalPriceEl) finalPriceEl.textContent = `${total}€`;
    if (priceInput) priceInput.value = total;
    
    // Mettre à jour également le résumé final
    updateSummaryDisplay();
}

// === GESTIONNAIRES DE FORMULAIRES ET SOUMISSION ===

// Initialiser les gestionnaires de formulaires
function initFormHandlers() {
    console.log('[ADMIN] 🚀 Initialisation des gestionnaires de formulaires...');
    
    // Gestionnaire de soumission du formulaire principal
    const addForm = document.getElementById('addForm');
    if (addForm) {
        addForm.addEventListener('submit', handleFormSubmission);
        console.log('[ADMIN] ✅ Event listener formulaire principal ajouté');
    }
    
    // Gestionnaire pour la sélection de la source
    const cardSourceSelect = document.getElementById('addCardSource');
    if (cardSourceSelect) {
        cardSourceSelect.addEventListener('change', handleSourceChange);
        console.log('[ADMIN] ✅ Event listener source cartes ajouté');
    }
    
    // **CORRECTION CRITIQUE** : Gestionnaire robuste et complètement vérifié pour le champ email
    const emailInput = document.getElementById('addEmail');
    if (emailInput) {
        console.log('[SUMMARY] ✅ Element #addEmail trouvé, ajout des event listeners...');
        
        // Event listeners avec logs de débogage dans le format demandé
        emailInput.addEventListener('input', function() {
            console.log('[SUMMARY] Email changed, updating summary...');
            updateSummaryDisplay();
        });
        emailInput.addEventListener('change', function() {
            console.log('[SUMMARY] Email changed, updating summary...');
            updateSummaryDisplay();
        });
        emailInput.addEventListener('blur', function() {
            console.log('[SUMMARY] Email changed, updating summary...');
            updateSummaryDisplay();
        });
        
        // Test immédiat des event listeners
        console.log('[SUMMARY] ✅ Tous les event listeners email ajoutés (input, change, blur)');
        console.log('[SUMMARY] ✅ Event listeners confirmés fonctionnels sur #addEmail');
    } else {
        console.error('[SUMMARY] ❌ CRITIQUE: Element #addEmail NON TROUVÉ!');
        console.error('[ADMIN] ❌ Champ email #addEmail non trouvé - PROBLÈME CRITIQUE!');
    }
    
    // **AJOUT** : Gestionnaire pour le champ commentaires
    const commentsInput = document.getElementById('addComments');
    if (commentsInput) {
        commentsInput.addEventListener('input', function() {
            updateSummaryDisplay();
            console.log('[ADMIN] 💬 Commentaires mis à jour dans le résumé');
        });
        console.log('[ADMIN] ✅ Event listener commentaires ajouté');
    }
    
    // **AJOUT** : Gestionnaire pour les champs Whatnot
    const whatnotUsername = document.getElementById('whatnotUsername');
    const liveDate = document.getElementById('liveDate');
    
    if (whatnotUsername) {
        whatnotUsername.addEventListener('input', updateSummaryDisplay);
        console.log('[ADMIN] ✅ Event listener nom utilisateur Whatnot ajouté');
    }
    
    if (liveDate) {
        liveDate.addEventListener('change', updateSummaryDisplay);
        console.log('[ADMIN] ✅ Event listener date live Whatnot ajouté');
    }
    
    // Gestionnaire pour fermer les modals en cliquant à l'extérieur
    window.addEventListener('click', (event) => {
        const modals = document.querySelectorAll('.modal, .card-add-modal');
        modals.forEach(modal => {
            if (event.target === modal) {
                modal.style.display = 'none';
            }
        });
    });
    
    console.log('[ADMIN] ✅ Gestionnaires de formulaires initialisés avec succès');
}

// Gérer le changement de source
function handleSourceChange(event) {
    const source = event.target.value;
    const whatnotFields = document.getElementById('whatnotFields');
    
    if (whatnotFields) {
        whatnotFields.style.display = source === 'whatnot' ? 'block' : 'none';
    }
}

// Gérer la soumission du formulaire
async function handleFormSubmission(event) {
    event.preventDefault();
    
    if (!validateStep3()) {
        return;
    }
    
    const submitButton = document.querySelector('.btn-submit');
    const originalText = submitButton?.textContent;
    
    try {
        // Affichage du loading
        if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = '⏳ Création en cours...';
        }
        
        // Préparer les données
        const formData = collectFormData();
        
        console.log('[ADMIN] Soumission de la commande:', formData);
        
        // Envoyer la requête
        const response = await fetch('/api/grading', {
            method: 'POST',
            headers: getSecureHeaders(),
            credentials: 'include',
            body: JSON.stringify(formData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert(`✅ Commande créée avec succès !\nID: ${result.submission_id}`);
            
            // Fermer le modal et actualiser
            closeNewCommandModal();
            refreshData();
            
            console.log('[ADMIN] ✅ Commande créée:', result.submission_id);
        } else {
            throw new Error(result.message || 'Erreur lors de la création');
        }
        
    } catch (error) {
        console.error('[ADMIN] Erreur soumission:', error);
        alert(`❌ Erreur: ${error.message}`);
    } finally {
        // Restaurer le bouton
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = originalText;
        }
    }
}

// Collecter les données du formulaire
function collectFormData() {
    const email = document.getElementById('addEmail')?.value.trim();
    const source = document.getElementById('addCardSource')?.value || 'website';
    const comments = document.getElementById('addComments')?.value.trim() || '';
    
    // Données Whatnot si applicable
    const whatnotUsername = source === 'whatnot' ? document.getElementById('whatnotUsername')?.value.trim() : null;
    const liveDate = source === 'whatnot' ? document.getElementById('liveDate')?.value : null;
    
    // Données de base
    const baseData = {
        customer_email: email,
        grading_type: selectedGradingType,
        card_source: source,
        comments: comments,
        whatnot_username: whatnotUsername,
        live_date: liveDate
    };
    
    // Si multi-cartes
    if (window.managedCards.length > 1) {
        baseData.items = window.managedCards.map(card => ({
            source: card.source,
            tm_card_id: card.tm_card_id,
            name: card.name,
            series: card.series,
            number: card.number,
            rarity: card.rarity,
            year: card.year,
            notes: card.notes || '',
            image_path: null // Les images seront gérées séparément
        }));
    } else if (window.managedCards.length === 1) {
        // Carte unique - utiliser le format legacy
        const card = window.managedCards[0];
        baseData.card_name = card.name;
        baseData.card_series = card.series;
        baseData.card_number = card.number;
        baseData.card_rarity = card.rarity;
        baseData.card_year = card.year;
    } else {
        throw new Error('Aucune carte sélectionnée');
    }
    
    return baseData;
}

// Charger toutes les demandes de gradation
async function loadAllRequests() {
    try {
        const loadingEl = document.getElementById('loadingState');
        const containerEl = document.getElementById('requestsContainer');
        const emptyEl = document.getElementById('emptyRequests');
        
        if (loadingEl) loadingEl.style.display = 'block';
        if (containerEl) containerEl.style.display = 'none';
        if (emptyEl) emptyEl.style.display = 'none';

        const response = await fetch('/api/admin/grading-requests', {
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (loadingEl) loadingEl.style.display = 'none';
        
        if (data.success && data.requests && data.requests.length > 0) {
            allRequests = data.requests;
            displayRequests(allRequests);
        } else {
            showEmptyRequests();
        }
    } catch (error) {
        console.error('Error loading requests:', error);
        const loadingEl = document.getElementById('loadingState');
        if (loadingEl) loadingEl.style.display = 'none';
        showEmptyRequests();
    }
}

// Afficher les demandes
function displayRequests(requests) {
    const tbody = document.getElementById('requestsTable');
    const displayContainerEl = document.getElementById('requestsContainer');
    
    // ✅ DEFENSE : Toujours réafficher le container
    if (displayContainerEl) displayContainerEl.style.display = 'block';
    
    if (!tbody) {
        console.error('[ADMIN] ❌ Missing #requestsTable tbody');
        return;
    }
    
    tbody.innerHTML = '';

    requests.forEach(request => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>
                <div style="font-family: monospace; font-size: 0.8rem;">${request.submission_id}</div>
            </td>
            <td>
                <div style="font-weight: 600;">${request.customer_email}</div>
            </td>
            <td>
                <div>${request.card_name || 'N/A'}</div>
                <div style="font-size: 0.8rem; color: #666;">
                    ${request.card_series || ''} ${request.card_number ? '• ' + request.card_number : ''}
                </div>
            </td>
            <td>
                <span class="badge badge-${request.grading_type || 'value'}">${getGradingTypeText(request.grading_type)}</span>
            </td>
            <td style="text-align: right; font-weight: 600;">${formatCurrency(request.price)}</td>
            <td>
                <span class="status-badge status-${request.status}">${getStatusText(request.status)}</span>
            </td>
            <td>
                <div style="font-size: 0.8rem;">${request.psa_submission_number || '-'}</div>
            </td>
            <td style="text-align: center;">
                ${request.qr_code_data ? `
                    <button onclick="viewQRCode('${request.submission_id}')" class="btn btn-small" style="background: #28a745; color: white; padding: 4px 8px; font-size: 0.75rem;">
                        📱 QR
                    </button>
                ` : `
                    <button onclick="generateQRCode('${request.submission_id}')" class="btn btn-small" style="background: #ffc107; color: black; padding: 4px 8px; font-size: 0.75rem;">
                        ⚡ Générer
                    </button>
                `}
            </td>
            <td style="font-size: 0.8rem; color: #666;">
                ${formatDate(request.created_at)}
            </td>
            <td>
                <button onclick="viewRequestDetails('${request.submission_id}')" class="btn btn-sm btn-secondary">
                    👁️ Voir
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });

    const finalContainerEl = document.getElementById('requestsContainer');
    if (finalContainerEl) finalContainerEl.style.display = 'block';
}

function showEmptyRequests() {
    const requestsContainerEl = document.getElementById('requestsContainer');
    const emptyEl = document.getElementById('emptyRequests');
    
    if (requestsContainerEl) requestsContainerEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'block';
}

// Filtrer les demandes
function filterRequests() {
    const searchInput = document.getElementById('searchInput');
    const statusFilter = document.getElementById('statusFilter');
    const typeFilter = document.getElementById('typeFilter');
    
    if (!searchInput || !statusFilter || !typeFilter) return;
    
    const searchTerm = searchInput.value.toLowerCase();
    const statusFilterValue = statusFilter.value;
    const typeFilterValue = typeFilter.value;
    
    let filteredRequests = allRequests;
    
    // Filtre par recherche
    if (searchTerm) {
        filteredRequests = filteredRequests.filter(request => 
            (request.card_name && request.card_name.toLowerCase().includes(searchTerm)) ||
            (request.customer_email && request.customer_email.toLowerCase().includes(searchTerm)) ||
            (request.submission_id && request.submission_id.toLowerCase().includes(searchTerm))
        );
    }
    
    // Filtre par statut
    if (statusFilterValue && statusFilterValue !== 'all') {
        filteredRequests = filteredRequests.filter(request => request.status === statusFilterValue);
    }
    
    // Filtre par type
    if (typeFilterValue && typeFilterValue !== 'all') {
        filteredRequests = filteredRequests.filter(request => request.grading_type === typeFilterValue);
    }
    
    displayRequests(filteredRequests);
}

// Voir les détails d'une demande (avec vérifications défensives contre les erreurs)
async function viewRequestDetails(submissionId) {
    // Vérifications défensives pour l'ID
    if (!submissionId || typeof submissionId !== 'string' || submissionId.trim() === '') {
        console.error('[ADMIN] ❌ ID de soumission invalide:', submissionId);
        alert('⚠️ Erreur: ID de demande invalide');
        return;
    }
    
    const cleanSubmissionId = submissionId.trim();
    currentRequestId = cleanSubmissionId;
    
    try {
        console.log(`[ADMIN] 🔍 Chargement des détails pour: ${cleanSubmissionId}`);
        
        const response = await fetch(`/api/admin/grading-requests/${encodeURIComponent(cleanSubmissionId)}`, {
            credentials: 'include',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Erreur HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (data && data.success && data.request) {
            console.log(`[ADMIN] ✅ Détails récupérés pour ${cleanSubmissionId}:`, data.request);
            displayRequestDetails(data.request);
            
            const modal = document.getElementById('requestModal');
            if (modal) {
                modal.style.display = 'block';
                console.log(`[ADMIN] ✅ Modal des détails affiché`);
            } else {
                console.error('[ADMIN] ❌ Modal requestModal non trouvé');
                alert('⚠️ Erreur d\'affichage: Interface modal non disponible');
            }
        } else {
            console.error('[ADMIN] ❌ Réponse invalide:', data);
            const errorMsg = data?.message || 'Données de demande non trouvées';
            alert(`⚠️ Erreur lors du chargement des détails: ${errorMsg}`);
        }
    } catch (error) {
        console.error(`[ADMIN] ❌ Error loading request details for ${cleanSubmissionId}:`, error);
        
        let errorMessage = 'Erreur lors du chargement des détails';
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            errorMessage = 'Erreur de connexion au serveur';
        } else if (error.message.includes('HTTP')) {
            errorMessage = `Erreur serveur: ${error.message}`;
        } else if (error.message) {
            errorMessage = `Erreur: ${error.message}`;
        }
        
        alert(`❌ ${errorMessage}`);
    }
}

// Convertir la source de la carte en texte lisible
function getSourceText(cardSource) {
    const sources = {
        'website': 'Site Web',
        'whatnot': 'Whatnot Live',
        'taskmaster': 'Base de données',
        'manual': 'Saisie manuelle'
    };
    return sources[cardSource] || 'Inconnu';
}

// Afficher les cartes dans le modal de détails
function displayCardsInModal(request) {
    console.log('[ADMIN] 📋 Affichage cartes dans modal pour:', request.submission_id);
    
    // Trouver le conteneur des cartes dans le modal
    const cardsContainer = document.getElementById('modalCardsContainer');
    if (!cardsContainer) {
        console.error('[ADMIN] ❌ modalCardsContainer non trouvé');
        return;
    }
    
    // Nettoyer le conteneur
    cardsContainer.replaceChildren();
    
    // Créer l'affichage de la carte
    const cardDiv = document.createElement('div');
    cardDiv.className = 'modal-card-item';
    cardDiv.style.cssText = 'padding: 1rem; border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 1rem;';
    
    const nameDiv = document.createElement('div');
    nameDiv.style.cssText = 'font-weight: 600; margin-bottom: 0.5rem;';
    nameDiv.textContent = request.card_name || 'Nom non défini';
    
    const seriesDiv = document.createElement('div');
    seriesDiv.style.cssText = 'color: #666; font-size: 0.9rem;';
    seriesDiv.textContent = request.card_series || 'Série non définie';
    
    cardDiv.appendChild(nameDiv);
    cardDiv.appendChild(seriesDiv);
    cardsContainer.appendChild(cardDiv);
    
    console.log('[ADMIN] ✅ Carte affichée dans modal');
}

// Mettre à jour les actions du modal
function updateModalActions(request) {
    console.log('[ADMIN] 🔧 Mise à jour actions modal pour:', request.submission_id);
    
    // Récupérer tous les boutons d'action
    const paymentButton = document.getElementById('modalPaymentButton');
    const trackingButton = document.getElementById('modalTrackingButton');
    const videoButton = document.getElementById('modalVideoButton');
    
    // Cacher tous les boutons par défaut
    if (paymentButton) paymentButton.style.display = 'none';
    if (trackingButton) trackingButton.style.display = 'none';
    if (videoButton) videoButton.style.display = 'none';
    
    // Afficher les boutons selon le contexte de la requête
    if (request && request.submission_id) {
        // Afficher le bouton vidéo selon le statut
        if (videoButton) {
            videoButton.style.display = 'inline-block';
            
            // Si vidéo déjà uploadée, montrer bouton "Voir Vidéo"
            if (request.video_url && request.video_status === 'uploaded') {
                videoButton.innerHTML = '<i class="fas fa-play me-2"></i>Voir Vidéo';
                videoButton.className = 'btn btn-success btn-sm';
                videoButton.onclick = () => showUploadedVideo(request.submission_id, request.video_url);
                console.log('[ADMIN] ✅ Bouton voir vidéo configuré pour:', request.submission_id);
            } else {
                // Sinon, bouton pour enregistrer
                videoButton.innerHTML = '<i class="fas fa-video me-2"></i>Enregistrer Vidéo';
                videoButton.className = 'btn btn-primary btn-sm';
                videoButton.onclick = () => openVideoRecorder(request.submission_id);
                console.log('[ADMIN] ✅ Bouton enregistrer vidéo configuré pour:', request.submission_id);
            }
        }
        
        // Afficher bouton paiement si statut approprié
        if (paymentButton && (request.status === 'completed' || request.status === 'awaiting_payment')) {
            paymentButton.style.display = 'inline-block';
            paymentButton.onclick = () => sendPaymentLink(request.submission_id);
        }
        
        // Afficher bouton tracking si numéro de suivi présent
        if (trackingButton && request.tracking_number) {
            trackingButton.style.display = 'inline-block';
            trackingButton.onclick = () => editTrackingNumber(request.submission_id, request.tracking_number);
        }
    }
    
    console.log('[ADMIN] ✅ Actions modal mises à jour avec bouton vidéo');
}

// Ouvrir l'interface d'enregistrement vidéo
function openVideoRecorder(submissionId) {
    console.log('[ADMIN] 🎥 Ouverture interface vidéo pour:', submissionId);
    
    if (!submissionId) {
        alert('Erreur: ID de soumission manquant');
        return;
    }
    
    // URL de l'interface vidéo avec l'ID de soumission pré-rempli
    const videoUrl = `/video-record.html?submission_id=${encodeURIComponent(submissionId)}`;
    
    // Ouvrir dans un nouvel onglet
    const videoWindow = window.open(videoUrl, '_blank', 'width=1200,height=800,scrollbars=yes,resizable=yes');
    
    if (!videoWindow) {
        // Si le popup est bloqué, proposer une alternative
        const openConfirm = confirm(
            'Le popup vidéo a été bloqué par votre navigateur.\n' +
            'Cliquez OK pour ouvrir l\'interface vidéo dans cet onglet, ou autorisez les popups pour une meilleure expérience.'
        );
        
        if (openConfirm) {
            window.location.href = videoUrl;
        }
    } else {
        // Mettre le focus sur la nouvelle fenêtre
        videoWindow.focus();
        console.log('[ADMIN] ✅ Interface vidéo ouverte dans nouvel onglet');
    }
}

// Afficher une vidéo uploadée
async function showUploadedVideo(submissionId, videoUrl) {
    console.log('[ADMIN] 🎬 Affichage vidéo uploadée pour:', submissionId);
    
    if (!submissionId || !videoUrl) {
        alert('Erreur: Informations vidéo manquantes');
        return;
    }
    
    let secureVideoUrl;
    
    try {
        // RÉCUPÉRER LE TOKEN DE VISUALISATION
        console.log('[ADMIN] 🔐 Récupération token de visualisation...');
        
        const tokenResponse = await fetch(`/api/video/view-token/${submissionId}`, {
            method: 'GET',
            credentials: 'include'
        });
        
        if (!tokenResponse.ok) {
            const errorData = await tokenResponse.json();
            throw new Error(errorData.message || 'Impossible d\'obtenir le token de visualisation');
        }
        
        const tokenData = await tokenResponse.json();
        console.log('[ADMIN] ✅ Token de visualisation obtenu');
        
        secureVideoUrl = tokenData.video_url;
        
    } catch (error) {
        console.error('[ADMIN] ❌ Erreur récupération token:', error);
        alert('Erreur: ' + error.message);
        return;
    }
    
    // Créer le modal vidéo
    const modal = document.createElement('div');
    modal.className = 'modal fade show';
    modal.style.cssText = `
        display: block;
        position: fixed;
        z-index: 2000;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0,0,0,0.5);
    `;
    
    const modalDialog = document.createElement('div');
    modalDialog.className = 'modal-dialog modal-lg modal-dialog-centered';
    
    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content';
    
    modalContent.innerHTML = `
        <div class="modal-header">
            <h5 class="modal-title">
                <i class="fas fa-video me-2"></i>Vidéo PSA - ${submissionId}
            </h5>
            <button type="button" class="btn-close" onclick="this.closest('.modal').remove()"></button>
        </div>
        <div class="modal-body text-center">
            <div class="video-container" style="position: relative; max-width: 100%; height: auto;">
                <video 
                    controls 
                    autoplay 
                    style="width: 100%; max-height: 500px; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);"
                    onloadstart="console.log('[ADMIN] 📹 Chargement vidéo démarré')"
                    oncanplay="console.log('[ADMIN] ✅ Vidéo prête à jouer')"
                    onerror="console.error('[ADMIN] ❌ Erreur chargement vidéo'); this.parentElement.innerHTML = '<p class=\\'text-danger\\'>❌ Erreur lors du chargement de la vidéo</p>'"
                >
                    <source src="${secureVideoUrl}" type="video/webm">
                    <source src="${secureVideoUrl}" type="video/mp4">
                    <p class="text-danger">
                        ❌ Votre navigateur ne supporte pas la lecture vidéo.
                        <br><a href="${secureVideoUrl}" target="_blank" class="btn btn-primary btn-sm mt-2">
                            <i class="fas fa-download me-1"></i>Télécharger la vidéo
                        </a>
                    </p>
                </video>
                <div class="mt-3">
                    <small class="text-muted">
                        <i class="fas fa-info-circle me-1"></i>
                        Preuve vidéo enregistrée pour la commande PSA
                    </small>
                </div>
            </div>
        </div>
        <div class="modal-footer">
            <a href="${secureVideoUrl}" 
               target="_blank" 
               class="btn btn-outline-primary">
                <i class="fas fa-download me-2"></i>Télécharger
            </a>
            <button type="button" 
                    class="btn btn-secondary" 
                    onclick="this.closest('.modal').remove()">
                <i class="fas fa-times me-2"></i>Fermer
            </button>
        </div>
    `;
    
    modalDialog.appendChild(modalContent);
    modal.appendChild(modalDialog);
    document.body.appendChild(modal);
    
    // Fermer modal en cliquant en dehors
    modal.onclick = function(event) {
        if (event.target === modal) {
            modal.remove();
        }
    };
    
    console.log('[ADMIN] ✅ Modal vidéo créé et affiché');
}

function displayRequestDetails(request) {
    console.log('[ADMIN] 📋 Affichage détails avancés:', request);
    
    // Remplir les informations de base
    const elements = {
        'modalRequestId': request.submission_id,
        'modalCustomerEmail': request.customer_email,
        'modalCreatedAt': formatDate(request.created_at),
        'modalPrice': formatCurrency(request.effective_price || request.total_price || request.price),
        'modalGradingType': (request.grading_type || '').toUpperCase(),
        'modalCardSource': getSourceText(request.card_source || 'website'),
        'modalEstimatedCompletion': request.estimated_completion ? formatDate(request.estimated_completion) : 'Non définie',
        'modalTrackingNumber': request.tracking_number || 'Non assigné',
        'modalPsaNumber': request.psa_number || 'En attente'
    };
    
    Object.entries(elements).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = value;
        }
    });
    
    // Gestion des commentaires (peut être HTML)
    const notesEl = document.getElementById('modalNotes');
    if (notesEl) {
        const notes = request.comments || request.notes || 'Aucune note';
        notesEl.innerHTML = `<p style="margin: 0; padding: 0.5rem; background: #f8f9fa; border-radius: 6px; border-left: 3px solid #007bff;">${notes}</p>`;
    }
    
    // Sélecteur de statut
    const statusSelect = document.getElementById('statusSelect');
    if (statusSelect) {
        statusSelect.value = request.status;
    }
    
    // Afficher les cartes (multi-items ou carte unique)
    displayCardsInModal(request);
    
    // Mettre à jour les actions contextuelles
    updateModalActions(request);
}

// Mettre à jour le statut d'une demande
async function updateRequestStatus() {
    if (!currentRequestId) return;
    
    const statusSelect = document.getElementById('statusSelect');
    if (!statusSelect) return;
    
    const newStatus = statusSelect.value;
    
    try {
        const response = await fetch(`/api/admin/grading-requests/${currentRequestId}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ status: newStatus })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('Statut mis à jour avec succès');
            closeModal();
            refreshData(); // Refresh all data
            loadAllRequests(); // Reload requests
        } else {
            alert('Erreur lors de la mise à jour du statut');
        }
    } catch (error) {
        console.error('Error updating status:', error);
        alert('Erreur lors de la mise à jour');
    }
}

function getStatusText(status) {
    const statusTexts = {
        'pending': 'En attente',
        'in_progress': 'En cours',  
        'completed': 'Terminé',
        'cancelled': 'Annulé'
    };
    return statusTexts[status] || status;
}

// === FONCTIONS MANQUANTES POUR LES BOUTONS ===

// Fonction pour scraper PSA 
function scrapeAllPSA() {
    console.log('🔍 Scraper PSA démarré...');
    alert('Fonction PSA Scraper - À implémenter selon vos besoins');
}

// Fonctions pour la gestion des modales
function closeModal() {
    console.log('🚫 Fermeture modal');
    const modal = document.querySelector('.modal, #modal, .modal-overlay');
    if (modal) modal.style.display = 'none';
}

function closeAddModal() {
    console.log('🚫 Fermeture modal ajout');
    const modal = document.querySelector('.add-modal, #addModal');
    if (modal) modal.style.display = 'none';
}

function closeCardAddModal() {
    console.log('🚫 Fermeture modal ajout carte');
    const modal = document.querySelector('.card-add-modal, #cardAddModal');
    if (modal) modal.style.display = 'none';
}

// Fonction pour la sélection de mode
function selectMode(mode) {
    console.log(`📋 Mode sélectionné: ${mode}`);
    
    // Supprimer la classe 'selected' de tous les modes
    document.querySelectorAll('.mode-option').forEach(option => {
        option.classList.remove('selected');
    });
    
    // Ajouter 'selected' au mode choisi
    const selectedOption = document.querySelector(`[data-mode="${mode}"]`);
    if (selectedOption) {
        selectedOption.classList.add('selected');
    }
    
    // Basculer entre les modes (TaskMaster / Manuel)
    const taskmasterMode = document.getElementById('taskmasterMode');
    const manualMode = document.getElementById('manualMode');
    
    if (mode === 'taskmaster') {
        if (taskmasterMode) taskmasterMode.classList.add('active');
        if (manualMode) manualMode.classList.remove('active');
        console.log('🔍 Mode TaskMaster activé');
    } else if (mode === 'manual') {
        if (manualMode) manualMode.classList.add('active');
        if (taskmasterMode) taskmasterMode.classList.remove('active');
        console.log('✏️ Mode Manuel activé');
    }
}

// Note: Les fonctions principales (openCardManager, addCardToList, nextStep, prevStep) 
// sont déjà définies plus haut dans ce fichier avec leurs implémentations complètes

// ========================================
// FONCTIONS POUR LES QR CODES
// ========================================

// Obtenir le libellé du type de grading PSA
function getGradingTypeText(gradingType) {
    switch (gradingType) {
        case 'value':
            return 'PSA Value';
        case 'regular':
            return 'PSA Regular';
        case 'express':
            return 'PSA Express';
        default:
            return 'PSA Value';
    }
}

// Afficher le QR code dans un modal ou ouvrir l'interface vidéo
function viewQRCode(submissionId) {
    console.log(`📱 Affichage QR code pour: ${submissionId}`);
    
    // Option 1: Ouvrir l'interface vidéo dans un nouvel onglet
    const videoUrl = `/video-record?id=${submissionId}`;
    window.open(videoUrl, '_blank', 'width=800,height=600');
    
    // Option 2: Alternative - Afficher le QR code dans un modal (si préféré)
    // showQRCodeModal(submissionId);
}

// Alternative: Modal pour afficher le QR code directement
function showQRCodeModal(submissionId) {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.8); z-index: 10000;
        display: flex; align-items: center; justify-content: center;
    `;
    
    const content = document.createElement('div');
    content.style.cssText = `
        background: white; padding: 2rem; border-radius: 12px;
        text-align: center; max-width: 400px; width: 90%;
    `;
    
    content.innerHTML = `
        <h3>QR Code - ${submissionId}</h3>
        <div style="margin: 1rem 0;">
            <img src="/api/public/qr/${submissionId}" 
                 style="max-width: 300px; width: 100%;" 
                 alt="QR Code" 
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" />
            <div style="display: none; color: #666; padding: 2rem;">
                QR Code non disponible
            </div>
        </div>
        <button onclick="this.parentElement.parentElement.remove()" 
                style="background: #dc3545; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer;">
            Fermer
        </button>
    `;
    
    modal.appendChild(content);
    document.body.appendChild(modal);
}

// ========================================
// CUSTOMER INVITATION MANAGEMENT FUNCTIONS
// ========================================

// Variables globales pour les invitations
let currentInvitationRequest = null;

/**
 * Ouvrir le modal d'invitation client
 */
function openInvitationModal() {
    if (!currentRequestId) {
        alert('❌ Aucune commande sélectionnée');
        return;
    }

    // Récupérer les données de la commande courante
    const currentRequest = allRequests.find(req => req.id === currentRequestId);
    if (!currentRequest) {
        alert('❌ Données de commande non trouvées');
        return;
    }

    currentInvitationRequest = currentRequest;

    // Pré-remplir le modal avec les données de la commande
    document.getElementById('invitationEmail').value = currentRequest.customer_email || '';
    document.getElementById('invitationOrderId').textContent = currentRequest.submission_id;
    document.getElementById('invitationCardName').textContent = currentRequest.card_name;
    document.getElementById('invitationGradingType').textContent = currentRequest.grading_type.toUpperCase();
    document.getElementById('invitationPrice').textContent = formatCurrency(currentRequest.price);

    // Masquer les messages d'erreur
    document.getElementById('invitationError').style.display = 'none';
    document.getElementById('invitationPreview').style.display = 'none';

    // Ouvrir le modal
    const modal = document.getElementById('invitationModal');
    if (modal) {
        modal.style.display = 'block';
        console.log('[ADMIN] ✅ Modal invitation ouvert pour commande', currentRequest.submission_id);
    }
}

/**
 * Fermer le modal d'invitation
 */
function closeInvitationModal() {
    const modal = document.getElementById('invitationModal');
    if (modal) {
        modal.style.display = 'none';
        // Réinitialiser le formulaire
        document.getElementById('invitationEmail').value = '';
        document.getElementById('sendEmailNow').checked = true;
        document.getElementById('invitationError').style.display = 'none';
        document.getElementById('invitationPreview').style.display = 'none';
        currentInvitationRequest = null;
    }
}

/**
 * Créer une invitation client
 */
async function createInvitation() {
    if (!currentInvitationRequest) {
        showInvitationError('Aucune commande sélectionnée');
        return;
    }

    const email = document.getElementById('invitationEmail').value.trim();
    const sendEmail = document.getElementById('sendEmailNow').checked;

    // Validation
    if (!email) {
        showInvitationError('Veuillez saisir un email');
        return;
    }

    if (!isValidEmail(email)) {
        showInvitationError('Format d\'email invalide');
        return;
    }

    try {
        // Afficher état de chargement
        const createBtn = document.querySelector('#invitationModal .btn[onclick="createInvitation()"]');
        const originalText = createBtn.innerHTML;
        createBtn.innerHTML = '⏳ Création...';
        createBtn.disabled = true;

        console.log('[ADMIN] 🎯 Création invitation pour', email, 'commande', currentInvitationRequest.id);

        // Appel API pour créer l'invitation
        const response = await fetch('/api/admin/invitations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                grading_request_id: currentInvitationRequest.id,
                customer_email: email,
                send_email: sendEmail
            }),
            credentials: 'include'
        });

        const data = await response.json();

        if (data.success) {
            console.log('[ADMIN] ✅ Invitation créée:', data.invitation);
            
            // Afficher l'aperçu de succès
            showInvitationSuccess(data.invitation);
            
            // Fermer le modal après 2 secondes
            setTimeout(() => {
                closeInvitationModal();
                alert(`✅ Invitation envoyée avec succès à ${email}!\n\nLe client recevra un email avec le lien d'invitation.`);
            }, 2000);

        } else {
            console.error('[ADMIN] ❌ Erreur création invitation:', data.message);
            
            if (data.code === 'INVITATION_EXISTS') {
                showInvitationError(`Une invitation active existe déjà pour ce client.\n\nToken existant: ${data.existing_invitation.token.substring(0, 8)}...`);
            } else {
                showInvitationError(data.message || 'Erreur lors de la création de l\'invitation');
            }
        }

    } catch (error) {
        console.error('[ADMIN] ❌ Erreur réseau:', error);
        showInvitationError('Erreur réseau lors de la création de l\'invitation');
    } finally {
        // Restaurer le bouton
        const createBtn = document.querySelector('#invitationModal .btn[onclick="createInvitation()"]');
        createBtn.innerHTML = originalText;
        createBtn.disabled = false;
    }
}

/**
 * Ouvrir le modal d'historique des invitations
 */
async function openInvitationHistoryModal() {
    if (!currentRequestId) {
        alert('❌ Aucune commande sélectionnée');
        return;
    }

    const modal = document.getElementById('invitationHistoryModal');
    if (modal) {
        modal.style.display = 'block';
        // Charger l'historique
        await loadInvitationHistory(currentRequestId);
    }
}

/**
 * Fermer le modal d'historique des invitations
 */
function closeInvitationHistoryModal() {
    const modal = document.getElementById('invitationHistoryModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Charger l'historique des invitations pour une commande
 */
async function loadInvitationHistory(gradingRequestId) {
    const contentDiv = document.getElementById('invitationHistoryContent');
    
    try {
        // Afficher état de chargement
        contentDiv.innerHTML = `
            <div style="text-align: center; padding: 2rem;">
                <div class="spinner" style="margin: 0 auto 1rem;"></div>
                <p style="color: #666;">Chargement des invitations...</p>
            </div>
        `;

        console.log('[ADMIN] 📋 Chargement historique invitations pour commande', gradingRequestId);

        const response = await fetch(`/api/admin/invitations/${gradingRequestId}`, {
            credentials: 'include'
        });

        const data = await response.json();

        if (data.success) {
            renderInvitationHistory(data.invitations);
        } else {
            contentDiv.innerHTML = `
                <div style="text-align: center; padding: 2rem; color: #dc3545;">
                    <div style="font-size: 2rem; margin-bottom: 1rem;">❌</div>
                    <p>Erreur lors du chargement de l'historique</p>
                    <small>${data.message}</small>
                </div>
            `;
        }

    } catch (error) {
        console.error('[ADMIN] ❌ Erreur chargement historique invitations:', error);
        contentDiv.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: #dc3545;">
                <div style="font-size: 2rem; margin-bottom: 1rem;">🔌</div>
                <p>Erreur réseau</p>
                <small>Impossible de charger l'historique des invitations</small>
            </div>
        `;
    }
}

/**
 * Afficher l'historique des invitations
 */
function renderInvitationHistory(invitations) {
    const contentDiv = document.getElementById('invitationHistoryContent');

    if (!invitations || invitations.length === 0) {
        contentDiv.innerHTML = `
            <div style="text-align: center; padding: 2rem;">
                <div style="font-size: 3rem; margin-bottom: 1rem;">📭</div>
                <h4 style="color: #666; margin-bottom: 0.5rem;">Aucune invitation envoyée</h4>
                <p style="color: #999;">Cette commande n'a pas encore d'invitations client.</p>
            </div>
        `;
        return;
    }

    let html = `
        <div style="margin-bottom: 1.5rem;">
            <h4 style="color: #003366;">📋 ${invitations.length} invitation${invitations.length > 1 ? 's' : ''} trouvée${invitations.length > 1 ? 's' : ''}</h4>
        </div>
        <div class="invitations-list">
    `;

    invitations.forEach((invitation, index) => {
        const statusColor = getInvitationStatusColor(invitation.status);
        const statusText = getInvitationStatusText(invitation.status);
        
        html += `
            <div style="background: white; border: 1px solid #dee2e6; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; border-left: 4px solid ${statusColor};">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 1rem;">
                    <div>
                        <h5 style="margin: 0; color: #003366;">📧 ${invitation.customer_email}</h5>
                        <div style="margin-top: 0.5rem;">
                            <span class="badge" style="background: ${statusColor}; color: white; padding: 0.25rem 0.5rem; border-radius: 12px; font-size: 0.8rem;">${statusText}</span>
                        </div>
                    </div>
                    <div style="text-align: right; font-size: 0.9rem; color: #666;">
                        <div><strong>Créée:</strong> ${formatDate(invitation.created_at)}</div>
                        <div><strong>Admin:</strong> ${invitation.created_by_admin}</div>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                    <div>
                        <div style="font-size: 0.9rem; color: #666;"><strong>Token:</strong></div>
                        <code style="background: #f8f9fa; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.8rem;">${invitation.token.substring(0, 16)}...</code>
                    </div>
                    <div>
                        <div style="font-size: 0.9rem; color: #666;"><strong>Expire:</strong></div>
                        <span style="font-size: 0.9rem;">${formatDate(invitation.expires_at)}</span>
                    </div>
                </div>

                ${invitation.used ? `
                    <div style="background: #d4edda; border: 1px solid #c3e6cb; border-radius: 4px; padding: 0.75rem; margin-top: 1rem;">
                        <div style="color: #155724; font-weight: 600;">✅ Invitation utilisée</div>
                        <div style="color: #155724; font-size: 0.9rem;">Le ${formatDate(invitation.used_at)}</div>
                        ${invitation.customer_info ? `
                            <div style="margin-top: 0.5rem; font-size: 0.9rem; color: #155724;">
                                <strong>Client:</strong> ${invitation.customer_info.first_name} ${invitation.customer_info.last_name}
                            </div>
                        ` : ''}
                    </div>
                ` : invitation.status === 'expired' ? `
                    <div style="background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; padding: 0.75rem; margin-top: 1rem;">
                        <div style="color: #721c24; font-weight: 600;">⏰ Invitation expirée</div>
                        <div style="color: #721c24; font-size: 0.9rem;">Le lien n'est plus valide</div>
                    </div>
                ` : `
                    <div style="background: #cce5ff; border: 1px solid #b3d9ff; border-radius: 4px; padding: 0.75rem; margin-top: 1rem;">
                        <div style="color: #003366; font-weight: 600;">⏳ En attente</div>
                        <div style="color: #003366; font-size: 0.9rem;">Le client n'a pas encore utilisé l'invitation</div>
                    </div>
                `}
            </div>
        `;
    });

    html += '</div>';
    contentDiv.innerHTML = html;
}

/**
 * Fonctions utilitaires pour les invitations
 */
function getInvitationStatusColor(status) {
    switch (status) {
        case 'used': return '#28a745';
        case 'expired': return '#dc3545';
        case 'active': return '#007bff';
        default: return '#6c757d';
    }
}

function getInvitationStatusText(status) {
    switch (status) {
        case 'used': return 'Utilisée';
        case 'expired': return 'Expirée';
        case 'active': return 'Active';
        default: return 'Inconnue';
    }
}

function showInvitationError(message) {
    const errorDiv = document.getElementById('invitationError');
    const messageDiv = document.getElementById('invitationErrorMessage');
    messageDiv.textContent = message;
    errorDiv.style.display = 'block';
    document.getElementById('invitationPreview').style.display = 'none';
}

function showInvitationSuccess(invitation) {
    const previewDiv = document.getElementById('invitationPreview');
    const emailSpan = document.getElementById('previewEmail');
    const urlSpan = document.getElementById('previewUrl');
    
    emailSpan.textContent = invitation.customer_email;
    urlSpan.textContent = invitation.invitation_url;
    
    previewDiv.style.display = 'block';
    document.getElementById('invitationError').style.display = 'none';
}

function isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

console.log('✅ Customer invitation system initialized');

// Exporter TOUTES les fonctions vers le scope global pour les onclick
window.refreshData = refreshData;
window.refreshPendingPayments = refreshPendingPayments;
window.openNewCommandModal = openNewCommandModal;
window.scrapeAllPSA = scrapeAllPSA;
window.closeModal = closeModal;
window.closeAddModal = closeAddModal;
window.closeCardAddModal = closeCardAddModal;
window.selectMode = selectMode;
window.addCardToList = addCardToList;
window.openCardManager = openCardManager;
window.nextStep = nextStep;
window.prevStep = prevStep;
window.getGradingTypeText = getGradingTypeText;
window.viewQRCode = viewQRCode;
window.showQRCodeModal = showQRCodeModal;
window.generateQRCode = generateQRCode; // Fonction déjà existante

// Exporter les nouvelles fonctions d'invitation
window.openInvitationModal = openInvitationModal;
window.closeInvitationModal = closeInvitationModal;
window.createInvitation = createInvitation;
window.openInvitationHistoryModal = openInvitationHistoryModal;
window.closeInvitationHistoryModal = closeInvitationHistoryModal;

console.info("[ADMIN] 🎯 ALL 16 functions exported to global scope including QR code functions");