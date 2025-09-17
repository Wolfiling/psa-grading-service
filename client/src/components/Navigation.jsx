import React from 'react';
import { Navigation as PolarisNavigation } from '@shopify/polaris';
// import { HomeMinor, OrdersMinor, SettingsMinor } from '@shopify/polaris-icons';
import { useLocation } from 'react-router-dom';

export default function Navigation() {
  const location = useLocation();

  return (
    <PolarisNavigation location={location.pathname}>
      <PolarisNavigation.Section
        items={[
          {
            url: '/',
            label: '🏠 Tableau de bord',
            selected: location.pathname === '/',
          },
          {
            url: '/requests',
            label: '📋 Demandes PSA',
            selected: location.pathname === '/requests',
            badge: '3',
          },
          {
            url: '/settings',
            label: '⚙️ Paramètres',
            selected: location.pathname === '/settings',
          },
        ]}
      />
    </PolarisNavigation>
  );
}