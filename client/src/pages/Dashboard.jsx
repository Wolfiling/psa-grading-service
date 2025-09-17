import React, { useState, useEffect } from 'react';
import {
  Page,
  Layout,
  Card,
  DataTable,
  DisplayText,
  TextStyle,
  Badge,
  Button,
  Stack,
  Heading,
  Spinner,
  EmptyState,
  Icon
} from '@shopify/polaris';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [recentRequests, setRecentRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      
      // Fetch stats
      const statsResponse = await fetch('/api/grading/stats/overview');
      const statsData = await statsResponse.json();
      
      // Fetch recent requests
      const requestsResponse = await fetch('/api/grading?limit=5');
      const requestsData = await requestsResponse.json();
      
      if (statsData.success) {
        setStats(statsData.stats);
      }
      
      if (requestsData.success) {
        setRecentRequests(requestsData.requests.slice(0, 5));
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    const statusConfig = {
      pending: { status: 'attention', text: 'En attente' },
      in_progress: { status: 'info', text: 'En cours' },
      completed: { status: 'success', text: 'Terminé' },
      cancelled: { status: 'critical', text: 'Annulé' }
    };
    
    return statusConfig[status] || { status: 'new', text: status };
  };

  const formatPrice = (price) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR'
    }).format(price);
  };

  const recentRequestsRows = recentRequests.map(request => [
    request.submission_id,
    request.card_name,
    request.grading_type.toUpperCase(),
    <Badge {...getStatusBadge(request.status)}>{getStatusBadge(request.status).text}</Badge>,
    formatPrice(request.price),
    new Date(request.created_at).toLocaleDateString('fr-FR')
  ]);

  if (loading) {
    return (
      <Page title="Tableau de bord PSA">
        <Layout>
          <Layout.Section>
            <Card>
              <div style={{ textAlign: 'center', padding: '50px' }}>
                <Spinner size="large" />
              </div>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page 
      title="Tableau de bord PSA"
      subtitle="Gérez vos demandes de gradation PSA"
      primaryAction={{
        content: '+ Nouvelle demande',
        url: '/requests/new'
      }}
    >
      <Layout>
        {/* Stats Cards */}
        <Layout.Section>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
            <Card>
              <Card.Section>
                <Stack alignment="center">
                  <div style={{ fontSize: '24px' }}>📊</div>
                  <Stack vertical spacing="none">
                    <DisplayText size="medium">{stats?.total_requests || 0}</DisplayText>
                    <TextStyle variation="subdued">Total demandes</TextStyle>
                  </Stack>
                </Stack>
              </Card.Section>
            </Card>

            <Card>
              <Card.Section>
                <Stack alignment="center">
                  <div style={{ width: '20px', height: '20px', backgroundColor: '#FFA500', borderRadius: '50%' }}></div>
                  <Stack vertical spacing="none">
                    <DisplayText size="medium">{stats?.pending_requests || 0}</DisplayText>
                    <TextStyle variation="subdued">En attente</TextStyle>
                  </Stack>
                </Stack>
              </Card.Section>
            </Card>

            <Card>
              <Card.Section>
                <Stack alignment="center">
                  <div style={{ width: '20px', height: '20px', backgroundColor: '#007BFF', borderRadius: '50%' }}></div>
                  <Stack vertical spacing="none">
                    <DisplayText size="medium">{stats?.in_progress_requests || 0}</DisplayText>
                    <TextStyle variation="subdued">En cours</TextStyle>
                  </Stack>
                </Stack>
              </Card.Section>
            </Card>

            <Card>
              <Card.Section>
                <Stack alignment="center">
                  <div style={{ width: '20px', height: '20px', backgroundColor: '#28A745', borderRadius: '50%' }}></div>
                  <Stack vertical spacing="none">
                    <DisplayText size="medium">{stats?.completed_requests || 0}</DisplayText>
                    <TextStyle variation="subdued">Terminées</TextStyle>
                  </Stack>
                </Stack>
              </Card.Section>
            </Card>

            <Card>
              <Card.Section>
                <Stack alignment="center">
                  <div style={{ width: '20px', height: '20px', backgroundColor: '#003366', borderRadius: '50%' }}></div>
                  <Stack vertical spacing="none">
                    <DisplayText size="medium">{formatPrice(stats?.total_revenue || 0)}</DisplayText>
                    <TextStyle variation="subdued">Revenus total</TextStyle>
                  </Stack>
                </Stack>
              </Card.Section>
            </Card>
          </div>
        </Layout.Section>

        {/* Recent Requests */}
        <Layout.Section>
          <Card>
            <Card.Section>
              <Stack distribution="equalSpacing" alignment="center">
                <Heading>Demandes récentes</Heading>
                <Button url="/requests">Voir toutes</Button>
              </Stack>
            </Card.Section>
            
            {recentRequests.length > 0 ? (
              <DataTable
                columnContentTypes={['text', 'text', 'text', 'text', 'text', 'text']}
                headings={[
                  'ID Soumission',
                  'Carte',
                  'Type',
                  'Statut',
                  'Prix',
                  'Date'
                ]}
                rows={recentRequestsRows}
              />
            ) : (
              <Card.Section>
                <EmptyState
                  heading="Aucune demande pour le moment"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>Vos demandes de gradation PSA apparaîtront ici.</p>
                </EmptyState>
              </Card.Section>
            )}
          </Card>
        </Layout.Section>

        {/* Quick Actions */}
        <Layout.Section secondary>
          <Card title="Actions rapides" sectioned>
            <Stack vertical>
              <Button url="/requests/new" size="large">Créer nouvelle demande</Button>
              <Button url="/settings" outline>Configurer PSA</Button>
              <Button url="/help" outline>Guide d'utilisation</Button>
            </Stack>
          </Card>

          <Card title="Statut PSA" sectioned>
            <Stack vertical spacing="tight">
              <Stack distribution="equalSpacing">
                <TextStyle variation="strong">Service PSA</TextStyle>
                <Badge status="success">Opérationnel</Badge>
              </Stack>
              <Stack distribution="equalSpacing">
                <TextStyle>Délai moyen Value</TextStyle>
                <TextStyle>~40 jours</TextStyle>
              </Stack>
              <Stack distribution="equalSpacing">
                <TextStyle>Délai moyen Regular</TextStyle>
                <TextStyle>~20 jours</TextStyle>
              </Stack>
              <Stack distribution="equalSpacing">
                <TextStyle>Délai moyen Express</TextStyle>
                <TextStyle>~10 jours</TextStyle>
              </Stack>
            </Stack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}