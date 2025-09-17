// Unified Email Service - Brevo with Replitmail fallback
// Ensures robust email delivery with automatic failover

import * as brevoService from './brevo.js';
import * as replitmailService from './replitmail.js';

/**
 * Unified email sending service with automatic fallback
 * Priority: Brevo -> Replitmail
 * @param {Object} message Email message object
 * @returns {Promise<Object>} Email send result
 */
export async function sendEmail(message) {
  const startTime = Date.now();
  let lastError = null;

  // Strategy 1: Try Brevo first (preferred)
  try {
    console.log('📧 [EMAIL] Attempting Brevo delivery...');
    
    const result = await brevoService.sendEmail(message);
    
    console.log(`✅ [EMAIL] Brevo delivery successful in ${Date.now() - startTime}ms`);
    console.log(`📧 [EMAIL] Message ID: ${result.messageId}`);
    
    return {
      ...result,
      service: 'brevo',
      delivery_time_ms: Date.now() - startTime
    };

  } catch (brevoError) {
    console.warn('⚠️ [EMAIL] Brevo delivery failed:', brevoError.message);
    lastError = brevoError;

    // Strategy 2: Fallback to Replitmail
    try {
      console.log('📧 [EMAIL] Falling back to Replitmail...');
      
      const result = await replitmailService.sendEmail(message);
      
      console.log(`✅ [EMAIL] Replitmail delivery successful in ${Date.now() - startTime}ms`);
      console.log(`📧 [EMAIL] Fallback successful after Brevo failure`);
      
      return {
        ...result,
        service: 'replitmail',
        fallback_from: 'brevo',
        delivery_time_ms: Date.now() - startTime,
        brevo_error: brevoError.message
      };

    } catch (replitmailError) {
      console.error('❌ [EMAIL] Both Brevo and Replitmail failed');
      console.error('❌ [EMAIL] Brevo error:', brevoError.message);
      console.error('❌ [EMAIL] Replitmail error:', replitmailError.message);
      
      // Both services failed - throw comprehensive error
      const error = new Error(
        `Email delivery failed on both services. Brevo: ${brevoError.message}. Replitmail: ${replitmailError.message}`
      );
      error.brevoError = brevoError;
      error.replitmailError = replitmailError;
      error.totalFailureTime = Date.now() - startTime;
      
      throw error;
    }
  }
}

/**
 * Test email delivery system
 * @param {string} testEmail Test recipient email
 * @returns {Promise<Object>} Test results
 */
export async function testEmailSystem(testEmail = 'test@example.com') {
  const testMessage = {
    to: testEmail,
    subject: '🧪 Test Email Service - PSA Grading System',
    text: 'This is a test email to verify the email service is working correctly.',
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2 style="color: #003d82;">🧪 Email Service Test</h2>
        <p>This is a test email to verify the email service is working correctly.</p>
        <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
        <p><strong>Service:</strong> PSA Grading System</p>
        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-top: 20px;">
          <p style="margin: 0; color: #666;">If you received this email, the email delivery system is functioning properly.</p>
        </div>
      </div>
    `
  };

  try {
    const result = await sendEmail(testMessage);
    
    return {
      success: true,
      service_used: result.service,
      message_id: result.messageId,
      delivery_time_ms: result.delivery_time_ms,
      fallback_used: !!result.fallback_from,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      brevo_error: error.brevoError?.message,
      replitmail_error: error.replitmailError?.message,
      total_failure_time: error.totalFailureTime,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Send PSA grading request notification email (unified)
 * @param {string} customerEmail Customer email address
 * @param {Object} requestDetails PSA request details
 * @returns {Promise<Object>} Email send result
 */
export async function sendPSARequestNotification(customerEmail, requestDetails) {
  try {
    // Try Brevo first
    return await brevoService.sendPSARequestNotification(customerEmail, requestDetails);
  } catch (brevoError) {
    console.warn('⚠️ [EMAIL] Brevo notification failed, trying Replitmail:', brevoError.message);
    
    // Fallback to Replitmail
    const result = await replitmailService.sendPSARequestNotification(customerEmail, requestDetails);
    
    return {
      ...result,
      service: 'replitmail',
      fallback_from: 'brevo',
      brevo_error: brevoError.message
    };
  }
}

/**
 * Send payment link email to customer (unified)
 * @param {string} customerEmail Customer email address
 * @param {Object} paymentDetails Payment details
 * @returns {Promise<Object>} Email send result
 */
export async function sendPaymentLinkEmail(customerEmail, paymentDetails) {
  try {
    // Try Brevo first
    return await brevoService.sendPaymentLinkEmail(customerEmail, paymentDetails);
  } catch (brevoError) {
    console.warn('⚠️ [EMAIL] Brevo payment link failed, trying Replitmail:', brevoError.message);
    
    // Fallback to Replitmail
    const result = await replitmailService.sendPaymentLinkEmail(customerEmail, paymentDetails);
    
    return {
      ...result,
      service: 'replitmail',
      fallback_from: 'brevo',
      brevo_error: brevoError.message
    };
  }
}

/**
 * Get email service status
 * @returns {Promise<Object>} Service status
 */
export async function getEmailServiceStatus() {
  const status = {
    timestamp: new Date().toISOString(),
    brevo: { available: false, error: null },
    replitmail: { available: false, error: null }
  };

  // Test Brevo
  try {
    // Check if BREVO_API_KEY is configured
    if (!process.env.BREVO_API_KEY) {
      throw new Error('BREVO_API_KEY not configured');
    }
    
    const { TransactionalEmailsApi } = await import('@getbrevo/brevo');
    const emailAPI = new TransactionalEmailsApi();
    emailAPI.authentications.apiKey.apiKey = process.env.BREVO_API_KEY;
    
    status.brevo.available = true;
    
  } catch (error) {
    status.brevo.error = error.message;
  }

  // Test Replitmail
  try {
    // Check if Replit environment tokens are available
    const xReplitToken = process.env.REPL_IDENTITY 
      ? "repl " + process.env.REPL_IDENTITY
      : process.env.WEB_REPL_RENEWAL
        ? "depl " + process.env.WEB_REPL_RENEWAL
        : null;
    
    if (!xReplitToken) {
      throw new Error('No REPL_IDENTITY or WEB_REPL_RENEWAL token found');
    }
    
    status.replitmail.available = true;
    
  } catch (error) {
    status.replitmail.error = error.message;
  }

  return status;
}