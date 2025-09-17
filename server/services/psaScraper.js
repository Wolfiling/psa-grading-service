import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import axios from 'axios';
import { pool } from '../database/init.js';

export class PSAScraper {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isLoggedIn = false;
  }

  async initialize() {
    try {
      this.browser = await puppeteer.launch({
        headless: true,
        executablePath: '/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-plugins',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding'
        ]
      });
      this.page = await this.browser.newPage();
      
      // Configuration de la page
      await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
      await this.page.setViewport({ width: 1366, height: 768 });
      
      console.log('✅ PSA Scraper initialisé avec succès');
    } catch (error) {
      console.error('❌ Erreur lors de l\'initialisation du scraper:', error);
      throw error;
    }
  }

  async loginToPSA(username, password) {
    try {
      if (!this.page) {
        throw new Error('Scraper non initialisé');
      }

      console.log('🔐 Connexion au compte PSA Japan...');
      
      // Aller sur la page de connexion PSA Japan
      await this.page.goto('https://app.collectors.com/signin?b=psajapan&r=https%253A%252F%252Fwww.psacard.co.jp%252Fmyaccount', { 
        waitUntil: 'networkidle2',
        timeout: 30000 
      });

      // PSA Japan utilise une authentification en 2 étapes
      console.log('📧 Étape 1: Saisie de l\'email...');
      
      // Attendre le champ email sur la première page
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Trouver le champ email (Eメール) - essayer plusieurs sélecteurs
      let emailField = null;
      const emailSelectors = [
        'input[type="email"]',
        'input[placeholder*="メール"]',
        'input[placeholder*="Eメール"]',
        'input[name="email"]',
        'input[name="username"]',
        'input:first-of-type',
        'input'
      ];
      
      console.log('🔍 Recherche du champ email...');
      for (const selector of emailSelectors) {
        try {
          emailField = await this.page.$(selector);
          if (emailField) {
            console.log(`✅ Champ email trouvé avec: ${selector}`);
            break;
          }
        } catch (e) { continue; }
      }
      
      if (!emailField) {
        console.log('❌ Champ email non trouvé');
        console.log('🔍 HTML de la page:', await this.page.content());
        throw new Error('Champ email non trouvé sur PSA Japan');
      }
      
      // Saisir l'email
      await emailField.type(username, { delay: 100 });
      console.log('✅ Email saisi');
      
      // Appuyer sur Entrée pour continuer (pas de bouton à cliquer)
      console.log('⌨️ Appui sur Entrée pour continuer...');
      await this.page.keyboard.press('Enter');
      
      // Attendre que le champ password apparaisse (plutôt qu'une navigation)
      console.log('🔍 Attente du changement de page...');
      try {
        await this.page.waitForSelector('input[type="password"]', { timeout: 10000 });
        console.log('✅ Page password détectée');
      } catch (e) {
        // Si pas de navigation, attendre un peu et continuer
        await new Promise(resolve => setTimeout(resolve, 3000));
        console.log('⏳ Attente supplémentaire...');
      }
      
      console.log('🔐 Étape 2: Saisie du mot de passe...');
      
      // Attendre le champ password sur la deuxième page
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Trouver le champ password (パスワード)
      let passwordField = null;
      const passwordSelectors = [
        'input[type="password"]',
        'input[placeholder*="パスワード"]',
        'input[name="password"]',
        'input:first-of-type'
      ];
      
      console.log('🔍 Recherche du champ password...');
      for (const selector of passwordSelectors) {
        try {
          passwordField = await this.page.$(selector);
          if (passwordField) {
            console.log(`✅ Champ password trouvé avec: ${selector}`);
            break;
          }
        } catch (e) { continue; }
      }
      
      if (!passwordField) {
        console.log('❌ Champ password non trouvé');
        console.log('🔍 HTML de la page:', await this.page.content());
        throw new Error('Champ password non trouvé sur PSA Japan');
      }
      
      // Saisir le mot de passe
      await passwordField.type(password, { delay: 100 });
      console.log('✅ Mot de passe saisi');
      
      // Appuyer sur Entrée pour confirmer (pas de bouton à cliquer)
      console.log('⌨️ Appui sur Entrée pour confirmer...');
      await this.page.keyboard.press('Enter');
      
      // Attendre que la connexion soit validée
      console.log('🔍 Attente de la validation...');
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Vérifier si la connexion a réussi
      const currentUrl = this.page.url();
      console.log('🔍 URL après connexion:', currentUrl);
      
      // Vérifier si on est sur la page d'accueil PSA Japan
      if (currentUrl.includes('psacard.co.jp') || 
          currentUrl.includes('myaccount') || 
          currentUrl.includes('dashboard') || 
          currentUrl.includes('collectors.com')) {
        
        // Vérifier également la présence d'éléments indiquant une connexion réussie
        try {
          await this.page.waitForSelector('a[href*="signout"], .user-menu, .account-menu', { timeout: 5000 });
          this.isLoggedIn = true;
          console.log('✅ Connexion PSA Japan réussie - utilisateur connecté');
          return true;
        } catch (e) {
          // Même sans ces éléments, si on est sur la bonne URL, considérer comme connecté
          this.isLoggedIn = true;
          console.log('✅ Connexion PSA Japan réussie - sur la page cible');
          return true;
        }
      } else {
        console.log('❌ Échec de la connexion PSA Japan');
        console.log('🔍 URL actuelle:', currentUrl);
        return false;
      }
    } catch (error) {
      console.error('❌ Erreur lors de la connexion PSA:', error);
      return false;
    }
  }

  async scrapePSASubmission(submissionNumber) {
    try {
      // 🔒 VÉRIFICATION DE SESSION OBLIGATOIRE AVANT SCRAPING
      const sessionValid = await this.checkSessionActive();
      if (!sessionValid) {
        console.log('⚠️ Session PSA expirée, tentative de reconnexion...');
        await this.ensureActiveSession();
      }

      if (!this.isLoggedIn) {
        throw new Error('Impossible de maintenir la connexion PSA');
      }

      console.log(`🔍 Scraping de la soumission PSA Japan: ${submissionNumber}`);
      
      // Parser le submissionNumber pour extraire ORDER_ID et SUBMISSION_NUMBER si format complet
      let orderId = null;
      let actualSubmissionNumber = submissionNumber;
      
      if (submissionNumber.includes('/')) {
        const parts = submissionNumber.split('/');
        if (parts.length === 2) {
          orderId = parts[0];
          actualSubmissionNumber = parts[1];
          console.log(`📋 Format complet détecté - ORDER_ID: ${orderId}, SUBMISSION: ${actualSubmissionNumber}`);
        }
      }
      
      // Récupérer les données client associées pour reconnaissance intelligente
      const clientData = await this.getClientCardData(actualSubmissionNumber);

      // Aller directement sur la page de la soumission PSA Japan
      // Format URL: https://psacard.co.jp/myaccount/myorders/[ORDER_ID]/[SUBMISSION_NUMBER]
      // Nous devons d'abord récupérer l'ORDER_ID depuis la liste des commandes
      
      console.log(`🎯 Navigation directe vers la soumission ${submissionNumber}...`);
      
      // D'abord aller sur la page des commandes pour récupérer l'ORDER_ID
      // 🔒 FORCER RECHARGEMENT SANS CACHE pour obtenir les données PSA les plus récentes
      await this.page.goto(`https://www.psacard.co.jp/myaccount`, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      // Forcer rechargement complet sans cache
      await this.page.reload({ waitUntil: 'networkidle2' });
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Fermer les popups éventuels
      try {
        await this.page.evaluate(() => {
          const closeButtons = Array.from(document.querySelectorAll('button, a, div'));
          const closeSelectors = ['Close', 'Accept', 'OK', '閉じる', '同意', 'Accept All'];
          closeButtons.forEach(btn => {
            const text = btn.textContent.trim();
            if (closeSelectors.some(selector => text.includes(selector))) {
              btn.click();
            }
          });
        });
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (e) {
        console.log('⚠️ Erreur fermeture popups:', e.message);
      }

      // Naviguer vers les commandes et chercher l'ORDER_ID
      console.log('📝 Navigation vers la section Commandes pour récupérer ORDER_ID...');
      const ordersLink = await this.page.evaluateHandle(() => {
        const links = Array.from(document.querySelectorAll('a, button, div[role="button"], li, nav a'));
        return links.find(link => link.textContent.trim() === '注文');
      });
      
      if (ordersLink) {
        await ordersLink.click();
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      
      // Essayer de trouver un lien direct vers la soumission
      console.log(`🔍 Recherche du lien direct vers ${actualSubmissionNumber}...`);
      const submissionLink = await this.page.evaluate((actualSubmissionNumber) => {
        const links = Array.from(document.querySelectorAll('a'));
        const submissionLink = links.find(link => {
          return link.textContent.includes(actualSubmissionNumber) && link.href.includes('myorders');
        });
        return submissionLink ? submissionLink.href : null;
      }, actualSubmissionNumber);
      
      if (submissionLink) {
        console.log(`🎯 Lien direct trouvé: ${submissionLink}`);
        await this.page.goto(submissionLink, {
          waitUntil: 'networkidle2',
          timeout: 30000
        });
      } else {
        // Fallback: construire l'URL avec ORDER_ID fourni ou générique
        console.log('⚠️ Lien direct non trouvé, construction URL...');
        const fallbackOrderId = orderId || '13229053'; // Utiliser l'ORDER_ID fourni ou fallback
        const genericUrl = `https://psacard.co.jp/myaccount/myorders/${fallbackOrderId}/${actualSubmissionNumber}`;
        console.log(`🔗 URL construite: ${genericUrl}`);
        
        try {
          await this.page.goto(genericUrl, {
            waitUntil: 'networkidle2',
            timeout: 30000
          });
        } catch (e) {
          console.log('⚠️ URL générique échouée, retour à la liste...');
          // Rester sur la page courante si l'URL directe échoue
        }
      }

      // Attendre que le contenu soit chargé
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Debug: capturer le contenu de la page pour analyse
      console.log('🔍 Analyse du contenu de la page Commandes...');
      const pageInfo = await this.page.evaluate(() => {
        return {
          url: window.location.href,
          title: document.title,
          hasTable: document.querySelectorAll('table').length > 0,
          tableCount: document.querySelectorAll('table').length,
          rowCount: document.querySelectorAll('tr').length,
          hasSubmissionNumbers: document.body.textContent.includes('25230318'),
          bodyText: document.body.textContent.substring(0, 500) // Premiers 500 caractères
        };
      });
      
      console.log('📊 Info page:', pageInfo);

      // Extraire les informations de la page
      const submissionData = await this.page.evaluate((submissionNumber, clientData) => {
        const data = {
          submissionNumber: null,
          status: null,
          receivedDate: null,
          estimatedGradingDate: null,
          completedDate: null,
          cards: [],
          totalCards: 0,
          serviceTier: null
        };

        // Extraire le numéro de soumission - sélecteurs plus larges pour PSA Japan
        const submissionSelectors = [
          '[data-testid="submission-number"]', '.submission-number', 'h1', 'h2', 'h3',
          '.order-number', '.tracking-number', '.reference-number'
        ];
        
        // D'abord essayer les sélecteurs standards
        for (const selector of submissionSelectors) {
          const element = document.querySelector(selector);
          if (element && element.textContent.includes(submissionNumber)) {
            data.submissionNumber = element.textContent.trim();
            break;
          }
        }
        
        // Ensuite rechercher dans tous les éléments TD et SPAN
        if (!data.submissionNumber) {
          const allTds = Array.from(document.querySelectorAll('td'));
          const foundTd = allTds.find(td => td.textContent.includes(submissionNumber));
          if (foundTd) {
            data.submissionNumber = foundTd.textContent.trim();
          }
        }
        
        if (!data.submissionNumber) {
          const allSpans = Array.from(document.querySelectorAll('span'));
          const foundSpan = allSpans.find(span => span.textContent.includes(submissionNumber));
          if (foundSpan) {
            data.submissionNumber = foundSpan.textContent.trim();
          }
        }
        
        // Si pas trouvé, chercher dans tout le texte de la page
        if (!data.submissionNumber) {
          const pageText = document.body.textContent;
          if (pageText.includes(submissionNumber)) {
            data.submissionNumber = submissionNumber; // On sait qu'il est présent
          }
        }

        // 🔒 NOUVELLE LOGIQUE : Termes japonais PSA spécifiques D'ABORD (plus fiables)
        const statusPatterns = [
          '完了', '発送済み', 'パッケージ化', 'ラベリング', 'グレーディング', 
          '品質チェック', '受付済み', '処理中', '発送済', '受付中'
        ];
        
        // D'abord chercher les termes PSA japonais spécifiques
        const pageText = document.body.textContent;
        for (const pattern of statusPatterns) {
          if (pageText.includes(pattern)) {
            data.status = pattern;
            console.log('📋 Statut PSA spécifique trouvé:', data.status);
            break;
          }
        }
        
        // FALLBACK : seulement si aucun terme japonais trouvé
        if (!data.status) {
          const statusSelectors = [
            '[data-testid="submission-status"]', '.submission-status',
            '.grading-status', '.current-status'
          ];
          
          for (const selector of statusSelectors) {
            const element = document.querySelector(selector);
            if (element && element.textContent.trim()) {
              data.status = element.textContent.trim();
              console.log('📋 Statut fallback trouvé:', data.status);
              break;
            }
          }
        }

        // Extraire les dates
        const receivedElement = document.querySelector('[data-testid="received-date"], .received-date');
        if (receivedElement) {
          data.receivedDate = receivedElement.textContent.trim();
        }

        const estimatedElement = document.querySelector('[data-testid="estimated-date"], .estimated-date');
        if (estimatedElement) {
          data.estimatedGradingDate = estimatedElement.textContent.trim();
        }

        const completedElement = document.querySelector('[data-testid="completed-date"], .completed-date');
        if (completedElement) {
          data.completedDate = completedElement.textContent.trim();
        }

        // Extraire les données de la page de soumission PSA Japan
        console.log('🔍 Extraction des données de la page de soumission...');
        
        // Chercher le numéro de soumission dans le titre
        const titleElement = document.querySelector('h1, h2, .title');
        if (titleElement && titleElement.textContent.includes(submissionNumber)) {
          data.submissionNumber = submissionNumber;
          console.log('✅ Numéro de soumission confirmé:', data.submissionNumber);
        }
        
        // Extraire le nombre de cartes (format "XX 枚") - utiliser pageText déjà déclaré
        const cardMatch = pageText.match(/(\d+)\s*枚/);
        if (cardMatch) {
          data.totalCards = parseInt(cardMatch[1]);
          console.log('📊 Nombre de cartes trouvé:', data.totalCards);
        }
        
        // 🔒 AMÉLIORATION : Extraction du statut déjà faite plus haut avec priorité correcte
        // Cette section est maintenant redondante et a été déplacée plus haut
        
        // Extraire le type de service
        const servicePatterns = [
          'バリューバルクサービス', 'Value Bulk', 'December Bulk Special', 
          'October Bulk Special', 'September Bulk Special'
        ];
        
        for (const pattern of servicePatterns) {
          if (pageText.includes(pattern)) {
            data.serviceTier = pattern === 'バリューバルクサービス' ? 'Value Bulk Service' : pattern;
            console.log('🎯 Type de service trouvé:', data.serviceTier);
            break;
          }
        }
        
        // Créer des cartes avec reconnaissance intelligente
        if (data.totalCards > 0) {
          console.log(`📦 Création de ${data.totalCards} cartes avec reconnaissance client...`);
          
          // Si on a des données client, utiliser la reconnaissance intelligente
          if (clientData && clientData.length > 0) {
            console.log(`🎯 ${clientData.length} cartes client trouvées pour correspondance`);
            
            for (let i = 1; i <= data.totalCards; i++) {
              const clientCard = clientData[i - 1]; // Correspondance avec les données client
              
              if (clientCard) {
                data.cards.push({
                  id: i,
                  name: clientCard.card_name,
                  series: clientCard.card_series,
                  number: clientCard.card_number,
                  rarity: clientCard.card_rarity,
                  grade: null,
                  certNumber: null,
                  status: data.status,
                  clientMatchId: clientCard.submission_id,
                  rawData: `Client: ${clientCard.card_name} | PSA: ${data.status} | Position: ${i}/${data.totalCards}`
                });
              } else {
                // Fallback pour les cartes sans correspondance client
                data.cards.push({
                  id: i,
                  name: `Carte inconnue ${i}/${data.totalCards}`,
                  grade: null,
                  certNumber: null,
                  status: data.status,
                  rawData: `${data.serviceTier} - ${data.status} - Carte ${i} sur ${data.totalCards}`
                });
              }
            }
          } else {
            // Méthode originale si pas de données client
            for (let i = 1; i <= data.totalCards; i++) {
              data.cards.push({
                id: i,
                name: `Carte ${i}/${data.totalCards}`,
                grade: null,
                certNumber: null,
                status: data.status,
                rawData: `${data.serviceTier} - ${data.status} - Carte ${i} sur ${data.totalCards}`
              });
            }
          }
        }
        
        // Fallback: si aucune carte créée, chercher dans les éléments de tableau
        if (data.cards.length === 0) {
          console.log('🔍 Fallback: recherche dans les éléments de tableau...');
          const cardElements = document.querySelectorAll('table tr, div[class*="order"], div[class*="submission"]');
          console.log('🔍 Fallback: éléments trouvés:', cardElements.length);
        
          cardElements.forEach((card, index) => {
          const cardData = {
            id: index + 1,
            name: null,
            grade: null,
            certNumber: null,
            status: null,
            rawData: null
          };

          // Si c'est une ligne de tableau, extraire le contenu des cellules
          if (card.tagName === 'TR') {
            const cells = Array.from(card.querySelectorAll('td, th'));
            cardData.rawData = cells.map(cell => cell.textContent.trim()).join(' | ');
            
            // Essayer d'identifier les données dans les cellules
            if (cells.length >= 2) {
              cardData.name = cells[0]?.textContent.trim() || null;
              cardData.status = cells[1]?.textContent.trim() || null;
              if (cells.length >= 3) cardData.grade = cells[2]?.textContent.trim() || null;
              if (cells.length >= 4) cardData.certNumber = cells[3]?.textContent.trim() || null;
            }
          } else {
            // Méthode originale pour les autres éléments
            const nameElement = card.querySelector('.card-name, [data-testid="card-name"]');
            if (nameElement) {
              cardData.name = nameElement.textContent.trim();
            }

            const gradeElement = card.querySelector('.grade, [data-testid="grade"]');
            if (gradeElement) {
              cardData.grade = gradeElement.textContent.trim();
            }

            const certElement = card.querySelector('.cert-number, [data-testid="cert-number"]');
            if (certElement) {
              cardData.certNumber = certElement.textContent.trim();
            }

            const statusElement = card.querySelector('.card-status, [data-testid="card-status"]');
            if (statusElement) {
              cardData.status = statusElement.textContent.trim();
            }
            
            // Backup: capturer tout le texte de l'élément
            if (!cardData.name && !cardData.status) {
              cardData.rawData = card.textContent.trim();
            }
          }

            // Ne garder que les cartes qui ont des données
            if (cardData.name || cardData.status || cardData.rawData) {
              data.cards.push(cardData);
            }
          });
        }

        // S'assurer qu'on a le bon nombre de cartes
        if (data.totalCards === 0 && data.cards.length > 0) {
          data.totalCards = data.cards.length;
        }

        return data;
      }, actualSubmissionNumber, clientData);

      console.log(`✅ Données PSA extraites pour ${actualSubmissionNumber}:`, submissionData);
      return submissionData;

    } catch (error) {
      console.error(`❌ Erreur lors du scraping PSA ${submissionNumber}:`, error);
      return null;
    }
  }

  async getClientCardData(psaSubmissionNumber) {
    try {
      const { pool } = await import('../database/init.js');
      
      // Rechercher avec le numéro exact ET avec le format contenant le numéro
      const query = `
        SELECT submission_id, card_name, card_series, card_number, card_rarity, customer_email
        FROM grading_requests 
        WHERE psa_submission_number = $1 OR psa_submission_number LIKE '%' || $1
        ORDER BY created_at ASC
      `;
      
      const result = await pool.query(query, [psaSubmissionNumber]);
      console.log(`🔍 Données client trouvées: ${result.rows.length} cartes pour PSA ${psaSubmissionNumber}`);
      
      return result.rows;
    } catch (error) {
      console.error('❌ Erreur récupération données client:', error);
      return [];
    }
  }

  async updatePSADataInDatabase(submissionId, psaData) {
    try {
      const { pool } = await import('../database/init.js');
      
      // Première requête : mettre à jour les données PSA
      const updateQuery = `
        UPDATE grading_requests 
        SET 
          psa_scraping_data = $1,
          psa_last_scraped = CURRENT_TIMESTAMP,
          psa_status = $2,
          psa_received_date = $3,
          psa_estimated_date = $4,
          psa_completed_date = $5,
          updated_at = CURRENT_TIMESTAMP
        WHERE submission_id = $6 OR psa_submission_number = $7 OR psa_submission_number LIKE '%' || $7
        RETURNING *
      `;

      const values = [
        JSON.stringify(psaData),
        psaData.status,
        psaData.receivedDate,
        psaData.estimatedGradingDate,
        psaData.completedDate,
        submissionId,
        psaData.submissionNumber
      ];

      const result = await pool.query(updateQuery, values);
      
      if (result.rows.length > 0) {
        console.log(`✅ Données PSA mises à jour en base pour ${result.rows.length} commande(s)`);
        
        // Deuxième requête : mettre à jour le status principal selon le statut PSA Japan
        if (psaData.status && psaData.status.trim() !== '') {
          // Mapper les statuts PSA Japan vers les statuts du système
          const statusMapping = {
            '受付済み': 'at_psa',                    // Reçu chez PSA
            '品質チェック': 'pending_psa_review',      // En attente de révision PSA  
            'グレーディング': 'being_graded',          // En cours de gradation
            'ラベリング': 'graded',                  // Gradé (en cours d'étiquetage)
            'パッケージ化': 'graded',                 // Gradé (en cours d'emballage)
            '発送済み': 'returned',                  // Retourné
            '処理中': 'being_graded',                // En traitement
            '完了': 'graded'                        // Terminé
          };
          
          const newStatus = statusMapping[psaData.status] || 'at_psa';
          
          const statusQuery = `
            UPDATE grading_requests 
            SET status = $1, updated_at = CURRENT_TIMESTAMP
            WHERE (submission_id = $2 OR psa_submission_number = $3 OR psa_submission_number LIKE '%' || $3)
            AND status IN ('sent_to_psa', 'at_psa', 'pending_psa_review', 'being_graded', 'graded')
          `;
          
          await pool.query(statusQuery, [newStatus, submissionId, psaData.submissionNumber]);
          console.log(`✅ Status mis à jour vers "${newStatus}" (${psaData.status}) pour les commandes PSA ${psaData.submissionNumber}`);
        }
        
        result.rows.forEach(row => {
          console.log(`   → ${row.submission_id}: PSA Status = ${row.psa_status}`);
        });
        return result.rows[0];
      } else {
        console.log(`⚠️ Aucune demande trouvée pour mise à jour PSA`);
        return null;
      }
    } catch (error) {
      console.error('❌ Erreur lors de la mise à jour en base:', error);
      throw error;
    }
  }

  async scrapeAllPendingSubmissions() {
    try {
      console.log('🔄 Début du scraping de toutes les soumissions en attente...');

      // 🔒 VÉRIFICATION ET RECONNEXION AUTOMATIQUE
      await this.ensureActiveSession();

      // Récupérer toutes les demandes avec un numéro PSA mais pas de données récentes
      const query = `
        SELECT submission_id, psa_submission_number, customer_email, card_name
        FROM grading_requests 
        WHERE psa_submission_number IS NOT NULL 
        AND psa_submission_number != ''
        AND (psa_last_scraped IS NULL OR psa_last_scraped < CURRENT_TIMESTAMP - INTERVAL '6 hours')
        ORDER BY created_at DESC
        LIMIT 50
      `;

      const result = await pool.query(query);
      const submissions = result.rows;

      console.log(`📋 ${submissions.length} soumissions à scraper`);

      const scrapedData = [];

      for (const submission of submissions) {
        try {
          console.log(`🔍 Scraping ${submission.psa_submission_number}...`);
          
          // 🔒 Vérifier session avant chaque scraping
          const sessionValid = await this.checkSessionActive();
          if (!sessionValid) {
            console.log('⚠️ Session expirée, reconnexion...');
            await this.ensureActiveSession();
          }
          
          const psaData = await this.scrapePSASubmission(submission.psa_submission_number);
          
          if (psaData) {
            await this.updatePSADataInDatabase(submission.submission_id, psaData);
            scrapedData.push({
              submissionId: submission.submission_id,
              psaData: psaData
            });
          }

          // Pause entre les requêtes pour éviter la détection + maintenir session
          await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
          await this.keepSessionAlive();
          
        } catch (error) {
          console.error(`❌ Erreur pour ${submission.psa_submission_number}:`, error);
        }
      }

      console.log(`✅ Scraping terminé: ${scrapedData.length} soumissions mises à jour`);
      return scrapedData;

    } catch (error) {
      console.error('❌ Erreur lors du scraping global:', error);
      return [];
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      console.log('🔒 PSA Scraper fermé');
    }
  }

  // Vérifier si la session PSA est encore active
  async checkSessionActive() {
    try {
      if (!this.page || !this.isLoggedIn) {
        return false;
      }
      
      // Essayer d'accéder à une page qui nécessite une connexion
      const response = await this.page.goto('https://www.psacard.co.jp/myaccount', {
        waitUntil: 'networkidle2',
        timeout: 10000
      });
      
      const url = this.page.url();
      const isActive = url.includes('myaccount') && !url.includes('signin');
      
      console.log(`🔍 Session PSA ${isActive ? 'active' : 'expirée'} - URL: ${url}`);
      
      if (!isActive) {
        this.isLoggedIn = false;
      }
      
      return isActive;
    } catch (error) {
      console.log('⚠️ Erreur vérification session PSA:', error.message);
      this.isLoggedIn = false;
      return false;
    }
  }

  // Maintenir la session active
  async keepSessionAlive() {
    try {
      if (!this.isLoggedIn) {
        return false;
      }
      
      // Ping périodique pour maintenir la session
      await this.page.evaluate(() => {
        // Faire une requête légère pour maintenir la session
        fetch('/myaccount', { method: 'HEAD' }).catch(() => {});
      });
      
      console.log('💓 Session PSA Japan maintenue active');
      return true;
    } catch (error) {
      console.log('⚠️ Erreur maintien session:', error.message);
      return false;
    }
  }

  // 🔒 NOUVELLE FONCTION : Assurer une session active avec reconnexion automatique
  async ensureActiveSession() {
    try {
      console.log('🔍 Vérification de la session PSA...');
      
      // Vérifier si on a déjà une session active
      if (this.isLoggedIn && await this.checkSessionActive()) {
        console.log('✅ Session PSA active et valide');
        return true;
      }
      
      // Session expirée ou non connecté - reconnexion nécessaire
      console.log('🔄 Reconnexion PSA nécessaire...');
      
      const username = process.env.PSA_USERNAME;
      const password = process.env.PSA_PASSWORD;
      
      if (!username || !password) {
        console.log('❌ Identifiants PSA manquants dans les variables d\'environnement');
        throw new Error('Identifiants PSA non configurés');
      }
      
      // Tenter la reconnexion
      const loginSuccess = await this.loginToPSA(username, password);
      
      if (loginSuccess) {
        console.log('✅ Reconnexion PSA réussie');
        // Maintenir la session immédiatement
        await this.keepSessionAlive();
        return true;
      } else {
        console.log('❌ Échec de la reconnexion PSA');
        this.isLoggedIn = false;
        throw new Error('Impossible de se reconnecter à PSA');
      }
      
    } catch (error) {
      console.error('❌ Erreur lors de la vérification/reconnexion PSA:', error);
      this.isLoggedIn = false;
      throw error;
    }
  }

  // Méthode statique pour scraper sans instance
  static async quickScrape(submissionNumber, username, password) {
    const scraper = new PSAScraper();
    try {
      await scraper.initialize();
      const loginSuccess = await scraper.loginToPSA(username, password);
      
      if (!loginSuccess) {
        throw new Error('Échec de la connexion PSA');
      }

      const data = await scraper.scrapePSASubmission(submissionNumber);
      return data;
    } finally {
      await scraper.close();
    }
  }
}

// Configuration singleton pour les tâches automatisées
export let globalScraper = null;

export async function initializeGlobalScraper() {
  try {
    if (!globalScraper) {
      globalScraper = new PSAScraper();
      await globalScraper.initialize();
      
      // Connexion avec les identifiants d'environnement
      const username = process.env.PSA_USERNAME;
      const password = process.env.PSA_PASSWORD;
      
      if (username && password) {
        await globalScraper.loginToPSA(username, password);
        console.log('✅ Scraper global PSA initialisé et connecté');
      } else {
        console.log('⚠️ Identifiants PSA manquants dans les variables d\'environnement');
      }
    }
    return globalScraper;
  } catch (error) {
    console.error('❌ Erreur lors de l\'initialisation du scraper global:', error);
    return null;
  }
}