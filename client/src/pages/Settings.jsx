import React, { useState, useCallback } from 'react';
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Select,
  Button,
  Stack,
  Banner,
  Checkbox,
  RangeSlider,
  ColorPicker,
  Heading,
  TextStyle
} from '@shopify/polaris';

export default function Settings() {
  const [settings, setSettings] = useState({
    // ✅ PSA Service Settings - PRIX DYNAMIQUES depuis psa_shopify_templates
    psaValuePrice: '',
    psaRegularPrice: '',
    psaExpressPrice: '',
    
    // Processing Times - DÉLAIS DYNAMIQUES depuis psa_shopify_templates
    psaValueDays: '',
    psaRegularDays: '',
    psaExpressDays: '',
    
    // Notifications
    emailNotifications: true,
    customerUpdates: true,
    adminNotifications: true,
    
    // Widget Settings
    widgetEnabled: true,
    widgetTitle: 'Gradation PSA',
    widgetPosition: 'bottom-right',
    widgetColor: '#003366',
    
    // Business Info
    businessName: '',
    contactEmail: '',
    returnAddress: '',
    
    // PSA Account
    psaAccountNumber: '',
    psaSubmitterName: '',
  });

  const [saved, setSaved] = useState(false);

  const handleSettingChange = useCallback((field, value) => {
    setSettings(prevSettings => ({
      ...prevSettings,
      [field]: value
    }));
  }, []);

  const handleSave = useCallback(async () => {
    try {
      // API call to save settings
      console.log('Saving settings:', settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  }, [settings]);

  return (
    <Page 
      title="Paramètres PSA"
      subtitle="Configurez votre service de gradation PSA"
      primaryAction={{
        content: 'Sauvegarder',
        onAction: handleSave
      }}
    >
      {saved && (
        <div style={{ marginBottom: '20px' }}>
          <Banner status="success" onDismiss={() => setSaved(false)}>
            Paramètres sauvegardés avec succès !
          </Banner>
        </div>
      )}

      <Layout>
        <Layout.Section>
          {/* PSA Service Pricing */}
          <Card title="Tarification PSA" sectioned>
            <FormLayout>
              <FormLayout.Group>
                <TextField
                  label="Prix PSA Value (€)"
                  value={settings.psaValuePrice}
                  onChange={(value) => handleSettingChange('psaValuePrice', value)}
                  type="number"
                  step="0.01"
                  prefix="€"
                />
                <TextField
                  label="Prix PSA Regular (€)"
                  value={settings.psaRegularPrice}
                  onChange={(value) => handleSettingChange('psaRegularPrice', value)}
                  type="number"
                  step="0.01"
                  prefix="€"
                />
                <TextField
                  label="Prix PSA Express (€)"
                  value={settings.psaExpressPrice}
                  onChange={(value) => handleSettingChange('psaExpressPrice', value)}
                  type="number"
                  step="0.01"
                  prefix="€"
                />
              </FormLayout.Group>
            </FormLayout>
          </Card>

          {/* Processing Times */}
          <Card title="Délais de traitement" sectioned>
            <FormLayout>
              <Stack vertical>
                <TextStyle variation="strong">PSA Value: {settings.psaValueDays} jours</TextStyle>
                <RangeSlider
                  label="Jours"
                  value={settings.psaValueDays}
                  onChange={(value) => handleSettingChange('psaValueDays', value)}
                  min={20}
                  max={60}
                  step={5}
                />
              </Stack>
              
              <Stack vertical>
                <TextStyle variation="strong">PSA Regular: {settings.psaRegularDays} jours</TextStyle>
                <RangeSlider
                  label="Jours"
                  value={settings.psaRegularDays}
                  onChange={(value) => handleSettingChange('psaRegularDays', value)}
                  min={10}
                  max={30}
                  step={2}
                />
              </Stack>
              
              <Stack vertical>
                <TextStyle variation="strong">PSA Express: {settings.psaExpressDays} jours</TextStyle>
                <RangeSlider
                  label="Jours"
                  value={settings.psaExpressDays}
                  onChange={(value) => handleSettingChange('psaExpressDays', value)}
                  min={5}
                  max={15}
                  step={1}
                />
              </Stack>
            </FormLayout>
          </Card>

          {/* Business Information */}
          <Card title="Informations entreprise" sectioned>
            <FormLayout>
              <TextField
                label="Nom de l'entreprise"
                value={settings.businessName}
                onChange={(value) => handleSettingChange('businessName', value)}
              />
              <TextField
                label="Email de contact"
                value={settings.contactEmail}
                onChange={(value) => handleSettingChange('contactEmail', value)}
                type="email"
              />
              <TextField
                label="Adresse de retour"
                value={settings.returnAddress}
                onChange={(value) => handleSettingChange('returnAddress', value)}
                multiline={3}
              />
            </FormLayout>
          </Card>

          {/* PSA Account Settings */}
          <Card title="Compte PSA" sectioned>
            <FormLayout>
              <TextField
                label="Numéro de compte PSA"
                value={settings.psaAccountNumber}
                onChange={(value) => handleSettingChange('psaAccountNumber', value)}
                helpText="Votre numéro de compte officiel PSA"
              />
              <TextField
                label="Nom du soumissionnaire PSA"
                value={settings.psaSubmitterName}
                onChange={(value) => handleSettingChange('psaSubmitterName', value)}
                helpText="Nom associé à votre compte PSA"
              />
            </FormLayout>
          </Card>
        </Layout.Section>

        <Layout.Section secondary>
          {/* Notifications */}
          <Card title="Notifications" sectioned>
            <Stack vertical>
              <Checkbox
                label="Notifications par email"
                checked={settings.emailNotifications}
                onChange={(value) => handleSettingChange('emailNotifications', value)}
              />
              <Checkbox
                label="Mises à jour clients"
                checked={settings.customerUpdates}
                onChange={(value) => handleSettingChange('customerUpdates', value)}
              />
              <Checkbox
                label="Notifications admin"
                checked={settings.adminNotifications}
                onChange={(value) => handleSettingChange('adminNotifications', value)}
              />
            </Stack>
          </Card>

          {/* Widget Settings */}
          <Card title="Widget boutique" sectioned>
            <FormLayout>
              <Checkbox
                label="Activer le widget PSA"
                checked={settings.widgetEnabled}
                onChange={(value) => handleSettingChange('widgetEnabled', value)}
              />
              
              {settings.widgetEnabled && (
                <>
                  <TextField
                    label="Titre du widget"
                    value={settings.widgetTitle}
                    onChange={(value) => handleSettingChange('widgetTitle', value)}
                  />
                  
                  <Select
                    label="Position du widget"
                    value={settings.widgetPosition}
                    onChange={(value) => handleSettingChange('widgetPosition', value)}
                    options={[
                      { label: 'Bas droite', value: 'bottom-right' },
                      { label: 'Bas gauche', value: 'bottom-left' },
                      { label: 'Haut droite', value: 'top-right' },
                      { label: 'Haut gauche', value: 'top-left' }
                    ]}
                  />

                  <div>
                    <TextStyle variation="strong">Couleur du widget</TextStyle>
                    <div style={{ marginTop: '10px' }}>
                      <ColorPicker
                        onChange={(value) => handleSettingChange('widgetColor', value.hex)}
                        color={settings.widgetColor}
                      />
                    </div>
                  </div>
                </>
              )}
            </FormLayout>
          </Card>

          {/* Help & Support */}
          <Card title="Aide & Support" sectioned>
            <Stack vertical>
              <Button outline>Guide d'installation</Button>
              <Button outline>Documentation API</Button>
              <Button outline>Contacter le support</Button>
            </Stack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}