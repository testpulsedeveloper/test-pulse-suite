/**
 * GoNoGoCard.jsx — "Preparación Go / No-Go" (Test Pulse 5.0, v4.43.0).
 *
 * Shows the release exit criteria (utils/goNoGo.js) for the cycles selected in Calidad and the
 * resulting QA recommendation. Purely presentational: the parent passes numbers it already
 * computed, so this card adds no requests.
 *
 * The wording always says "recomendación": QA recommends, the release owners decide.
 */
import React, { useMemo } from 'react';
import { evaluateGoNoGo } from '../utils/goNoGo';

const VERDICT_TONE = { go: 'tp5-loz--success', 'go-exception': 'tp5-loz--warning', 'no-go': 'tp5-loz--danger', empty: 'tp5-loz--neutral' };

export default function GoNoGoCard({ passed, failed, blocked, notRun, bugs, scopeLabel, includeBugs = true, footnote }) {
  const r = useMemo(
    () => evaluateGoNoGo({ passed, failed, blocked, notRun, bugs, includeBugs }),
    [passed, failed, blocked, notRun, bugs, includeBugs]
  );
  return (
    <section className="tp5-card tp5-gonogo" aria-label="Preparación Go / No-Go">
      <div className="tp5-section__head">
        <h2 className="tp5-h2">Preparación Go / No-Go</h2>
        {scopeLabel && <span className="tp5-subtle tp5-small tp5-ellipsis">{scopeLabel}</span>}
        <span className={`tp5-loz ${VERDICT_TONE[r.verdict]}`} style={{ marginLeft: 'auto' }}>
          {r.verdict === 'empty' ? 'SIN DATOS' : `RECOMENDACIÓN: ${r.verdictLabel.toUpperCase()}`}
        </span>
      </div>
      {r.verdict === 'empty' ? (
        <p className="tp5-subtle tp5-small" style={{ margin: 0 }}>Selecciona ciclos con casos para evaluar los criterios de salida.</p>
      ) : (
        <>
          <ul className="tp5-gonogo__list">
            {r.criteria.map(c => (
              <li key={c.id} className={`tp5-gonogo__item ${c.ok ? 'is-ok' : 'is-bad'}`}>
                <span className="tp5-gonogo__icon" aria-hidden="true">{c.ok ? '✓' : '✕'}</span>
                <span className="tp5-gonogo__text">
                  <span className="tp5-strong">{c.label}</span>
                  <span className="tp5-subtle tp5-small">{c.detail}</span>
                </span>
                <span className="tp5-sr-only">{c.ok ? 'Cumple' : 'No cumple'}</span>
              </li>
            ))}
          </ul>
          <p className="tp5-subtle tp5-small" style={{ margin: 0 }}>
            {r.met} de {r.total} criterios cumplidos. Es una recomendación de QA, no una autorización de liberación.{footnote ? ` ${footnote}` : ''}
          </p>
        </>
      )}
    </section>
  );
}
