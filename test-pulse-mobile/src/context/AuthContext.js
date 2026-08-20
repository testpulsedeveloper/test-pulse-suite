import React, { createContext, useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(null);
  const [cloudId, setCloudId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadAuthData = async () => {
      try {
        const storedToken = await SecureStore.getItemAsync('jira_access_token');
        const storedCloudId = await SecureStore.getItemAsync('jira_cloud_id');
        if (storedToken) {
          setToken(storedToken);
          setCloudId(storedCloudId);
        }
      } catch (e) {
        console.log('Failed to load auth data', e);
      } finally {
        setIsLoading(false);
      }
    };
    loadAuthData();
  }, []);

  const login = async (newToken, newCloudId) => {
    try {
      await SecureStore.setItemAsync('jira_access_token', newToken);
      if (newCloudId) {
        await SecureStore.setItemAsync('jira_cloud_id', newCloudId);
      }
      setToken(newToken);
      setCloudId(newCloudId);
    } catch (e) {
      console.log('Error saving auth data', e);
    }
  };

  const logout = async () => {
    try {
      await SecureStore.deleteItemAsync('jira_access_token');
      await SecureStore.deleteItemAsync('jira_cloud_id');
      setToken(null);
      setCloudId(null);
      // Forzar cierre de sesion en el navegador embebido para que no recuerde al usuario en OAuth
      WebBrowser.openBrowserAsync('https://id.atlassian.com/logout?continue=https://start.atlassian.com');
    } catch (e) {
      console.log('Error deleting auth data', e);
    }
  };

  return (
    <AuthContext.Provider value={{ token, cloudId, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
