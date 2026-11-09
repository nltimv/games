// Fleets in the panels: a commander's card, wing and missions (on the
// command ship's panel), joining a fleet (on any other ship's), a ship
// aboard a fleet, and the commanders a shipyard offers.

import { FEE_LIMIT_STEPS, MARGIN_STEPS, MISSIONS, MISSION_IDS, TRAITS } from '../../content/commanders.js';
import { HULLS } from '../../content/ships.js';
import { allFactions, allSystems, findPlace, findSystem, systemOf } from '../../content/galaxy.js';
import { goodName } from '../../content/goods.js';
import { formatCredits, formatNumber } from '../../../../shared/js/format.js';
import { candidates, commanderLevel, commanders, fleetCommand, hireCommander, hireCost, hireLock, hireShortfall, joiningOf, leaderOf, levelProgress, onMap, traitText, wingOf } from '../../systems/commanders.js';
import { areaAround, canStartMission, doctrineOf, joinFleet, leaveFleet, missionArea, setDoctrine, startMission } from '../../systems/missions.js';
import { findShip } from '../../systems/fleet.js';
import { isSurveyed } from '../../systems/explore.js';
import { isShielded } from '../../systems/shielding.js';
import { bar, countdown, h } from '../dom.js';
import { button, chip, sectionTitle, shipGlyph } from '../components.js';
import { portrait } from '../portrait.js';
import { plural, signedCredits } from '../format.js';
import { shipRow } from './lists.js';

// The mission being planned for each commander: { kind, center, hours }.
// UI state only; the galaxy map lights up its area.
const drafts = new Map();

/** The area a commander's mission covers now, or would cover as planned, for the galaxy map. */
export function plannedArea(state, commander) {
  if (!commander?.commander) return null;
  if (commander.mission) return missionArea(state, commander.mission);
  const command = fleetCommand(state);
  const draft = draftOf(state, commander);
  return command && draft.center ? areaAround(state, draft.center, command.reach) : null;
}

function draftOf(state, commander) {
  if (!drafts.has(commander.id)) {
    const command = fleetCommand(state);
    const lead = wingOf(state, commander).map((ship) => HULLS[ship.hull].role);
    const kind = MISSION_IDS.find((id) => lead.includes(MISSIONS[id].lead)) ?? 'mine';
    drafts.set(commander.id, { kind, center: startCenter(state, commander) ?? 'aurel', hours: command?.hours.at(-1) ?? 1 });
  }
  return drafts.get(commander.id);
}

/** The system the commander is in, if ships can work there. */
function startCenter(state, commander) {
  const system = findSystem(systemOf(commander.at));
  return system && isSurveyed(state, system.id) && isShielded(state, system) ? system.id : null;
}

// ---------- The commander's own panel ----------

export function commanderSections(ctx, commander) {
  return [commanderCard(ctx, commander), missionSection(ctx, commander), wingSection(ctx, commander), doctrineSection(ctx, commander), reportSection(ctx, commander)];
}

/** Standing orders (Fleet command II): kept from mission to mission. */
function doctrineSection(ctx, commander) {
  const { state } = ctx;
  if (!fleetCommand(state)?.doctrines) return null;
  const doctrine = doctrineOf(commander);
  const set = (patch) => ctx.act((s) => setDoctrine(s, findShip(s, commander.id), patch));
  const row = (label, steps, value, text, field) =>
    h(
      'div',
      { class: 'dw-field' },
      h('span', null, label),
      h(
        'div',
        { class: 'dw-chips', role: 'group', 'aria-label': label },
        steps.map((step) => chip(text(step), value === step ? 'aqua' : null, { onClick: () => set({ [field]: step }), 'aria-pressed': String(value === step), dataset: { key: `doctrine-${field}-${step}` } })),
      ),
    );
  const met = allFactions().filter((faction) => state.standing?.[faction.id] != null);
  return h(
    'div',
    { class: 'dw-section' },
    sectionTitle('Standing orders'),
    row('Least margin on a run', MARGIN_STEPS, doctrine.margin, (m) => (m ? `${m} cr/t` : 'Any'), 'margin'),
    row('Most fees on a run', FEE_LIMIT_STEPS, doctrine.feeLimit, (f) => (f == null ? 'No limit' : f === 0 ? 'No fees' : formatCredits(f)), 'feeLimit'),
    h(
      'label',
      { class: 'dw-field' },
      h('span', null, 'Trades with'),
      h(
        'select',
        { class: 'dw-select', dataset: { key: 'doctrine-factions' }, onChange: (e) => set({ factions: e.target.value }) },
        h('option', { value: 'any', selected: doctrine.factions === 'any' }, 'Anyone'),
        h('option', { value: 'friendly', selected: doctrine.factions === 'friendly' }, 'Factions at Friendly or better'),
        met.map((faction) => h('option', { value: faction.id, selected: doctrine.factions === faction.id }, `Only the ${faction.name}`)),
      ),
    ),
  );
}

function commanderCard(ctx, commander) {
  const level = commanderLevel(commander);
  const progress = levelProgress(commander);
  const traits = commander.commander.traits.slice(0, level >= 3 ? 2 : 1);
  return h(
    'div',
    { class: 'dw-card dw-commander' },
    h(
      'div',
      { class: 'dw-commander-head' },
      portrait(commander, 64),
      h(
        'div',
        { class: 'dw-grow' },
        h('strong', null, `Level ${level} commander`),
        h('span', { class: 'dw-note' }, traitText(commander)),
        progress.next ? bar({ fraction: (progress.hours - progress.from) / (progress.next - progress.from), small: true }) : null,
        h('small', { class: 'dw-note' }, progress.next ? `${formatNumber(Math.floor(progress.hours))} of ${progress.next} h on missions for level ${level + 1}` : `${formatNumber(Math.floor(progress.hours))} h on missions`),
      ),
    ),
    h('ul', { class: 'dw-traits' }, traits.map((id) => h('li', null, h('strong', null, TRAITS[id].name), ` ${TRAITS[id].note}`))),
  );
}

function missionSection(ctx, commander) {
  const { state } = ctx;
  const mission = commander.mission;
  if (mission) {
    const system = findSystem(mission.center);
    const area = missionArea(state, mission);
    const returning = mission.status === 'returning';
    return h(
      'div',
      { class: 'dw-section' },
      sectionTitle(`${MISSIONS[mission.kind].name} mission`, `${system.name} area · ${plural(area.length, 'system')}`),
      h(
        'div',
        { class: 'dw-card is-aqua' },
        h('div', { class: 'dw-card-head' }, h('strong', null, returning ? 'Heading back to the command ship' : `${MISSIONS[mission.kind].verb} around ${system.name}`), returning ? null : countdown(mission.endsAt)),
        returning ? null : bar({ start: mission.startedAt, end: mission.endsAt }),
        h('p', { class: 'dw-note' }, `${plural(mission.ships, 'ship')} out of contact until the fleet is back.`),
      ),
    );
  }

  const command = fleetCommand(state);
  const draft = draftOf(state, commander);
  const set = (patch) => {
    Object.assign(draft, patch);
    ctx.update({});
  };
  const check = canStartMission(state, commander, draft);
  const centers = allSystems()
    .filter((s) => isSurveyed(state, s.id) && isShielded(state, s))
    .sort((a, b) => a.name.localeCompare(b.name));
  const area = command ? areaAround(state, draft.center, command.reach) : [];
  return h(
    'div',
    { class: 'dw-section' },
    sectionTitle('New mission'),
    h(
      'div',
      { class: 'dw-chips', role: 'group', 'aria-label': 'Mission' },
      MISSION_IDS.map((id) => chip(MISSIONS[id].name, draft.kind === id ? 'aqua' : null, { onClick: () => set({ kind: id }), 'aria-pressed': String(draft.kind === id), dataset: { key: `mission-${id}` } })),
    ),
    h(
      'label',
      { class: 'dw-field' },
      h('span', null, 'Area around'),
      h(
        'select',
        { class: 'dw-select', dataset: { key: 'mission-center' }, onChange: (e) => set({ center: e.target.value }) },
        centers.map((s) => h('option', { value: s.id, selected: s.id === draft.center }, s.name)),
      ),
      h('small', { class: 'dw-note' }, `${plural(area.length, 'system')}, out to ${plural(command?.reach ?? 1, 'jump')}`),
    ),
    h(
      'div',
      { class: 'dw-chips', role: 'group', 'aria-label': 'Hours' },
      (command?.hours ?? []).map((hours) => chip(`${hours} h`, draft.hours === hours ? 'aqua' : null, { onClick: () => set({ hours }), 'aria-pressed': String(draft.hours === hours), dataset: { key: `mission-hours-${hours}` } })),
    ),
    check.ok ? null : h('p', { class: 'dw-note' }, check.error),
    button(`Start the ${MISSIONS[draft.kind].name.toLowerCase()} mission`, {
      variant: 'primary',
      block: true,
      disabled: !check.ok,
      key: 'start-mission',
      onClick: () => {
        const result = ctx.act((s) => startMission(s, findShip(s, commander.id), { ...draft }));
        if (result?.ok) ctx.toast(`${commander.name} is on the way`, 'order');
      },
    }),
  );
}

function wingSection(ctx, commander) {
  const { state } = ctx;
  const command = fleetCommand(state);
  const wing = wingOf(state, commander);
  const joining = joiningOf(state, commander);
  const room = (command?.wing ?? 0) - wing.length - joining.length;
  const docked = Boolean(!commander.mission && !commander.order && commander.at);
  const others = commander.mission ? [] : state.ships.filter((ship) => onMap(ship) && !ship.commander && !joining.includes(ship));
  return h(
    'div',
    { class: 'dw-section' },
    sectionTitle('Wing', `${wing.length} / ${command?.wing ?? 0}`, { numeric: true }),
    wing.length || joining.length
      ? h(
          'ul',
          { class: 'dw-list' },
          wing.map((ship) => aboardRow(ctx, ship, docked)),
          joining.map((ship) => shipRow(ctx, ship)),
        )
      : h('p', { class: 'dw-note' }, 'No ships yet.'),
    room > 0 && others.length
      ? h(
          'div',
          { class: 'dw-row-actions' },
          others.slice(0, 12).map((ship) =>
            button([shipGlyph(ship.hull, { small: true }), ` ${ship.name}`], {
              small: true,
              key: `join-${ship.id}`,
              sub: `${HULLS[ship.hull].role} · ${travelNote(ship, commander)}`,
              onClick: () => join(ctx, ship, commander),
            }),
          ),
        )
      : null,
  );
}

/** Where a ship would come from to join: "here", "from Aurel", or "after its orders". */
function travelNote(ship, commander) {
  if (ship.order || ship.queue.length) return 'after its orders';
  if (ship.at === commander.at) return 'here';
  const here = systemOf(ship.at);
  return here === systemOf(commander.at) ? `from ${findPlace(ship.at)?.name ?? 'nearby'}` : `from ${findSystem(here)?.name ?? 'afar'}`;
}

/** A ship aboard a fleet: what it is and carries, and taking it out where the command ship docks. */
function aboardRow(ctx, ship, docked) {
  const leader = leaderOf(ctx.state, ship);
  const cargo = Object.entries(ship.cargo).filter(([, qty]) => qty >= 1);
  // Out on a mission the ship is out of contact: nothing of what it carries shows.
  const status = leader?.mission ? 'Out on the mission' : cargo.length ? `Aboard with ${cargo.map(([good, qty]) => `${formatNumber(qty)} t ${goodName(good).toLowerCase()}`).join(', ')}` : 'Aboard';
  return h(
    'li',
    null,
    h(
      'div',
      { class: 'dw-ship-row is-aboard' },
      shipGlyph(ship.hull),
      h('span', { class: 'dw-grow' }, h('strong', null, `${ship.name} · ${HULLS[ship.hull].role}`), h('small', null, status)),
      docked ? button('Take out', { small: true, key: `leave-${ship.id}`, onClick: () => ctx.act((s) => leaveFleet(s, findShip(s, ship.id))) }) : null,
    ),
  );
}

function reportSection(ctx, commander) {
  const report = commander.commander.report;
  if (!report) return null;
  const numbers = [
    ['Brought in', signedCredits(Math.round(report.credits))],
    report.sold ? ['Sold', `${formatNumber(report.sold)} t`] : null,
    report.mined ? ['Mined', `${formatNumber(report.mined)} t`] : null,
    report.jumps ? ['Jumps', `${report.jumps} · ${formatCredits(report.fees)}`] : null,
    report.surveyed ? ['Surveyed', plural(report.surveyed, 'system')] : null,
    report.signals ? ['Signals', String(report.signals)] : null,
  ].filter(Boolean);
  return h(
    'div',
    { class: 'dw-section' },
    sectionTitle("Captain's log"),
    h('blockquote', { class: 'dw-captains-log' }, report.text),
    h('dl', { class: 'dw-specs' }, numbers.map(([term, value]) => h('div', null, h('dt', null, term), h('dd', null, value)))),
  );
}

// ---------- Any other ship ----------

function join(ctx, ship, commander) {
  const result = ctx.act((s) => joinFleet(s, findShip(s, ship.id), findShip(s, commander.id)));
  if (result?.ok && !result.boarded) ctx.toast(`${ship.name} ${result.queued ? 'joins' : 'flies to'} ${commander.name} ${result.queued ? 'after its orders' : 'and goes aboard'}`, 'order');
}

/** On a ship's panel: the fleets it could join. */
export function fleetSection(ctx, ship) {
  const { state } = ctx;
  if (ship.commander || ship.fleet) return null;
  const command = fleetCommand(state);
  if (commanders(state).some((c) => joiningOf(state, c).includes(ship))) return null;
  const open = commanders(state).filter((c) => !c.mission && wingOf(state, c).length + joiningOf(state, c).length < (command?.wing ?? 0));
  if (!open.length) return null;
  return h(
    'div',
    { class: 'dw-section' },
    sectionTitle('Fleet'),
    h(
      'div',
      { class: 'dw-row-actions' },
      open.map((c) =>
        button([portrait(c, 20), ` Join ${c.name}`], {
          small: true,
          key: `join-${c.id}`,
          onClick: () => join(ctx, ship, c),
        }),
      ),
    ),
  );
}

/** The panel of a ship aboard a fleet: whose, and taking it out where the command ship docks. */
export function aboardSection(ctx, ship) {
  const { state } = ctx;
  const leader = leaderOf(state, ship);
  const docked = !leader.mission && !leader.order && leader.at;
  return h(
    'div',
    { class: 'dw-card is-aqua' },
    h(
      'div',
      { class: 'dw-fleet-line' },
      portrait(leader, 32),
      h('span', { class: 'dw-grow' }, leader.mission ? `With ${leader.name} on a ${MISSIONS[leader.mission.kind].name.toLowerCase()} mission` : `Aboard ${leader.name}'s fleet`),
      button('Open', { small: true, key: 'open-leader', onClick: () => ctx.select('ship', leader.id) }),
    ),
    docked ? h('div', { class: 'dw-row-actions' }, button(`Take out at ${findPlace(leader.at)?.name ?? 'the dock'}`, { small: true, key: 'leave-fleet', onClick: () => ctx.act((s) => leaveFleet(s, findShip(s, ship.id))) })) : null,
  );
}

// ---------- Shipyards ----------

/** The three commanders a shipyard offers, once Fleet command I is researched. */
export function hireSection(ctx, station) {
  const { state } = ctx;
  if (hireLock(state, station.id)) return null;
  const cost = hireCost(state, station.id);
  const short = hireShortfall(state, station.id);
  const hours = HULLS.osprey.buildMinutes / 60;
  return h(
    'div',
    { class: 'dw-section' },
    sectionTitle('Commanders for hire', formatCredits(cost.total)),
    h('p', { class: 'dw-note' }, `${formatCredits(cost.price)} for the commander and ${formatCredits(cost.ship)} for their Osprey-class command ship, built here in ${plural(hours, 'hour')}.`),
    short ? h('p', { class: 'dw-note' }, short) : null,
    candidates(state).map((candidate) => {
      const trait = TRAITS[candidate.traits[0]];
      return h(
        'div',
        { class: 'dw-card dw-commander' },
        h('div', { class: 'dw-commander-head' }, portrait(candidate, 52), h('div', { class: 'dw-grow' }, h('strong', null, candidate.name), h('span', { class: 'dw-note' }, `Level 1 · ${trait.name}`))),
        h('p', { class: 'dw-note' }, trait.note),
        button(`Hire for ${formatCredits(cost.total)}`, {
          variant: 'primary',
          disabled: Boolean(short),
          key: `hire-${candidate.id}`,
          onClick: () => {
            const result = ctx.act((s) => hireCommander(s, candidate.id, station.id));
            if (result?.ok) ctx.toast(`${candidate.name} is hired. Their Osprey is ready in ${plural(hours, 'hour')}`, 'purchase');
          },
        }),
      );
    }),
  );
}
