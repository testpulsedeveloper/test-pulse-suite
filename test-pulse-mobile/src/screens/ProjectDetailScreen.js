import React, { useContext, useEffect, useState } from 'react';
import { View, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { Surface, Text, Card, useTheme, Appbar, Chip, FAB, Portal, Modal, TextInput, Button, RadioButton, Snackbar } from 'react-native-paper';
import { AuthContext } from '../context/AuthContext';
import { fetchProjectPlans, fetchProjectConfig, createJiraIssue } from '../api/jiraApi';

export default function ProjectDetailScreen({ route, navigation }) {
  const { project } = route.params;
  const { token, cloudId } = useContext(AuthContext);
  const theme = useTheme();

  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState(null);

  // Modal State
  const [modalVisible, setModalVisible] = useState(false);
  const [summary, setSummary] = useState('');
  const [creating, setCreating] = useState(false);
  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');

  useEffect(() => {
    loadPlans();
    loadConfig();
  }, [project.key]);

  const loadConfig = async () => {
    const c = await fetchProjectConfig(token, cloudId, project.key);
    setConfig(c);
  };

  const loadPlans = async () => {
    try {
      setLoading(true);
      const data = await fetchProjectPlans(token, cloudId, project.key);
      setPlans(data);
    } catch (e) {
      console.log('Failed to fetch plans', e);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!summary.trim()) {
      setSnackbarMessage('El nombre es obligatorio');
      setSnackbarVisible(true);
      return;
    }
    
    if (!config) {
      setSnackbarMessage('Cargando configuración... intenta de nuevo');
      setSnackbarVisible(true);
      return;
    }

    try {
      setCreating(true);
      const issueTypeName = config.planIssueType;
      await createJiraIssue(token, cloudId, project.key, summary, issueTypeName);
      
      setModalVisible(false);
      setSummary('');
      setSnackbarMessage('Test Plan creado exitosamente');
      setSnackbarVisible(true);
      
      loadPlans();
    } catch (e) {
      console.error(e);
      setSnackbarMessage('Error al crear. Verifica tus permisos.');
      setSnackbarVisible(true);
    } finally {
      setCreating(false);
    }
  };

  const renderPlan = ({ item }) => {
    const status = item.fields?.status?.name || 'To Do';
    
    return (
      <Card style={styles.card} onPress={() => navigation.navigate('PlanDetail', { plan: item, project })}>
        <Card.Title
          title={item.fields?.summary}
          subtitle={`Key: ${item.key}`}
        />
        <Card.Content>
          <View style={styles.chipContainer}>
            <Chip style={styles.chip} textStyle={styles.chipText}>{status}</Chip>
          </View>
        </Card.Content>
      </Card>
    );
  };

  return (
    <Surface style={styles.container}>
      <Appbar.Header style={{ backgroundColor: theme.colors.primary }}>
        <Appbar.BackAction color="#fff" onPress={() => navigation.goBack()} />
        <Appbar.Content title={project.name} color="#fff" />
      </Appbar.Header>

      <View style={styles.content}>
        <Text style={styles.sectionTitle}>Test Plans Activos</Text>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={{ marginTop: 10 }}>Cargando planes de prueba...</Text>
          </View>
        ) : (
          <FlatList
            data={plans}
            keyExtractor={(item) => item.id}
            renderItem={renderPlan}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<Text style={styles.empty}>No se encontraron Test Plans en este proyecto.</Text>}
          />
        )}
      </View>

      <FAB
        style={[styles.fab, { backgroundColor: theme.colors.accent }]}
        icon="plus"
        color="white"
        onPress={() => setModalVisible(true)}
      />

      <Portal>
        <Modal visible={modalVisible} onDismiss={() => setModalVisible(false)} contentContainerStyle={styles.modalContainer}>
          <Text style={styles.modalTitle}>Crear Nuevo Test Plan</Text>

          <TextInput
            label="Nombre"
            value={summary}
            onChangeText={text => setSummary(text)}
            style={styles.input}
            mode="outlined"
            disabled={creating}
          />
          
          <Button 
            mode="contained" 
            onPress={handleCreate} 
            loading={creating} 
            disabled={creating}
            style={styles.createButton}
          >
            Crear
          </Button>
        </Modal>

        <Snackbar
          visible={snackbarVisible}
          onDismiss={() => setSnackbarVisible(false)}
          duration={3000}
        >
          {snackbarMessage}
        </Snackbar>
      </Portal>
    </Surface>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F5F7',
  },
  content: {
    flex: 1,
    padding: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#172B4D',
  },
  list: {
    paddingBottom: 80,
  },
  card: {
    marginBottom: 15,
    backgroundColor: '#fff',
    elevation: 2,
  },
  chipContainer: {
    flexDirection: 'row',
    marginTop: 10,
  },
  chip: {
    backgroundColor: '#DFE1E6',
  },
  chipText: {
    fontSize: 12,
    color: '#42526E',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  empty: {
    textAlign: 'center',
    marginTop: 50,
    color: '#666',
  },
  fab: {
    position: 'absolute',
    margin: 16,
    right: 0,
    bottom: 0,
  },
  modalContainer: {
    backgroundColor: 'white',
    padding: 20,
    margin: 20,
    borderRadius: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#172B4D',
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 5,
  },
  input: {
    marginTop: 10,
    marginBottom: 20,
  },
  createButton: {
    marginTop: 10,
  }
});
