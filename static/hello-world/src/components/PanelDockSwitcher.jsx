import React, { useState, useEffect } from 'react';

/**
 * Clave de almacenamiento local para recordar la preferencia de acoplamiento (docking)
 * de los paneles de inspección y ejecución en el navegador del usuario.
 */
const DOCK_STORAGE_KEY = 'tp_panel_dock_position';

/**
 * Evento personalizado de ventana para sincronizar en tiempo real todos los paneles
 * abiertos cuando el usuario cambia la posición preferida (Izquierda, Centro o Derecha).
 */
const DOCK_SYNC_EVENT = 'tp-panel-dock-change';

/**
 * Ancho estándar del panel acoplado en modo Split-View integrado (Izquierda / Derecha).
 * Permite calcular simétricamente el espacio restante de la mesa de trabajo principal.
 */
export const DOCK_SPLIT_WIDTH = 'min(740px, 48vw)';

/**
 * Lee de forma segura la posición guardada en localStorage.
 * Valores soportados: 'left' | 'center' | 'right'. Por defecto retorna 'center'.
 */
export function getSavedDockPosition() {
  try {
    const raw = window.localStorage.getItem(DOCK_STORAGE_KEY);
    if (raw === 'left' || raw === 'center' || raw === 'right') {
      return raw;
    }
  } catch (_) {
    // En caso de restricción de iframe/cookies, usamos el valor por defecto ('center').
  }
  return 'center';
}

/**
 * Hook personalizado que gestiona y sincroniza la posición de acoplamiento del panel
 * ('left', 'center' o 'right') entre todos los módulos de Test Pulse Suite.
 */
export function usePanelDockPosition() {
  const [dockPosition, setDockPositionState] = useState(() => getSavedDockPosition());

  useEffect(() => {
    const handleSync = (event) => {
      const nextPos = event?.detail?.position || getSavedDockPosition();
      if (nextPos === 'left' || nextPos === 'center' || nextPos === 'right') {
        setDockPositionState(nextPos);
      }
    };
    window.addEventListener(DOCK_SYNC_EVENT, handleSync);
    return () => window.removeEventListener(DOCK_SYNC_EVENT, handleSync);
  }, []);

  const setDockPosition = (nextPos) => {
    const normalized = (nextPos === 'left' || nextPos === 'right') ? nextPos : 'center';
    setDockPositionState(normalized);
    try {
      window.localStorage.setItem(DOCK_STORAGE_KEY, normalized);
      window.dispatchEvent(new CustomEvent(DOCK_SYNC_EVENT, { detail: { position: normalized } }));
    } catch (_) {
      // Ignorar errores de almacenamiento en navegadores con bloqueo estricto.
    }
  };

  return [dockPosition, setDockPosition];
}

/**
 * Calcula los estilos CSS del contenedor de fondo (overlay) según la posición elegida.
 * - En modo 'center' (modal tradicional): aplica fondo oscuro translúcido con desenfoque y cierra al hacer clic afuera.
 * - En modo 'left' o 'right' (Split-View integrado en ventana): se ancla debajo de la barra superior (top: 56px)
 *   y deja libre de bloqueo el resto de la pantalla (pointerEvents: 'none') mientras la tabla principal ajusta su ancho.
 */
export function getDockOverlayStyle(dockPosition, baseZIndex = 1050) {
  const isCenter = dockPosition === 'center';
  const isLeft = dockPosition === 'left';

  if (isCenter) {
    return {
      position: 'fixed',
      inset: 0,
      zIndex: baseZIndex,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      backgroundColor: 'rgba(9, 30, 66, 0.54)',
      backdropFilter: 'blur(2px)',
      pointerEvents: 'auto',
      transition: 'background-color 0.18s ease'
    };
  }

  return {
    position: 'fixed',
    top: '56px',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: baseZIndex,
    display: 'flex',
    alignItems: 'stretch',
    justifyContent: isLeft ? 'flex-start' : 'flex-end',
    padding: '0px',
    backgroundColor: 'transparent',
    backdropFilter: 'none',
    pointerEvents: 'none',
    transition: 'background-color 0.18s ease'
  };
}

/**
 * Calcula los estilos CSS de la tarjeta principal del modal o panel lateral integrado en la ventana.
 * Reactiva pointerEvents: 'auto' para que todo el contenido del panel sea interactivo.
 */
export function getDockContainerStyle(dockPosition, options = {}) {
  const isCenter = dockPosition === 'center';
  const isLeft = dockPosition === 'left';

  const centerMaxWidth = options.centerMaxWidth || '1380px';
  const centerWidth = options.centerWidth || '95%';
  const centerHeight = options.centerHeight || '90vh';
  const centerMinHeight = options.centerMinHeight || '620px';
  const centerMaxHeight = options.centerMaxHeight || '920px';
  const drawerWidth = options.drawerWidth || DOCK_SPLIT_WIDTH;
  const drawerMinWidth = options.drawerMinWidth || '420px';
  const bg = options.backgroundColor || '#FFFFFF';

  if (isCenter) {
    return {
      pointerEvents: 'auto',
      backgroundColor: bg,
      borderRadius: '10px',
      border: '1px solid #DCDFE4',
      boxShadow: '0 20px 32px -8px rgba(9, 30, 66, 0.25), 0 0 1px rgba(9, 30, 66, 0.31)',
      width: centerWidth,
      maxWidth: centerMaxWidth,
      height: centerHeight,
      minHeight: centerMinHeight,
      maxHeight: centerMaxHeight,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      transition: 'width 0.2s ease, max-width 0.2s ease, height 0.2s ease'
    };
  }

  return {
    pointerEvents: 'auto',
    backgroundColor: bg,
    borderRadius: '0px',
    borderTop: 'none',
    borderBottom: 'none',
    borderLeft: isLeft ? 'none' : '2px solid #DCDFE4',
    borderRight: isLeft ? '2px solid #DCDFE4' : 'none',
    boxShadow: isLeft
      ? '6px 0 18px -4px rgba(9, 30, 66, 0.10)'
      : '-6px 0 18px -4px rgba(9, 30, 66, 0.10)',
    width: drawerWidth,
    minWidth: drawerMinWidth,
    maxWidth: '52vw',
    height: 'calc(100vh - 56px)',
    minHeight: 'calc(100vh - 56px)',
    maxHeight: 'calc(100vh - 56px)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    transition: 'width 0.18s cubic-bezier(0.16, 1, 0.3, 1), transform 0.18s ease'
  };
}

/**
 * Componente visual de botones segmentados (Izquierda | Centro | Derecha)
 * para permitir al usuario elegir en cualquier momento cómo visualizar los paneles.
 */
export default function PanelDockSwitcher({ dockPosition, onChange }) {
  const modes = [
    {
      id: 'left',
      title: 'Acoplar como panel lateral izquierdo (permite interactuar con la lista a la derecha)',
      label: 'Izq',
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
          <rect x="2.5" y="3.5" width="4.5" height="9" rx="1" fill="currentColor" stroke="none" />
        </svg>
      )
    },
    {
      id: 'center',
      title: 'Mostrar como ventana flotante centrada',
      label: 'Centro',
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
          <rect x="4.2" y="4.5" width="7.6" height="7" rx="1" fill="currentColor" stroke="none" />
        </svg>
      )
    },
    {
      id: 'right',
      title: 'Acoplar como panel lateral derecho (permite interactuar con la lista a la izquierda)',
      label: 'Der',
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
          <rect x="9" y="3.5" width="4.5" height="9" rx="1" fill="currentColor" stroke="none" />
        </svg>
      )
    }
  ];

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        backgroundColor: '#F1F2F4',
        border: '1px solid #DCDFE4',
        borderRadius: '6px',
        padding: '2px',
        gap: '2px',
        flexShrink: 0
      }}
      title="Posición del panel (se guarda automáticamente)"
    >
      {modes.map((m) => {
        const active = dockPosition === m.id;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onChange(m.id)}
            title={m.title}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 7px',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: active ? '#FFFFFF' : 'transparent',
              color: active ? '#0C66E4' : '#626F86',
              boxShadow: active ? '0 1px 2px rgba(9, 30, 66, 0.16)' : 'none',
              fontSize: '11px',
              fontWeight: active ? 700 : 600,
              cursor: 'pointer',
              lineHeight: 1,
              transition: 'all 0.15s ease'
            }}
          >
            {m.icon}
            <span>{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}
