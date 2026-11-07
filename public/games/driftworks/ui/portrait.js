// A commander's portrait: a glossy bubble with head and shoulders, drawn
// from the seeded numbers in commander.portrait (see systems/commanders.js).

import { svgIcon } from './dom.js';

const SKIN = ['#f7dcc8', '#e9bd9a', '#c98f68', '#9a6546', '#6a4430'];
const HAIR = ['#2a2019', '#5b3b24', '#a5682f', '#dcb66c', '#cfd2dc'];

// Hair shapes over a head centred at (32, 27) with radius 10.
const HAIR_SHAPES = [
  'M21.5 26c0-8 4.6-12 10.5-12s10.5 4 10.5 12c-2-4.4-5.4-6.2-10.5-6.2S23.5 21.6 21.5 26z',
  'M21 27c-.6-8.6 4.4-13.2 11-13.2 6.4 0 11.4 4.2 11 12.2-3.4-5.6-9.8-5.4-14.6-7.4-2.4 3-4.8 5.6-7.4 8.4z',
  'M21.6 26.4c0-7.8 4.6-11.8 10.4-11.8s10.4 4 10.4 11.8c-2.2-4-5.6-5.8-10.4-5.8s-8.2 1.8-10.4 5.8zM32 7.4a4.6 4.6 0 1 1 0 9.2 4.6 4.6 0 0 1 0-9.2z',
  'M20.6 38c-1.8-14 2.4-23.6 11.4-23.6S45.2 24 43.4 38c-1.2-6-1.2-11.6-3-14.2-2.2 1.4-5.4 2-8.4 2s-6.2-.6-8.4-2c-1.8 2.6-1.8 8.2-3 14.2z',
  'M22.4 24.4c.8-6 4.6-8.6 9.6-8.6s8.8 2.6 9.6 8.6c-2.6-2.4-5.8-3.2-9.6-3.2s-7 .8-9.6 3.2z',
  'M20.8 27.6c-2.4-3-1-7.6 2-8.6.6-3.4 4-5.6 6.6-4.8 1.8-1.8 5.4-1.8 7.2 0 2.6-.8 6 1.4 6.6 4.8 3 1 4.4 5.6 2 8.6-1.4-3.6-3.6-5.4-6.4-6-2 1.4-5.2 1.4-7.2 0-1.8 1.4-4.8 1.4-6.4 0-2.8.6-5 2.4-4.4 6z',
];

/** The portrait as an <svg> element, `size` px square. */
export function portrait(commander, size = 48) {
  const p = commander?.commander?.portrait ?? commander?.portrait ?? { hue: 190, skin: 1, hair: 0, hairTone: 1, badge: 40 };
  const bg = `pb${p.hue}`;
  const shine = 'pshine';
  const skin = SKIN[p.skin % SKIN.length];
  const hair = HAIR[p.hairTone % HAIR.length];
  const suit = `hsl(${p.hue} 45% 34%)`;
  const badge = `hsl(${p.badge} 85% 62%)`;
  return svgIcon(`<svg class="dw-portrait" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
    <defs>
      <radialGradient id="${bg}" cx="0.35" cy="0.3" r="0.85">
        <stop offset="0" stop-color="hsl(${p.hue} 90% 88%)"/>
        <stop offset="0.6" stop-color="hsl(${p.hue} 70% 62%)"/>
        <stop offset="1" stop-color="hsl(${p.hue} 65% 38%)"/>
      </radialGradient>
      <linearGradient id="${shine}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity="0.75"/>
        <stop offset="1" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
      <clipPath id="pclip"><circle cx="32" cy="32" r="30"/></clipPath>
    </defs>
    <circle cx="32" cy="32" r="30" fill="url(#${bg})"/>
    <g clip-path="url(#pclip)">
      <path d="M10 64c1-12 9.6-18.6 22-18.6S53 52 54 64z" fill="${suit}"/>
      <path d="M26.4 45.8 32 52l5.6-6.2" fill="none" stroke="#fff" stroke-opacity="0.7" stroke-width="1.6" stroke-linejoin="round"/>
      <circle cx="44" cy="54" r="2.6" fill="${badge}" stroke="#fff" stroke-width="0.8"/>
      <rect x="28.6" y="34" width="6.8" height="9" rx="3" fill="${skin}"/>
      <circle cx="32" cy="27" r="10" fill="${skin}"/>
      <path d="${HAIR_SHAPES[p.hair % HAIR_SHAPES.length]}" fill="${hair}"/>
      <circle cx="28.4" cy="28.4" r="1" fill="#2a2430" fill-opacity="0.75"/>
      <circle cx="35.6" cy="28.4" r="1" fill="#2a2430" fill-opacity="0.75"/>
      <path d="M29.6 32.6q2.4 1.6 4.8 0" fill="none" stroke="#7a4a3a" stroke-opacity="0.6" stroke-width="0.9" stroke-linecap="round"/>
    </g>
    <ellipse cx="32" cy="15" rx="21" ry="11" fill="url(#${shine})"/>
    <circle cx="32" cy="32" r="30" fill="none" stroke="#fff" stroke-opacity="0.85" stroke-width="1.6"/>
  </svg>`);
}
