const fs = require('fs');
let authContext = fs.readFileSync('src/context/AuthContext.js', 'utf8');

// add import
if (!authContext.includes('expo-web-browser')) {
  authContext = authContext.replace(
    "import * as SecureStore from 'expo-secure-store';",
    "import * as SecureStore from 'expo-secure-store';\nimport * as WebBrowser from 'expo-web-browser';"
  );
}

// modify logout
const oldLogout = `  const logout = async () => {
    try {
      await SecureStore.deleteItemAsync('jira_access_token');
      await SecureStore.deleteItemAsync('jira_cloud_id');
      setToken(null);
      setCloudId(null);
    } catch (e) {
      console.log('Error deleting auth data', e);
    }
  };`;

const newLogout = `  const logout = async () => {
    try {
      await SecureStore.deleteItemAsync('jira_access_token');
      await SecureStore.deleteItemAsync('jira_cloud_id');
      setToken(null);
      setCloudId(null);
      // Forzar cierre de sesion en el navegador embebido para que no recuerde al usuario en OAuth
      WebBrowser.openAuthSessionAsync('https://id.atlassian.com/logout?continue=https://start.atlassian.com');
    } catch (e) {
      console.log('Error deleting auth data', e);
    }
  };`;

if(authContext.includes('WebBrowser.openAuthSessionAsync')) {
   console.log("Already patched");
} else {
   authContext = authContext.replace(oldLogout, newLogout);
   fs.writeFileSync('src/context/AuthContext.js', authContext);
   console.log("Patched AuthContext.js");
}
