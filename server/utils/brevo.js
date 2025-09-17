// Brevo (formerly Sendinblue) email utility
// Reference: @getbrevo/brevo package

import { TransactionalEmailsApi, SendSmtpEmail } from '@getbrevo/brevo';

/**
 * Initialize Brevo API client
 * @returns {TransactionalEmailsApi} Brevo API client
 * @throws {Error} If no API key found
 */
function initBrevoClient() {
  if (!process.env.BREVO_API_KEY) {
    throw new Error('BREVO_API_KEY environment variable is required');
  }

  const emailAPI = new TransactionalEmailsApi();
  emailAPI.authentications.apiKey.apiKey = process.env.BREVO_API_KEY;
  return emailAPI;
}

/**
 * Send email using Brevo's transactional email service
 * @param {Object} message Email message object
 * @param {string|string[]} message.to Recipient email address(es)
 * @param {string|string[]} [message.cc] CC recipient email address(es)
 * @param {string} message.subject Email subject
 * @param {string} [message.text] Plain text body
 * @param {string} [message.html] HTML body
 * @param {Object} [message.from] Sender information {name: "Name", email: "email@domain.com"}
 * @param {Array} [message.attachments] Email attachments
 * @returns {Promise<{accepted: string[], rejected: string[], pending?: string[], messageId: string, response: string}>}
 * @throws {Error} If email sending fails
 */
async function sendEmail(message) {
  // Basic validation
  if (!message.to) {
    throw new Error("Recipient email address is required");
  }
  if (!message.subject) {
    throw new Error("Email subject is required");
  }
  if (!message.text && !message.html) {
    throw new Error("Either text or html content is required");
  }

  const emailAPI = initBrevoClient();
  const email = new SendSmtpEmail();

  // Set email properties
  email.subject = message.subject;
  email.htmlContent = message.html || '';
  email.textContent = message.text || '';
  
  // Set sender - default to validated Brevo email
  email.sender = message.from || { 
    name: "Pokémon Cards Store", 
    email: "teampkshop@gmail.com" 
  };

  // Set recipients
  if (Array.isArray(message.to)) {
    email.to = message.to.map(email => ({ email }));
  } else {
    email.to = [{ email: message.to }];
  }

  // Set CC recipients if provided
  if (message.cc) {
    if (Array.isArray(message.cc)) {
      email.cc = message.cc.map(email => ({ email }));
    } else {
      email.cc = [{ email: message.cc }];
    }
  }

  // Set attachments if provided
  if (message.attachments && message.attachments.length > 0) {
    email.attachment = message.attachments.map(att => ({
      name: att.filename || att.name,
      content: att.content,
      type: att.contentType || att.type
    }));
  }

  try {
    const result = await emailAPI.sendTransacEmail(email);
    
    // Return format compatible with replitmail.js
    return {
      accepted: email.to.map(recipient => recipient.email),
      rejected: [],
      messageId: result.body.messageId,
      response: `Email sent successfully via Brevo. Message ID: ${result.body.messageId}`
    };
  } catch (error) {
    console.error('Error sending email via Brevo:', error);
    
    // Extract error details
    let errorMessage = 'Failed to send email via Brevo';
    if (error.body && error.body.message) {
      errorMessage = error.body.message;
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    throw new Error(errorMessage);
  }
}

/**
 * Send PSA grading request notification email
 * @param {string} customerEmail Customer email address
 * @param {Object} requestDetails PSA request details
 * @returns {Promise<Object>} Email send result
 */
async function sendPSARequestNotification(customerEmail, requestDetails) {
  const {
    submission_ids,
    cards,
    grading_type,
    total_price,
    estimated_completion,
    payment_option
  } = requestDetails;

  // Format cards list
  const cardsList = cards.map((card, index) => 
    `${index + 1}. ${card.name}${card.series ? ` (${card.series})` : ''}`
  ).join('\n');

  // Format submission IDs
  const submissionIdsList = submission_ids.map((id, index) => 
    `Carte ${index + 1}: ${id}`
  ).join('\n');

  const serviceNames = {
    'value-bulk': 'PSA Value Bulk',
    'value': 'PSA Value', 
    'value-plus': 'PSA Value Plus',
    'regular': 'PSA Regular',
    'xp': 'PSA XP',
    'super-xp': 'PSA Super XP',
    'wt': 'PSA WT (Walk Through)',
    'premium-1': 'PSA Premium 1',
    'premium-2': 'PSA Premium 2', 
    'premium-3': 'PSA Premium 3',
    'premium-5': 'PSA Premium 5',
    'premium-10': 'PSA Premium 10'
  };

  const serviceName = serviceNames[grading_type] || grading_type;
  const estimatedDate = new Date(estimated_completion).toLocaleDateString('fr-FR');

  // Email content based on payment option
  let subject, textContent, htmlContent;
  
  if (payment_option === 'pay_later') {
    subject = `Demande PSA enregistrée - Paiement en attente (${cards.length} carte${cards.length > 1 ? 's' : ''})`;
    
    textContent = `Bonjour,

Votre demande de gradation PSA a été enregistrée avec succès !

📋 DÉTAILS DE VOTRE DEMANDE :
Service : ${serviceName}
Nombre de cartes : ${cards.length}
Prix total : ${total_price}€
Date d'estimation : ${estimatedDate}

🎯 VOS CARTES :
${cardsList}

🆔 NUMÉROS DE SUIVI :
${submissionIdsList}

💳 PAIEMENT :
Vous avez choisi l'option "Payer plus tard". 
Nous vous enverrons prochainement un lien de paiement sécurisé pour finaliser votre commande.

📞 CONTACT :
Si vous avez des questions, n'hésitez pas à nous contacter.

Merci de votre confiance !
L'équipe PSA Grading Service`;

    htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8f9fa; padding: 20px;">
      <div style="background: white; border-radius: 12px; padding: 30px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #003d82; margin-bottom: 10px;">🎯 Demande PSA Enregistrée</h1>
          <p style="color: #666; font-size: 18px;">Paiement en attente</p>
        </div>

        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
          <h3 style="color: #003d82; margin-bottom: 15px;">📋 Détails de votre demande</h3>
          <p><strong>Service :</strong> ${serviceName}</p>
          <p><strong>Nombre de cartes :</strong> ${cards.length}</p>
          <p><strong>Prix total :</strong> <span style="color: #dc143c; font-weight: bold;">${total_price}€</span></p>
          <p><strong>Date d'estimation :</strong> ${estimatedDate}</p>
        </div>

        <div style="background: #e8f4f8; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
          <h3 style="color: #003d82; margin-bottom: 15px;">🎯 Vos cartes</h3>
          <div style="color: #333;">
            ${cards.map((card, index) => 
              `<p style="margin: 5px 0;">${index + 1}. <strong>${card.name}</strong>${card.series ? ` <em>(${card.series})</em>` : ''}</p>`
            ).join('')}
          </div>
        </div>

        <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
          <h3 style="color: #856404; margin-bottom: 15px;">🆔 Numéros de suivi</h3>
          <div style="color: #333; font-family: monospace; font-size: 14px;">
            ${submission_ids.map((id, index) => 
              `<p style="margin: 5px 0;">Carte ${index + 1}: <strong>${id}</strong></p>`
            ).join('')}
          </div>
        </div>

        <div style="background: #d1ecf1; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
          <h3 style="color: #0c5460; margin-bottom: 15px;">💳 Paiement</h3>
          <p style="color: #333;">Vous avez choisi l'option <strong>"Payer plus tard"</strong>.</p>
          <p style="color: #333;">Nous vous enverrons prochainement un lien de paiement sécurisé pour finaliser votre commande.</p>
        </div>

        <div style="text-align: center; padding: 20px; background: #f8f9fa; border-radius: 8px;">
          <p style="color: #666; margin-bottom: 10px;">Si vous avez des questions, n'hésitez pas à nous contacter.</p>
          <p style="color: #003d82; font-weight: bold;">Merci de votre confiance !</p>
          <p style="color: #666; font-size: 14px;">L'équipe PSA Grading Service</p>
        </div>
      </div>
    </div>`;

  } else {
    // Immediate payment confirmation
    subject = `Demande PSA confirmée - Paiement en cours (${cards.length} carte${cards.length > 1 ? 's' : ''})`;
    
    textContent = `Bonjour,

Votre demande de gradation PSA a été soumise avec succès !

📋 DÉTAILS DE VOTRE DEMANDE :
Service : ${serviceName}
Nombre de cartes : ${cards.length}
Prix total : ${total_price}€
Date d'estimation : ${estimatedDate}

🎯 VOS CARTES :
${cardsList}

🆔 NUMÉROS DE SUIVI :
${submissionIdsList}

💳 PAIEMENT :
Vous avez été redirigé(e) vers notre système de paiement sécurisé.
Une fois le paiement confirmé, nous commencerons le processus de gradation.

📞 CONTACT :
Si vous avez des questions, n'hésitez pas à nous contacter.

Merci de votre confiance !
L'équipe PSA Grading Service`;

    htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8f9fa; padding: 20px;">
      <div style="background: white; border-radius: 12px; padding: 30px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #22c55e; margin-bottom: 10px;">✅ Demande PSA Confirmée</h1>
          <p style="color: #666; font-size: 18px;">Paiement en cours</p>
        </div>

        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
          <h3 style="color: #003d82; margin-bottom: 15px;">📋 Détails de votre demande</h3>
          <p><strong>Service :</strong> ${serviceName}</p>
          <p><strong>Nombre de cartes :</strong> ${cards.length}</p>
          <p><strong>Prix total :</strong> <span style="color: #dc143c; font-weight: bold;">${total_price}€</span></p>
          <p><strong>Date d'estimation :</strong> ${estimatedDate}</p>
        </div>

        <div style="background: #e8f4f8; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
          <h3 style="color: #003d82; margin-bottom: 15px;">🎯 Vos cartes</h3>
          <div style="color: #333;">
            ${cards.map((card, index) => 
              `<p style="margin: 5px 0;">${index + 1}. <strong>${card.name}</strong>${card.series ? ` <em>(${card.series})</em>` : ''}</p>`
            ).join('')}
          </div>
        </div>

        <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
          <h3 style="color: #856404; margin-bottom: 15px;">🆔 Numéros de suivi</h3>
          <div style="color: #333; font-family: monospace; font-size: 14px;">
            ${submission_ids.map((id, index) => 
              `<p style="margin: 5px 0;">Carte ${index + 1}: <strong>${id}</strong></p>`
            ).join('')}
          </div>
        </div>

        <div style="background: #d4edda; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
          <h3 style="color: #155724; margin-bottom: 15px;">💳 Paiement</h3>
          <p style="color: #333;">Vous avez été redirigé(e) vers notre système de paiement sécurisé.</p>
          <p style="color: #333;">Une fois le paiement confirmé, nous commencerons le processus de gradation.</p>
        </div>

        <div style="text-align: center; padding: 20px; background: #f8f9fa; border-radius: 8px;">
          <p style="color: #666; margin-bottom: 10px;">Si vous avez des questions, n'hésitez pas à nous contacter.</p>
          <p style="color: #003d82; font-weight: bold;">Merci de votre confiance !</p>
          <p style="color: #666; font-size: 14px;">L'équipe PSA Grading Service</p>
        </div>
      </div>
    </div>`;
  }

  return await sendEmail({
    to: customerEmail,
    subject: subject,
    text: textContent,
    html: htmlContent,
    from: { 
      name: "Pokémon Cards Store", 
      email: "teampkshop@gmail.com" 
    }
  });
}

/**
 * Send payment link email to customer
 * @param {string} customerEmail Customer email address
 * @param {Object} paymentDetails Payment details
 * @returns {Promise<Object>} Email send result
 */
async function sendPaymentLinkEmail(customerEmail, paymentDetails) {
  const {
    checkout_url,
    submission_ids,
    cards,
    grading_type,
    total_price
  } = paymentDetails;

  const serviceNames = {
    'value-bulk': 'PSA Value Bulk',
    'value': 'PSA Value', 
    'value-plus': 'PSA Value Plus',
    'regular': 'PSA Regular',
    'xp': 'PSA XP',
    'super-xp': 'PSA Super XP',
    'wt': 'PSA WT (Walk Through)',
    'premium-1': 'PSA Premium 1',
    'premium-2': 'PSA Premium 2', 
    'premium-3': 'PSA Premium 3',
    'premium-5': 'PSA Premium 5',
    'premium-10': 'PSA Premium 10'
  };

  const serviceName = serviceNames[grading_type] || grading_type;

  const subject = `🔗 Lien de paiement PSA - ${cards.length} carte${cards.length > 1 ? 's' : ''} (${total_price}€)`;
  
  const textContent = `Bonjour,

Voici votre lien de paiement sécurisé pour finaliser votre demande de gradation PSA :

💳 LIEN DE PAIEMENT :
${checkout_url}

📋 RAPPEL DE VOTRE COMMANDE :
Service : ${serviceName}
Nombre de cartes : ${cards.length}
Prix total : ${total_price}€

🎯 CARTES :
${cards.map((card, index) => `${index + 1}. ${card.name}${card.series ? ` (${card.series})` : ''}`).join('\n')}

🆔 NUMÉROS DE SUIVI :
${submission_ids.map((id, index) => `Carte ${index + 1}: ${id}`).join('\n')}

⚡ FINALISER VOTRE COMMANDE :
Cliquez sur le lien ci-dessus pour procéder au paiement sécurisé.
Une fois le paiement confirmé, nous commencerons immédiatement le processus de gradation.

📞 CONTACT :
Si vous avez des questions, n'hésitez pas à nous contacter.

Merci de votre confiance !
L'équipe PSA Grading Service`;

  const htmlContent = `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8f9fa; padding: 20px;">
    <div style="background: white; border-radius: 12px; padding: 30px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="color: #003d82; margin-bottom: 10px;">💳 Lien de Paiement PSA</h1>
        <p style="color: #666; font-size: 18px;">Finalisez votre commande</p>
      </div>

      <div style="text-align: center; margin-bottom: 30px;">
        <a href="${checkout_url}" style="display: inline-block; background: linear-gradient(135deg, #dc143c, #e6194f); color: white; padding: 18px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 18px; text-transform: uppercase;">
          💳 PAYER MAINTENANT (${total_price}€)
        </a>
      </div>

      <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
        <h3 style="color: #003d82; margin-bottom: 15px;">📋 Rappel de votre commande</h3>
        <p><strong>Service :</strong> ${serviceName}</p>
        <p><strong>Nombre de cartes :</strong> ${cards.length}</p>
        <p><strong>Prix total :</strong> <span style="color: #dc143c; font-weight: bold;">${total_price}€</span></p>
      </div>

      <div style="background: #e8f4f8; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
        <h3 style="color: #003d82; margin-bottom: 15px;">🎯 Vos cartes</h3>
        <div style="color: #333;">
          ${cards.map((card, index) => 
            `<p style="margin: 5px 0;">${index + 1}. <strong>${card.name}</strong>${card.series ? ` <em>(${card.series})</em>` : ''}</p>`
          ).join('')}
        </div>
      </div>

      <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
        <h3 style="color: #856404; margin-bottom: 15px;">🆔 Numéros de suivi</h3>
        <div style="color: #333; font-family: monospace; font-size: 14px;">
          ${submission_ids.map((id, index) => 
            `<p style="margin: 5px 0;">Carte ${index + 1}: <strong>${id}</strong></p>`
          ).join('')}
        </div>
      </div>

      <div style="background: #d1ecf1; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
        <h3 style="color: #0c5460; margin-bottom: 15px;">⚡ Finaliser votre commande</h3>
        <p style="color: #333;">Cliquez sur le bouton ci-dessus pour procéder au paiement sécurisé.</p>
        <p style="color: #333;">Une fois le paiement confirmé, nous commencerons immédiatement le processus de gradation.</p>
      </div>

      <div style="text-align: center; padding: 20px; background: #f8f9fa; border-radius: 8px;">
        <p style="color: #666; margin-bottom: 10px;">Si vous avez des questions, n'hésitez pas à nous contacter.</p>
        <p style="color: #003d82; font-weight: bold;">Merci de votre confiance !</p>
        <p style="color: #666; font-size: 14px;">L'équipe PSA Grading Service</p>
      </div>
    </div>
  </div>`;

  return await sendEmail({
    to: customerEmail,
    subject: subject,
    text: textContent,
    html: htmlContent,
    from: { 
      name: "Pokémon Cards Store", 
      email: "teampkshop@gmail.com" 
    }
  });
}

/**
 * Send customer invitation email for PSA grading orders
 * @param {Object} invitationDetails Invitation details
 * @returns {Promise<Object>} Email send result
 */
async function sendCustomerInvitationEmail(invitationDetails) {
  const {
    customer_email,
    invitation_token,
    invitation_url,
    grading_request,
    admin_name = 'Équipe PSA Grading'
  } = invitationDetails;

  const {
    submission_id,
    card_name,
    grading_type,
    price,
    created_at
  } = grading_request;

  // Format grading type display name
  const serviceNames = {
    'value-bulk': 'PSA Value Bulk',
    'value': 'PSA Value', 
    'value-plus': 'PSA Value Plus',
    'regular': 'PSA Regular',
    'express': 'PSA Express',
    'super_express': 'PSA Super Express',
    'xp': 'PSA XP',
    'super-xp': 'PSA Super XP',
    'wt': 'PSA WT (Walk Through)',
    'premium-1': 'PSA Premium 1',
    'premium-2': 'PSA Premium 2', 
    'premium-3': 'PSA Premium 3',
    'premium-5': 'PSA Premium 5',
    'premium-10': 'PSA Premium 10'
  };

  const serviceName = serviceNames[grading_type] || grading_type.toUpperCase();
  const formattedPrice = `${price}€`;
  const formattedDate = new Date(created_at).toLocaleDateString('fr-FR');

  const subject = `🎯 Invitation PSA Grading - Accès à votre commande ${submission_id}`;
  
  const textContent = `Bonjour,

Vous avez été invité(e) à accéder à votre commande PSA Grading !

🎯 VOTRE INVITATION :
Commande : ${submission_id}
Carte : ${card_name}
Service : ${serviceName}
Prix : ${formattedPrice}
Date : ${formattedDate}

🔗 ACCÉDER À VOTRE COMMANDE :
${invitation_url}

✨ CRÉER VOTRE COMPTE CLIENT :
En cliquant sur le lien ci-dessus, vous pourrez :
• Créer votre compte client sécurisé
• Suivre votre commande en temps réel
• Recevoir des notifications automatiques
• Accéder à votre dashboard personnel

⏰ INVITATION VALIDE 7 JOURS :
Cette invitation expire dans 7 jours. N'hésitez pas à créer votre compte dès maintenant !

📞 CONTACT :
Si vous avez des questions, n'hésitez pas à nous contacter.

Merci de votre confiance !
${admin_name}`;

  const htmlContent = `
  <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 650px; margin: 0 auto; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px;">
    <div style="background: white; border-radius: 16px; padding: 0; box-shadow: 0 10px 40px rgba(0,0,0,0.15); overflow: hidden;">
      
      <!-- Header -->
      <div style="background: linear-gradient(135deg, #003366, #0066cc); padding: 30px; text-align: center;">
        <h1 style="color: white; margin: 0 0 10px 0; font-size: 28px; font-weight: 700;">🎯 Invitation PSA Grading</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 0; font-size: 16px;">Accédez à votre commande personnalisée</p>
      </div>

      <!-- Welcome Section -->
      <div style="padding: 30px; text-align: center; border-bottom: 1px solid #f0f0f0;">
        <h2 style="color: #003366; margin: 0 0 15px 0; font-size: 22px; font-weight: 600;">🎉 Bienvenue !</h2>
        <p style="color: #666; margin: 0; font-size: 16px; line-height: 1.5;">
          Vous avez été invité(e) à accéder à votre commande PSA Grading.<br>
          Créez votre compte client pour suivre votre commande en temps réel.
        </p>
      </div>

      <!-- Order Details -->
      <div style="padding: 30px;">
        <h3 style="color: #003366; margin: 0 0 20px 0; font-size: 18px; font-weight: 600; text-align: center;">📄 Détails de votre commande</h3>
        
        <div style="background: #f8f9fa; border-radius: 12px; padding: 25px; margin-bottom: 25px;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 15px;">
            <div>
              <div style="color: #666; font-size: 14px; font-weight: 600; margin-bottom: 5px;">🆔 Commande</div>
              <div style="color: #003366; font-size: 16px; font-weight: 700; font-family: Monaco, monospace;">${submission_id}</div>
            </div>
            <div>
              <div style="color: #666; font-size: 14px; font-weight: 600; margin-bottom: 5px;">💰 Prix</div>
              <div style="color: #28a745; font-size: 18px; font-weight: 700;">${formattedPrice}</div>
            </div>
          </div>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
            <div>
              <div style="color: #666; font-size: 14px; font-weight: 600; margin-bottom: 5px;">🎴 Carte</div>
              <div style="color: #003366; font-size: 16px; font-weight: 600;">${card_name}</div>
            </div>
            <div>
              <div style="color: #666; font-size: 14px; font-weight: 600; margin-bottom: 5px;">⭐ Service PSA</div>
              <div style="color: #003366; font-size: 16px; font-weight: 600;">${serviceName}</div>
            </div>
          </div>
          
          <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #dee2e6;">
            <div style="color: #666; font-size: 14px; font-weight: 600; margin-bottom: 5px;">📅 Créée le</div>
            <div style="color: #003366; font-size: 16px; font-weight: 600;">${formattedDate}</div>
          </div>
        </div>

        <!-- CTA Button -->
        <div style="text-align: center; margin: 30px 0;">
          <a href="${invitation_url}" style="display: inline-block; background: linear-gradient(135deg, #fd7e14, #e55100); color: white; padding: 18px 40px; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 16px; text-transform: uppercase; box-shadow: 0 4px 15px rgba(253, 126, 20, 0.3); transition: all 0.3s ease;">
            ✨ Accéder à ma commande
          </a>
        </div>

        <!-- Benefits -->
        <div style="background: #e3f2fd; border-radius: 12px; padding: 25px; margin: 25px 0;">
          <h4 style="color: #1976d2; margin: 0 0 15px 0; font-size: 16px; font-weight: 600; text-align: center;">🎯 Avec votre compte client</h4>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; font-size: 14px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="color: #28a745; font-size: 16px;">✅</span>
              <span style="color: #1976d2;">Suivi temps réel</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="color: #28a745; font-size: 16px;">✅</span>
              <span style="color: #1976d2;">Notifications automatiques</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="color: #28a745; font-size: 16px;">✅</span>
              <span style="color: #1976d2;">Dashboard personnel</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="color: #28a745; font-size: 16px;">✅</span>
              <span style="color: #1976d2;">Historique complet</span>
            </div>
          </div>
        </div>

        <!-- Expiration Notice -->
        <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <div style="color: #856404; font-weight: 600; margin-bottom: 5px;">⏰ Invitation temporaire</div>
          <div style="color: #856404; font-size: 14px;">Cette invitation est valide pendant 7 jours. Créez votre compte dès maintenant !</div>
        </div>
      </div>

      <!-- Footer -->
      <div style="background: #f8f9fa; padding: 25px; text-align: center; border-top: 1px solid #e9ecef;">
        <p style="color: #666; margin: 0 0 10px 0; font-size: 14px;">
          Cet email a été envoyé par <strong>${admin_name}</strong>
        </p>
        <p style="color: #999; margin: 0; font-size: 12px;">
          © 2024 PSA Grading Service - Certification professionnelle de cartes
        </p>
        <div style="margin-top: 15px;">
          <a href="mailto:support@psagrading.com" style="color: #667eea; text-decoration: none; font-size: 14px; margin: 0 15px;">📧 Support</a>
          <a href="/contact" style="color: #667eea; text-decoration: none; font-size: 14px; margin: 0 15px;">📞 Contact</a>
        </div>
      </div>
    </div>
  </div>`;

  return await sendEmail({
    to: customer_email,
    subject: subject,
    text: textContent,
    html: htmlContent,
    from: { 
      name: "PSA Grading Service", 
      email: "teampkshop@gmail.com" 
    }
  });
}

export {
  sendEmail,
  sendPSARequestNotification,
  sendPaymentLinkEmail,
  sendCustomerInvitationEmail
};