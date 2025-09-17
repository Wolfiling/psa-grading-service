/**
 * PSA Video Recorder - Système d'enregistrement vidéo pour preuves PSA
 * Interface personnel pour scanner QR codes et enregistrer les vidéos
 */

console.log('[PSA Video] 📦 videoRecorder.js chargé avec succès');

class PSAVideoRecorder {
    constructor() {
        try {
            console.log('[PSA Video] 🚀 Initialisation PSAVideoRecorder...');
        this.currentSubmissionId = null;
        this.submissionData = null;
        this.mediaRecorder = null;
        this.videoStream = null;
        this.recordedChunks = [];
        this.recordingStartTime = null;
        this.recordingTimer = null;
        this.maxRecordingTime = 2 * 60; // 2 minutes en secondes
        this.qrScanner = null;
        this.isScannerActive = false;
        
        this.initializeElements();
        this.bindEvents();
        
        // Vérifier si un submission_id est passé dans l'URL
        this.checkUrlParameters();
        
        console.log('[PSA Video] VideoRecorder initialisé');
        
        } catch (error) {
            console.error('[PSA Video] ❌ Erreur initialisation:', error);
        }
    }
    
    initializeElements() {
        // Sections principales
        this.qrScannerSection = document.getElementById('qrScannerSection');
        this.loadingSection = document.getElementById('loadingSection');
        this.submissionInfoSection = document.getElementById('submissionInfoSection');
        this.videoSection = document.getElementById('videoSection');
        this.successSection = document.getElementById('successSection');
        
        // QR Scanner
        this.qrReader = document.getElementById('qr-reader');
        this.startScanBtn = document.getElementById('startScanBtn');
        this.stopScanBtn = document.getElementById('stopScanBtn');
        this.manualSubmissionId = document.getElementById('manualSubmissionId');
        this.loadManualBtn = document.getElementById('loadManualBtn');
        
        // Vidéo
        this.videoPreview = document.getElementById('videoPreview');
        this.recordingOverlay = document.getElementById('recordingOverlay');
        this.timerDisplay = document.getElementById('timerDisplay');
        this.startRecordBtn = document.getElementById('startRecordBtn');
        this.stopRecordBtn = document.getElementById('stopRecordBtn');
        this.uploadBtn = document.getElementById('uploadBtn');
        this.resetBtn = document.getElementById('resetBtn');
        
        // UI
        this.statusBadge = document.getElementById('statusBadge');
        this.alertContainer = document.getElementById('alertContainer');
        this.submissionDetails = document.getElementById('submissionDetails');
        this.progressContainer = document.getElementById('progressContainer');
        this.uploadProgress = document.getElementById('uploadProgress');
        this.newRecordingBtn = document.getElementById('newRecordingBtn');
        
        // QR Code elements
        this.qrCodeSection = document.getElementById('qrCodeSection');
        this.qrCodeDisplay = document.getElementById('qrCodeDisplay');
        this.qrCodeImage = document.getElementById('qrCodeImage');
        this.qrLoader = document.getElementById('qrLoader');
    }
    
    bindEvents() {
        // QR Scanner
        this.startScanBtn.addEventListener('click', () => this.startQRScanner());
        this.stopScanBtn.addEventListener('click', () => this.stopQRScanner());
        this.loadManualBtn.addEventListener('click', () => this.loadManualSubmission());
        
        // Enregistrement vidéo
        this.startRecordBtn.addEventListener('click', () => this.startRecording());
        this.stopRecordBtn.addEventListener('click', () => this.stopRecording());
        this.uploadBtn.addEventListener('click', () => this.uploadVideo());
        this.resetBtn.addEventListener('click', () => this.resetInterface());
        this.newRecordingBtn.addEventListener('click', () => this.resetInterface());
        
        // Entrée manuelle
        this.manualSubmissionId.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.loadManualSubmission();
            }
        });
    }
    
    // Vérifier les paramètres URL et charger automatiquement une soumission si spécifiée
    checkUrlParameters() {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            // Vérifier les deux types de paramètres : 'submission_id' et 'id'
            const submissionId = urlParams.get('submission_id') || urlParams.get('id');
            
            if (submissionId) {
                console.log('[PSA Video] 🔗 Submission ID détecté dans l\'URL:', submissionId);
                
                // Pré-remplir le champ d'entrée manuelle
                if (this.manualSubmissionId) {
                    this.manualSubmissionId.value = submissionId;
                }
                
                // Charger automatiquement la soumission immédiatement
                this.showAlert('Chargement automatique de la soumission depuis l\'URL...', 'info', true);
                this.loadSubmissionInfo(submissionId);
            } else {
                console.log('[PSA Video] 💡 Aucun submission_id/id dans l\'URL - utilisation normale du scanner QR');
            }
        } catch (error) {
            console.error('[PSA Video] ❌ Erreur lors de la vérification des paramètres URL:', error);
        }
    }
    
    showAlert(message, type = 'info', autoHide = true) {
        const alertClass = {
            success: 'alert-success',
            error: 'alert-danger',
            warning: 'alert-warning',
            info: 'alert-info'
        }[type];
        
        const iconClass = {
            success: 'fa-check-circle',
            error: 'fa-exclamation-triangle',
            warning: 'fa-exclamation-circle',
            info: 'fa-info-circle'
        }[type];
        
        const alertHtml = `
            <div class="alert ${alertClass} alert-custom alert-dismissible fade show" role="alert">
                <i class="fas ${iconClass} me-2"></i>
                ${message}
                <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
            </div>
        `;
        
        this.alertContainer.innerHTML = alertHtml;
        
        if (autoHide && type === 'success') {
            setTimeout(() => {
                const alert = this.alertContainer.querySelector('.alert');
                if (alert) {
                    alert.remove();
                }
            }, 5000);
        }
        
        // Scroll vers le haut pour voir l'alerte
        this.alertContainer.scrollIntoView({ behavior: 'smooth' });
    }
    
    updateStatus(status) {
        const statusConfig = {
            pending: { text: 'En attente', class: 'status-pending' },
            scanning: { text: 'Scan en cours', class: 'status-pending' },
            loading: { text: 'Chargement', class: 'status-pending' },
            ready: { text: 'Prêt', class: 'status-pending' },
            recording: { text: 'Enregistrement', class: 'status-recording' },
            processing: { text: 'Traitement', class: 'status-pending' },
            uploading: { text: 'Upload en cours', class: 'status-pending' },
            uploaded: { text: 'Terminé', class: 'status-uploaded' }
        };
        
        const config = statusConfig[status] || statusConfig.pending;
        this.statusBadge.textContent = config.text;
        this.statusBadge.className = `status-badge ${config.class}`;
    }
    
    showSection(sectionElement) {
        // Masquer toutes les sections
        [this.qrScannerSection, this.loadingSection, this.submissionInfoSection, 
         this.videoSection, this.successSection].forEach(section => {
            section.classList.add('hidden');
        });
        
        // Afficher la section demandée
        sectionElement.classList.remove('hidden');
    }
    
    async startQRScanner() {
        try {
            this.updateStatus('scanning');
            this.showAlert('Démarrage du scanner QR...', 'info', true);
            
            if (!this.qrScanner) {
                this.qrScanner = new Html5Qrcode("qr-reader");
            }
            
            const config = {
                fps: 10,
                qrbox: { width: 250, height: 250 },
                aspectRatio: 1.0
            };
            
            await this.qrScanner.start(
                { facingMode: "environment" }, // Caméra arrière
                config,
                (decodedText) => this.handleQRCodeScanned(decodedText),
                (error) => {
                    // Erreur silencieuse pour les tentatives de scan
                    console.debug('[QR Scanner] Tentative:', error);
                }
            );
            
            this.isScannerActive = true;
            this.startScanBtn.classList.add('hidden');
            this.stopScanBtn.classList.remove('hidden');
            
            this.showAlert('Scanner QR actif - Positionnez le QR code devant la caméra', 'info', true);
            
        } catch (error) {
            console.error('[QR Scanner] Erreur démarrage:', error);
            this.showAlert('Erreur: Impossible d\'accéder à la caméra. Vérifiez les permissions.', 'error', false);
            this.updateStatus('pending');
        }
    }
    
    async stopQRScanner() {
        try {
            if (this.qrScanner && this.isScannerActive) {
                await this.qrScanner.stop();
                this.isScannerActive = false;
                this.startScanBtn.classList.remove('hidden');
                this.stopScanBtn.classList.add('hidden');
                this.updateStatus('pending');
                this.showAlert('Scanner QR arrêté', 'info', true);
            }
        } catch (error) {
            console.error('[QR Scanner] Erreur arrêt:', error);
        }
    }
    
    async handleQRCodeScanned(decodedText) {
        console.log('[QR Scanner] QR code scanné:', decodedText);
        
        try {
            // Arrêter le scanner
            await this.stopQRScanner();
            
            // Extraire l'ID de soumission depuis l'URL ou les données JSON
            let submissionId = null;
            
            if (decodedText.includes('submission_id')) {
                // Format JSON du QR code
                try {
                    const qrData = JSON.parse(decodedText);
                    submissionId = qrData.submission_id;
                } catch {
                    // Si ce n'est pas du JSON, chercher dans l'URL
                    const urlMatch = decodedText.match(/id=([^&]+)/);
                    submissionId = urlMatch ? urlMatch[1] : null;
                }
            } else if (decodedText.includes('video-record')) {
                // Format URL directe
                const urlMatch = decodedText.match(/id=([^&]+)/);
                submissionId = urlMatch ? urlMatch[1] : null;
            } else if (decodedText.startsWith('PSA')) {
                // ID direct
                submissionId = decodedText;
            }
            
            if (submissionId) {
                this.showAlert(`QR code scanné: ${submissionId}`, 'success', true);
                await this.loadSubmissionInfo(submissionId);
            } else {
                this.showAlert('QR code invalide: Impossible d\'extraire l\'ID de soumission', 'error', false);
                this.updateStatus('pending');
            }
            
        } catch (error) {
            console.error('[QR Scanner] Erreur traitement QR:', error);
            this.showAlert('Erreur lors du traitement du QR code', 'error', false);
            this.updateStatus('pending');
        }
    }
    
    async loadManualSubmission() {
        const submissionId = this.manualSubmissionId.value.trim();
        
        if (!submissionId) {
            this.showAlert('Veuillez entrer un ID de soumission', 'warning', false);
            return;
        }
        
        console.log('[Manual Load] Chargement manuel:', submissionId);
        await this.loadSubmissionInfo(submissionId);
    }
    
    async loadSubmissionInfo(submissionId) {
        try {
            this.currentSubmissionId = submissionId;
            this.updateStatus('loading');
            this.showSection(this.loadingSection);
            
            console.log('[Submission] Chargement infos pour:', submissionId);
            
            // Requête API pour récupérer les infos de la soumission
            const response = await fetch(`/api/public/submission/${submissionId}`);
            
            if (!response.ok) {
                throw new Error(`Soumission non trouvée: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.message || 'Erreur lors du chargement');
            }
            
            this.submissionData = data.submission;
            
            // Afficher les informations de la soumission
            this.displaySubmissionInfo();
            
            // Charger le QR code de la commande
            await this.loadQRCode();
            
            // Vérifier si une vidéo existe déjà
            await this.checkExistingVideo();
            
            // Initialiser la caméra
            await this.initializeCamera();
            
            this.showSection(this.submissionInfoSection);
            this.updateStatus('ready');
            
            // Cacher l'interface QR scanner après chargement automatique réussi
            console.log('[PSA Video] 🎯 Tentative de masquage QR scanner...');
            console.log('[PSA Video] qrScannerSection existe:', !!this.qrScannerSection);
            
            if (this.qrScannerSection) {
                this.qrScannerSection.style.display = 'none';
                console.log('[PSA Video] ✅ QR scanner interface cachée avec succès');
            } else {
                console.log('[PSA Video] ❌ qrScannerSection non trouvé - impossible de cacher');
                // Essayer de trouver l'élément directement
                const qrSection = document.getElementById('qrScannerSection');
                if (qrSection) {
                    qrSection.style.display = 'none';
                    console.log('[PSA Video] ✅ QR scanner caché via getElementById');
                } else {
                    console.log('[PSA Video] ❌ Impossible de trouver #qrScannerSection');
                }
            }
            
            this.showAlert('Commande chargée avec succès - Vous pouvez maintenant enregistrer la vidéo', 'success', true);
            
        } catch (error) {
            console.error('[Submission] Erreur chargement:', error);
            this.showAlert(`Erreur: ${error.message}`, 'error', false);
            this.updateStatus('pending');
            this.showSection(this.qrScannerSection);
        }
    }
    
    displaySubmissionInfo() {
        const submission = this.submissionData;
        
        const html = `
            <div class="row">
                <div class="col-md-6">
                    <h5><i class="fas fa-user me-2"></i>Client</h5>
                    <p><strong>Email:</strong> ${submission.customer_email}</p>
                    <p><strong>Type:</strong> ${submission.grading_type}</p>
                    <p><strong>Source:</strong> ${submission.card_source}</p>
                </div>
                <div class="col-md-6">
                    <h5><i class="fas fa-credit-card me-2"></i>Carte</h5>
                    <p><strong>Nom:</strong> ${submission.card_name}</p>
                    ${submission.card_series ? `<p><strong>Série:</strong> ${submission.card_series}</p>` : ''}
                    ${submission.card_year ? `<p><strong>Année:</strong> ${submission.card_year}</p>` : ''}
                </div>
            </div>
            <div class="row mt-3">
                <div class="col-md-12">
                    <h5><i class="fas fa-info-circle me-2"></i>Soumission</h5>
                    <p><strong>ID:</strong> <code>${submission.submission_id}</code></p>
                    <p><strong>Statut:</strong> <span class="badge bg-primary">${submission.status}</span></p>
                    <p><strong>Créée:</strong> ${new Date(submission.created_at).toLocaleDateString('fr-FR')}</p>
                    ${submission.comments ? `<p><strong>Commentaires:</strong> ${submission.comments}</p>` : ''}
                </div>
            </div>
        `;
        
        this.submissionDetails.innerHTML = html;
    }
    
    async loadQRCode() {
        try {
            console.log('[QR Code] Chargement QR code pour:', this.currentSubmissionId);
            
            // Afficher le loader
            this.qrLoader.classList.remove('hidden');
            this.qrCodeImage.classList.add('hidden');
            
            // Charger l'image QR depuis l'API publique
            const qrImageUrl = `/api/public/qr/${this.currentSubmissionId}`;
            
            // Créer une nouvelle image et vérifier qu'elle se charge
            const img = new Image();
            
            return new Promise((resolve, reject) => {
                img.onload = () => {
                    console.log('[QR Code] ✅ QR code chargé avec succès');
                    
                    // Configurer et afficher l'image
                    this.qrCodeImage.src = qrImageUrl;
                    this.qrCodeImage.classList.remove('hidden');
                    this.qrLoader.classList.add('hidden');
                    
                    resolve();
                };
                
                img.onerror = () => {
                    console.warn('[QR Code] ⚠️ QR code non trouvé, tentative de génération...');
                    this.handleMissingQRCode().then(resolve).catch(reject);
                };
                
                img.src = qrImageUrl;
                
                // Timeout de 5 secondes
                setTimeout(() => {
                    if (this.qrCodeImage.classList.contains('hidden')) {
                        console.warn('[QR Code] ⏰ Timeout chargement QR code');
                        this.handleMissingQRCode().then(resolve).catch(reject);
                    }
                }, 5000);
            });
            
        } catch (error) {
            console.error('[QR Code] ❌ Erreur chargement QR code:', error);
            this.qrLoader.classList.add('hidden');
            this.showQRCodeError('Erreur de chargement du QR code');
        }
    }
    
    async handleMissingQRCode() {
        try {
            console.log('[QR Code] Tentative de génération du QR code manquant...');
            
            // Afficher un message explicatif
            this.qrCodeImage.style.display = 'none';
            this.qrCodeDisplay.innerHTML = `
                <div class="text-warning">
                    <i class="fas fa-exclamation-triangle me-2"></i>
                    QR code en cours de génération...
                </div>
            `;
            
            // Générer le QR code via l'API admin (nécessite auth)
            // Pour l'instant, afficher un message d'information
            this.qrCodeDisplay.innerHTML = `
                <div class="text-info">
                    <i class="fas fa-info-circle me-2"></i>
                    QR code non disponible pour cette commande.<br>
                    <small>Contactez l'administrateur pour générer le QR code.</small>
                </div>
            `;
            
            this.qrLoader.classList.add('hidden');
            
        } catch (error) {
            console.error('[QR Code] ❌ Erreur génération QR code:', error);
            this.showQRCodeError('Impossible de générer le QR code');
        }
    }
    
    showQRCodeError(message) {
        this.qrLoader.classList.add('hidden');
        this.qrCodeImage.classList.add('hidden');
        this.qrCodeDisplay.innerHTML = `
            <div class="text-danger">
                <i class="fas fa-exclamation-circle me-2"></i>
                ${message}
            </div>
        `;
    }
    
    async checkExistingVideo() {
        try {
            const response = await fetch(`/api/video/${this.currentSubmissionId}`);
            
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.video) {
                    this.showAlert(`⚠️ Une vidéo existe déjà pour cette commande (${(data.video.file_size / 1024 / 1024).toFixed(1)}MB, ${data.video.duration}s). Elle sera remplacée si vous enregistrez une nouvelle vidéo.`, 'warning', false);
                }
            }
        } catch (error) {
            console.log('[Video Check] Aucune vidéo existante trouvée');
        }
    }
    
    async initializeCamera() {
        try {
            // Libérer le stream existant
            if (this.videoStream) {
                this.videoStream.getTracks().forEach(track => track.stop());
            }
            
            // Configuration de la caméra
            const constraints = {
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 30 }
                },
                audio: true
            };
            
            this.videoStream = await navigator.mediaDevices.getUserMedia(constraints);
            this.videoPreview.srcObject = this.videoStream;
            
            console.log('[Camera] Caméra initialisée avec succès');
            
            // Afficher la section vidéo
            this.videoSection.classList.remove('hidden');
            
        } catch (error) {
            console.error('[Camera] Erreur initialisation caméra:', error);
            this.showAlert('Erreur: Impossible d\'accéder à la caméra. Vérifiez les permissions.', 'error', false);
            throw error;
        }
    }
    
    async startRecording() {
        try {
            if (!this.videoStream) {
                throw new Error('Stream vidéo non disponible');
            }
            
            this.recordedChunks = [];
            this.recordingStartTime = Date.now();
            
            // Configuration MediaRecorder
            const options = {
                mimeType: 'video/webm;codecs=vp8,opus'
            };
            
            // Fallback si WebM non supporté
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                options.mimeType = 'video/webm';
                if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                    options.mimeType = 'video/mp4';
                }
            }
            
            this.mediaRecorder = new MediaRecorder(this.videoStream, options);
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    this.recordedChunks.push(event.data);
                }
            };
            
            this.mediaRecorder.onstop = () => {
                console.log('[Recording] Enregistrement arrêté');
                this.uploadBtn.classList.remove('hidden');
            };
            
            this.mediaRecorder.start(1000); // Chunk toutes les 1 secondes
            
            // UI Updates
            this.updateStatus('recording');
            this.recordingOverlay.classList.add('active');
            this.startRecordBtn.classList.add('hidden');
            this.stopRecordBtn.classList.remove('hidden');
            
            // Démarrer le timer
            this.startRecordingTimer();
            
            this.showAlert('🔴 Enregistrement démarré - Maximum 2 minutes', 'info', true);
            
            console.log('[Recording] Enregistrement démarré avec:', options.mimeType);
            
        } catch (error) {
            console.error('[Recording] Erreur démarrage:', error);
            this.showAlert(`Erreur: ${error.message}`, 'error', false);
            this.updateStatus('ready');
        }
    }
    
    startRecordingTimer() {
        const updateTimer = () => {
            if (this.recordingStartTime) {
                const elapsed = Math.floor((Date.now() - this.recordingStartTime) / 1000);
                const minutes = Math.floor(elapsed / 60);
                const seconds = elapsed % 60;
                const totalMinutes = Math.floor(this.maxRecordingTime / 60);
                const totalSeconds = this.maxRecordingTime % 60;
                
                const elapsedStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                const totalStr = `${totalMinutes.toString().padStart(2, '0')}:${totalSeconds.toString().padStart(2, '0')}`;
                
                this.timerDisplay.textContent = `${elapsedStr} / ${totalStr}`;
                
                // Arrêt automatique après 2 minutes
                if (elapsed >= this.maxRecordingTime) {
                    this.stopRecording();
                    this.showAlert('⏰ Enregistrement arrêté automatiquement (2 minutes maximum)', 'warning', false);
                }
            }
        };
        
        this.recordingTimer = setInterval(updateTimer, 1000);
        updateTimer(); // Mise à jour immédiate
    }
    
    stopRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
        }
        
        // Clear timer
        if (this.recordingTimer) {
            clearInterval(this.recordingTimer);
            this.recordingTimer = null;
        }
        
        // UI Updates
        this.updateStatus('processing');
        this.recordingOverlay.classList.remove('active');
        this.stopRecordBtn.classList.add('hidden');
        this.startRecordBtn.classList.remove('hidden');
        
        const elapsed = this.recordingStartTime ? Math.floor((Date.now() - this.recordingStartTime) / 1000) : 0;
        this.showAlert(`✅ Enregistrement terminé (${elapsed}s) - Vous pouvez maintenant uploader la vidéo`, 'success', true);
        
        console.log('[Recording] Enregistrement terminé, chunks:', this.recordedChunks.length);
    }
    
    async uploadVideo() {
        try {
            if (this.recordedChunks.length === 0) {
                throw new Error('Aucun enregistrement trouvé');
            }
            
            this.updateStatus('uploading');
            this.uploadBtn.classList.add('hidden');
            this.progressContainer.style.display = 'block';
            
            // Créer le blob vidéo
            const videoBlob = new Blob(this.recordedChunks, { type: 'video/webm' });
            const videoDuration = this.recordingStartTime ? Math.floor((Date.now() - this.recordingStartTime) / 1000) : null;
            
            console.log('[Upload] Création du blob:', {
                size: videoBlob.size,
                type: videoBlob.type,
                duration: videoDuration
            });
            
            // Validation côté client
            if (videoBlob.size > 50 * 1024 * 1024) {
                throw new Error('Fichier trop volumineux (maximum 50MB)');
            }
            
            // Préparer FormData
            const formData = new FormData();
            formData.append('video', videoBlob, `${this.currentSubmissionId}.webm`);
            formData.append('duration', videoDuration);
            formData.append('startTime', new Date(this.recordingStartTime).toISOString());
            
            // Upload avec progression
            const response = await this.uploadWithProgress(formData, `/api/video/upload/${this.currentSubmissionId}`);
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Erreur upload');
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.message);
            }
            
            console.log('[Upload] Upload réussi:', result);
            
            this.updateStatus('uploaded');
            this.showSection(this.successSection);
            
            this.showAlert(`🎉 Vidéo uploadée avec succès! (${(videoBlob.size / 1024 / 1024).toFixed(1)}MB)`, 'success', false);
            
        } catch (error) {
            console.error('[Upload] Erreur:', error);
            this.showAlert(`Erreur upload: ${error.message}`, 'error', false);
            this.updateStatus('ready');
            this.uploadBtn.classList.remove('hidden');
            this.progressContainer.style.display = 'none';
        }
    }
    
    uploadWithProgress(formData, url) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const percentComplete = Math.round((e.loaded / e.total) * 100);
                    this.uploadProgress.style.width = percentComplete + '%';
                    this.uploadProgress.textContent = percentComplete + '%';
                    
                    console.log('[Upload Progress]', percentComplete + '%');
                }
            });
            
            xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve({
                        ok: true,
                        json: () => Promise.resolve(JSON.parse(xhr.responseText))
                    });
                } else {
                    resolve({
                        ok: false,
                        json: () => Promise.resolve(JSON.parse(xhr.responseText))
                    });
                }
            });
            
            xhr.addEventListener('error', () => {
                reject(new Error('Erreur réseau lors de l\'upload'));
            });
            
            xhr.open('POST', url);
            xhr.send(formData);
        });
    }
    
    resetInterface() {
        // Nettoyer les streams
        if (this.videoStream) {
            this.videoStream.getTracks().forEach(track => track.stop());
            this.videoStream = null;
        }
        
        // Arrêter le scanner QR si actif
        if (this.isScannerActive) {
            this.stopQRScanner();
        }
        
        // Reset des timers
        if (this.recordingTimer) {
            clearInterval(this.recordingTimer);
            this.recordingTimer = null;
        }
        
        // Reset des données
        this.currentSubmissionId = null;
        this.submissionData = null;
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.recordingStartTime = null;
        
        // Reset UI
        this.manualSubmissionId.value = '';
        this.alertContainer.innerHTML = '';
        this.progressContainer.style.display = 'none';
        this.uploadProgress.style.width = '0%';
        this.uploadProgress.textContent = '0%';
        this.timerDisplay.textContent = '00:00 / 02:00';
        
        // Reset boutons
        this.startRecordBtn.classList.remove('hidden');
        this.stopRecordBtn.classList.add('hidden');
        this.uploadBtn.classList.add('hidden');
        this.startScanBtn.classList.remove('hidden');
        this.stopScanBtn.classList.add('hidden');
        this.recordingOverlay.classList.remove('active');
        
        // Retour à l'interface de scan
        this.updateStatus('pending');
        this.showSection(this.qrScannerSection);
        
        console.log('[Reset] Interface réinitialisée');
    }
    
    // Méthodes publiques pour l'accès externe
    loadSubmissionInfo(submissionId) {
        return this.loadSubmissionInfo(submissionId);
    }
}

// Auto-initialisation singleton pour éviter les duplications
if (!window.__PSA_VIDEO_INIT__) {
    window.__PSA_VIDEO_INIT__ = true;
    
    // Initialisation automatique au chargement DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPSAVideo);
    } else {
        initPSAVideo(); // DOM déjà chargé
    }
}

function initPSAVideo() {
    try {
        console.log('[PSA Video] 🚀 Auto-initialisation PSAVideoRecorder...');
        window.psaVideoRecorder = new PSAVideoRecorder();
        console.log('[PSA Video] ✅ PSAVideoRecorder instantiated');
    } catch (error) {
        console.error('[PSA Video] ❌ Init error:', error);
    }
}

console.log('[PSA Video] VideoRecorder singleton ready');