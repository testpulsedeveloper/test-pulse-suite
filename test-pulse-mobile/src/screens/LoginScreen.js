import React, { useContext, useState, useEffect } from 'react';
import { View, StyleSheet, Text, Platform, Alert, Image } from 'react-native';
import { Button, Surface, useTheme } from 'react-native-paper';
import { AuthContext } from '../context/AuthContext';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';

WebBrowser.maybeCompleteAuthSession();

// Credentials provided by the user
const CLIENT_ID = 'JqrGfXYHkN9sKWV0g2HB40Zhau2UHyz5';
const CLIENT_SECRET = 'YOUR_CLIENT_SECRET_HERE';

// Endpoints
const discovery = {
  authorizationEndpoint: 'https://auth.atlassian.com/authorize',
  tokenEndpoint: 'https://auth.atlassian.com/oauth/token',
};

export default function LoginScreen() {
  const { login } = useContext(AuthContext);
  const theme = useTheme();
  
  const [loading, setLoading] = useState(false);

  const redirectUri = AuthSession.makeRedirectUri({
    scheme: 'testpulse',
    useProxy: false
  });

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: CLIENT_ID,
      scopes: ['read:jira-work', 'write:jira-work', 'read:jira-user', 'offline_access'],
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      extraParams: {
        audience: 'api.atlassian.com',
        prompt: 'consent',
      },
    },
    discovery
  );

  useEffect(() => {
    if (response?.type === 'success') {
      const { code } = response.params;
      exchangeCodeForToken(code);
    } else if (response?.type === 'error') {
      Alert.alert('Error de Autenticación', response.error?.message || 'Algo salió mal.');
    }
  }, [response]);

  const exchangeCodeForToken = async (code) => {
    setLoading(true);
    try {
      // 1. Exchange authorization code for access token
      const tokenResponse = await fetch(discovery.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code,
          redirect_uri: redirectUri,
          code_verifier: request?.codeVerifier,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(`Failed to exchange code for token: ${tokenResponse.status} - ${errorText}`);
      }

      const tokenData = await tokenResponse.json();
      const accessToken = tokenData.access_token;

      // 2. Fetch accessible resources to get cloudId
      const resourcesResponse = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json'
        }
      });

      if (!resourcesResponse.ok) {
        throw new Error('Failed to fetch accessible resources');
      }

      const resourcesData = await resourcesResponse.json();
      
      if (resourcesData.length === 0) {
        throw new Error('No Jira sites accessible for this user.');
      }

      // Normally we'd let the user select a site, but we assume the first one (Liverpool Digital)
      const cloudId = resourcesData[0].id;

      // 3. Save into context
      await login(`Bearer ${accessToken}`, cloudId);

    } catch (error) {
      console.error(error);
      Alert.alert('Error', `No se pudo completar el inicio de sesión.\n${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Surface style={styles.content}>
        <View style={styles.logoContainer}>
          <Text style={{ fontSize: 60 }}>🚀</Text>
          <Text style={[styles.title, { color: '#D81B60' }]}>Test Pulse</Text>
          <Text style={styles.subtitle}>Mobile Execution</Text>
        </View>

        <Text style={styles.infoText}>
          Inicia sesión de forma segura utilizando tu cuenta corporativa de Jira.
        </Text>

        <Button 
          mode="contained" 
          onPress={() => promptAsync()}
          loading={loading}
          disabled={!request || loading}
          buttonColor="#D81B60"
          style={styles.button}
        >
          Iniciar Sesión con SSO
        </Button>

        <View style={styles.debugContainer}>
          <Text style={styles.debugTitle}>⚠️ Importante para OAuth:</Text>
          <Text style={styles.debugText}>
            Asegúrate de que esta URL exacta esté configurada en "Callback URL" en la consola de Atlassian:
          </Text>
          <Text style={styles.debugUri} selectable={true}>{redirectUri}</Text>
        </View>
      </Surface>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { flex: 1, justifyContent: 'center', padding: 20 },
  logoContainer: { alignItems: 'center', marginBottom: 40 },
  logoImage: { width: 100, height: 100, marginBottom: 15, borderRadius: 20 },
  title: { fontSize: 42, fontWeight: 'bold' },
  subtitle: { fontSize: 18, color: '#666', marginTop: 5 },
  infoText: { textAlign: 'center', color: '#555', marginBottom: 30, fontSize: 16 },
  button: { width: '100%', paddingVertical: 8, borderRadius: 8 },
  debugContainer: { marginTop: 40, padding: 15, backgroundColor: '#FFF4E5', borderRadius: 8, borderWidth: 1, borderColor: '#FFB020' },
  debugTitle: { fontWeight: 'bold', color: '#B25E02', marginBottom: 5 },
  debugText: { fontSize: 12, color: '#666', marginBottom: 10 },
  debugUri: { fontSize: 13, color: '#333', fontWeight: '500', padding: 8, backgroundColor: '#fff', borderRadius: 4, borderWidth: 1, borderColor: '#ddd' }
});
