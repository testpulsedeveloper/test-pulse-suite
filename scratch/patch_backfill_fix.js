const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

const target = `    // Patch execution data with the fetched descriptions and fields
    executionData = executionData.map(t =>
      descMap[t.id] !== undefined ? { ...t, description: descMap[t.id], rawFields: rawFieldsMap[t.id], renderedFields: renderedFieldsMap[t.id] } : t
    );

    await setExecutionData(cycleId, executionData);
  } catch (e) {
    console.error('backfillDescriptions error:', e);
  }

  return executionData;`;

const replacement = `    // Patch solo los test que cambiaron (directamente en la DB) para evitar sobrescribir todo el array de execution
    const updatedTests = [];
    executionData = executionData.map(t => {
       if (descMap[t.id] !== undefined) {
           const updated = { ...t, description: descMap[t.id], rawFields: rawFieldsMap[t.id], renderedFields: renderedFieldsMap[t.id] };
           updatedTests.push(updated);
           return updated;
       }
       return t;
    });

    for (const t of updatedTests) {
        await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${t.id}\`, {
           method: 'PUT',
           headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
           body: JSON.stringify(t)
        });
    }

  } catch (e) {
    console.error('backfillDescriptions error:', e);
  }

  return executionData;`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched backfillDescriptions to avoid setExecutionData");
} else {
    console.error("Could not find target in backfillDescriptions");
}
