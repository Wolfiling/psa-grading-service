import React, { useState, useEffect } from 'react';
import {
  Page,
  Card,
  DataTable,
  Filters,
  Button,
  Badge,
  Modal,
  TextField,
  Select,
  Stack,
  TextContainer,
  DisplayText,
  TextStyle,
  Spinner,
  EmptyState,
  Pagination
} from '@shopify/polaris';

export default function GradingRequests() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [modalActive, setModalActive] = useState(false);
  const [filters, setFilters] = useState({
    status: '',
    grading_type: '',
    query: ''
  });

  useEffect(() => {
    fetchRequests();
  }, [filters]);

  const fetchRequests = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/grading');
      const data = await response.json();
      
      if (data.success) {
        setRequests(data.requests);
      }
    } catch (error) {
      console.error('Error fetching requests:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusUpdate = async (requestId, newStatus) => {
    try {
      const response = await fetch(`/api/grading/${requestId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: newStatus,
          tracking_number: selectedRequest?.tracking_number || '',
          psa_submission_number: selectedRequest?.psa_submission_number || '',
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        fetchRequests(); // Refresh the list
        setModalActive(false);
        setSelectedRequest(null);
      }
    } catch (error) {
      console.error('Error updating status:', error);
    }
  };

  const getStatusBadge = (status) => {
    const statusConfig = {
      pending: { status: 'attention', text: 'En attente' },
      in_progress: { status: 'info', text: 'En cours' },
      shipped: { status: 'warning', text: 'Expédié' },
      at_psa: { status: 'info', text: 'Chez PSA' },
      graded: { status: 'success', text: 'Gradé' },
      returned: { status: 'success', text: 'Retourné' },
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

  const filteredRequests = requests.filter(request => {
    if (filters.status && request.status !== filters.status) return false;
    if (filters.grading_type && request.grading_type !== filters.grading_type) return false;
    if (filters.query && !request.card_name.toLowerCase().includes(filters.query.toLowerCase())) return false;
    return true;
  });

  const rows = filteredRequests.map(request => [
    request.submission_id,
    request.customer_email,
    request.card_name,
    request.grading_type.toUpperCase(),
    <Badge {...getStatusBadge(request.status)}>{getStatusBadge(request.status).text}</Badge>,
    formatPrice(request.price),
    new Date(request.created_at).toLocaleDateString('fr-FR'),
    <Button 
      size="slim" 
      onClick={() => {
        setSelectedRequest(request);
        setModalActive(true);
      }}
    >
      Voir
    </Button>
  ]);

  if (loading) {
    return (
      <Page title="Demandes PSA">
        <Card>
          <div style={{ textAlign: 'center', padding: '50px' }}>
            <Spinner size="large" />
          </div>
        </Card>
      </Page>
    );
  }

  return (
    <Page 
      title="Demandes de gradation PSA"
      subtitle={`${filteredRequests.length} demande${filteredRequests.length > 1 ? 's' : ''}`}
      primaryAction={{
        content: '+ Créer demande'
      }}
    >
      <Card>
        <div style={{ padding: '16px' }}>
          <Filters
            queryValue={filters.query}
            filters={[
              {
                key: 'status',
                label: 'Statut',
                filter: (
                  <Select
                    options={[
                      { label: 'Tous les statuts', value: '' },
                      { label: 'En attente', value: 'pending' },
                      { label: 'En cours', value: 'in_progress' },
                      { label: 'Expédié', value: 'shipped' },
                      { label: 'Chez PSA', value: 'at_psa' },
                      { label: 'Gradé', value: 'graded' },
                      { label: 'Retourné', value: 'returned' },
                      { label: 'Terminé', value: 'completed' },
                      { label: 'Annulé', value: 'cancelled' }
                    ]}
                    value={filters.status}
                    onChange={(value) => setFilters({...filters, status: value})}
                  />
                ),
                shortcut: true
              },
              {
                key: 'grading_type',
                label: 'Type PSA',
                filter: (
                  <Select
                    options={[
                      { label: 'Tous les types', value: '' },
                      { label: 'PSA Value', value: 'value' },
                      { label: 'PSA Regular', value: 'regular' },
                      { label: 'PSA Express', value: 'express' }
                    ]}
                    value={filters.grading_type}
                    onChange={(value) => setFilters({...filters, grading_type: value})}
                  />
                ),
                shortcut: true
              }
            ]}
            appliedFilters={[]}
            onQueryChange={(value) => setFilters({...filters, query: value})}
            onQueryClear={() => setFilters({...filters, query: ''})}
            onClearAll={() => setFilters({ status: '', grading_type: '', query: '' })}
          />
        </div>

        {filteredRequests.length > 0 ? (
          <DataTable
            columnContentTypes={['text', 'text', 'text', 'text', 'text', 'text', 'text', 'text']}
            headings={[
              'ID Soumission',
              'Client',
              'Carte',
              'Type PSA',
              'Statut',
              'Prix',
              'Date',
              'Actions'
            ]}
            rows={rows}
            sortable={[true, true, true, true, true, true, true, false]}
          />
        ) : (
          <Card.Section>
            <EmptyState
              heading="Aucune demande trouvée"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Ajustez vos filtres ou créez votre première demande PSA.</p>
            </EmptyState>
          </Card.Section>
        )}
      </Card>

      {selectedRequest && (
        <Modal
          open={modalActive}
          onClose={() => {
            setModalActive(false);
            setSelectedRequest(null);
          }}
          title={`Demande ${selectedRequest.submission_id}`}
          primaryAction={{
            content: 'Fermer',
            onAction: () => {
              setModalActive(false);
              setSelectedRequest(null);
            }
          }}
          secondaryActions={[
            {
              content: 'Modifier statut',
              onAction: () => {
                // Handle status update
                const newStatus = prompt('Nouveau statut:', selectedRequest.status);
                if (newStatus && newStatus !== selectedRequest.status) {
                  handleStatusUpdate(selectedRequest.id, newStatus);
                }
              }
            }
          ]}
        >
          <Modal.Section>
            <Stack vertical>
              <TextContainer>
                <DisplayText size="small">Détails de la demande</DisplayText>
                
                <div style={{ marginTop: '16px' }}>
                  <Stack vertical spacing="tight">
                    <Stack distribution="equalSpacing">
                      <TextStyle variation="strong">Client:</TextStyle>
                      <TextStyle>{selectedRequest.customer_email}</TextStyle>
                    </Stack>
                    
                    <Stack distribution="equalSpacing">
                      <TextStyle variation="strong">Carte:</TextStyle>
                      <TextStyle>{selectedRequest.card_name}</TextStyle>
                    </Stack>
                    
                    <Stack distribution="equalSpacing">
                      <TextStyle variation="strong">Type PSA:</TextStyle>
                      <TextStyle>{selectedRequest.grading_type.toUpperCase()}</TextStyle>
                    </Stack>
                    
                    <Stack distribution="equalSpacing">
                      <TextStyle variation="strong">Prix:</TextStyle>
                      <TextStyle>{formatPrice(selectedRequest.price)}</TextStyle>
                    </Stack>
                    
                    <Stack distribution="equalSpacing">
                      <TextStyle variation="strong">Statut:</TextStyle>
                      <Badge {...getStatusBadge(selectedRequest.status)}>
                        {getStatusBadge(selectedRequest.status).text}
                      </Badge>
                    </Stack>
                    
                    {selectedRequest.estimated_completion && (
                      <Stack distribution="equalSpacing">
                        <TextStyle variation="strong">Estimation:</TextStyle>
                        <TextStyle>
                          {new Date(selectedRequest.estimated_completion).toLocaleDateString('fr-FR')}
                        </TextStyle>
                      </Stack>
                    )}
                    
                    {selectedRequest.tracking_number && (
                      <Stack distribution="equalSpacing">
                        <TextStyle variation="strong">Suivi:</TextStyle>
                        <TextStyle>{selectedRequest.tracking_number}</TextStyle>
                      </Stack>
                    )}
                    
                    {selectedRequest.comments && (
                      <Stack distribution="equalSpacing">
                        <TextStyle variation="strong">Commentaires:</TextStyle>
                        <TextStyle>{selectedRequest.comments}</TextStyle>
                      </Stack>
                    )}
                  </Stack>
                </div>
              </TextContainer>
            </Stack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}