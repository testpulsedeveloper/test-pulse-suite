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
    
    .actions-grid { display: flex; flex-direction: column; gap: 12px; margin-top: 4px; }
    .btn-camera { background: #E1007A; background: linear-gradient(135deg, #E1007A 0%, #C20066 100%); color: #FFFFFF; border: none; border-radius: 14px; padding: 18px; font-size: 16px; font-weight: 800; display: flex; align-items: center; justify-content: center; gap: 10px; cursor: pointer; box-shadow: 0 6px 16px rgba(225, 0, 122, 0.35); transition: transform 0.1s; }
    .btn-camera:active { transform: scale(0.98); }
    .btn-gallery { background: #F1F2F4; color: #172B4D; border: 1px solid #DCDFE4; border-radius: 12px; padding: 13px; font-size: 14px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; }
    .btn-gallery:active { background: #E4E6EA; }
    
    .preview-card { border: 2px dashed #0C66E4; border-radius: 14px; background: #F8FAFD; padding: 12px; text-align: center; position: relative; }
    .preview-card img, .preview-card video { width: 100%; max-height: 240px; object-fit: contain; border-radius: 8px; background: #000; }
    .preview-info { font-size: 11px; color: #626F86; margin-top: 6px; font-weight: 600; }
    .btn-remove-preview { position: absolute; top: 18px; right: 18px; background: rgba(0,0,0,0.7); color: #fff; border: none; border-radius: 50%; width: 28px; height: 28px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; }

    .note-input { width: 100%; border: 1px solid #DCDFE4; border-radius: 10px; padding: 10px 12px; font-size: 13px; outline: none; resize: none; color: #172B4D; background: #FAFBFC; }
    .note-input:focus { border-color: #0C66E4; background: #FFF; }

    .btn-submit { background: #006644; background: linear-gradient(135deg, #1F845A 0%, #006644 100%); color: #FFFFFF; border: none; border-radius: 14px; padding: 16px; font-size: 16px; font-weight: 800; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; box-shadow: 0 6px 16px rgba(0, 102, 68, 0.3); }
    .btn-submit:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }

    .success-view { display: none; padding: 36px 20px; text-align: center; }
    .success-icon { font-size: 64px; animation: bounce 0.6s ease; }
    .success-title { font-size: 20px; font-weight: 800; color: #1F845A; margin: 12px 0 8px 0; }
    .success-msg { font-size: 13.5px; color: #44546F; line-height: 1.5; margin-bottom: 24px; }
    .btn-again { background: #E1007A; color: #FFFFFF; border: none; border-radius: 12px; padding: 14px 24px; font-size: 14px; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }

    .loading-overlay { display: none; position: absolute; inset: 0; background: rgba(255,255,255,0.92); z-index: 10; border-radius: 20px; flex-direction: column; align-items: center; justify-content: center; gap: 12px; }
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

      <!-- Hidden inputs for Camera and Gallery -->
      <input type="file" id="cameraInput" accept="image/*" capture="environment" style="display:none;" />
      <input type="file" id="galleryInput" accept="image/*,video/*" style="display:none;" />

      <!-- Step 1: Action Buttons (when no file selected) -->
      <div id="initialActions" class="actions-grid">
        <button type="button" class="btn-camera" onclick="document.getElementById('cameraInput').click();">
          <span style="font-size: 22px;">📷</span>
          <span>TOMAR FOTO CON CÁMARA</span>
        </button>
        <button type="button" class="btn-gallery" onclick="document.getElementById('galleryInput').click();">
          <span>🖼️ Galería o Video</span>
        </button>
      </div>

      <!-- Step 2: Preview Area (when file selected) -->
      <div id="previewArea" style="display: none; flex-direction: column; gap: 12px;">
        <div class="preview-card">
          <button type="button" class="btn-remove-preview" onclick="resetSelectedFile();" title="Quitar">✕</button>
          <div id="previewMediaContainer"></div>
          <div id="previewInfo" class="preview-info"></div>
        </div>

        <textarea id="noteInput" class="note-input" rows="2" placeholder="Comentario o nota sobre esta captura (opcional)..."></textarea>

        <button type="button" id="submitBtn" class="btn-submit" onclick="submitEvidence();">
          <span>🚀 ENVIAR A LA PANTALLA</span>
        </button>

        <button type="button" class="btn-gallery" onclick="document.getElementById('cameraInput').click();" style="padding: 10px; font-size: 12px;">
          <span>🔄 Cambiar Foto</span>
        </button>
      </div>
    </div>

    <!-- Success Screen -->
    <div id="successView" class="success-view">
      <div class="success-icon">✅</div>
      <div class="success-title">¡Evidencia Enviada!</div>
      <div class="success-msg">
        La captura ya se encuentra adjunta al Test Run en la pantalla de tu computadora.
      </div>
      <button type="button" class="btn-again" onclick="takeAnother();">
        <span>📸 Tomar Otra Foto</span>
      </button>
    </div>

  </div>

  <script>
    const SESSION_ID = ${JSON.stringify(String(session.sessionId || ''))};
    let currentFile = null;
    let currentBase64 = null;
    let currentMime = 'image/jpeg';

    const cameraInput = document.getElementById('cameraInput');
    const galleryInput = document.getElementById('galleryInput');

    cameraInput.addEventListener('change', handleFileSelect);
    galleryInput.addEventListener('change', handleFileSelect);

    async function handleFileSelect(e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      currentFile = file;
      currentMime = file.type || 'image/jpeg';
      showLoading('Procesando vista previa...');

      try {
        const isImage = file.type.startsWith('image/');
        const isVideo = file.type.startsWith('video/');

        if (isImage) {
          // Client-side canvas downscale / compression
          const compressed = await compressImage(file, 1920, 0.85);
          currentBase64 = compressed.base64;
          currentMime = compressed.mime;

          const container = document.getElementById('previewMediaContainer');
          container.innerHTML = '<img src="' + currentBase64 + '" alt="Vista Previa" />';
          
          const compSize = (compressed.size / 1024 / 1024).toFixed(2);
          document.getElementById('previewInfo').innerText = file.name + ' • ' + compSize + ' MB (Optimizado)';
        } else if (isVideo) {
          currentBase64 = await readFileAsBase64(file);
          const container = document.getElementById('previewMediaContainer');
          container.innerHTML = '<video controls src="' + currentBase64 + '"></video>';
          const sz = (file.size / 1024 / 1024).toFixed(2);
          document.getElementById('previewInfo').innerText = file.name + ' • ' + sz + ' MB (Video)';
        }

        document.getElementById('initialActions').style.display = 'none';
        document.getElementById('previewArea').style.display = 'flex';
      } catch (err) {
        alert('Error al leer el archivo: ' + err.message);
      } finally {
        hideLoading();
      }
    }

    function resetSelectedFile() {
      currentFile = null;
      currentBase64 = null;
      cameraInput.value = '';
      galleryInput.value = '';
      document.getElementById('previewArea').style.display = 'none';
      document.getElementById('initialActions').style.display = 'flex';
    }

    function takeAnother() {
      resetSelectedFile();
      document.getElementById('successView').style.display = 'none';
      document.getElementById('uploadFormContainer').style.display = 'flex';
      document.getElementById('noteInput').value = '';
    }

    async function submitEvidence() {
      if (!currentBase64) {
        alert('Por favor toma una foto primero.');
        return;
      }

      showLoading('Subiendo evidencia a Jira... 🚀');
      const note = document.getElementById('noteInput').value.trim();

      try {
        const response = await fetch(window.location.href, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: SESSION_ID,
            filename: currentFile ? currentFile.name : ('foto_' + Date.now() + '.jpg'),
            mimeType: currentMime,
            base64Data: currentBase64,
            note: note
          })
        });

        const result = await response.json();
        if (result.success) {
          document.getElementById('uploadFormContainer').style.display = 'none';
          document.getElementById('successView').style.display = 'block';
        } else {
          alert('Error: ' + (result.error || 'No se pudo subir la evidencia'));
        }
      } catch (err) {
        alert('Error de conexión al subir la evidencia: ' + err.message);
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
