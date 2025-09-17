// Replit Mail utility - adapted from blueprint:replitmail
// CRITICAL: This code follows the exact deterministic pattern from the blueprint
// Reference: blueprint:replitmail integration

/**
 * Get authentication token for Replit environment
 * @returns {string} Authentication token
 * @throws {Error} If no authentication token found
 */
function getAuthToken() {
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!xReplitToken) {
    throw new Error(
      "No authentication token found. Please set REPL_IDENTITY or ensure you're running in Replit environment."
    );
  }

  return xReplitToken;
}

/**
 * Send email using Replit's OpenInt mail service
 * @param {Object} message Email message object
 * @param {string|string[]} message.to Recipient email address(es)
 * @param {string|string[]} [message.cc] CC recipient email address(es)
 * @param {string} message.subject Email subject
 * @param {string} [message.text] Plain text body
 * @param {string} [message.html] HTML body
 * @param {Array} [message.attachments] Email attachments
 * @returns {Promise<{accepted: string[], rejected: string[], pending?: string[], messageId: string, response: string}>}
 * @throws {Error} If email sending fails
 */
export async function sendEmail(message) {
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

  const authToken = getAuthToken();

  try {
    const response = await fetch(
      "https://connectors.replit.com/api/v2/mailer/send",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X_REPLIT_TOKEN": authToken,
        },
        body: JSON.stringify({
          to: message.to,
          cc: message.cc,
          subject: message.subject,
          text: message.text,
          html: message.html,
          attachments: message.attachments,
        }),
      }
    );

    if (!response.ok) {
      let errorMessage = "Failed to send email";
      try {
        const error = await response.json();
        errorMessage = error.message || errorMessage;
      } catch (e) {
        // If we can't parse the error response, use the status text
        errorMessage = response.statusText || errorMessage;
      }
      throw new Error(errorMessage);
    }

    return await response.json();
  } catch (error) {
    console.error('Error sending email via Replit Mail:', error);
    throw error;
  }
}

/**
 * Send PSA grading request notification email
 * @param {string} customerEmail Customer email address
 * @param {Object} requestDetails PSA request details
 * @returns {Promise<Object>} Email send result
 */
export async function sendPSARequestNotification(customerEmail, requestDetails) {
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
    html: htmlContent
  });
}

/**
 * Send payment link email to customer
 * @param {string} customerEmail Customer email address
 * @param {Object} paymentDetails Payment details
 * @returns {Promise<Object>} Email send result
 */
export async function sendPaymentLinkEmail(customerEmail, paymentDetails) {
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
    html: htmlContent
  });
}