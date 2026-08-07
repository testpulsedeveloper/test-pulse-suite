import React, { useContext, useEffect, useState } from 'react';
import { View, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { Surface, Text, Card, useTheme, Appbar, Chip, Button, IconButton, Divider } from 'react-native-paper';
import { AuthContext } from '../context/AuthContext';
import { fetchCycleExecution, saveCycleExecution, uploadAttachment } from '../api/jiraApi';
import * as ImagePicker from 'expo-image-picker';

export default function ExecutionScreen({ route, navigation }) {
  const { cycle } = route.params;
  const { token, cloudId } = useContext(AuthContext);
  const theme = useTheme();

  const [executionData, setExecutionData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedCaseId, setExpandedCaseId] = useState(null);

  useEffect(() => {
    loadExecutionData();
  }, [cycle.key]);

  const loadExecutionData = async () => {
    try {
      setLoading(true);
      const data = await fetchCycleExecution(token, cloudId, cycle.id);
      setExecutionData(data);
    } catch (e) {
      console.log('Failed to fetch execution data', e);
      Alert.alert('Error', 'No se pudo cargar la información de ejecución');
    } finally {
      setLoading(false);
    }
  };

  const updateCaseStatus = async (testId, newStatus) => {
    if (!executionData) return;
    
    // Optimistic update
    const newData = executionData.map(t => 
      t.id === testId ? { ...t, status: newStatus } : t
    );
    
    setExecutionData(newData);

    // Save to Jira
    const success = await saveCycleExecution(token, cloudId, cycle.id, newData);
    if (!success) {
      Alert.alert('Error', 'No se pudo guardar el estado');
      loadExecutionData(); // Revert on failure
    }
  };

  const promptEvidenceAction = (testId) => {
    Alert.alert(
      'Añadir Evidencia',
      '¿Desde dónde quieres subir la evidencia (foto o video)?',
      [
        { text: 'Cámara', onPress: () => takeEvidence(testId, false) },
        { text: 'Galería', onPress: () => takeEvidence(testId, true) },
        { text: 'Cancelar', style: 'cancel' }
      ]
    );
  };

  const takeEvidence = async (testId, fromGallery) => {
    try {
      let permissionResult;
      if (fromGallery) {
        permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      } else {
        permissionResult = await ImagePicker.requestCameraPermissionsAsync();
      }
      
      if (permissionResult.granted === false) {
        Alert.alert('Permiso denegado', 'Necesitas dar acceso para continuar.');
        return;
      }

      const pickerOptions = {
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        allowsEditing: true,
        quality: 0.5,
        videoMaxDuration: 60, // Limitar video a 60 segundos
      };

      const result = fromGallery 
        ? await ImagePicker.launchImageLibraryAsync(pickerOptions)
        : await ImagePicker.launchCameraAsync(pickerOptions);

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const fileUri = result.assets[0].uri;
        let mimeType = result.assets[0].mimeType || (result.assets[0].type === 'video' ? 'video/mp4' : 'image/jpeg');
        
        // Find the test case first to make sure it's valid
        if (!executionData) return;
        const testCase = executionData.find(t => t.id === testId);
        if (!testCase) return;

        // Upload attachment
        Alert.alert('Subiendo...', 'Se está subiendo la evidencia a Jira (puede tardar un poco dependiendo del tamaño)');
        
        const attachmentResponse = await uploadAttachment(
          token, 
          cloudId, 
          testId, 
          fileUri,
          mimeType
        );

        if (attachmentResponse && attachmentResponse.length > 0) {
          const newEvidence = {
            id: attachmentResponse[0].id,
            filename: attachmentResponse[0].filename,
            url: attachmentResponse[0].content
          };
          
          // Actualizar el JSON de ejecución con la nueva evidencia
          const currentEvidences = testCase.evidences || [];
          const newData = executionData.map(t => 
            t.id === testId ? { ...t, evidences: [...currentEvidences, newEvidence] } : t
          );
          
          setExecutionData(newData);
          await saveCycleExecution(token, cloudId, cycle.id, newData);
          Alert.alert('Éxito', 'Evidencia subida correctamente.');
        }
      }
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'No se pudo subir la evidencia.');
    }
  };

  const getStatusColor = (status) => {
    switch(status) {
      case 'Passed': return '#36B37E';
      case 'Failed': return '#FF5630';
      case 'Blocked': return '#FFAB00';
      default: return '#DFE1E6';
    }
  };

  // Helper function to extract plain text from Jira ADF (Atlassian Document Format) or HTML string
  const renderDescription = (desc) => {
    if (!desc) return "No hay detalles cargados desde Jira.";
    if (typeof desc === 'string') {
       // Simple HTML strip
       let text = desc.replace(/<br\s*\/?>/gi, '\n');
       text = text.replace(/<\/p>|<\/li>|<\/h[1-6]>/gi, '\n');
       text = text.replace(/<[^>]+>/g, '');
       
       // Decode common HTML entities
       text = text.replace(/&nbsp;/g, ' ')
                  .replace(/&lt;/g, '<')
                  .replace(/&gt;/g, '>')
                  .replace(/&amp;/g, '&')
                  .replace(/&quot;/g, '"')
                  .replace(/&#39;/g, "'");

       // Clean up excessive newlines
       text = text.replace(/\n\s*\n/g, '\n\n');

       return text.trim() || desc;
    }
    
    // Si es un objeto ADF, extraer el texto
    try {
      if (desc.type === 'doc' && desc.content) {
        let text = '';
        const extractText = (nodes) => {
          nodes.forEach(node => {
            if (node.type === 'text') text += node.text;
            if (node.type === 'paragraph') text += '\n';
            if (node.type === 'bulletList' || node.type === 'orderedList') text += '\n';
            if (node.type === 'listItem') text += '• ';
            if (node.content) extractText(node.content);
          });
        };
        extractText(desc.content);
        return text.trim() || "Descripción vacía.";
      }
      return JSON.stringify(desc); // Fallback
    } catch (e) {
      return "Formato de descripción no soportado.";
    }
  };

  const renderTestCase = ({ item }) => {
    const isExpanded = expandedCaseId === item.id;
    const statusColor = getStatusColor(item.status);

    return (
      <Card 
        style={[styles.card, { borderColor: statusColor, borderWidth: 1 }]} 
        onPress={() => setExpandedCaseId(isExpanded ? null : item.id)}
      >
        <View style={styles.cardHeader}>
          <View style={[styles.cardTitleContainer, { flex: 1, paddingRight: 10 }]}>
            <Text style={styles.caseKey}>{item.key || item.id}</Text>
            <Text style={styles.caseSummary} numberOfLines={2}>{item.summary}</Text>
          </View>
          <Chip style={{ backgroundColor: statusColor }} textStyle={{ color: item.status === 'To Do' ? '#000' : '#fff' }}>
            {item.status || 'To Do'}
          </Chip>
        </View>

        {isExpanded && (
          <View style={styles.cardDetails}>
            <Divider style={{ marginVertical: 10 }} />
            
            <Text style={styles.stepsTitle}>Detalles / Pasos:</Text>
            <Text style={styles.stepText}>
              {renderDescription(item.description)}
            </Text>

            <View style={styles.actionsContainer}>
              <View style={styles.statusButtonsRow}>
                <Button mode="contained" buttonColor="#36B37E" style={styles.actionBtn} onPress={() => updateCaseStatus(item.id, 'Passed')}>Pass</Button>
                <Button mode="contained" buttonColor="#FF5630" style={styles.actionBtn} onPress={() => updateCaseStatus(item.id, 'Failed')}>Fail</Button>
                <Button mode="contained" buttonColor="#FFAB00" style={styles.actionBtn} onPress={() => updateCaseStatus(item.id, 'Blocked')}>Block</Button>
              </View>
              
              <Button 
                icon="camera" 
                mode="outlined" 
                textColor="#D81B60"
                style={{ borderColor: '#D81B60', marginTop: 10 }} 
                onPress={() => promptEvidenceAction(item.id)}
              >
                Añadir Evidencia
              </Button>
              
              {item.evidences && item.evidences.length > 0 && (
                <Text style={{ marginTop: 5, fontSize: 12, color: '#666', textAlign: 'center' }}>
                  {item.evidences.length} evidencia(s) adjuntadas
                </Text>
              )}
            </View>
          </View>
        )}
      </Card>
    );
  };

  return (
    <Surface style={styles.container}>
      <Appbar.Header style={{ backgroundColor: theme.colors.primary }}>
        <Appbar.BackAction color="#fff" onPress={() => navigation.goBack()} />
        <Appbar.Content title={cycle.fields?.summary || cycle.key} subtitle="Ejecución de Ciclo" color="#fff" />
      </Appbar.Header>

      <View style={styles.content}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={{ marginTop: 10 }}>Cargando casos de prueba...</Text>
          </View>
        ) : (
          <FlatList
            data={executionData || []}
            keyExtractor={(item) => item.id}
            renderItem={renderTestCase}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<Text style={styles.empty}>Este ciclo no tiene casos asignados.</Text>}
          />
        )}
      </View>
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
    padding: 10,
  },
  list: {
    paddingBottom: 20,
  },
  card: {
    marginBottom: 10,
    backgroundColor: '#fff',
    elevation: 2,
    padding: 15,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#172B4D',
  },
  cardDetails: {
    marginTop: 5,
  },
  stepsTitle: {
    fontWeight: 'bold',
    marginBottom: 5,
    color: '#172B4D',
  },
  stepText: {
    fontSize: 14,
    marginBottom: 4,
    color: '#42526E',
  },
  actionsContainer: {
    marginTop: 15,
  },
  statusButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionBtn: {
    flex: 1,
    marginHorizontal: 2,
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
  }
});
