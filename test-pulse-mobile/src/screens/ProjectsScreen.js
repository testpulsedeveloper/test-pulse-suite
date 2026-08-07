import React, { useContext, useEffect, useState } from 'react';
import { View, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { Surface, Text, Card, Title, useTheme, Avatar } from 'react-native-paper';
import { AuthContext } from '../context/AuthContext';
import { fetchProjects } from '../api/jiraApi';

export default function ProjectsScreen({ navigation }) {
  const { token, cloudId, logout } = useContext(AuthContext);
  const theme = useTheme();
  
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (token) {
      loadProjects();
    }
  }, [token]);

  const loadProjects = async () => {
    try {
      setLoading(true);
      const data = await fetchProjects(token, cloudId);
      setProjects(data);
    } catch (e) {
      console.log('Failed to fetch projects', e);
    } finally {
      setLoading(false);
    }
  };

  const renderProject = ({ item }) => (
    <Card style={styles.card} onPress={() => navigation.navigate('ProjectDetail', { project: item })}>
      <Card.Title
        title={item.name}
        subtitle={`Key: ${item.key}`}
        left={(props) => (
          <Avatar.Image 
            {...props} 
            source={{ uri: item.avatarUrls?.['48x48'] }} 
            size={40} 
            style={{ backgroundColor: 'transparent' }}
          />
        )}
      />
    </Card>
  );

  return (
    <Surface style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.colors.primary }]}>Proyectos</Text>
        <Text style={styles.logoutBtn} onPress={logout}>Cerrar Sesión</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={{ marginTop: 10 }}>Cargando proyectos...</Text>
        </View>
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(item) => item.id}
          renderItem={renderProject}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>No se encontraron proyectos.</Text>}
        />
      )}
    </Surface>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F5F7',
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 20,
    backgroundColor: '#fff',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    borderBottomWidth: 1,
    borderBottomColor: '#EBECF0',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  logoutBtn: {
    color: '#0052CC',
    fontWeight: '600'
  },
  list: {
    padding: 15,
  },
  card: {
    marginBottom: 15,
    backgroundColor: '#fff',
    elevation: 2,
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
