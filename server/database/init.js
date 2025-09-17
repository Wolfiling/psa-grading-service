import pkg from 'pg';
const { Pool } = pkg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Gestion des erreurs de connexion pour éviter les crashes
pool.on('error', (err) => {
  console.error('❌ Erreur inattendue de la base de données:', err);
  console.log('🔄 Tentative de reconnexion automatique...');
});

pool.on('connect', () => {
  console.log('✅ Nouvelle connexion à la base de données établie');
});

// Gestion de la perte de connexion
process.on('SIGTERM', async () => {
  console.log('🔄 Fermeture gracieuse du pool de connexions...');
  await pool.end();
});

process.on('SIGINT', async () => {
  console.log('🔄 Fermeture gracieuse du pool de connexions...');
  await pool.end();
});

export const initializeDatabase = async () => {
  try {
    const client = await pool.connect();
    
    // Create grading_requests table
    await client.query(`
      CREATE TABLE IF NOT EXISTS grading_requests (
        id SERIAL PRIMARY KEY,
        shop_domain VARCHAR(255) NOT NULL,
        customer_email VARCHAR(255) NOT NULL,
        grading_type VARCHAR(50) NOT NULL,
        card_source VARCHAR(50) NOT NULL,
        card_name VARCHAR(255) NOT NULL,
        card_series VARCHAR(255),
        card_number VARCHAR(50),
        card_rarity VARCHAR(100),
        card_year INTEGER,
        order_number VARCHAR(100),
        whatnot_username VARCHAR(100),
        live_date DATE,
        whatnot_order_number VARCHAR(100),
        card_image VARCHAR(255),
        shopify_order_verified BOOLEAN DEFAULT FALSE,
        shopify_order_data JSONB,
        comments TEXT,
        status VARCHAR(50) DEFAULT 'pending',
        submission_id VARCHAR(100) UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        price DECIMAL(10,2),
        estimated_completion DATE,
        tracking_number VARCHAR(100),
        psa_submission_number VARCHAR(100)
      )
    `);

    // Add missing columns if they don't exist (for existing tables)
    try {
      await client.query(`ALTER TABLE grading_requests ADD COLUMN IF NOT EXISTS card_image VARCHAR(255)`);
      await client.query(`ALTER TABLE grading_requests ADD COLUMN IF NOT EXISTS shopify_order_verified BOOLEAN DEFAULT FALSE`);
      await client.query(`ALTER TABLE grading_requests ADD COLUMN IF NOT EXISTS shopify_order_data JSONB`);
      await client.query(`ALTER TABLE grading_requests ADD COLUMN IF NOT EXISTS psa_scraping_data JSONB`);
      await client.query(`ALTER TABLE grading_requests ADD COLUMN IF NOT EXISTS psa_last_scraped TIMESTAMP`);
      await client.query(`ALTER TABLE grading_requests ADD COLUMN IF NOT EXISTS psa_status VARCHAR(100)`);
      await client.query(`ALTER TABLE grading_requests ADD COLUMN IF NOT EXISTS psa_received_date DATE`);
      await client.query(`ALTER TABLE grading_requests ADD COLUMN IF NOT EXISTS psa_estimated_date DATE`);
      await client.query(`ALTER TABLE grading_requests ADD COLUMN IF NOT EXISTS psa_completed_date DATE`);
      await client.query(`ALTER TABLE grading_requests ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'pending'`);
      
      // Video proof system columns
      await client.query(`ALTER TABLE grading_requests ADD COLUMN IF NOT EXISTS video_url VARCHAR(500)`);
      await client.query(`ALTER TABLE grading_requests ADD COLUMN IF NOT EXISTS qr_code_data TEXT`);
      await client.query(`ALTER TABLE grading_requests ADD COLUMN IF NOT EXISTS qr_code_image_path VARCHAR(500)`);
      await client.query(`ALTER TABLE grading_requests ADD COLUMN IF NOT EXISTS video_status VARCHAR(50) DEFAULT 'pending'`);
      await client.query(`ALTER TABLE grading_requests ADD COLUMN IF NOT EXISTS recording_timestamp TIMESTAMP`);
      await client.query(`ALTER TABLE grading_requests ADD COLUMN IF NOT EXISTS qr_code_generated_at TIMESTAMP`);
      await client.query(`ALTER TABLE grading_requests ADD COLUMN IF NOT EXISTS video_file_size INTEGER`);
      await client.query(`ALTER TABLE grading_requests ADD COLUMN IF NOT EXISTS video_duration INTEGER`);
      
      // Video validation override system columns
      await client.query(`ALTER TABLE grading_requests ADD COLUMN IF NOT EXISTS video_override_admin VARCHAR(100)`);
      await client.query(`ALTER TABLE grading_requests ADD COLUMN IF NOT EXISTS video_override_reason TEXT`);
      await client.query(`ALTER TABLE grading_requests ADD COLUMN IF NOT EXISTS video_override_timestamp TIMESTAMP`);
      
      // Multi-card system columns
      await client.query(`ALTER TABLE grading_requests ADD COLUMN IF NOT EXISTS items_count INTEGER DEFAULT 0`);
      await client.query(`ALTER TABLE grading_requests ADD COLUMN IF NOT EXISTS total_price DECIMAL(10,2)`);
      await client.query(`ALTER TABLE grading_requests ADD COLUMN IF NOT EXISTS is_multi_card BOOLEAN DEFAULT FALSE`);
    } catch (error) {
      // Columns may already exist, ignore errors
    }

    // Create app_settings table
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        id SERIAL PRIMARY KEY,
        shop_domain VARCHAR(255) NOT NULL UNIQUE,
        settings JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create notifications table
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        shop_domain VARCHAR(255) NOT NULL,
        grading_request_id INTEGER REFERENCES grading_requests(id),
        type VARCHAR(50) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        email_sent BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create customers table - Système d'espace client
    await client.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        phone VARCHAR(20),
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP,
        email_verified BOOLEAN DEFAULT FALSE,
        email_verification_token VARCHAR(255),
        password_reset_token VARCHAR(255),
        password_reset_expires TIMESTAMP
      )
    `);

    // Create customer_sessions table - Sessions actives clients
    await client.query(`
      CREATE TABLE IF NOT EXISTS customer_sessions (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
        session_token VARCHAR(255) UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ip_address VARCHAR(45),
        user_agent TEXT
      )
    `);

    // Create customer_auth_tokens table - Liens tokenisés pour les invitations
    await client.query(`
      CREATE TABLE IF NOT EXISTS customer_auth_tokens (
        id SERIAL PRIMARY KEY,
        customer_email VARCHAR(255) NOT NULL,
        grading_request_id INTEGER REFERENCES grading_requests(id),
        token VARCHAR(255) UNIQUE NOT NULL,
        token_type VARCHAR(50) NOT NULL DEFAULT 'invitation',
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        used_at TIMESTAMP,
        created_by_admin VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Index pour optimiser les performances
    await client.query(`CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_customer_sessions_token ON customer_sessions(session_token)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_customer_sessions_customer ON customer_sessions(customer_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_customer_auth_tokens_token ON customer_auth_tokens(token)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_customer_auth_tokens_email ON customer_auth_tokens(customer_email)`);
    
    // Lier les demandes aux clients (colonne optionnelle pour compatibilité)
    try {
      await client.query(`ALTER TABLE grading_requests ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_grading_requests_customer ON grading_requests(customer_id)`);
    } catch (error) {
      // Column may already exist
    }

    // Create psa_shopify_templates table - mapping des produits PSA template
    await client.query(`
      CREATE TABLE IF NOT EXISTS psa_shopify_templates (
        id SERIAL PRIMARY KEY,
        service_id VARCHAR(50) NOT NULL UNIQUE,
        service_name VARCHAR(255) NOT NULL,
        shopify_product_id BIGINT NOT NULL,
        shopify_variant_id BIGINT NOT NULL,
        shopify_variant_gid VARCHAR(255) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        estimated_days INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT TRUE
      )
    `);

    // Create client_access_logs table for security audit
    await client.query(`
      CREATE TABLE IF NOT EXISTS client_access_logs (
        id SERIAL PRIMARY KEY,
        submission_id VARCHAR(100) NOT NULL,
        client_ip INET NOT NULL,
        user_agent TEXT,
        email_domain VARCHAR(50),
        access_type VARCHAR(50) NOT NULL,
        access_granted BOOLEAN DEFAULT FALSE,
        token_issued VARCHAR(100),
        token_expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        session_id VARCHAR(100),
        failure_reason VARCHAR(200)
      )
    `);

    // Create client_reports table for issue reporting
    await client.query(`
      CREATE TABLE IF NOT EXISTS client_reports (
        id SERIAL PRIMARY KEY,
        submission_id VARCHAR(100) NOT NULL,
        ticket_number VARCHAR(50) UNIQUE NOT NULL,
        client_email VARCHAR(255) NOT NULL,
        issue_type VARCHAR(100) NOT NULL,
        description TEXT NOT NULL,
        priority VARCHAR(20) DEFAULT 'medium',
        status VARCHAR(50) DEFAULT 'open',
        client_ip INET,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP,
        admin_notes TEXT
      )
    `);

    // Create grading_items table for multi-card support
    await client.query(`
      CREATE TABLE IF NOT EXISTS grading_items (
        id SERIAL PRIMARY KEY,
        grading_request_id INTEGER NOT NULL REFERENCES grading_requests(id) ON DELETE CASCADE,
        source VARCHAR(20) NOT NULL CHECK (source IN ('taskmaster', 'manual')),
        tm_card_id VARCHAR(100),
        name VARCHAR(255) NOT NULL,
        series VARCHAR(255),
        number VARCHAR(50),
        rarity VARCHAR(100),
        year INTEGER,
        notes TEXT,
        image_path VARCHAR(500),
        price_each DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add client access columns to grading_requests
    try {
      await client.query(`ALTER TABLE grading_requests ADD COLUMN IF NOT EXISTS client_access_enabled BOOLEAN DEFAULT TRUE`);
      await client.query(`ALTER TABLE grading_requests ADD COLUMN IF NOT EXISTS last_client_access TIMESTAMP`);
      await client.query(`ALTER TABLE grading_requests ADD COLUMN IF NOT EXISTS client_access_count INTEGER DEFAULT 0`);
    } catch (error) {
      // Columns may already exist, ignore errors
    }

    // Create video_check_overrides table for admin overrides
    await client.query(`
      CREATE TABLE IF NOT EXISTS video_check_overrides (
        id SERIAL PRIMARY KEY,
        submission_id VARCHAR(100) NOT NULL,
        admin_id VARCHAR(100) NOT NULL,
        override_type VARCHAR(50) NOT NULL,
        justification TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ip_address INET,
        session_id VARCHAR(100)
      )
    `);

    // Create shipment_validations table for tracking validations
    await client.query(`
      CREATE TABLE IF NOT EXISTS shipment_validations (
        id SERIAL PRIMARY KEY,
        submission_id VARCHAR(100) NOT NULL,
        validation_success BOOLEAN NOT NULL,
        validation_reason VARCHAR(100) NOT NULL,
        validated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        validator_admin VARCHAR(100),
        batch_id VARCHAR(100),
        notes TEXT
      )
    `);

    // Create automated_reminders table for tracking reminders
    await client.query(`
      CREATE TABLE IF NOT EXISTS automated_reminders (
        id SERIAL PRIMARY KEY,
        submission_id VARCHAR(100) NOT NULL UNIQUE,
        reminder_type VARCHAR(50) NOT NULL DEFAULT 'video_missing',
        reminder_count INTEGER DEFAULT 1,
        last_reminder_sent TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        first_reminder_sent TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        email_id VARCHAR(200),
        latest_email_id VARCHAR(200),
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(50) DEFAULT 'active'
      )
    `);

    // Create admin_alerts table for system alerts
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_alerts (
        id SERIAL PRIMARY KEY,
        alert_type VARCHAR(50) NOT NULL,
        submission_id VARCHAR(100),
        alert_level VARCHAR(20) NOT NULL DEFAULT 'warning',
        message TEXT NOT NULL,
        resolved BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP,
        resolved_by VARCHAR(100),
        metadata JSONB
      )
    `);

    // Create psa_shipment_batches table for tracking shipments
    await client.query(`
      CREATE TABLE IF NOT EXISTS psa_shipment_batches (
        id SERIAL PRIMARY KEY,
        batch_id VARCHAR(100) NOT NULL UNIQUE,
        created_by VARCHAR(100) NOT NULL,
        submission_count INTEGER NOT NULL DEFAULT 0,
        video_validated_count INTEGER NOT NULL DEFAULT 0,
        override_count INTEGER NOT NULL DEFAULT 0,
        status VARCHAR(50) DEFAULT 'draft',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        shipped_at TIMESTAMP,
        tracking_number VARCHAR(100),
        notes TEXT,
        metadata JSONB
      )
    `);

    // Create psa_shipment_items table for batch contents
    await client.query(`
      CREATE TABLE IF NOT EXISTS psa_shipment_items (
        id SERIAL PRIMARY KEY,
        batch_id VARCHAR(100) NOT NULL,
        submission_id VARCHAR(100) NOT NULL,
        video_validated BOOLEAN DEFAULT FALSE,
        has_override BOOLEAN DEFAULT FALSE,
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        validation_notes TEXT,
        FOREIGN KEY (batch_id) REFERENCES psa_shipment_batches(batch_id)
      )
    `);

    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_grading_requests_shop ON grading_requests(shop_domain);
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_grading_requests_status ON grading_requests(status);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_grading_requests_created ON grading_requests(created_at);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_grading_requests_submission ON grading_requests(submission_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_client_access_logs_submission ON client_access_logs(submission_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_client_access_logs_ip ON client_access_logs(client_ip);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_client_access_logs_created ON client_access_logs(created_at);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_client_reports_submission ON client_reports(submission_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_client_reports_ticket ON client_reports(ticket_number);
    `);

    // Create indexes for new video validation tables
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_video_check_overrides_submission ON video_check_overrides(submission_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_video_check_overrides_admin ON video_check_overrides(admin_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_shipment_validations_submission ON shipment_validations(submission_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_shipment_validations_batch ON shipment_validations(batch_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_automated_reminders_submission ON automated_reminders(submission_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_automated_reminders_type ON automated_reminders(reminder_type);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_admin_alerts_type ON admin_alerts(alert_type);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_admin_alerts_level ON admin_alerts(alert_level);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_admin_alerts_resolved ON admin_alerts(resolved);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_psa_shipment_batches_status ON psa_shipment_batches(status);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_psa_shipment_items_batch ON psa_shipment_items(batch_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_psa_shipment_items_submission ON psa_shipment_items(submission_id);
    `);

    client.release();
    console.log('✅ Database tables created successfully');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
};

// Pool déjà exporté en haut du fichier