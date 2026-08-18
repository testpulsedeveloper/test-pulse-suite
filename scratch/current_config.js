const renderConfigTab = () => (
    <div className="tab-layout">
      <div className="tab-content" style={{ maxWidth: '800px', margin: '0 auto', background: 'var(--bg-main)' }}>
        <h2 style={{ marginBottom: '1.5rem', color: 'var(--text-primary)' }}>Configuración del Proyecto</h2>
        
        <div className="chart-card">
          <h3 style={{ borderBottom: '1px solid var(--ds-border)', paddingBottom: '0.5rem' }}>Mapeo de Tipos de Issue</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
            Alinea la aplicación con tu esquema de Jira. ¿Cómo se llaman los siguientes conceptos en tu proyecto?
          </p>

          <div className="form-group">
            <label>Tipo de issue para <strong>Test Plan</strong></label>
            <input 
              type="text" 
              className="form-control"
              value={projectConfig.testPlanType || 'Test Plan'}
              onChange={e => setProjectConfig({...projectConfig, testPlanType: e.target.value})}
              placeholder="Ej: Test Plan"
            />
          </div>

          <div className="form-group">
            <label>Tipo de issue para <strong>Test Cycle</strong></label>
            <input 
              type="text" 
              className="form-control"
              value={projectConfig.testCycleType || 'Test Cycle'}
              onChange={e => setProjectConfig({...projectConfig, testCycleType: e.target.value})}
              placeholder="Ej: Test Cycle"
            />
          </div>

          <div className="form-group">
            <label>Tipo de issue para <strong>Test Case</strong></label>
            <input 
              type="text" 
              className="form-control"
              value={projectConfig.testCaseType || 'Test Case'}
              onChange={e => setProjectConfig({...projectConfig, testCaseType: e.target.value})}
              placeholder="Ej: Test Case"
            />
          </div>
        </div>

        <div className="chart-card" style={{ marginTop: '1.5rem' }}>
          <h3 style={{ borderBottom: '1px solid var(--ds-border)', paddingBottom: '0.5rem' }}>Widgets del Tablero de Reportes</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
            Selecciona qué métricas y gráficas estarán visibles en la pestaña de Reportes. Los contadores principales y la tabla de defectos son fijos.
          </p>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
               <input 
                 type="checkbox" 
                 checked={projectConfig.showProgreso !== false}
                 onChange={e => setProjectConfig({...projectConfig, showProgreso: e.target.checked})}
                 style={{ width: '1.2rem', height: '1.2rem' }}
               />
               <span style={{ fontWeight: '500' }}>Mostrar Progreso por Ciclo de Pruebas</span>
            </label>
            
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
               <input 
                 type="checkbox" 
                 checked={projectConfig.showTesterStats !== false}
                 onChange={e => setProjectConfig({...projectConfig, showTesterStats: e.target.checked})}
                 style={{ width: '1.2rem', height: '1.2rem' }}
               />
               <span style={{ fontWeight: '500' }}>Mostrar Casos por Tester</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
               <input 
                 type="checkbox" 
                 checked={projectConfig.showExecTypeStats !== false}
                 onChange={e => setProjectConfig({...projectConfig, showExecTypeStats: e.target.checked})}
                 style={{ width: '1.2rem', height: '1.2rem' }}
               />
               <span style={{ fontWeight: '500' }}>Mostrar Casos por Tipo de Ejecución (Manual/Auto)</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
               <input 
                 type="checkbox" 
                 checked={projectConfig.showBugTimes !== false}
                 onChange={e => setProjectConfig({...projectConfig, showBugTimes: e.target.checked})}
                 style={{ width: '1.2rem', height: '1.2rem' }}
               />
               <span style={{ fontWeight: '500' }}>Mostrar Tiempo de Resolución de Defectos (Horas Laborales)</span>
            </label>
          </div>
        </div>

        <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
          <button 
            className="btn btn-primary" 
            onClick={handleSaveConfig}
            disabled={isSavingConfig}
          >
            {isSavingConfig ? 'Guardando...' : 'Guardar Configuración'}
          </button>
        </div>
      </div>
    </div>
  )