const getBaseUrl = (cloudId) => {
  if (cloudId) {
    return `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`;
  }
  // Fallback for dev if token is still basic
  return 'https://liverpooldigital.atlassian.net/rest/api/3';
};

export const fetchProjects = async (token, cloudId) => {
  if (!token) return [];
  
  try {
    const response = await fetch(`${getBaseUrl(cloudId)}/project`, {
      headers: {
        Authorization: token,
        Accept: 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching projects:', error);
    throw error;
  }
};


export const fetchProjectConfig = async (token, cloudId, projectKey) => {
  if (!token) return { testCycleType: 'Test Cycle', planIssueType: 'Test Set' };
  try {
    const configRes = await fetch(`${getBaseUrl(cloudId)}/project/${projectKey}/properties/testpulse-config`, {
      headers: {
        Authorization: token,
        Accept: 'application/json'
      }
    });
    
    if (configRes.ok) {
      const configData = await configRes.json();
      if (configData && configData.value) {
        return {
          testCycleType: configData.value.testCycleType || 'Test Cycle',
          planIssueType: configData.value.planIssueType || 'Test Set'
        };
      }
    }
  } catch (e) {
    console.error('Error fetching project config:', e);
  }
  return { testCycleType: 'Test Cycle', planIssueType: 'Test Set' };
};

export const fetchProjectPlans = async (token, cloudId, projectKey) => {
  if (!token) return [];
  
  try {
    const config = await fetchProjectConfig(token, cloudId, projectKey);
    const planIssueType = config.planIssueType;

    const jql = `project = "${projectKey}" AND issuetype = "${planIssueType}" ORDER BY created DESC`;
    const searchRes = await fetch(`${getBaseUrl(cloudId)}/search/jql`, {
      method: 'POST',
      headers: {
        Authorization: token,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jql: jql,
        maxResults: 50,
        fields: ["summary", "status", "issuetype", "created"]
      })
    });

    if (!searchRes.ok) {
      throw new Error(`Search API error: ${searchRes.status}`);
    }

    const searchData = await searchRes.json();
    return searchData.issues || [];
  } catch (error) {
    console.error('Error fetching project plans:', error);
    return [];
  }
};

export const fetchProjectCycles = async (token, cloudId, projectKey, planId = null) => {
  if (!token) return [];
  
  try {
    // 1. Fetch project config to know which Issue Type is the Test Cycle
    const config = await fetchProjectConfig(token, cloudId, projectKey);
    const cycleIssueType = config.testCycleType;

    // 2. Fetch cycles using JQL
    const jql = `project = "${projectKey}" AND issuetype = "${cycleIssueType}" ORDER BY created DESC`;
    const searchRes = await fetch(`${getBaseUrl(cloudId)}/search/jql`, {
      method: 'POST',
      headers: {
        Authorization: token,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jql: jql,
        maxResults: 50,
        fields: ["summary", "status", "issuetype", "created"],
        properties: ["testops-plan-link"]
      })
    });

    if (!searchRes.ok) {
      throw new Error(`Search API error: ${searchRes.status}`);
    }

    const searchData = await searchRes.json();
    let issues = searchData.issues || [];
    
    if (planId) {
      issues = issues.filter(issue => {
        const link = issue.properties && issue.properties['testops-plan-link'];
        return link && link.planId === planId;
      });
    }

    return issues;
  } catch (error) {
    console.error('Error fetching project cycles:', error);
    return []; // Return empty array gracefully for now
  }
};

export const fetchCycleExecution = async (token, cloudId, cycleId) => {
  if (!token) return [];
  
  try {
    const response = await fetch(`${getBaseUrl(cloudId)}/issue/${cycleId}/properties/execution`, {
      headers: {
        Authorization: token,
        Accept: 'application/json'
      }
    });
    
    if (response.status === 404) {
      return [];
    }
    if (!response.ok) {
      throw new Error(`fetchCycleExecution error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.value || [];
  } catch (error) {
    console.error('Error fetching cycle execution:', error);
    return [];
  }
};

export const saveCycleExecution = async (token, cloudId, cycleId, executionData) => {
  try {
    const response = await fetch(`${getBaseUrl(cloudId)}/issue/${cycleId}/properties/execution`, {
      method: 'PUT',
      headers: {
        Authorization: token,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(executionData)
    });
    
    if (!response.ok) {
      throw new Error(`saveCycleExecution error: ${response.status}`);
    }
    return true;
  } catch (error) {
    console.error('Error saving cycle execution:', error);
    return false;
  }
};

export const uploadAttachment = async (token, cloudId, issueId, fileUri, mimeType = 'image/jpeg') => {
  try {
    const formData = new FormData();
    
    // Convert mimeType to extension
    let extension = 'jpg';
    if (mimeType.includes('png')) extension = 'png';
    else if (mimeType.includes('mp4')) extension = 'mp4';
    else if (mimeType.includes('mov') || mimeType.includes('quicktime')) extension = 'mov';
    else if (mimeType.includes('webm')) extension = 'webm';
    else if (mimeType.includes('pdf')) extension = 'pdf';

    formData.append('file', {
      uri: fileUri,
      name: `evidence_${Date.now()}.${extension}`,
      type: mimeType
    });

    const response = await fetch(`${getBaseUrl(cloudId)}/issue/${issueId}/attachments`, {
      method: 'POST',
      headers: {
        Authorization: token,
        Accept: 'application/json',
        'X-Atlassian-Token': 'no-check'
      },
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`uploadAttachment error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data; // Returns an array of created attachments
  } catch (error) {
    console.error('Error uploading attachment:', error);
    throw error;
  }
};


export const createJiraIssue = async (token, cloudId, projectKey, summary, issueTypeName) => {
  if (!token) return null;
  
  try {
    // We need the projectId, not just the key. But wait, project can be passed as key or id to the REST API!
    const body = {
      fields: {
        project: { key: projectKey },
        summary: summary,
        issuetype: { name: issueTypeName }
      }
    };

    const response = await fetch(`${getBaseUrl(cloudId)}/issue`, {
      method: 'POST',
      headers: {
        Authorization: token,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    
    if (!response.ok) {
      const text = await response.text();
      console.error('API error text:', text);
      throw new Error(`Failed to create issue: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error creating issue:', error);
    throw error;
  }
};
