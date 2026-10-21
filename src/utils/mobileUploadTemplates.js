// === Mobile Companion HTML Templates & Escaping ===

export function escapeHtml(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function generateMobileErrorHtml(title, message) {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Test Pulse | Enlace no disponible</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    body { background-color: #091E42; color: #FFFFFF; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: #FFFFFF; color: #172B4D; border-radius: 16px; padding: 28px 20px; max-width: 420px; width: 100%; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.3); }
    .icon { font-size: 54px; margin-bottom: 16px; }
    h1 { font-size: 20px; font-weight: 800; color: #BF2600; margin-bottom: 10px; }
    p { font-size: 14px; color: #44546F; line-height: 1.5; margin-bottom: 20px; }
    .badge { display: inline-block; background: #F1F2F4; color: #172B4D; font-weight: 700; font-size: 12px; padding: 4px 12px; border-radius: 20px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">⚠️</div>
    <h1>${safeTitle}</h1>
    <p>${safeMessage}</p>
    <div class="badge">Test Pulse Companion</div>
  </div>
</body>
</html>`;
}

export function generateMobileUploadHtml(session) {
  const testRunKey = escapeHtml(session.testRunKey || session.testRunId || session.testKey || 'TEST-RUN');
  const testCaseKey = escapeHtml(session.testKey || '');
  const testSummary = escapeHtml(session.testSummary || 'Ejecución de Prueba');
  const iterInfo = escapeHtml(session.iterName ? `Paso / Iteración: ${session.iterName}` : 'Evidencia General de la Ejecución');
  const initialHistory = Array.isArray(session.uploadedHistory) ? session.uploadedHistory : [];

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>⚡ Test Pulse | Captura Móvil</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; -webkit-tap-highlight-color: transparent; }
    body { background: linear-gradient(135deg, #091E42 0%, #172B4D 100%); color: #172B4D; min-height: 100vh; padding: 16px; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .container { width: 100%; max-width: 460px; background: #FFFFFF; border-radius: 20px; box-shadow: 0 24px 48px rgba(0,0,0,0.35); overflow: hidden; display: flex; flex-direction: column; }
    .header { background: #E1007A; background: linear-gradient(135deg, #E1007A 0%, #B0005E 100%); color: #FFFFFF; padding: 20px; text-align: center; }
    .header .logo { font-size: 13px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; opacity: 0.9; margin-bottom: 4px; }
    .header h1 { font-size: 18px; font-weight: 800; }
    .body { padding: 20px; display: flex; flex-direction: column; gap: 16px; }
    .meta-box { background: #F7F8F9; border: 1px solid #DCDFE4; border-radius: 12px; padding: 12px 14px; }
    .meta-tag { display: inline-flex; align-items: center; gap: 4px; background: #E9F2FF; color: #0C66E4; font-weight: 800; font-size: 12px; padding: 2px 8px; border-radius: 6px; margin-bottom: 6px; }
    .meta-title { font-size: 13px; font-weight: 700; color: #172B4D; line-height: 1.4; }
    .meta-sub { font-size: 11px; color: #626F86; font-weight: 500; margin-top: 4px; }

    .history-banner { display: none; background: #DCFFF1; border: 1px solid #7EE2B8; border-radius: 12px; padding: 10px 12px; flex-direction: column; gap: 6px; }
    .history-title { font-size: 12px; font-weight: 800; color: #1F845A; display: flex; align-items: center; gap: 6px; }
    .history-sub { font-size: 11px; color: #216E4E; font-weight: 500; }
    .history-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
    .history-chip { background: #FFFFFF; border: 1px solid #7EE2B8; color: #1F845A; font-size: 10.5px; font-weight: 700; padding: 2px 8px; border-radius: 999px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    
    .actions-grid { display: flex; flex-direction: column; gap: 12px; margin-top: 4px; }
    .btn-camera { background: #E1007A; background: linear-gradient(135deg, #E1007A 0%, #C20066 100%); color: #FFFFFF; border: none; border-radius: 14px; padding: 18px; font-size: 16px; font-weight: 800; display: flex; align-items: center; justify-content: center; gap: 10px; cursor: pointer; box-shadow: 0 6px 16px rgba(225, 0, 122, 0.35); transition: transform 0.1s; }
    .btn-camera:active { transform: scale(0.98); }
    .btn-gallery { background: #F1F2F4; color: #172B4D; border: 1px solid #DCDFE4; border-radius: 12px; padding: 13px; font-size: 14px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; }
    .btn-gallery:active { background: #E4E6EA; }
    
    .staged-header { display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: 800; color: #0C66E4; }
    .btn-clear-all { background: none; border: none; color: #BF2600; font-size: 11.5px; font-weight: 700; cursor: pointer; text-decoration: underline; }
    .staged-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 10px; max-height: 320px; overflow-y: auto; padding: 2px; }
    .preview-card { border: 2px solid #0C66E4; border-radius: 12px; background: #F8FAFD; padding: 8px; text-align: center; position: relative; display: flex; flex-direction: column; justify-content: space-between; }
    .preview-card img, .preview-card video { width: 100%; height: 110px; object-fit: cover; border-radius: 8px; background: #000; }
    .preview-info { font-size: 10px; color: #626F86; margin-top: 6px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .btn-remove-preview { position: absolute; top: 12px; right: 12px; background: rgba(0,0,0,0.75); color: #fff; border: none; border-radius: 50%; width: 24px; height: 24px; font-size: 12px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 2; }

    .add-more-row { display: flex; gap: 8px; }
    .btn-add-more-cam { flex: 1; background: #FFF0F6; color: #C20066; border: 1.5px dashed #E1007A; border-radius: 10px; padding: 10px 8px; font-size: 12px; font-weight: 800; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; }
    .btn-add-more-gal { flex: 1; background: #F1F2F4; color: #172B4D; border: 1px solid #DCDFE4; border-radius: 10px; padding: 10px 8px; font-size: 12px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; }

    .note-input { width: 100%; border: 1px solid #DCDFE4; border-radius: 10px; padding: 10px 12px; font-size: 13px; outline: none; resize: none; color: #172B4D; background: #FAFBFC; }
    .note-input:focus { border-color: #0C66E4; background: #FFF; }

    .btn-submit { background: #006644; background: linear-gradient(135deg, #1F845A 0%, #006644 100%); color: #FFFFFF; border: none; border-radius: 14px; padding: 16px; font-size: 16px; font-weight: 800; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; box-shadow: 0 6px 16px rgba(0, 102, 68, 0.3); }
    .btn-submit:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }

    .success-view { display: none; padding: 32px 20px; text-align: center; }
    .success-icon { font-size: 60px; animation: bounce 0.6s ease; }
    .success-title { font-size: 20px; font-weight: 800; color: #1F845A; margin: 12px 0 8px 0; }
    .success-msg { font-size: 13.5px; color: #44546F; line-height: 1.5; margin-bottom: 18px; }
    .btn-again { background: #E1007A; color: #FFFFFF; border: none; border-radius: 12px; padding: 14px 24px; font-size: 14px; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 6px 16px rgba(225, 0, 122, 0.3); }

    .loading-overlay { display: none; position: absolute; inset: 0; background: rgba(255,255,255,0.92); z-index: 10; border-radius: 20px; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 20px; text-align: center; }
    .spinner { width: 44px; height: 44px; border: 4px solid #E1007A; border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; }
    
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes bounce { 0% { transform: scale(0.3); } 50% { transform: scale(1.15); } 100% { transform: scale(1); } }
  </style>
</head>
<body>
  <div class="container" style="position: relative;">
    
    <!-- Loading Overlay -->
    <div id="loadingOverlay" class="loading-overlay">
      <div class="spinner"></div>
      <div id="loadingText" style="font-size: 14px; font-weight: 700; color: #172B4D;">Optimizando y enviando evidencia...</div>
    </div>

    <!-- Header -->
    <div class="header">
      <div class="logo">⚡ Test Pulse Companion</div>
      <h1>📸 Captura Móvil de Evidencia</h1>
    </div>

    <!-- Main Upload Form -->
    <div id="uploadFormContainer" class="body">
      <!-- Target Info -->
      <div class="meta-box">
        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px; flex-wrap: wrap;">
          <span class="meta-tag" style="margin-bottom: 0;">🏃 Test Run: ${testRunKey}</span>
          ${testCaseKey && testCaseKey !== testRunKey ? `<span style="font-size: 11px; background: #E4E6EA; color: #44546F; font-weight: 700; padding: 2px 6px; border-radius: 4px;">🧪 Caso: ${testCaseKey}</span>` : ''}
        </div>
        <div class="meta-title">${testSummary}</div>
        <div class="meta-sub">📁 ${iterInfo}</div>
      </div>

      <!-- Persistent Session History Banner (shows photos already uploaded in this session) -->
      <div id="uploadedHistoryBanner" class="history-banner">
        <div class="history-title">
          <span>✅</span>
          <span id="uploadedHistoryCountText">0 evidencias enviadas en esta sesión</span>
        </div>
        <div class="history-sub">Tus capturas anteriores están guardadas. Cada nueva foto se suma sin sobrescribir.</div>
        <div id="uploadedHistoryChips" class="history-chips"></div>
      </div>

      <!-- Hidden inputs for Camera and Gallery (multiple supported) -->
      <input type="file" id="cameraInput" accept="image/*" capture="environment" style="display:none;" />
      <input type="file" id="galleryInput" accept="image/*,video/*" multiple style="display:none;" />

      <!-- Step 1: Action Buttons (when no file staged yet) -->
      <div id="initialActions" class="actions-grid">
        <button type="button" class="btn-camera" onclick="document.getElementById('cameraInput').click();">
          <span style="font-size: 22px;">📷</span>
          <span>TOMAR FOTO CON CÁMARA</span>
        </button>
        <button type="button" class="btn-gallery" onclick="document.getElementById('galleryInput').click();">
          <span>🖼️ Seleccionar de Galería o Video (1 o más)</span>
        </button>
      </div>

      <!-- Step 2: Staged Previews Area (accumulates 1 or more photos before sending) -->
      <div id="previewArea" style="display: none; flex-direction: column; gap: 12px;">
        <div class="staged-header">
          <span id="stagedCountLabel">📸 1 captura lista para enviar</span>
          <button type="button" class="btn-clear-all" onclick="resetSelectedFiles();">Vaciar selección</button>
        </div>

        <div id="previewMediaContainer" class="staged-grid"></div>

        <!-- Buttons to add MORE photos to the current batch without overwriting -->
        <div class="add-more-row">
          <button type="button" class="btn-add-more-cam" onclick="document.getElementById('cameraInput').click();">
            <span>📷 + Tomar otra foto</span>
          </button>
          <button type="button" class="btn-add-more-gal" onclick="document.getElementById('galleryInput').click();">
            <span>🖼️ + Galería</span>
          </button>
        </div>

        <textarea id="noteInput" class="note-input" rows="2" placeholder="Comentario o nota sobre estas capturas (opcional)..."></textarea>

        <button type="button" id="submitBtn" class="btn-submit" onclick="submitEvidence();">
          <span id="submitBtnText">🚀 ENVIAR A LA PANTALLA</span>
        </button>
      </div>
    </div>

    <!-- Success Screen -->
    <div id="successView" class="success-view">
      <div class="success-icon">✅</div>
      <div id="successTitle" class="success-title">¡Evidencia Enviada!</div>
      <div id="successMsg" class="success-msg">
        La captura ya se encuentra adjunta al Test Run en la pantalla de tu computadora.
      </div>
      <div id="successHistoryBox" style="margin-bottom: 20px; text-align: left;"></div>
      <button type="button" class="btn-again" onclick="takeAnother();">
        <span>📸 Tomar / Agregar Más Fotos</span>
      </button>
    </div>

  </div>

  <script>
    const SESSION_ID = ${JSON.stringify(String(session.sessionId || ''))};
    const SESSION_TOKEN = ${JSON.stringify(String(session.sessionToken || ''))};
    // Lista acumulativa de archivos en preparación antes de enviar
    let stagedItems = [];
    // Historial de evidencias ya enviadas durante esta sesión QR (persistido en servidor + cliente)
    let uploadedHistory = ${JSON.stringify(initialHistory)};

    const cameraInput = document.getElementById('cameraInput');
    const galleryInput = document.getElementById('galleryInput');

    cameraInput.addEventListener('change', handleFileSelect);
    galleryInput.addEventListener('change', handleFileSelect);

    // Renderizar banner de historial inicial si la sesión ya tenía fotos subidas
    renderUploadedHistory();

    async function handleFileSelect(e) {
      const files = e.target.files ? Array.from(e.target.files) : [];
      if (!files.length) return;

      showLoading(files.length > 1 ? ('Procesando ' + files.length + ' archivos...') : 'Procesando vista previa...');

      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const isImage = file.type && file.type.startsWith('image/');
          const isVideo = file.type && file.type.startsWith('video/');
          const itemId = 'st_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

          if (isImage) {
            const compressed = await compressImage(file, 1920, 0.85);
            const compSize = (compressed.size / 1024 / 1024).toFixed(2);
            stagedItems.push({
              id: itemId,
              name: file.name || ('foto_' + (stagedItems.length + 1) + '.jpg'),
              base64: compressed.base64,
              mime: compressed.mime,
              sizeLabel: compSize + ' MB',
              isVideo: false
            });
          } else if (isVideo) {
            const base64 = await readFileAsBase64(file);
            const sz = (file.size / 1024 / 1024).toFixed(2);
            stagedItems.push({
              id: itemId,
              name: file.name || ('video_' + (stagedItems.length + 1) + '.mp4'),
              base64: base64,
              mime: file.type || 'video/mp4',
              sizeLabel: sz + ' MB (Video)',
              isVideo: true
            });
          }
        }

        // Limpiar el value de los inputs para permitir volver a disparar 'change' al tomar otra foto
        cameraInput.value = '';
        galleryInput.value = '';
        renderStagedPreviews();
      } catch (err) {
        alert('Error al leer el archivo: ' + err.message);
      } finally {
        hideLoading();
      }
    }

    function renderStagedPreviews() {
      const container = document.getElementById('previewMediaContainer');
      const initialActions = document.getElementById('initialActions');
      const previewArea = document.getElementById('previewArea');
      const countLabel = document.getElementById('stagedCountLabel');
      const submitBtnText = document.getElementById('submitBtnText');

      if (!stagedItems.length) {
        container.innerHTML = '';
        previewArea.style.display = 'none';
        initialActions.style.display = 'flex';
        return;
      }

      initialActions.style.display = 'none';
      previewArea.style.display = 'flex';
      countLabel.innerText = stagedItems.length === 1
        ? '📸 1 captura lista para enviar'
        : ('📸 ' + stagedItems.length + ' capturas listas para enviar');
      submitBtnText.innerText = stagedItems.length === 1
        ? '🚀 ENVIAR EVIDENCIA A LA PANTALLA'
        : ('🚀 ENVIAR ' + stagedItems.length + ' EVIDENCIAS A LA PANTALLA');

      container.innerHTML = stagedItems.map((item, idx) => {
        const mediaHtml = item.isVideo
          ? '<video controls src="' + item.base64 + '"></video>'
          : '<img src="' + item.base64 + '" alt="Captura ' + (idx + 1) + '" />';
        const safeName = String(item.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return (
          '<div class="preview-card">' +
            '<button type="button" class="btn-remove-preview" onclick="removeStagedItem(\\'' + item.id + '\\');" title="Quitar esta captura">✕</button>' +
            mediaHtml +
            '<div class="preview-info">#' + (idx + 1) + ' • ' + safeName + ' (' + item.sizeLabel + ')</div>' +
          '</div>'
        );
      }).join('');
    }

    function removeStagedItem(id) {
      stagedItems = stagedItems.filter(item => item.id !== id);
      renderStagedPreviews();
    }

    function resetSelectedFiles() {
      stagedItems = [];
      cameraInput.value = '';
      galleryInput.value = '';
      renderStagedPreviews();
    }

    function renderUploadedHistory() {
      const banner = document.getElementById('uploadedHistoryBanner');
      const countText = document.getElementById('uploadedHistoryCountText');
      const chipsContainer = document.getElementById('uploadedHistoryChips');
      const successHistoryBox = document.getElementById('successHistoryBox');

      if (!uploadedHistory || uploadedHistory.length === 0) {
        banner.style.display = 'none';
        if (successHistoryBox) successHistoryBox.innerHTML = '';
        return;
      }

      banner.style.display = 'flex';
      countText.innerText = uploadedHistory.length === 1
        ? '1 evidencia guardada en este caso/iteración'
        : (uploadedHistory.length + ' evidencias guardadas en este caso/iteración');

      const chipsHtml = uploadedHistory.map((h, i) => {
        const safeName = String(h.filename || ('Evidencia ' + (i + 1))).replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return '<span class="history-chip">📸 ' + (i + 1) + '. ' + safeName + '</span>';
      }).join('');

      chipsContainer.innerHTML = chipsHtml;

      if (successHistoryBox) {
        successHistoryBox.innerHTML =
          '<div class="history-banner" style="display:flex;">' +
            '<div class="history-title"><span>📦</span><span>Total acumulado en esta sesión: ' + uploadedHistory.length + ' evidencia(s)</span></div>' +
            '<div class="history-chips">' + chipsHtml + '</div>' +
          '</div>';
      }
    }

    function takeAnother() {
      resetSelectedFiles();
      renderUploadedHistory();
      document.getElementById('successView').style.display = 'none';
      document.getElementById('uploadFormContainer').style.display = 'flex';
      document.getElementById('noteInput').value = '';
    }

    async function submitEvidence() {
      if (!stagedItems.length) {
        alert('Por favor toma o selecciona al menos una foto primero.');
        return;
      }

      const note = document.getElementById('noteInput').value.trim();
      const totalToUpload = stagedItems.length;
      let uploadedNow = 0;

      try {
        // Subir secuencialmente cada captura en preparación para asegurar orden y persistencia sin colisiones
        while (stagedItems.length > 0) {
          const item = stagedItems[0];
          const currentIndex = uploadedNow + 1;
          showLoading(
            totalToUpload > 1
              ? ('Subiendo evidencia ' + currentIndex + ' de ' + totalToUpload + ' a Jira... 🚀')
              : 'Subiendo evidencia a Jira... 🚀'
          );

          const response = await fetch(window.location.href, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: SESSION_ID,
              sessionToken: SESSION_TOKEN,
              filename: item.name || ('foto_' + Date.now() + '.jpg'),
              mimeType: item.mime,
              base64Data: item.base64,
              note: note
            })
          });

          const result = await response.json();
          if (!result.success) {
            throw new Error(result.error || 'No se pudo subir la evidencia #' + currentIndex);
          }

          uploadedNow++;
          if (result.evidence) {
            uploadedHistory.push({
              id: result.evidence.id,
              filename: result.evidence.filename || item.name
            });
          }
          // Quitar de la cola el elemento ya subido exitosamente
          stagedItems.shift();
        }

        renderStagedPreviews();
        renderUploadedHistory();

        document.getElementById('successTitle').innerText = uploadedNow > 1
          ? ('¡' + uploadedNow + ' Evidencias Enviadas!')
          : '¡Evidencia Enviada!';
        document.getElementById('successMsg').innerText =
          'Las capturas se han agregado al mismo caso/iteración sin sobrescribir las anteriores. Puedes seguir tomando más fotos si lo necesitas.';

        document.getElementById('uploadFormContainer').style.display = 'none';
        document.getElementById('successView').style.display = 'block';
      } catch (err) {
        renderStagedPreviews();
        renderUploadedHistory();
        alert('Error al subir evidencia: ' + err.message);
      } finally {
        hideLoading();
      }
    }

    function compressImage(file, maxDimension, quality) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(e) {
          const img = new Image();
          img.onload = function() {
            let width = img.width;
            let height = img.height;

            if (width > maxDimension || height > maxDimension) {
              if (width > height) {
                height = Math.round((height * maxDimension) / width);
                width = maxDimension;
              } else {
                width = Math.round((width * maxDimension) / height);
                height = maxDimension;
              }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            const mime = 'image/jpeg';
            const base64 = canvas.toDataURL(mime, quality);
            const byteString = atob(base64.split(',')[1]);
            resolve({ base64, mime, size: byteString.length });
          };
          img.onerror = reject;
          img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    function readFileAsBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    function showLoading(text) {
      document.getElementById('loadingText').innerText = text || 'Cargando...';
      document.getElementById('loadingOverlay').style.display = 'flex';
    }

    function hideLoading() {
      document.getElementById('loadingOverlay').style.display = 'none';
    }
  </script>
</body>
</html>`;
}
