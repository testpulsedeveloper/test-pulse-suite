commit 49815434527b837ba9d2ac93a3f1272583fe0f39
Author: GUSTAVO BARBOSA MORENO <GBARBOSAM@820KJ66RVXV96.local>
Date:   Fri Aug 28 11:03:31 2026 -0600

    feat(perf): Phase 3 parallel fetch, UI pagination, and localized spinners

diff --git a/src/index.js b/src/index.js
index 0559029..43c465d 100644
--- a/src/index.js
+++ b/src/index.js
@@ -1,76 +1,86 @@
 import Resolver from '@forge/resolver';
 import api, { route } from '@forge/api';
 
-async function fetchAllIssues(jql, fields, expand, properties, maxPages = 12) {
+async function fetchAllIssues(jql, fields, expand, properties, maxPages = 100) {
   try {
-    let allIssues = [];
     let maxResults = 100;
-    let page = 0;
-    let nextPageToken = null;
-    let isLast = false;
     
     // Transform *all to specific fields
     let safeFields = fields;
     if (Array.isArray(fields) && fields.includes('*all')) {
-        safeFields = ['summary', 'description', 'status', 'created', 'issuetype', 'priority', 'assignee', 'reporter', 'resolution', 'components', 'customfield_10534', 'customfield_10530', 'customfield_10535', 'customfield_10568', 'customfield_10569', 'customfield_10570'];
+        safeFields = ['summary', 'status', 'created', 'issuetype', 'priority', 'assignee', 'reporter', 'resolution', 'customfield_10534', 'customfield_10530', 'customfield_10535', 'customfield_10568', 'customfield_10569', 'customfield_10570'];
         fields.forEach(f => {
            if (f !== '*all' && !safeFields.includes(f)) safeFields.push(f);
         });
     } else if (fields === '*all') {
-        safeFields = ['summary', 'description', 'status', 'created', 'issuetype', 'priority', 'assignee', 'reporter', 'resolution', 'components', 'customfield_10534', 'customfield_10530', 'customfield_10535', 'customfield_10568', 'customfield_10569', 'customfield_10570'];
+        safeFields = ['summary', 'status', 'created', 'issuetype', 'priority', 'assignee', 'reporter', 'resolution', 'customfield_10534', 'customfield_10530', 'customfield_10535', 'customfield_10568', 'customfield_10569', 'customfield_10570'];
     }
-    
-    while (page < maxPages && !isLast) {
+
+    const buildBody = (startAt) => {
       const body = {
         jql,
         maxResults,
+        startAt,
         fields: Array.isArray(safeFields) ? safeFields : [safeFields]
       };
-      
-      if (nextPageToken) {
-         body.nextPageToken = nextPageToken;
-      }
-      
-      if (expand) {
-         body.expand = Array.isArray(expand) ? expand.join(',') : expand;
-      }
-      if (properties) {
-         body.properties = Array.isArray(properties) ? properties : [properties];
-      }
-      
-      const response = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
-        method: 'POST',
-        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
-        body: JSON.stringify(body)
-      });
-      
-      if (!response.ok) {
-         return [{ id: '999999', key: 'ERR-1', fields: { summary: `JQL Search failed: ${response.status} ${await response.text()}`, status: { name: 'Error' }, created: new Date().toISOString() } }];
-      }
-      
-      const data = await response.json();
-      const issues = data.issues || [];
-      allIssues = allIssues.concat(issues);
-      
-      // Update pagination cursor for the next iteration
-      nextPageToken = data.nextPageToken;
-      
-      // Stop if there are no more pages
-      if (data.nextPageToken == null || data.isLast === true || issues.length === 0) {
-          isLast = true;
-          break;
-      }
-      
-      page++;
+      if (expand) body.expand = Array.isArray(expand) ? expand.join(',') : expand;
+      if (properties) body.properties = Array.isArray(properties) ? properties : [properties];
+      return body;
+    };
+
+    // 1. Fetch first page to get total
+    const firstRes = await api.asUser().requestJira(route`/rest/api/3/search`, {
+      method: 'POST',
+      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
+      body: JSON.stringify(buildBody(0))
+    });
+
+    if (!firstRes.ok) {
+       return [{ id: '999999', key: 'ERR-1', fields: { summary: `JQL Search failed: ${firstRes.status} ${await firstRes.text()}`, status: { name: 'Error' }, created: new Date().toISOString() } }];
     }
+
+    const firstData = await firstRes.json();
+    let allIssues = firstData.issues || [];
+    const total = firstData.total || 0;
     
+    // If we have more issues, fetch them in chunks
+    if (total > maxResults) {
+        const pagesToFetch = Math.min(Math.ceil(total / maxResults) - 1, maxPages - 1);
+        const offsets = [];
+        for (let i = 1; i <= pagesToFetch; i++) {
+            offsets.push(i * maxResults);
+        }
+
+        // Fetch in batches of 5 to avoid rate limits
+        const BATCH_SIZE = 5;
+        for (let i = 0; i < offsets.length; i += BATCH_SIZE) {
+            const batch = offsets.slice(i, i + BATCH_SIZE);
+            const promises = batch.map(async (startAt) => {
+                const res = await api.asUser().requestJira(route`/rest/api/3/search`, {
+                  method: 'POST',
+                  headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
+                  body: JSON.stringify(buildBody(startAt))
+                });
+                if (res.ok) {
+                    const data = await res.json();
+                    return data.issues || [];
+                }
+                return [];
+            });
+            const results = await Promise.all(promises);
+            results.forEach(issues => {
+                allIssues = allIssues.concat(issues);
+            });
+        }
+    }
+
     return allIssues;
-  } catch(err) {
-    return [{ id: '999999', key: 'ERR-2', fields: { summary: `Exception: ${err.message}`, status: { name: 'Error' }, created: new Date().toISOString() } }];
+  } catch (e) {
+    console.error("fetchAllIssues exception:", e);
+    return [];
   }
 }
 
-
 const resolver = new Resolver();
 
 // === Folder Management (Jira Entity Properties) ===
