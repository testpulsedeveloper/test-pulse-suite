/**
 * @file LifecycleTimeline.jsx
 * @description Gantt-style timeline of the Lifecycle module (v4.26.0).
 *
 * Draws one horizontal bar per row (a Test Plan, a Test Cycle or an initiative) between its start
 * and end dates, plus diamond markers ◆ for milestones (deliverables with a delivery date) and a
 * vertical line for today. It is plain HTML/CSS: every bar is positioned with a percentage of the
 * total period, so it needs no chart library and scales with the width of the page.
 *
 * Bar colours (same meaning everywhere in Lifecycle):
 *   - green  → every execution passed;
 *   - red    → the end date has passed and there are executions left (late);
 *   - blue   → in progress;
 *   - grey   → not started yet / no executions.
 * The darker part of a bar is the share of executions already run (passed + failed + blocked).
 *
 * Rows without dates cannot be drawn; they are listed under the chart so nobody thinks they
 * were forgotten.
 *
 * Props:
 *   rows: Array<{ id, label, sublabel?, start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', runs?, level?, href?,
 *                 onToggle?, open? }>
 *         `level` 1 indents the row (a cycle under its plan). `runs` = { total, passed, failed,
 *         blocked, notRun, other }. `onToggle`/`open` show an arrow that opens/closes child rows.
 *   milestones: Array<{ date, label }>
 *   onOpen: (href) => void - Opens a Jira issue (rows with `href`).
 *   emptyText: string - Shown when no row has dates.
 */

import React from 'react';

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "2026-11-17" → milliseconds at 00:00 UTC, or null when the text is not a date. */
const parseDay = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
};

/** Today at 00:00 UTC, so "today" and the dates are compared on the same scale. */
const todayMs = () => {
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
};

/** "2026-11-17" → "17 nov 2026". */
const formatDay = (value) => {
  const ms = parseDay(value);
  if (ms === null) return '';
  const date = new Date(ms);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
};

/** Colour of a bar from its executions and its end date (see the file header). */
export const barState = (runs, endMs, today = todayMs()) => {
  const total = runs?.total || 0;
  const executed = (runs?.passed || 0) + (runs?.failed || 0) + (runs?.blocked || 0);
  if (total > 0 && runs.passed === total) return 'done';
  if (endMs !== null && endMs < today && total > 0 && executed < total) return 'late';
  if (endMs !== null && endMs < today && total === 0) return 'late';
  if (executed > 0) return 'progress';
  return 'pending';
};

const STATE_COLORS = {
  done: { bar: '#BAF3DB', fill: '#1F845A', label: 'Completado' },
  late: { bar: '#FFD5D2', fill: '#C9372C', label: 'Atrasado' },
  progress: { bar: '#CCE0FF', fill: '#0C66E4', label: 'En curso' },
  pending: { bar: '#DCDFE4', fill: '#8590A2', label: 'Sin iniciar' }
};

const LABEL_WIDTH = 230;

export default function LifecycleTimeline({ rows = [], milestones = [], onOpen, emptyText = 'Sin fechas para mostrar.' }) {
  const today = todayMs();
  const dated = rows.map(row => ({ ...row, startMs: parseDay(row.start), endMs: parseDay(row.end) }));
  const drawable = dated.filter(row => row.startMs !== null && row.endMs !== null && row.endMs >= row.startMs);
  const undated = dated.filter(row => !drawable.includes(row));
  const marks = milestones.map(m => ({ ...m, ms: parseDay(m.date) })).filter(m => m.ms !== null);

  if (drawable.length === 0 && marks.length === 0) {
    return <div style={{ color: 'var(--jira-subtle, #626F86)', fontSize: '0.8rem' }}>{emptyText}</div>;
  }

  // Period shown: from the earliest to the latest date (bars, milestones and today), with a
  // few days of margin on both sides so nothing touches the edges.
  const points = [...drawable.flatMap(row => [row.startMs, row.endMs]), ...marks.map(m => m.ms), today];
  const from = Math.min(...points) - 3 * DAY_MS;
  const to = Math.max(...points) + 4 * DAY_MS;
  const span = Math.max(to - from, DAY_MS);
  const pos = (ms) => `${((ms - from) / span) * 100}%`;
  const width = (startMs, endMs) => `${Math.max(((endMs - startMs + DAY_MS) / span) * 100, 0.6)}%`;

  // Month ticks along the top axis.
  const ticks = [];
  const first = new Date(from);
  let tick = Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1);
  while (tick < to) {
    const date = new Date(tick);
    ticks.push({ ms: tick, label: `${MONTHS[date.getUTCMonth()]}${date.getUTCMonth() === 0 ? ` ${date.getUTCFullYear()}` : ''}` });
    tick = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  }

  const grid = (children, height) => (
    <div style={{ position: 'relative', flex: '1 1 auto', minWidth: 0, height }}>
      {ticks.map(t => <div key={t.ms} style={{ position: 'absolute', left: pos(t.ms), top: 0, bottom: 0, borderLeft: '1px dashed var(--jira-border, #DCDFE4)' }} />)}
      {today >= from && today <= to && <div title="Hoy" style={{ position: 'absolute', left: pos(today), top: 0, bottom: 0, borderLeft: '2px solid #E2483D' }} />}
      {children}
    </div>
  );

  return (
    <div style={{ fontSize: '0.78rem' }}>
      {/* Axis: months and today */}
      <div style={{ display: 'flex' }}>
        <div style={{ flex: `0 0 ${LABEL_WIDTH}px` }} />
        {grid(
          <>
            {ticks.map(t => <span key={t.ms} style={{ position: 'absolute', left: pos(t.ms), top: 0, paddingLeft: '3px', color: 'var(--jira-subtle, #626F86)' }}>{t.label}</span>)}
            {today >= from && today <= to && <span style={{ position: 'absolute', left: pos(today), bottom: 0, paddingLeft: '3px', color: '#E2483D', fontWeight: 700 }}>Hoy</span>}
          </>, 30)}
      </div>

      {/* Milestones: one line with every deliverable that has a delivery date */}
      {marks.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', borderTop: '1px solid var(--jira-border, #DCDFE4)' }}>
          <div style={{ flex: `0 0 ${LABEL_WIDTH}px`, padding: '4px 8px 4px 0', color: 'var(--jira-subtle, #626F86)' }}>Hitos (entregables)</div>
          {grid(marks.map((m, i) => (
            <span key={`${m.date}-${i}`} title={`${m.label} · ${formatDay(m.date)}`}
              style={{ position: 'absolute', left: pos(m.ms + DAY_MS / 2), top: '50%', transform: 'translate(-50%, -50%) rotate(45deg)', width: '9px', height: '9px', background: '#6E5DC6', border: '1px solid #FFFFFF' }} />
          )), 24)}
        </div>
      )}

      {/* One bar per row */}
      {drawable.map(row => {
        const state = barState(row.runs, row.endMs, today);
        const colors = STATE_COLORS[state];
        const total = row.runs?.total || 0;
        const executed = (row.runs?.passed || 0) + (row.runs?.failed || 0) + (row.runs?.blocked || 0);
        const pct = total > 0 ? Math.round((executed / total) * 100) : 0;
        const tooltip = `${row.label}${row.sublabel ? ` — ${row.sublabel}` : ''}\n${formatDay(row.start)} → ${formatDay(row.end)}\n${colors.label}${total > 0 ? ` · ${executed} de ${total} ejecutados (${pct}%)` : ''}`;
        return (
          <div key={row.id} style={{ display: 'flex', alignItems: 'center', borderTop: '1px solid var(--jira-border, #DCDFE4)' }}>
            <div style={{ flex: `0 0 ${LABEL_WIDTH}px`, padding: `5px 8px 5px ${row.level ? 18 : 0}px`, minWidth: 0, display: 'flex', alignItems: 'center', gap: '4px' }}>
              {row.onToggle && (
                <button type="button" onClick={row.onToggle} aria-expanded={Boolean(row.open)} title={row.open ? 'Ocultar ciclos' : 'Ver ciclos'}
                  style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: 'var(--jira-subtle, #626F86)', width: '12px' }}>
                  {row.open ? '▾' : '▸'}
                </button>
              )}
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.sublabel || row.label}>
                {row.href
                  ? <button type="button" onClick={() => onOpen?.(row.href)} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: 'var(--jira-blue, #0C66E4)', fontWeight: row.level ? 400 : 700, fontSize: 'inherit' }}>{row.label}</button>
                  : <strong style={{ color: 'var(--jira-text, #172B4D)' }}>{row.label}</strong>}
                {row.sublabel && <span style={{ color: 'var(--jira-subtle, #626F86)' }}> {row.sublabel}</span>}
              </span>
            </div>
            {grid(
              <div title={tooltip} style={{ position: 'absolute', left: pos(row.startMs), width: width(row.startMs, row.endMs), top: '5px', bottom: '5px', background: colors.bar, borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: colors.fill }} />
              </div>, 26)}
          </div>
        );
      })}

      {/* Legend */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '8px', color: 'var(--jira-subtle, #626F86)' }}>
        {Object.values(STATE_COLORS).map(c => (
          <span key={c.label} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '14px', height: '8px', borderRadius: '2px', background: c.fill }} />{c.label}
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '8px', height: '8px', background: '#6E5DC6', transform: 'rotate(45deg)' }} />Hito
        </span>
        <span>La parte oscura de cada barra es lo ya ejecutado.</span>
      </div>

      {undated.length > 0 && (
        <div style={{ marginTop: '6px', color: 'var(--jira-subtle, #626F86)' }}>
          Sin fechas en Planeación: {undated.map(row => row.label).join(', ')}.
        </div>
      )}
    </div>
  );
}
