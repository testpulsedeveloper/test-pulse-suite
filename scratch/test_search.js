const { api, route } = require('@forge/api');

async function testSearch() {
  const jql = 'issuetype = "Error"';
  const res = await api.asUser().requestJira(route`/rest/api/3/search`, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jql, maxResults: 10, fields: ['summary'] })
  });
  console.log('Status:', res.status);
  const data = await res.text();
  console.log('Data:', data.substring(0, 200));
}
testSearch();
