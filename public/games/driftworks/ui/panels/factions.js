// Factions: your standing with each, and what each pays more for or sells
// cheaper.

import { goodName } from '../../content/goods.js';
import { nextLevel, standingLevel, standingPoints } from '../../systems/standing.js';
import { h } from '../dom.js';

const goodList = (goods) => goods.map((g) => goodName(g).toLowerCase()).join(' and ');

/** What a faction pays more for and sells cheaper, or null for none (Halcyon). */
export function specialities(faction) {
  const parts = [];
  if (faction.pays?.length) parts.push(`Pays more for ${goodList(faction.pays)}`);
  if (faction.cheap?.length) parts.push(`sells ${goodList(faction.cheap)} cheaper`);
  return parts.length ? parts.join(', ') : null;
}

/** A faction with your standing and its specialities. */
export function factionRow(state, faction) {
  const level = standingLevel(state, faction.id);
  const next = nextLevel(state, faction.id);
  const points = Math.floor(standingPoints(state, faction.id));
  const standing = next ? `${level.name} · ${points} / ${next.points} to ${next.name}` : `${level.name} · ${points} points`;
  const bonus = level.bonus ? ` · prices ${Math.round(level.bonus * 100)}% better` : '';
  const special = specialities(faction);
  return h(
    'li',
    { class: 'dw-ship-row dw-faction-row', dataset: { key: `faction-${faction.id}` } },
    h('span', { class: 'dw-faction-dot', style: { background: faction.color }, 'aria-hidden': 'true' }),
    h('span', { class: 'dw-grow' }, h('strong', null, faction.name), h('small', null, `${standing}${bonus}`), special ? h('small', null, special) : null),
  );
}
