import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AppProvider, Frame } from '@shopify/polaris';
import '@shopify/polaris/build/esm/styles.css';
import Dashboard from './pages/Dashboard';
import GradingRequests from './pages/GradingRequests';
import Settings from './pages/Settings';
import Navigation from './components/Navigation';

function App() {
  return (
    <AppProvider 
      i18n={{}}
      features={{
        newDesignLanguage: true,
      }}
    >
      <Router>
        <Frame navigation={<Navigation />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/requests" element={<GradingRequests />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </Frame>
      </Router>
    </AppProvider>
  );
}

export default App;