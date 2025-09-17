import express from 'express';
import { getCardScraper } from '../services/cardScraper.js';

export const createCardRoutes = () => {
  const router = express.Router();

// Rechercher des cartes
router.get('/search', async (req, res) => {
  try {
    const { q: query } = req.query;
    
    if (!query || query.trim().length < 2) {
      return res.json({
        success: false,
        message: 'Veuillez saisir au moins 2 caractères pour la recherche'
      });
    }

    console.log(`🔍 Recherche de cartes: "${query}"`);
    
    const scraper = await getCardScraper();
    const cards = await scraper.searchCards(query.trim());
    
    res.json({
      success: true,
      cards: cards,
      total: cards.length
    });
  } catch (error) {
    console.error('❌ Erreur lors de la recherche de cartes:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la recherche de cartes'
    });
  }
});

// Obtenir les cartes populaires
router.get('/popular', async (req, res) => {
  try {
    console.log('🎴 Récupération des cartes populaires');
    
    const scraper = await getCardScraper();
    const cards = await scraper.getCardsByPopularity();
    
    res.json({
      success: true,
      cards: cards,
      total: cards.length
    });
  } catch (error) {
    console.error('❌ Erreur lors de la récupération des cartes populaires:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des cartes populaires'
    });
  }
});

// Forcer la mise à jour du cache
router.post('/refresh', async (req, res) => {
  try {
    console.log('🔄 Rafraîchissement forcé du cache des cartes');
    
    const scraper = await getCardScraper();
    const cards = await scraper.getAllCards();
    
    res.json({
      success: true,
      message: `Cache mis à jour avec ${cards.length} cartes`,
      total: cards.length
    });
  } catch (error) {
    console.error('❌ Erreur lors du rafraîchissement du cache:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du rafraîchissement du cache'
    });
  }
});

// NOUVEL ENDPOINT : Tester les vraies données de l'API externe 
router.get('/external', async (req, res) => {
  try {
    console.log('🌐 Test des vraies données depuis l\'API externe...');
    
    const scraper = await getCardScraper();
    // Force l'utilisation des vraies API au lieu du fallback
    const realCards = await scraper.fetchRealCardsFromAPI();
    
    // Test spécifique pour s12a 260 (devrait être "Origin Forme Dialga VSTAR")
    const s12a260 = realCards.find(card => 
      card.series && card.series.toLowerCase().includes('s12a 260')
    );
    
    res.json({
      success: true,
      message: 'Test des vraies données API externe',
      totalCards: realCards.length,
      sampleCards: realCards.slice(0, 10),
      s12a260Test: s12a260 ? {
        found: true,
        name: s12a260.name,
        series: s12a260.series,
        isCorrectName: s12a260.name === 'Origin Forme Dialga VSTAR',
        expectedName: 'Origin Forme Dialga VSTAR'
      } : {
        found: false,
        message: 'Carte s12a 260 non trouvée dans les données API'
      },
      apiSources: [
        'TCGdx API (https://api.tcgdx.net) - Priorité 1',
        'Données de fallback avec vrais noms - Priorité 2'
      ]
    });
  } catch (error) {
    console.error('❌ Erreur lors du test API externe:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du test des données API externe',
      error: error.message
    });
  }
});

  return router;
};