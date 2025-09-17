/**
 * PSA CLIENT VIDEO ACCESS - JAVASCRIPT
 * Interface client pour accès sécurisé aux vidéos de preuve PSA
 * Version: 1.0.0
 * Author: PSA Grading Service
 */

(() => {
    'use strict';

    // Configuration et constantes
    const CONFIG = {
        API_BASE: '/api/client',
        TIMEOUT: 30000, // 30 secondes
        MAX_RETRIES: 3,
        COUNTDOWN_UPDATE_INTERVAL: 1000, // 1 seconde
        SESSION_CHECK_INTERVAL: 60000, // 1 minute
        CHAR_COUNT_UPDATE_DEBOUNCE: 300, // 300ms
    };

    // État de l'application
    let appState = {
        isAuthenticated: false,
        accessToken: null,
        expiresAt: null,
        submissionData: null,
        countdownInterval: null,
        sessionCheckInterval: null,
        currentSection: 'auth', // 'auth', 'video', 'report', 'report-success'
    };

    // Cache des éléments DOM
    const elements = {
        // Sections
        authSection: null,
        videoSection: null,
        reportSection: null,
        reportSuccessSection: null,

        // Forms
        authForm: null,
        reportForm: null,

        // Inputs
        submissionIdInput: null,
        emailPartialInput: null,
        simpleCaptchaInput: null,

        // Buttons
        submitBtn: null,
        reportIssueBtn: null,
        logoutBtn: null,
        submitReportBtn: null,
        cancelReportBtn: null,

        // Display elements
        authMessage: null,
        proofVideo: null,
        videoLoading: null,
        cardName: null,
        submissionDisplay: null,
        gradingType: null,
        recordingDate: null,
        videoDuration: null,
        accessExpires: null,

        // Modal
        helpModal: null,
        closeHelpModal: null,
        helpLink: null,
        forgotLink: null,
        contactSupport: null,

        // Report elements
        issueDescription: null,
        charCount: null,
        contactEmail: null,
        reportMessage: null,
        ticketNumber: null,

        // Navigation
        backToVideoBtn: null,
        newReportBtn: null,
    };

    /**
     * Point d'entrée principal
     */
    function init() {
        console.log('[PSA Client] 🚀 Initialisation du portail client...');
        
        try {
            cacheElements();
            bindEventListeners();
            initializeUI();
            
            // Vérifier si on a des paramètres URL pour connexion automatique
            checkURLParameters();
            
            console.log('[PSA Client] ✅ Portail client initialisé');
        } catch (error) {
            console.error('[PSA Client] ❌ Erreur d\'initialisation:', error);
            showError('Erreur d\'initialisation de l\'application');
        }
    }

    /**
     * Cache tous les éléments DOM nécessaires
     */
    function cacheElements() {
        const selectors = {
            // Sections
            authSection: '#auth-section',
            videoSection: '#video-section',
            reportSection: '#report-section',
            reportSuccessSection: '#report-success-section',

            // Forms
            authForm: '#client-auth-form',
            reportForm: '#report-form',

            // Inputs
            submissionIdInput: '#submission-id',
            emailPartialInput: '#email-partial',
            simpleCaptchaInput: '#simple-captcha',

            // Buttons
            submitBtn: '#submit-btn',
            reportIssueBtn: '#report-issue-btn',
            logoutBtn: '#logout-btn',
            submitReportBtn: '#submit-report-btn',
            cancelReportBtn: '#cancel-report-btn',

            // Display elements
            authMessage: '#auth-message',
            proofVideo: '#proof-video',
            videoLoading: '#video-loading',
            cardName: '#card-name',
            submissionDisplay: '#submission-display',
            gradingType: '#grading-type',
            recordingDate: '#recording-date',
            videoDuration: '#video-duration',
            accessExpires: '#access-expires',

            // Modal
            helpModal: '#help-modal',
            closeHelpModal: '#close-help-modal',
            helpLink: '#help-link',
            forgotLink: '#forgot-link',
            contactSupport: '#contact-support',

            // Report elements
            issueDescription: '#issue-description',
            charCount: '#char-count',
            contactEmail: '#contact-email',
            reportMessage: '#report-message',
            ticketNumber: '#ticket-number',

            // Navigation
            backToVideoBtn: '#back-to-video-btn',
            newReportBtn: '#new-report-btn',
        };

        for (const [key, selector] of Object.entries(selectors)) {
            const element = document.querySelector(selector);
            if (!element && !key.includes('Modal') && !key.includes('Help')) {
                console.warn(`[PSA Client] ⚠️ Élément non trouvé: ${selector}`);
            }
            elements[key] = element;
        }
    }

    /**
     * Attache tous les event listeners
     */
    function bindEventListeners() {
        // Formulaire d'authentification
        if (elements.authForm) {
            elements.authForm.addEventListener('submit', handleAuthSubmit);
        }

        // Boutons de navigation
        if (elements.reportIssueBtn) {
            elements.reportIssueBtn.addEventListener('click', showReportSection);
        }

        if (elements.logoutBtn) {
            elements.logoutBtn.addEventListener('click', handleLogout);
        }

        // Formulaire de signalement
        if (elements.reportForm) {
            elements.reportForm.addEventListener('submit', handleReportSubmit);
        }

        if (elements.cancelReportBtn) {
            elements.cancelReportBtn.addEventListener('click', showVideoSection);
        }

        // Navigation post-signalement
        if (elements.backToVideoBtn) {
            elements.backToVideoBtn.addEventListener('click', showVideoSection);
        }

        if (elements.newReportBtn) {
            elements.newReportBtn.addEventListener('click', showReportSection);
        }

        // Modal d'aide
        if (elements.helpLink) {
            elements.helpLink.addEventListener('click', (e) => {
                e.preventDefault();
                showHelpModal();
            });
        }

        if (elements.forgotLink) {
            elements.forgotLink.addEventListener('click', (e) => {
                e.preventDefault();
                window.open('mailto:support@psa-grading.com?subject=Informations de connexion perdues', '_blank');
            });
        }

        if (elements.closeHelpModal) {
            elements.closeHelpModal.addEventListener('click', hideHelpModal);
        }

        if (elements.contactSupport) {
            elements.contactSupport.addEventListener('click', () => {
                window.open('mailto:support@psa-grading.com?subject=Demande d\'aide - Portail client', '_blank');
            });
        }

        if (elements.helpModal) {
            elements.helpModal.addEventListener('click', (e) => {
                if (e.target === elements.helpModal) {
                    hideHelpModal();
                }
            });
        }

        // Compteur de caractères pour la description
        if (elements.issueDescription && elements.charCount) {
            let debounceTimeout;
            elements.issueDescription.addEventListener('input', (e) => {
                clearTimeout(debounceTimeout);
                debounceTimeout = setTimeout(() => {
                    updateCharCount();
                }, CONFIG.CHAR_COUNT_UPDATE_DEBOUNCE);
            });
        }

        // Formatage automatique des champs
        if (elements.submissionIdInput) {
            elements.submissionIdInput.addEventListener('input', formatSubmissionId);
        }

        if (elements.emailPartialInput) {
            elements.emailPartialInput.addEventListener('input', formatEmailPartial);
        }

        // Gestion clavier
        document.addEventListener('keydown', handleKeyboardShortcuts);

        // Vérification de connexion automatique
        window.addEventListener('beforeunload', cleanup);
    }

    /**
     * Initialise l'état de l'UI
     */
    function initializeUI() {
        showAuthSection();
        
        // Pré-remplir l'année actuelle dans le captcha
        if (elements.simpleCaptchaInput) {
            const currentYear = new Date().getFullYear().toString();
            elements.simpleCaptchaInput.setAttribute('placeholder', currentYear);
        }

        // Focus sur le premier champ
        if (elements.submissionIdInput) {
            setTimeout(() => {
                elements.submissionIdInput.focus();
            }, 100);
        }
    }

    /**
     * Vérifie les paramètres URL pour connexion automatique
     */
    function checkURLParameters() {
        const urlParams = new URLSearchParams(window.location.search);
        const submissionId = urlParams.get('submission_id');
        const token = urlParams.get('token');

        if (submissionId && token) {
            console.log('[PSA Client] 🔗 Connexion automatique détectée');
            // TODO: Implémenter la connexion automatique avec token
            // Pour l'instant, on pré-remplit juste le champ
            if (elements.submissionIdInput) {
                elements.submissionIdInput.value = submissionId;
            }
        }
    }

    /**
     * Gère la soumission du formulaire d'authentification
     */
    async function handleAuthSubmit(e) {
        e.preventDefault();

        if (appState.isAuthenticated) {
            console.warn('[PSA Client] ⚠️ Tentative de double authentification');
            return;
        }

        console.log('[PSA Client] 🔐 Tentative d\'authentification');

        const formData = new FormData(elements.authForm);
        const submissionId = formData.get('submission_id')?.trim();
        const emailPartial = formData.get('email_partial')?.trim().toLowerCase();
        const simpleCaptcha = formData.get('simple_captcha')?.trim();

        // Validation côté client
        if (!validateAuthForm(submissionId, emailPartial, simpleCaptcha)) {
            return;
        }

        setLoadingState(true);
        hideMessage();

        try {
            const response = await fetch(`${CONFIG.API_BASE}/verify-submission`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    submission_id: submissionId,
                    email_partial: emailPartial,
                    simple_captcha: simpleCaptcha,
                }),
                signal: AbortSignal.timeout(CONFIG.TIMEOUT)
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || 'Erreur de vérification');
            }

            if (result.success && result.data) {
                console.log('[PSA Client] ✅ Authentification réussie');
                handleAuthSuccess(result.data);
            } else {
                throw new Error(result.message || 'Réponse invalide du serveur');
            }

        } catch (error) {
            console.error('[PSA Client] ❌ Erreur d\'authentification:', error);
            
            let errorMessage = 'Une erreur est survenue';
            
            if (error.name === 'AbortError') {
                errorMessage = 'Délai d\'attente dépassé';
            } else if (error.message.includes('RATE_LIMITED')) {
                errorMessage = 'Trop de tentatives. Veuillez patienter avant de réessayer.';
            } else if (error.message.includes('SUBMISSION_NOT_FOUND')) {
                errorMessage = 'Numéro de soumission non trouvé';
            } else if (error.message.includes('EMAIL_VERIFICATION_FAILED')) {
                errorMessage = 'Les caractères de l\'email ne correspondent pas';
            } else if (error.message.includes('INVALID_CAPTCHA')) {
                errorMessage = 'Vérification de sécurité échouée';
            } else if (error.message) {
                errorMessage = error.message;
            }

            showError(errorMessage);
        } finally {
            setLoadingState(false);
        }
    }

    /**
     * Gère le succès de l'authentification
     */
    function handleAuthSuccess(data) {
        appState.isAuthenticated = true;
        appState.accessToken = data.access_token;
        appState.expiresAt = data.expires_at;
        appState.submissionData = data.submission;

        console.log('[PSA Client] 📊 Session établie:', {
            submission: data.submission.id,
            expires: new Date(data.expires_at).toLocaleString('fr-FR')
        });

        // Démarrer le countdown
        startCountdown();
        
        // Démarrer la vérification de session
        startSessionCheck();

        showVideoSection();
        loadVideo();
    }

    /**
     * Charge et affiche la vidéo
     */
    async function loadVideo() {
        if (!appState.accessToken || !appState.submissionData) {
            console.error('[PSA Client] ❌ Token ou données manquants pour charger la vidéo');
            return;
        }

        console.log('[PSA Client] 🎬 Chargement de la vidéo...');

        // Afficher les informations de soumission
        updateSubmissionDisplay();

        // Afficher le loader
        if (elements.videoLoading) {
            elements.videoLoading.style.display = 'flex';
        }

        try {
            // Construire l'URL vidéo
            const videoUrl = `${CONFIG.API_BASE}/video/${appState.accessToken}?submission_id=${appState.submissionData.id}`;
            
            if (elements.proofVideo) {
                elements.proofVideo.src = videoUrl;
                
                elements.proofVideo.addEventListener('loadstart', () => {
                    console.log('[PSA Client] 📹 Début du chargement vidéo');
                });

                elements.proofVideo.addEventListener('canplay', () => {
                    console.log('[PSA Client] ✅ Vidéo prête à être lue');
                    if (elements.videoLoading) {
                        elements.videoLoading.style.display = 'none';
                    }
                });

                elements.proofVideo.addEventListener('error', (e) => {
                    console.error('[PSA Client] ❌ Erreur de chargement vidéo:', e);
                    if (elements.videoLoading) {
                        elements.videoLoading.innerHTML = `
                            <div style="color: #dc3545; text-align: center;">
                                <p>❌ Erreur de chargement de la vidéo</p>
                                <button onclick="window.location.reload()" style="padding: 8px 16px; margin-top: 10px;">
                                    🔄 Recharger
                                </button>
                            </div>
                        `;
                    }
                });

                // Prévenir le téléchargement
                elements.proofVideo.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    showInfo('Le téléchargement n\'est pas autorisé pour des raisons de sécurité');
                });
            }

        } catch (error) {
            console.error('[PSA Client] ❌ Erreur lors du chargement vidéo:', error);
            
            if (elements.videoLoading) {
                elements.videoLoading.innerHTML = `
                    <div style="color: #dc3545; text-align: center;">
                        <p>❌ Impossible de charger la vidéo</p>
                        <p style="font-size: 0.9em; margin-top: 10px;">
                            ${error.message || 'Erreur inconnue'}
                        </p>
                        <button onclick="window.location.reload()" style="padding: 8px 16px; margin-top: 10px;">
                            🔄 Recharger la page
                        </button>
                    </div>
                `;
            }
        }
    }

    /**
     * Met à jour l'affichage des informations de soumission
     */
    function updateSubmissionDisplay() {
        const submission = appState.submissionData;
        if (!submission) return;

        if (elements.cardName) {
            elements.cardName.textContent = submission.card_name || 'Carte inconnue';
        }

        if (elements.submissionDisplay) {
            elements.submissionDisplay.textContent = submission.id || '';
        }

        if (elements.gradingType) {
            elements.gradingType.textContent = submission.grading_type || '';
        }

        if (elements.recordingDate && submission.recording_date) {
            const recordingDate = new Date(submission.recording_date);
            elements.recordingDate.textContent = recordingDate.toLocaleString('fr-FR');
        }

        if (elements.videoDuration && submission.video_duration) {
            const duration = formatDuration(submission.video_duration);
            elements.videoDuration.textContent = duration;
        }
    }

    /**
     * Démarre le countdown d'expiration
     */
    function startCountdown() {
        if (appState.countdownInterval) {
            clearInterval(appState.countdownInterval);
        }

        appState.countdownInterval = setInterval(() => {
            updateCountdown();
        }, CONFIG.COUNTDOWN_UPDATE_INTERVAL);

        // Mise à jour immédiate
        updateCountdown();
    }

    /**
     * Met à jour le countdown d'expiration
     */
    function updateCountdown() {
        if (!appState.expiresAt || !elements.accessExpires) {
            return;
        }

        const now = Date.now();
        const expiresAt = appState.expiresAt;
        const timeLeft = expiresAt - now;

        if (timeLeft <= 0) {
            elements.accessExpires.textContent = 'Expiré';
            elements.accessExpires.classList.add('expired');
            console.log('[PSA Client] ⏰ Session expirée');
            handleSessionExpired();
            return;
        }

        const minutes = Math.floor(timeLeft / 60000);
        const seconds = Math.floor((timeLeft % 60000) / 1000);
        
        elements.accessExpires.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        
        // Changer la couleur selon le temps restant
        elements.accessExpires.classList.remove('warning', 'danger');
        if (minutes < 5) {
            elements.accessExpires.classList.add('danger');
        } else if (minutes < 15) {
            elements.accessExpires.classList.add('warning');
        }
    }

    /**
     * Démarre la vérification périodique de session
     */
    function startSessionCheck() {
        if (appState.sessionCheckInterval) {
            clearInterval(appState.sessionCheckInterval);
        }

        appState.sessionCheckInterval = setInterval(() => {
            checkSessionValidity();
        }, CONFIG.SESSION_CHECK_INTERVAL);
    }

    /**
     * Vérifie la validité de la session
     */
    async function checkSessionValidity() {
        if (!appState.isAuthenticated || !appState.accessToken) {
            return;
        }

        // Vérification côté client d'abord
        if (Date.now() >= appState.expiresAt) {
            console.log('[PSA Client] ⏰ Session expirée (côté client)');
            handleSessionExpired();
            return;
        }

        // TODO: Vérification côté serveur si nécessaire
        // Pour l'instant on fait confiance au timestamp local
    }

    /**
     * Gère l'expiration de session
     */
    function handleSessionExpired() {
        console.log('[PSA Client] 🔐 Gestion de l\'expiration de session');
        
        cleanup();
        showError('Votre session a expiré. Veuillez vous reconnecter.', 'warning');
        
        setTimeout(() => {
            resetToAuthSection();
        }, 3000);
    }

    /**
     * Gère la déconnexion manuelle
     */
    function handleLogout() {
        console.log('[PSA Client] 🚪 Déconnexion manuelle');
        
        if (confirm('Êtes-vous sûr de vouloir vous déconnecter ?')) {
            cleanup();
            showInfo('Vous avez été déconnecté avec succès');
            
            setTimeout(() => {
                resetToAuthSection();
            }, 2000);
        }
    }

    /**
     * Gère la soumission du signalement
     */
    async function handleReportSubmit(e) {
        e.preventDefault();

        console.log('[PSA Client] 📋 Soumission de signalement');

        const formData = new FormData(elements.reportForm);
        const reportData = {
            submission_id: appState.submissionData?.id,
            client_email: formData.get('client_email')?.trim(),
            issue_type: formData.get('issue_type'),
            description: formData.get('description')?.trim(),
            priority: formData.get('priority') || 'medium'
        };

        // Validation
        if (!reportData.client_email || !reportData.issue_type || !reportData.description) {
            showReportError('Tous les champs obligatoires doivent être remplis');
            return;
        }

        if (reportData.description.length < 10) {
            showReportError('Veuillez fournir une description plus détaillée (minimum 10 caractères)');
            return;
        }

        setReportLoadingState(true);
        hideReportMessage();

        try {
            const response = await fetch(`${CONFIG.API_BASE}/report-issue`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(reportData),
                signal: AbortSignal.timeout(CONFIG.TIMEOUT)
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || 'Erreur lors de l\'envoi du signalement');
            }

            if (result.success && result.data) {
                console.log('[PSA Client] ✅ Signalement envoyé:', result.data.ticket_number);
                handleReportSuccess(result.data);
            } else {
                throw new Error(result.message || 'Réponse invalide du serveur');
            }

        } catch (error) {
            console.error('[PSA Client] ❌ Erreur envoi signalement:', error);
            
            let errorMessage = 'Une erreur est survenue lors de l\'envoi';
            
            if (error.name === 'AbortError') {
                errorMessage = 'Délai d\'attente dépassé';
            } else if (error.message) {
                errorMessage = error.message;
            }

            showReportError(errorMessage);
        } finally {
            setReportLoadingState(false);
        }
    }

    /**
     * Gère le succès du signalement
     */
    function handleReportSuccess(data) {
        console.log('[PSA Client] 📋 Signalement traité avec succès');

        // Afficher le numéro de ticket
        if (elements.ticketNumber) {
            elements.ticketNumber.textContent = data.ticket_number;
        }

        showReportSuccessSection();
        
        // Auto-retour à la vidéo après 30 secondes
        setTimeout(() => {
            if (appState.currentSection === 'report-success') {
                showVideoSection();
                showInfo('Retour automatique à votre vidéo');
            }
        }, 30000);
    }

    // ========================================================================
    // NAVIGATION ENTRE SECTIONS
    // ========================================================================

    function showAuthSection() {
        hideAllSections();
        if (elements.authSection) {
            elements.authSection.style.display = 'block';
        }
        appState.currentSection = 'auth';
        
        // Focus sur le premier champ
        setTimeout(() => {
            if (elements.submissionIdInput) {
                elements.submissionIdInput.focus();
            }
        }, 100);
    }

    function showVideoSection() {
        hideAllSections();
        if (elements.videoSection) {
            elements.videoSection.style.display = 'block';
        }
        appState.currentSection = 'video';
    }

    function showReportSection() {
        hideAllSections();
        if (elements.reportSection) {
            elements.reportSection.style.display = 'block';
        }
        appState.currentSection = 'report';
        
        // Pré-remplir l'email si possible
        if (elements.contactEmail && appState.submissionData) {
            // On ne peut pas pré-remplir l'email complet pour des raisons de sécurité
            // L'utilisateur devra le saisir manuellement
            elements.contactEmail.focus();
        }
        
        updateCharCount();
    }

    function showReportSuccessSection() {
        hideAllSections();
        if (elements.reportSuccessSection) {
            elements.reportSuccessSection.style.display = 'block';
        }
        appState.currentSection = 'report-success';
    }

    function hideAllSections() {
        [elements.authSection, elements.videoSection, elements.reportSection, elements.reportSuccessSection]
            .forEach(section => {
                if (section) {
                    section.style.display = 'none';
                }
            });
    }

    function resetToAuthSection() {
        // Reset de l'état
        appState.isAuthenticated = false;
        appState.accessToken = null;
        appState.expiresAt = null;
        appState.submissionData = null;
        
        // Reset des formulaires
        if (elements.authForm) {
            elements.authForm.reset();
        }
        if (elements.reportForm) {
            elements.reportForm.reset();
        }
        
        // Reset de la vidéo
        if (elements.proofVideo) {
            elements.proofVideo.src = '';
            elements.proofVideo.load();
        }
        
        showAuthSection();
        hideMessage();
    }

    // ========================================================================
    // UTILITAIRES UI
    // ========================================================================

    function setLoadingState(isLoading) {
        if (!elements.submitBtn) return;

        const btnText = elements.submitBtn.querySelector('.btn-text');
        const btnLoader = elements.submitBtn.querySelector('.btn-loader');

        if (isLoading) {
            if (btnText) btnText.style.display = 'none';
            if (btnLoader) btnLoader.style.display = 'flex';
            elements.submitBtn.disabled = true;
        } else {
            if (btnText) btnText.style.display = 'block';
            if (btnLoader) btnLoader.style.display = 'none';
            elements.submitBtn.disabled = false;
        }
    }

    function setReportLoadingState(isLoading) {
        if (!elements.submitReportBtn) return;

        const btnText = elements.submitReportBtn.querySelector('.btn-text');
        const btnLoader = elements.submitReportBtn.querySelector('.btn-loader');

        if (isLoading) {
            if (btnText) btnText.style.display = 'none';
            if (btnLoader) btnLoader.style.display = 'flex';
            elements.submitReportBtn.disabled = true;
        } else {
            if (btnText) btnText.style.display = 'block';
            if (btnLoader) btnLoader.style.display = 'none';
            elements.submitReportBtn.disabled = false;
        }
    }

    function showError(message, type = 'error') {
        showMessage(message, type);
    }

    function showInfo(message) {
        showMessage(message, 'success');
    }

    function showWarning(message) {
        showMessage(message, 'warning');
    }

    function showMessage(message, type = 'error') {
        if (!elements.authMessage) return;

        elements.authMessage.textContent = message;
        elements.authMessage.className = `auth-message ${type}`;
        elements.authMessage.style.display = 'block';

        // Scroll vers le message si nécessaire
        elements.authMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        // Auto-hide pour les messages de succès
        if (type === 'success') {
            setTimeout(() => {
                hideMessage();
            }, 5000);
        }
    }

    function hideMessage() {
        if (elements.authMessage) {
            elements.authMessage.style.display = 'none';
        }
    }

    function showReportError(message) {
        if (!elements.reportMessage) return;

        elements.reportMessage.textContent = message;
        elements.reportMessage.className = 'report-message error';
        elements.reportMessage.style.display = 'block';
        
        elements.reportMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function hideReportMessage() {
        if (elements.reportMessage) {
            elements.reportMessage.style.display = 'none';
        }
    }

    function showHelpModal() {
        if (elements.helpModal) {
            elements.helpModal.style.display = 'flex';
            // Prevent body scroll
            document.body.style.overflow = 'hidden';
        }
    }

    function hideHelpModal() {
        if (elements.helpModal) {
            elements.helpModal.style.display = 'none';
            // Restore body scroll
            document.body.style.overflow = '';
        }
    }

    function updateCharCount() {
        if (!elements.issueDescription || !elements.charCount) return;

        const count = elements.issueDescription.value.length;
        elements.charCount.textContent = count;

        // Change la couleur selon le nombre de caractères
        elements.charCount.style.color = count > 1800 ? '#dc3545' : count > 1500 ? '#fd7e14' : '#6c757d';
    }

    // ========================================================================
    // VALIDATION ET FORMATAGE
    // ========================================================================

    function validateAuthForm(submissionId, emailPartial, simpleCaptcha) {
        if (!submissionId || submissionId.length < 5) {
            showError('Veuillez saisir un numéro de soumission valide');
            return false;
        }

        if (!emailPartial || emailPartial.length !== 4) {
            showError('Veuillez saisir exactement 4 caractères de votre email');
            return false;
        }

        if (!simpleCaptcha) {
            showError('Veuillez répondre à la question de sécurité');
            return false;
        }

        const currentYear = new Date().getFullYear().toString();
        if (simpleCaptcha !== currentYear) {
            showError('Réponse de sécurité incorrecte');
            return false;
        }

        return true;
    }

    function formatSubmissionId(e) {
        let value = e.target.value;
        
        // Supprimer les caractères non autorisés
        value = value.replace(/[^a-zA-Z0-9-]/g, '');
        
        // Limiter la longueur
        if (value.length > 50) {
            value = value.substring(0, 50);
        }
        
        e.target.value = value;
    }

    function formatEmailPartial(e) {
        let value = e.target.value;
        
        // Supprimer les caractères non alphanumériques
        value = value.replace(/[^a-zA-Z0-9]/g, '');
        
        // Convertir en minuscules
        value = value.toLowerCase();
        
        // Limiter à 4 caractères
        if (value.length > 4) {
            value = value.substring(0, 4);
        }
        
        e.target.value = value;
    }

    function formatDuration(seconds) {
        if (!seconds || seconds <= 0) return 'N/A';
        
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        
        if (mins > 0) {
            return `${mins}min ${secs}s`;
        } else {
            return `${secs}s`;
        }
    }

    // ========================================================================
    // GESTION CLAVIER ET RACCOURCIS
    // ========================================================================

    function handleKeyboardShortcuts(e) {
        // Échapper pour fermer les modales
        if (e.key === 'Escape') {
            if (elements.helpModal && elements.helpModal.style.display === 'flex') {
                hideHelpModal();
                e.preventDefault();
            }
        }

        // Entrée pour soumettre les formulaires
        if (e.key === 'Enter' && e.ctrlKey) {
            if (appState.currentSection === 'auth' && elements.authForm) {
                elements.authForm.dispatchEvent(new Event('submit'));
                e.preventDefault();
            } else if (appState.currentSection === 'report' && elements.reportForm) {
                elements.reportForm.dispatchEvent(new Event('submit'));
                e.preventDefault();
            }
        }
    }

    // ========================================================================
    // NETTOYAGE ET GESTION MÉMOIRE
    // ========================================================================

    function cleanup() {
        console.log('[PSA Client] 🧹 Nettoyage des ressources...');

        // Arrêter les intervalles
        if (appState.countdownInterval) {
            clearInterval(appState.countdownInterval);
            appState.countdownInterval = null;
        }

        if (appState.sessionCheckInterval) {
            clearInterval(appState.sessionCheckInterval);
            appState.sessionCheckInterval = null;
        }

        // Nettoyer la vidéo
        if (elements.proofVideo) {
            elements.proofVideo.pause();
            elements.proofVideo.src = '';
            elements.proofVideo.load();
        }

        // Reset de l'état
        appState.isAuthenticated = false;
        appState.accessToken = null;
        appState.expiresAt = null;
        appState.submissionData = null;
    }

    // ========================================================================
    // INITIALISATION QUAND LE DOM EST PRÊT
    // ========================================================================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Export pour débogage en développement
    if (window.location.hostname === 'localhost' || window.location.hostname.includes('replit')) {
        window.PSAClientDebug = {
            appState,
            elements,
            showAuthSection,
            showVideoSection,
            showReportSection,
            cleanup
        };
    }

})();