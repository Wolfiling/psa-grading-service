import express from 'express';

export function createWebhookRoutes(shopify) {
  const router = express.Router();

  // App uninstalled webhook
  router.post('/app/uninstalled', async (req, res) => {
    try {
      console.log('App uninstalled from shop:', req.body.domain);
      // Clean up shop data if needed
      res.status(200).send('OK');
    } catch (error) {
      console.error('Error handling app uninstall:', error);
      res.status(500).send('Error');
    }
  });

  // Order created webhook - useful for connecting to existing orders
  router.post('/orders/create', async (req, res) => {
    try {
      console.log('New order created:', req.body.id);
      // You could automatically check for PSA grading requests here
      res.status(200).send('OK');
    } catch (error) {
      console.error('Error handling order creation:', error);
      res.status(500).send('Error');
    }
  });

  return router;
}