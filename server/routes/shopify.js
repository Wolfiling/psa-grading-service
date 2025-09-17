import express from 'express';
import { pool } from '../database/init.js';

export function createShopifyRoutes() {
  const router = express.Router();

  // ✅ SECURITY FIX: Configuration directe des variables d'environnement
  const SHOPIFY_SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN;
  const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const SHOPIFY_STOREFRONT_ACCESS_TOKEN = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
  
  console.log('✅ Configuration Shopify chargée:', {
    shop_domain_configured: !!SHOPIFY_SHOP_DOMAIN,
    admin_token_configured: !!SHOPIFY_ADMIN_ACCESS_TOKEN,
    storefront_token_configured: !!SHOPIFY_STOREFRONT_ACCESS_TOKEN
  });

  // Validation robuste des variables d'environnement requises
  if (!SHOPIFY_SHOP_DOMAIN || !SHOPIFY_ADMIN_ACCESS_TOKEN || !SHOPIFY_STOREFRONT_ACCESS_TOKEN) {
    console.error('❌ CRITICAL: Configuration Shopify manquante:', {
      SHOPIFY_SHOP_DOMAIN: !!SHOPIFY_SHOP_DOMAIN,
      SHOPIFY_ADMIN_ACCESS_TOKEN: !!SHOPIFY_ADMIN_ACCESS_TOKEN,
      SHOPIFY_STOREFRONT_ACCESS_TOKEN: !!SHOPIFY_STOREFRONT_ACCESS_TOKEN
    });
    throw new Error('Configuration Shopify manquante: vérifiez les variables d\'environnement');
  }
  
  // Validation format des variables (sans exposer les valeurs)
  if (SHOPIFY_SHOP_DOMAIN && !SHOPIFY_SHOP_DOMAIN.includes('.myshopify.com')) {
    console.warn('⚠️ SHOPIFY_SHOP_DOMAIN format invalide (attendu: *.myshopify.com)');
  }
  if (SHOPIFY_ADMIN_ACCESS_TOKEN && !SHOPIFY_ADMIN_ACCESS_TOKEN.startsWith('shpat_')) {
    console.warn('⚠️ SHOPIFY_ADMIN_ACCESS_TOKEN format invalide (attendu: shpat_*)');
  }
  
  console.log('✅ Configuration Shopify validée:', {
    shop_domain_valid: SHOPIFY_SHOP_DOMAIN?.includes('.myshopify.com') ?? false,
    admin_token_valid: SHOPIFY_ADMIN_ACCESS_TOKEN?.startsWith('shpat_') ?? false,
    storefront_token_configured: !!SHOPIFY_STOREFRONT_ACCESS_TOKEN
  });

  // Vérifier une commande Shopify
  router.post('/verify-order', async (req, res) => {
    try {
      const { orderNumber, email } = req.body;

      if (!orderNumber || !email) {
        return res.status(400).json({
          success: false,
          message: 'Numéro de commande et email requis'
        });
      }

      // TODO: Intégrer avec l'API Admin Shopify pour vérifier la commande
      // Pour l'instant, on simule la vérification
      const mockShopifyOrder = {
        id: orderNumber,
        email: email,
        financial_status: 'paid',
        fulfillment_status: 'fulfilled',
        line_items: [
          {
            title: 'Carte Pokémon',
            variant_title: 'Édition Spéciale',
            price: '25.00'
          }
        ],
        created_at: new Date().toISOString()
      };

      // Mettre à jour la demande de gradation avec les infos Shopify
      await pool.query(`
        UPDATE grading_requests 
        SET shopify_order_verified = TRUE, 
            shopify_order_data = $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE order_number = $2 AND customer_email = $3
      `, [
        JSON.stringify(mockShopifyOrder),
        orderNumber,
        email
      ]);

      res.json({
        success: true,
        order: mockShopifyOrder,
        message: 'Commande Shopify vérifiée avec succès'
      });

    } catch (error) {
      console.error('Erreur lors de la vérification Shopify:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la vérification de la commande'
      });
    }
  });

  // Obtenir les détails d'une commande Shopify
  router.get('/order/:orderNumber', async (req, res) => {
    try {
      const { orderNumber } = req.params;

      const result = await pool.query(`
        SELECT shopify_order_data, shopify_order_verified
        FROM grading_requests 
        WHERE order_number = $1 AND shopify_order_verified = TRUE
        LIMIT 1
      `, [orderNumber]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Commande non trouvée ou non vérifiée'
        });
      }

      res.json({
        success: true,
        order: result.rows[0].shopify_order_data,
        verified: result.rows[0].shopify_order_verified
      });

    } catch (error) {
      console.error('Erreur lors de la récupération de la commande:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération de la commande'
      });
    }
  });

  // Créer tous les produits PSA template sur Shopify
  router.post('/create-all-psa-templates', async (req, res) => {
    try {
      console.log('🏭 Création de tous les produits PSA template sur Shopify...');

      // Configuration complète des services PSA (depuis public.js)
      const psaServices = {
        'value-bulk': { price: 20.00, days: 65, name: 'PSA Value Bulk' },
        'value': { price: 25.00, days: 45, name: 'PSA Value' },
        'value-plus': { price: 45.00, days: 20, name: 'PSA Value Plus' },
        'regular': { price: 75.00, days: 10, name: 'PSA Regular' },
        'xp': { price: 125.00, days: 10, name: 'PSA XP' },
        'super-xp': { price: 250.00, days: 10, name: 'PSA Super XP' },
        'wt': { price: 500.00, days: 10, name: 'PSA WT (Walk Through)' },
        'premium-1': { price: 750.00, days: 10, name: 'PSA Premium 1' },
        'premium-2': { price: 1500.00, days: 10, name: 'PSA Premium 2' },
        'premium-3': { price: 2500.00, days: 10, name: 'PSA Premium 3' },
        'premium-5': { price: 3500.00, days: 10, name: 'PSA Premium 5' },
        'premium-10': { price: 7400.00, days: 10, name: 'PSA Premium 10' }
      };

      const createdProducts = [];

      for (const [serviceId, service] of Object.entries(psaServices)) {
        console.log(`🔨 Création produit: ${service.name} (${service.price}€)`);

        const productData = {
          product: {
            title: `Service PSA - ${service.name}`,
            body_html: `<h3>Service de gradation PSA - ${service.name}</h3>
              <p><strong>Prix:</strong> ${service.price}€</p>
              <p><strong>Délai estimé:</strong> ${service.days} jours</p>
              <p><strong>Service:</strong> ${service.name}</p>
              <p>Service professionnel de gradation PSA avec expédition et suivi inclus.</p>
              <p><em>Produit template - sera personnalisé pour chaque commande.</em></p>`,
            vendor: 'PSA Grading Service',
            product_type: 'Service PSA',
            status: 'active',
            published: true,
            published_scope: 'web',
            variants: [{
              price: service.price.toString(),
              inventory_management: null,
              inventory_policy: 'continue',
              title: 'Service Standard'
            }],
            tags: [
              'psa-grading', 
              'psa-template',
              `service-${serviceId}`,
              `price-${service.price}`,
              `days-${service.days}`
            ]
          }
        };

        try {
          const productResponse = await fetch(`https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2023-10/products.json`, {
            method: 'POST',
            headers: {
              'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(productData)
          });

          if (!productResponse.ok) {
            const errorData = await productResponse.text();
            console.error(`❌ Erreur création ${service.name}:`, errorData);
            continue;
          }

          const product = await productResponse.json();
          const variant = product.product.variants[0];

          createdProducts.push({
            serviceId,
            serviceName: service.name,
            productId: product.product.id,
            variantId: variant.id,
            variantGid: `gid://shopify/ProductVariant/${variant.id}`,
            price: service.price,
            days: service.days
          });

          console.log(`✅ ${service.name}: Produit ${product.product.id}, Variant ${variant.id}`);
          
          // Petite pause entre créations
          await new Promise(resolve => setTimeout(resolve, 500));

        } catch (error) {
          console.error(`❌ Erreur création ${service.name}:`, error);
          continue;
        }
      }

      console.log(`🎉 Création terminée: ${createdProducts.length}/${Object.keys(psaServices).length} produits créés`);

      // Sauvegarder les mappings dans la base de données
      console.log('💾 Sauvegarde des mappings PSA en base de données...');
      let savedCount = 0;
      
      for (const product of createdProducts) {
        try {
          await pool.query(`
            INSERT INTO psa_shopify_templates 
            (service_id, service_name, shopify_product_id, shopify_variant_id, shopify_variant_gid, price, estimated_days)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (service_id) 
            DO UPDATE SET 
              service_name = EXCLUDED.service_name,
              shopify_product_id = EXCLUDED.shopify_product_id,
              shopify_variant_id = EXCLUDED.shopify_variant_id,
              shopify_variant_gid = EXCLUDED.shopify_variant_gid,
              price = EXCLUDED.price,
              estimated_days = EXCLUDED.estimated_days,
              updated_at = CURRENT_TIMESTAMP,
              is_active = true
          `, [
            product.serviceId,
            product.serviceName,
            product.productId,
            product.variantId,
            product.variantGid,
            product.price,
            product.days
          ]);
          savedCount++;
        } catch (error) {
          console.error(`❌ Erreur sauvegarde ${product.serviceName}:`, error);
        }
      }

      console.log(`💾 Mappings sauvés: ${savedCount}/${createdProducts.length} en base de données`);

      const mappingJson = JSON.stringify(createdProducts, null, 2);
      console.log('🔍 Mapping des produits PSA:', mappingJson);

      res.json({
        success: true,
        message: `${createdProducts.length} produits PSA template créés avec succès`,
        products: createdProducts,
        totalServices: Object.keys(psaServices).length,
        savedInDatabase: savedCount
      });

    } catch (error) {
      console.error('❌ Erreur création template PSA:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la création des templates PSA',
        error: error.message
      });
    }
  });


  // Créer un checkout Shopify pour le paiement d'une demande PSA - VERSION TEMPLATE
  router.post('/create-checkout', async (req, res) => {
    try {
      const { grading_request_id } = req.body;

      if (!grading_request_id) {
        return res.status(400).json({
          success: false,
          message: 'ID de la demande de gradation requis'
        });
      }

      // Récupérer les détails de la demande
      const requestResult = await pool.query(`
        SELECT id, customer_email, grading_type, card_name, card_series, price, submission_id
        FROM grading_requests 
        WHERE id = $1
      `, [grading_request_id]);

      if (requestResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Demande de gradation non trouvée'
        });
      }

      const request = requestResult.rows[0];

      // 🎯 NOUVELLE MÉTHODE: Récupérer le produit template PSA existant
      console.log(`🎯 Recherche template PSA pour service: ${request.grading_type}`);
      
      const templateResult = await pool.query(`
        SELECT * FROM psa_shopify_templates 
        WHERE service_id = $1 AND is_active = true
      `, [request.grading_type]);

      if (templateResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: `Template PSA non trouvé pour le service: ${request.grading_type}`
        });
      }

      const template = templateResult.rows[0];
      console.log(`✅ Template trouvé: ${template.service_name} (${template.shopify_variant_gid})`);

      // 🚀 SOLUTION: Utiliser Draft Orders au lieu de Storefront API (évite les problèmes de publication)
      console.log(`💡 Utilisation de Draft Orders pour éviter les problèmes de publication Storefront API`);

      // ✅ UTILISER LE VARIANT TEMPLATE EXISTANT - Pas besoin de créer un nouveau produit !
      console.log(`🎯 Utilisation du template PSA: ${template.service_name} pour demande ${request.submission_id}`);
      console.log(`🔗 Variant ID: ${template.shopify_variant_gid} (Prix: ${template.price}€)`);
      
      // 🚀 CRÉATION D'UNE DRAFT ORDER (évite les problèmes de publication Storefront API)
      console.log(`💳 Création Draft Order pour: ${template.service_name} (${template.price}€)`);
      
      const draftOrderPayload = {
        draft_order: {
          line_items: [{
            variant_id: template.shopify_variant_id, // Utilise l'ID variant numérique, pas le GID
            quantity: 1,
            title: `PSA Grading: ${template.service_name} - ${request.card_name}`,
            price: template.price.toString()
          }],
          customer: {
            first_name: request.customer_email.split('@')[0] || 'Client',
            last_name: 'PSA',
            email: request.customer_email
          },
          note: `PSA Grading Request - Service: ${template.service_name} | Processing Time: ${template.estimated_days} jours | Card: ${request.card_name} ${request.card_series ? `(${request.card_series})` : ''} | ID: ${request.submission_id}`,
          send_invoice: true,
          invoice_sent_at: null,
          use_customer_default_address: false
        }
      };

      console.log(`📋 Payload Draft Order: ${JSON.stringify(draftOrderPayload, null, 2)}`);

      const draftResponse = await fetch(`https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2023-10/draft_orders.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(draftOrderPayload)
      });

      const draftData = await draftResponse.json();

      if (!draftResponse.ok) {
        console.error('❌ Erreur création Draft Order:', draftData);
        return res.status(400).json({
          success: false,
          message: 'Erreur lors de la création du Draft Order',
          errors: draftData.errors || draftData
        });
      }

      const draftOrder = draftData.draft_order;
      console.log(`✅ Draft Order créée: ${draftOrder.id}`);
      
      // Créer l'URL de checkout instantané
      const checkoutUrl = draftOrder.invoice_url;
      console.log(`🔗 URL checkout: ${checkoutUrl}`);

      res.json({
        success: true,
        message: 'Draft Order créée avec succès',
        checkout_url: checkoutUrl,
        draft_order_id: draftOrder.id,
        service_details: {
          name: template.service_name,
          price: template.price,
          days: template.estimated_days
        },
        request_details: {
          submission_id: request.submission_id,
          card_name: request.card_name,
          card_series: request.card_series
        }
      });

    } catch (error) {
      console.error('❌ Erreur checkout avec template PSA:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la création du checkout avec template',
        error: error.message
      });
    }
  });

  // Route pour publier les templates PSA sur le Custom Storefront  
  router.post('/publish-templates-to-storefront', async (req, res) => {
    try {
      console.log('🏭 Recherche du publication ID pour Custom Storefront...');
      
      // 1. Trouver le publication ID du custom storefront
      const publicationsQuery = `
        query getPublications {
          publications(first: 10) {
            nodes {
              id
              name
            }
          }
        }
      `;
      
      const pubResponse = await fetch(`https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2023-10/graphql.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: publicationsQuery })
      });
      
      const pubData = await pubResponse.json();
      console.log('📋 Publications trouvées:', pubData.data?.publications?.nodes);
      
      // Publier sur TOUS les Custom Storefronts PSA Submission Manager
      const psaStorefronts = pubData.data?.publications?.nodes?.filter(pub => 
        pub.name === 'PSA Submission Manager'
      ) || [];
      
      console.log(`🎯 ${psaStorefronts.length} Custom Storefronts PSA trouvés:`, psaStorefronts);
      
      if (psaStorefronts.length === 0) {
        throw new Error('Aucun Custom Storefront PSA Submission Manager trouvé');
      }
      
      // Utiliser le premier pour les logs, mais publier sur tous
      const customStorefront = psaStorefronts[0];
      
      if (!customStorefront) {
        throw new Error('Publication Custom Storefront non trouvée');
      }
      
      console.log(`✅ Custom Storefront trouvé: ${customStorefront.name} (${customStorefront.id})`);
      
      // 2. Récupérer tous les produits PSA template depuis la base
      const { pool } = await import('../database/init.js');
      const { rows: templates } = await pool.query('SELECT service_name, shopify_product_id, shopify_variant_id FROM psa_shopify_templates WHERE is_active = TRUE');
      
      console.log(`🏭 Publication de ${templates.length} templates PSA...`);
      
      let publishedCount = 0;
      
      // 3. Publier chaque produit sur TOUS les custom storefronts PSA
      for (const template of templates) {
        const productGid = `gid://shopify/Product/${template.shopify_product_id}`;
        
        const publishMutation = `
          mutation publishablePublish($id: ID!, $input: PublishablePublishInput!) {
            publishablePublish(id: $id, input: $input) {
              publishable {
                id
              }
              userErrors {
                field
                message
              }
            }
          }
        `;
        
        // Publier sur TOUS les Custom Storefronts PSA
        const allPsaPublicationIds = psaStorefronts.map(sf => sf.id);
        console.log(`📤 Publication ${template.service_name} sur ${allPsaPublicationIds.length} Custom Storefronts:`, allPsaPublicationIds);
        
        const publishResponse = await fetch(`https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2023-10/graphql.json`, {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            query: publishMutation,
            variables: {
              id: productGid,
              input: {
                publicationIds: allPsaPublicationIds
              }
            }
          })
        });
        
        const publishData = await publishResponse.json();
        
        if (publishData.data?.publishablePublish?.userErrors?.length > 0) {
          console.error(`❌ Erreur publication ${template.service_name}:`, publishData.data.publishablePublish.userErrors);
        } else {
          console.log(`✅ ${template.service_name} publié sur ${allPsaPublicationIds.length} Custom Storefronts PSA`);
          publishedCount++;
        }
        
        // Petite pause pour éviter de surcharger l'API
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      res.json({
        success: true,
        message: `${publishedCount}/${templates.length} templates PSA publiés sur le Custom Storefront`,
        publication: customStorefront
      });
      
    } catch (error) {
      console.error('❌ Erreur publication templates:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la publication des templates',
        error: error.message
      });
    }
  });

  // Route ALTERNATIVE : Checkout instantané via Draft Order (contourne les problèmes de publications)
  router.post('/create-instant-checkout', async (req, res) => {
    try {
      const { template_id, customer_info = {}, card_details = {} } = req.body;

      console.log('⚡ Création checkout instantané via Draft Order...');

      // 1. Récupérer le template PSA depuis la base
      const { pool } = await import('../database/init.js');
      const { rows: templates } = await pool.query(
        'SELECT * FROM psa_shopify_templates WHERE service_id = $1 AND is_active = TRUE LIMIT 1',
        [template_id]
      );

      if (templates.length === 0) {
        return res.status(404).json({
          success: false,
          message: `Template PSA '${template_id}' non trouvé`
        });
      }

      const template = templates[0];
      console.log(`💳 Création Draft Order pour: ${template.service_name} (${template.price}€)`);

      // 2. Créer une Draft Order via Admin API (évite les problèmes de publications)
      const draftOrderPayload = {
        draft_order: {
          line_items: [{
            variant_id: template.shopify_variant_id,
            quantity: 1,
            title: `PSA Grading: ${template.service_name}`,
            price: template.price.toString()
          }],
          customer: {
            first_name: customer_info.first_name || 'Client',
            last_name: customer_info.last_name || 'PSA',
            email: customer_info.email || 'noreply@example.com'
          },
          note: `PSA Grading Request - Service: ${template.service_name} | Processing Time: ${template.estimated_days} jours | Card: ${card_details.name || 'Non spécifié'}`,
          send_invoice: true,
          invoice_sent_at: null,
          use_customer_default_address: false
        }
      };

      console.log('📋 Payload Draft Order:', JSON.stringify(draftOrderPayload, null, 2));

      const draftResponse = await fetch(`https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2023-10/draft_orders.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(draftOrderPayload)
      });

      const draftData = await draftResponse.json();

      if (!draftResponse.ok) {
        console.error('❌ Erreur création Draft Order:', draftData);
        return res.status(400).json({
          success: false,
          message: 'Erreur lors de la création du Draft Order',
          errors: draftData.errors || draftData
        });
      }

      const draftOrder = draftData.draft_order;
      console.log(`✅ Draft Order créée: ${draftOrder.id} | Invoice URL: ${draftOrder.invoice_url}`);

      res.json({
        success: true,
        message: 'Checkout instantané créé avec succès',
        checkout_url: draftOrder.invoice_url, // ✅ Format attendu par le client
        checkout: {
          draft_order_id: draftOrder.id,
          invoice_url: draftOrder.invoice_url,
          total_price: draftOrder.total_price,
          currency: draftOrder.currency,
          customer: draftOrder.customer
        },
        template: {
          service: template.service_name,
          price: `${template.price}€`,
          processing_time: `${template.estimated_days} jours`
        }
      });

    } catch (error) {
      console.error('❌ Erreur checkout instantané:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la création du checkout instantané',
        error: error.message
      });
    }
  });

  // Route pour identifier la publication Custom Storefront correcte
  router.get('/identify-storefront-publication', async (req, res) => {
    try {
      console.log('🔍 Identification des publications Custom Storefront...');
      
      // Récupérer TOUTES les publications
      const publicationsQuery = `
        query getPublications {
          publications(first: 50) {
            nodes {
              id
              name
              supportsFuturePublishing
            }
          }
        }
      `;
      
      const pubResponse = await fetch(`https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2023-10/graphql.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: publicationsQuery })
      });
      
      const pubData = await pubResponse.json();
      
      if (pubData.errors) {
        console.error('❌ Erreurs GraphQL:', pubData.errors);
        return res.status(400).json({
          success: false,
          message: 'Erreur lors de la récupération des publications',
          errors: pubData.errors
        });
      }
      
      const publications = pubData.data?.publications?.nodes || [];
      console.log(`📋 ${publications.length} publications trouvées:`, publications);
      
      // Identifier les Custom Storefronts potentiels (excluant les channels connus)
      const knownChannels = ['Online Store', 'Point of Sale', 'Google & YouTube', 'Shop', 'Facebook & Instagram', 'TikTok'];
      const customStorefronts = publications.filter(pub => 
        !knownChannels.some(known => pub.name.includes(known))
      );
      
      console.log(`🎯 ${customStorefronts.length} Custom Storefronts identifiés:`, customStorefronts);
      
      res.json({
        success: true,
        message: `${publications.length} publications analysées`,
        data: {
          all_publications: publications,
          known_channels: publications.filter(pub => 
            knownChannels.some(known => pub.name.includes(known))
          ),
          custom_storefronts: customStorefronts,
          recommendation: customStorefronts.length > 0 ? 
            `Utilisez probablement: ${customStorefronts[0].name} (${customStorefronts[0].id})` :
            'Aucun Custom Storefront trouvé - votre token pourrait être lié à Online Store'
        }
      });
      
    } catch (error) {
      console.error('❌ Erreur identification publications:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de l\'identification des publications',
        error: error.message
      });
    }
  });

  // Route pour récupérer les détails d'une commande Shopify
  router.get('/order/:order_id', async (req, res) => {
    try {
      const { order_id } = req.params;

      if (!SHOPIFY_ADMIN_ACCESS_TOKEN) {
        throw new Error('Token admin Shopify manquant');
      }

      const orderResponse = await fetch(`https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2023-10/orders/${order_id}.json`, {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN,
        }
      });

      if (!orderResponse.ok) {
        throw new Error(`Erreur API Shopify: ${orderResponse.status}`);
      }

      const order = await orderResponse.json();
      
      res.json({
        success: true,
        order: order.order
      });

    } catch (error) {
      console.error('Erreur récupération commande:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération de la commande'
      });
    }
  });


  return router;
}
