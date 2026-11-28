/**
 * CycleHealthCard.jsx — "Salud del ciclo" in Planeación (Test Pulse 5.0, v4.42.0).
 *
 * Eight indicators (see utils/cycleHealthIndicators.js) that tell whether the selected cycle
 * will finish on time. "Personalizar" lets each person hide the ones they don't use; the
 * choice is kept in this browser only (a convenience, not shared data).
 *
 * Data: the cycle's cases and schedule come from Planeación (already loaded). The only call
 * is one read of the project's environment downtime reports when the cycle changes.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '../utils/queryClient';
import { computeCycleHealth } from '../utils/cycleHealthIndicators';

const HIDDEN_KEY = 'tp_cycle_health_hidden_v1';
const readHidden = () => {
  try { const v = JSON.parse(window.localStorage.getItem(HIDDEN_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; }
};
const writeHidden = (list) => {
  try { window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(list)); } catch (_) { /* storage blocked */ }
};

const TONE_CLASS = { success: 'tp5-loz--success', warning: 'tp5-loz--warning', danger: 'tp5-loz--danger', neutral: 'tp5-loz--neutral' };
const TONE_LABEL = { success: 'BIEN', warning: 'ATENCIÓN', danger: 'RIESGO', neutral: 'SIN DATOS' };

export default function CycleHealthCard({ projectId, cycle, tests, schedule, environments }) {
  const [downtime, setDowntime] = useState([]);
  const [hidden, setHidden] = useState(() => readHidden());
  const [customOpen, setCustomOpen] = useState(false);

  // One read per cycle change; failures simply leave the downtime indicator empty.
  useEffect(() => {
    if (!projectId || !cycle?.id) return undefined;
    let cancelled = false;
    invoke('getEnvDowntime', { projectId })
      .then(res => { if (!cancelled) setDowntime(Array.isArray(res?.events) ? res.events : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [projectId, cycle?.id]);

  const indicators = useMemo(
    () => computeCycleHealth({ tests, schedule, downtime, environments }),
    [tests, schedule, downtime, environments]
  );
  const visible = indicators.filter(i => !hidden.includes(i.id));

  const toggle = (id) => {
    const next = hidden.includes(id) ? hidden.filter(x => x !== id) : [...hidden, id];
    setHidden(next);
    writeHidden(next);
  };

  if (!cycle) return null;
  return (
    <section className="tp5-card tp5-health" aria-label="Salud del ciclo">
      <div className="tp5-section__head">
        <h2 className="tp5-h2">Salud del ciclo</h2>
        <span className="tp5-subtle tp5-small">Se calcula en días hábiles, sin fines de semana ni festivos</span>
        <button type="button" className="tp5-link" onClick={() => setCustomOpen(o => !o)} aria-expanded={customOpen}>
          Personalizar · {visible.length} de {indicators.length}
        </button>
      </div>
      {customOpen && (
        <div className="tp5-health__custom" role="group" aria-label="Indicadores visibles">
          {indicators.map(i => (
            <label key={i.id} className="tp5-radio">
              <input type="checkbox" checked={!hidden.includes(i.id)} onChange={() => toggle(i.id)} /> {i.label}
            </label>
          ))}
        </div>
      )}
      {visible.length === 0 ? (
        <p className="tp5-subtle tp5-small" style={{ margin: 0 }}>Ocultaste todos los indicadores. Usa Personalizar para mostrarlos.</p>
      ) : (
        <div className="tp5-health__grid">
          {visible.map(i => (
            <div key={i.id} className="tp5-health__item">
              <div className="tp5-kpi__head">
                <span className="tp5-kpi__label">{i.label}</span>
                <span className={`tp5-loz ${TONE_CLASS[i.tone]}`}>{TONE_LABEL[i.tone]}</span>
              </div>
              <span className="tp5-health__value">{i.value}</span>
              <span className="tp5-kpi__detail">{i.detail}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
