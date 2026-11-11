/**
 * Tests for src/utils/wikiPanels.js (v4.23.5): Jira wiki `{panel}` markup shown as a box.
 * All data below is made up.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePanelParams, wikiPanelsToHtml, plainTextToAdfWithPanels } from '../src/utils/wikiPanels.js';

test('panel parameters: hex colour and title only', () => {
  assert.deepEqual(parsePanelParams('bgColor=#eae6ff'), { bgColor: '#eae6ff', title: '' });
  assert.deepEqual(parsePanelParams('title=Datos|bgColor=#FFF'), { bgColor: '#FFF', title: 'Datos' });
  // Anything that is not a hex colour never reaches the style attribute.
  assert.equal(parsePanelParams('bgColor=red;position:fixed').bgColor, '#F4F5F7');
  assert.equal(parsePanelParams('').bgColor, '#F4F5F7');
});

test('plain-text field rendered by Jira: markers become a coloured box', () => {
  const html = '<p>{panel:bgColor=#eae6ff}<br/>Datos de prueba para el escenario.<br/>{panel}</p>';
  const out = wikiPanelsToHtml(html);
  assert.ok(!out.includes('{panel'), 'no literal markers left');
  assert.ok(out.includes('<div class="tp-wiki-panel" style="background-color:#eae6ff;'));
  assert.ok(out.includes('>Datos de prueba para el escenario.</div>'), 'no blank first/last line');
});

test('one paragraph per line (ADF field) and a title', () => {
  const html = '<p>Antes</p><p>{panel:title=Nota}</p><p>Linea uno</p><p>{panel}</p><p>Despues</p>';
  const out = wikiPanelsToHtml(html);
  assert.ok(!out.includes('{panel'));
  assert.ok(out.startsWith('<p>Antes</p>'));
  assert.ok(out.includes('<strong>Nota</strong>'));
  assert.ok(out.includes('<p>Linea uno</p>'));
  assert.ok(out.endsWith('<p>Despues</p>'));
});

test('text without a complete pair is left as it is', () => {
  assert.equal(wikiPanelsToHtml('<p>Sin marcado</p>'), '<p>Sin marcado</p>');
  assert.equal(wikiPanelsToHtml('<p>{panel} abierto</p>'), '<p>{panel} abierto</p>');
  assert.equal(wikiPanelsToHtml(null), null);
});

test('plain text to ADF: panel node with the inner lines', () => {
  const nodes = plainTextToAdfWithPanels('Intro\n{panel:bgColor=#eae6ff}\nDato A\nDato B\n{panel}\nFin');
  assert.deepEqual(nodes.map(n => n.type), ['paragraph', 'panel', 'paragraph']);
  assert.deepEqual(nodes[1].content.map(p => p.content[0].text), ['Dato A', 'Dato B']);
  assert.deepEqual(plainTextToAdfWithPanels('  '), []);
  assert.deepEqual(plainTextToAdfWithPanels('Solo\ntexto').map(n => n.content[0].text), ['Solo', 'texto']);
});
