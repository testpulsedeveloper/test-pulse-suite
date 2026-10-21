import React, { useState, useEffect } from 'react';

/**
 * Clave de almacenamiento local para recordar la preferencia de acoplamiento (docking)
 * de los paneles de inspección y ejecución en el navegador del usuario.
 */
const DOCK_STORAGE_KEY = 'tp_panel_dock_position';

/**
 * Clave de almacenamiento local para recordar el ancho personalizado (en píxeles)
 * del panel lateral cuando está acoplado a la izquierda o a la derecha.
 */
const DOCK_WIDTH_STORAGE_KEY = 'tp_panel_dock_width';

/**
 * Eventos personalizados de ventana para sincronizar en tiempo real todos los paneles
 * abiertos y el contenedor principal cuando el usuario cambia la posición o arrastra la línea divisora.
 */
const DOCK_SYNC_EVENT = 'tp-panel-dock-change';
const DOCK_WIDTH_SYNC_EVENT = 'tp-panel-dock-width-change';

/**
 * Límites y valor por defecto del ancho del panel lateral acoplado (en píxeles).
 */
export const DEFAULT_DOCK_WIDTH_PX = 720;
export const MIN_DOCK_WIDTH_PX = 380;
export const MAX_DOCK_WIDTH_VW_RATIO = 0.78;

/**
 * Ancho estándar de respaldo del panel acoplado en modo Split-View integrado (Izquierda / Derecha).
 */
export const DOCK_SPLIT_WIDTH = 'min(720px, 78vw)';

/**
 * Calcula el ancho máximo permitido en píxeles según el tamaño actual de la ventana,
 * asegurando que siempre quede al menos 300px visibles para la mesa de trabajo principal.
 */
export function clampDockWidth(px) {
  const num = Number(px);
  if (!Number.isFinite(num)) return DEFAULT_DOCK_WIDTH_PX;
  const vw = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1440;
  const maxPx = Math.max(MIN_DOCK_WIDTH_PX + 80, Math.min(1400, Math.floor(vw * MAX_DOCK_WIDTH_VW_RATIO), vw - 280));
  return Math.max(MIN_DOCK_WIDTH_PX, Math.min(maxPx, Math.round(num)));
}

/**
 * Lee de forma segura el ancho personalizado guardado en localStorage.
 */
export function getSavedDockWidth() {
  try {
    const raw = window.localStorage.getItem(DOCK_WIDTH_STORAGE_KEY);
    if (raw) {
      const parsed = parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed >= MIN_DOCK_WIDTH_PX) {
        return clampDockWidth(parsed);
      }
    }
  } catch (_) {
    // En caso de restricción de iframe/cookies, usamos el ancho por defecto.
  }
  return DEFAULT_DOCK_WIDTH_PX;
}

/**
 * Devuelve la expresión CSS segura para el ancho del panel acoplado y el margen del workspace.
 */
export function getDockSplitCssWidth(widthPx) {
  const safePx = clampDockWidth(widthPx || getSavedDockWidth());
  return `min(${safePx}px, 78vw)`;
}

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
 * Hook personalizado que gestiona y sincroniza en tiempo real el ancho del panel lateral
 * (en píxeles) y el estado de arrastre activo (`isResizing`) en toda la aplicación.
 */
export function usePanelDockWidth() {
  const [dockWidth, setDockWidthState] = useState(() => getSavedDockWidth());
  const [isResizing, setIsResizingState] = useState(false);

  useEffect(() => {
    const handleSync = (event) => {
      if (event?.detail?.width !== undefined) {
        setDockWidthState(clampDockWidth(event.detail.width));
      } else {
        setDockWidthState(getSavedDockWidth());
      }
      if (typeof event?.detail?.isResizing === 'boolean') {
        setIsResizingState(event.detail.isResizing);
      }
    };
    window.addEventListener(DOCK_WIDTH_SYNC_EVENT, handleSync);
    return () => window.removeEventListener(DOCK_WIDTH_SYNC_EVENT, handleSync);
  }, []);

  const setDockWidth = (nextWidth, options = {}) => {
    const clamped = clampDockWidth(nextWidth);
    const activeResize = Boolean(options.isResizing);
    setDockWidthState(clamped);
    setIsResizingState(activeResize);
    try {
      if (options.persist !== false) {
        window.localStorage.setItem(DOCK_WIDTH_STORAGE_KEY, String(clamped));
      }
      window.dispatchEvent(
        new CustomEvent(DOCK_WIDTH_SYNC_EVENT, {
          detail: { width: clamped, isResizing: activeResize }
        })
      );
    } catch (_) {
      // Ignorar errores de almacenamiento en navegadores con bloqueo estricto.
    }
  };

  return [dockWidth, setDockWidth, isResizing];
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
  const activeWidthPx = options.dockWidthPx || getSavedDockWidth();
  const drawerWidth = getDockSplitCssWidth(activeWidthPx);
  const drawerMinWidth = `${MIN_DOCK_WIDTH_PX}px`;
  const bg = options.backgroundColor || '#FFFFFF';
  const isResizing = Boolean(options.isResizing);

  if (isCenter) {
    return {
      position: 'relative',
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
    position: 'relative',
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
    maxWidth: '78vw',
    height: 'calc(100vh - 56px)',
    minHeight: 'calc(100vh - 56px)',
    maxHeight: 'calc(100vh - 56px)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    transition: isResizing
      ? 'none'
      : 'width 0.18s cubic-bezier(0.16, 1, 0.3, 1), transform 0.18s ease'
  };
}

/**
 * Barra divisora interactiva (Splitter / Resizer) para el borde interior del panel lateral acoplado.
 * Permite arrastrar hacia la izquierda o derecha para agrandar o achicar el panel lateral,
 * guardando automáticamente la preferencia del usuario en localStorage.
 */
export function PanelResizeHandle({ dockPosition }) {
  const [dockWidth, setDockWidth, isResizing] = usePanelDockWidth();
  const [isHovered, setIsHovered] = useState(false);

  if (dockPosition !== 'left' && dockPosition !== 'right') {
    return null;
  }

  const isLeftDock = dockPosition === 'left';

  const handleMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation();

    let latestWidth = dockWidth;
    setDockWidth(latestWidth, { isResizing: true, persist: false });

    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    const handleMouseMove = (moveEvt) => {
      const vw = window.innerWidth || 1440;
      const rawNext = isLeftDock ? moveEvt.clientX : (vw - moveEvt.clientX);
      latestWidth = clampDockWidth(rawNext);
      setDockWidth(latestWidth, { isResizing: true, persist: true });
    };

    const handleMouseUp = () => {
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      setDockWidth(latestWidth, { isResizing: false, persist: true });
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleDoubleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDockWidth(DEFAULT_DOCK_WIDTH_PX, { isResizing: false, persist: true });
  };

  const activeHighlight = isResizing || isHovered;

  return (
    <div
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      title="Arrastra la línea divisora para ajustar el tamaño del panel lateral (doble clic para restaurar tamaño original)"
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        [isLeftDock ? 'right' : 'left']: 0,
        width: '10px',
        cursor: 'col-resize',
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: activeHighlight ? 'rgba(225, 0, 122, 0.08)' : 'transparent',
        borderLeft: !isLeftDock && activeHighlight ? '2px solid #E1007A' : 'none',
        borderRight: isLeftDock && activeHighlight ? '2px solid #E1007A' : 'none',
        transition: 'background-color 0.12s ease'
      }}
    >
      {/* Pastilla visual central de agarre (Grip Pill) */}
      <div
        style={{
          width: '6px',
          height: '44px',
          borderRadius: '999px',
          backgroundColor: activeHighlight ? '#E1007A' : '#B3BAC5',
          boxShadow: activeHighlight ? '0 0 0 3px rgba(225, 0, 122, 0.18)' : '0 1px 2px rgba(9,30,66,0.12)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '3px',
          opacity: activeHighlight ? 1 : 0.75,
          transition: 'all 0.12s ease',
          pointerEvents: 'none'
        }}
      >
        <span style={{ width: '2px', height: '2px', borderRadius: '50%', backgroundColor: '#FFFFFF' }} />
        <span style={{ width: '2px', height: '2px', borderRadius: '50%', backgroundColor: '#FFFFFF' }} />
        <span style={{ width: '2px', height: '2px', borderRadius: '50%', backgroundColor: '#FFFFFF' }} />
      </div>

      {/* Indicador flotante de ancho en píxeles mientras se arrastra */}
      {isResizing && (
        <div
          style={{
            position: 'fixed',
            top: '68px',
            [isLeftDock ? 'left' : 'right']: `${ Math.max(24, dockWidth - 75) }px`,
            backgroundColor: '#172B4D',
            color: '#FFFFFF',
            fontSize: '10.5px',
            fontWeight: 700,
            padding: '3px 8px',
            borderRadius: '999px',
            boxShadow: '0 4px 12px rgba(9,30,66,0.28)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 9999
          }}
        >
          ↔ {dockWidth} px
        </div>
      )}
    </div>
  );
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
