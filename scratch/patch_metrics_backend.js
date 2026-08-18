const fs = require('fs');
let code = fs.readFileSync('src/index.js', 'utf8');

const oldBackend = `            const resp = await api.asUser().requestJira(route\`/rest/api/3/issue/\${key}?fields=summary,status,assignee,resolution,customfield_10004,priority\`);
            if (resp.status === 200) {
               const i = await resp.json();
               bugMap[key] = {
                 summary: i.fields?.summary,
                 status: i.fields?.status?.name,
                 assignee: i.fields?.assignee?.displayName || 'Sin asignar',
                 resolution: i.fields?.resolution?.name || 'Unresolved',
                 severity: i.fields?.customfield_10004 || i.fields?.priority?.name || 'N/A'
               };
            }`;

const newBackend = `            const resp = await api.asUser().requestJira(route\`/rest/api/3/issue/\${key}?expand=changelog&fields=summary,status,assignee,resolution,customfield_10004,priority,created\`);
            if (resp.status === 200) {
               const i = await resp.json();
               
               // MX Holidays
               const mxHolidays = new Set([
                 '2024-01-01', '2024-02-05', '2024-03-18', '2024-05-01', '2024-09-16', '2024-10-01', '2024-11-18', '2024-12-25',
                 '2025-01-01', '2025-02-03', '2025-03-17', '2025-05-01', '2025-09-16', '2025-11-17', '2025-12-25',
                 '2026-01-01', '2026-02-02', '2026-03-16', '2026-05-01', '2026-09-16', '2026-11-16', '2026-12-25',
                 '2027-01-01', '2027-02-01', '2027-03-15', '2027-05-01', '2027-09-16', '2027-11-15', '2027-12-25'
               ]);

               function getBusinessHours(startMs, endMs) {
                 if (!startMs || !endMs || startMs >= endMs) return 0;
                 let current = new Date(startMs);
                 const end = new Date(endMs);
                 let businessMinutes = 0;
                 const mxOffset = -6 * 60 * 60 * 1000; 

                 while (current < end) {
                    const mxTime = new Date(current.getTime() + mxOffset);
                    const day = mxTime.getUTCDay();
                    const hour = mxTime.getUTCHours();
                    const dateString = mxTime.toISOString().split('T')[0];
                    
                    let isBusiness = false;
                    if (!mxHolidays.has(dateString)) {
                        if (day >= 1 && day <= 4) { 
                            if (hour >= 7 && hour < 18) isBusiness = true;
                        } else if (day === 5) {
                            if (hour >= 7 && hour < 13) isBusiness = true;
                        }
                    }
                    if (isBusiness) businessMinutes++;
                    current.setTime(current.getTime() + 60000);
                 }
                 return businessMinutes / 60;
               }

               const timesSpent = {};
               let currentStatus = 'Nuevo'; // Default assumed start state
               let lastTime = new Date(i.fields.created).getTime();
               
               const histories = i.changelog?.histories || [];
               // Jira returns histories ascending by created, but double check
               histories.sort((a,b) => new Date(a.created).getTime() - new Date(b.created).getTime());

               histories.forEach(history => {
                  const statusItem = history.items.find(item => item.field === 'status');
                  if (statusItem) {
                     const transTime = new Date(history.created).getTime();
                     const hours = getBusinessHours(lastTime, transTime);
                     
                     // If fromString exists, prefer it. Otherwise use the tracked currentStatus.
                     const stateName = (statusItem.fromString || currentStatus).toLowerCase();
                     timesSpent[stateName] = (timesSpent[stateName] || 0) + hours;
                     
                     currentStatus = statusItem.toString;
                     lastTime = transTime;
                  }
               });
               
               // Add ongoing time if not closed
               const finalStatus = currentStatus.toLowerCase();
               const isClosed = ['cerrada', 'cerrado', 'done', 'resolved', 'resuelta', 'resuelto'].includes(finalStatus);
               if (!isClosed) {
                  const ongoingHours = getBusinessHours(lastTime, Date.now());
                  timesSpent[finalStatus] = (timesSpent[finalStatus] || 0) + ongoingHours;
               }

               bugMap[key] = {
                 summary: i.fields?.summary,
                 status: i.fields?.status?.name,
                 assignee: i.fields?.assignee?.displayName || 'Sin asignar',
                 resolution: i.fields?.resolution?.name || 'Unresolved',
                 severity: i.fields?.customfield_10004 || i.fields?.priority?.name || 'N/A',
                 timesSpent
               };
            }`;

code = code.replace(oldBackend, newBackend);
fs.writeFileSync('src/index.js', code);
