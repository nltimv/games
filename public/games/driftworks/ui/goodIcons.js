// Small flat icons for goods, drawn as inline SVG on a 24-unit
// grid. Each good has its own silhouette (a rock, an ingot, a droplet, a
// chip...) in the colours of its `look` (content/goods.js), so goods can be
// told apart by shape as well as colour. Raw ores are rocks, refined goods
// are bars and simple forms, and processed goods and components are made
// things. The credits coin is drawn the same way, inline in index.html.

import { GOODS } from "../content/goods.js";

const FALLBACK = { light: "#ffffff", mid: "#aaaaaa", dark: "#555555" };
const LINE = 'stroke-linejoin="round" stroke-linecap="round"';

// ---------- Shared shapes ----------

/** A rough rock with a lit facet and a shaded one. */
const rock = (c, body = c.mid) => `
  <path d="M4 15 6.5 8 11 4.5 17 5 20.5 10 20 16.5 14 20.5 7.5 19.5Z" fill="${body}" stroke="${c.dark}" stroke-width="1.2" ${LINE}/>
  <path d="M6.5 8 11 4.5 17 5 13 9.5 8 11Z" fill="${c.light}" opacity="0.85"/>
  <path d="M20.5 10 20 16.5 14 20.5 13.5 14Z" fill="${c.dark}" opacity="0.45"/>`;

/** A cast ingot seen from slightly above, at a vertical offset. */
const ingot = (c, y = 0, scale = 1) => {
  const s = (x) => 12 + (x - 12) * scale;
  return `
  <path d="M${s(6.5)} ${8 + y}H${s(17.5)}L${s(20)} ${12 + y}H${s(4)}Z" fill="${c.light}" stroke="${c.dark}" stroke-width="1.1" ${LINE}/>
  <path d="M${s(4)} ${12 + y}H${s(20)}L${s(21.5)} ${17.5 + y}H${s(2.5)}Z" fill="${c.mid}" stroke="${c.dark}" stroke-width="1.1" ${LINE}/>`;
};

// ---------- Each good ----------

const DRAW = {
  // Raw ores: rocks, each with its own markings.
  "ferrite-ore": (c) =>
    `${rock(c)}
  <rect x="8" y="12.5" width="2.2" height="2.2" transform="rotate(45 9.1 13.6)" fill="#ffffff" opacity="0.9"/>
  <rect x="14.5" y="14.5" width="1.8" height="1.8" transform="rotate(45 15.4 15.4)" fill="#ffffff" opacity="0.8"/>
  <rect x="15.5" y="9.5" width="1.4" height="1.4" transform="rotate(45 16.2 10.2)" fill="#ffffff" opacity="0.7"/>`,
  "silicate-rock": (c) =>
    `${rock(c)}
  <circle cx="9" cy="14" r="1" fill="${c.dark}"/><circle cx="12" cy="16.5" r="0.8" fill="${c.dark}"/>
  <circle cx="15.5" cy="12" r="0.9" fill="${c.dark}"/><circle cx="11.5" cy="12.5" r="0.7" fill="${c.light}"/>
  <circle cx="16.5" cy="16" r="0.7" fill="${c.light}"/>`,
  "carbon-ore": (c) =>
    `${rock(c)}
  <path d="M8 11 12 13.5 13.5 9.5M12 13.5 10.5 18" fill="none" stroke="${c.light}" stroke-width="0.8" opacity="0.7" ${LINE}/>
  <path d="M16 13.2v2.6M14.7 14.5h2.6" stroke="#ffffff" stroke-width="0.9" ${LINE}/>`,
  "titanium-ore": (c) =>
    `${rock(c, "#6f7488")}
  <path d="M5.5 15.5 9.5 12.5 12.5 14.5 18.5 9.5" fill="none" stroke="${c.light}" stroke-width="1.8" ${LINE}/>
  <path d="M9.5 12.5 9 17" fill="none" stroke="${c.mid}" stroke-width="1.2" ${LINE}/>`,
  "crystal-ore": (c) =>
    `${rock({ ...c, light: "#b9bccb", dark: "#2f3140" }, "#6b6f80")}
  <path d="M11.5 12 13 3 16 11Z" fill="${c.mid}" stroke="${c.dark}" stroke-width="1" ${LINE}/>
  <path d="M13 3 13.6 11.5 11.5 12Z" fill="${c.light}"/>
  <path d="M15.5 13.5 19 7.5 19.5 14Z" fill="${c.mid}" stroke="${c.dark}" stroke-width="1" ${LINE}/>`,
  ice: (c) => `
  <path d="M4.5 20 6.5 9 10.5 5.5 13 11 11.5 20Z" fill="${c.mid}" stroke="${c.dark}" stroke-width="1.1" ${LINE}/>
  <path d="M6.5 9 10.5 5.5 9.5 20H4.5Z" fill="${c.light}" opacity="0.9"/>
  <path d="M11 20 12.5 8 17 3 20.5 9.5 19 20Z" fill="${c.mid}" stroke="${c.dark}" stroke-width="1.1" ${LINE}/>
  <path d="M12.5 8 17 3 16 20H11Z" fill="${c.light}" opacity="0.9"/>
  <path d="M3 20.5h18" stroke="${c.dark}" stroke-width="1.1" ${LINE}/>`,

  // Refined: bars and simple forms.
  iron: (c) => ingot(c, 1.5),
  titanium: (c) => `${ingot(c, 3.5, 0.9)}${ingot(c, -3, 0.62)}`,
  silicon: (c) => `
  <path d="M5.6 18.4A9 9 0 1 1 18.4 18.4Z" fill="${c.mid}" stroke="${c.dark}" stroke-width="1.2" ${LINE}/>
  ${[8.2, 11, 13.8]
    .flatMap((x) =>
      [6.6, 9.4, 12.2].map(
        (y) =>
          `<rect x="${x}" y="${y}" width="2.1" height="2.1" rx="0.3" fill="${c.light}"/>`,
      ),
    )
    .join("")}`,
  graphite: (c) => `
  <path d="M3.5 15.5 12 12 20.5 15.5 12 19Z" fill="${c.dark}" stroke="${c.dark}" stroke-width="1" ${LINE}/>
  <path d="M3.5 11.5 12 8 20.5 11.5 12 15Z" fill="${c.mid}" stroke="${c.dark}" stroke-width="1" ${LINE}/>
  <path d="M3.5 7.5 12 4 20.5 7.5 12 11Z" fill="${c.light}" stroke="${c.dark}" stroke-width="1" ${LINE}/>`,
  water: (c) => `
  <path d="M12 2.5C12 2.5 5 10.5 5 15a7 7 0 0 0 14 0c0-4.5-7-12.5-7-12.5Z" fill="${c.mid}" stroke="${c.dark}" stroke-width="1.2" ${LINE}/>
  <path d="M8.5 14.5c0 2 1.2 3.5 3 4" fill="none" stroke="${c.light}" stroke-width="1.6" ${LINE}/>`,
  crystal: (c) => `
  <path d="M3.5 9 8 4h8l4.5 5L12 21Z" fill="${c.mid}" stroke="${c.dark}" stroke-width="1.1" ${LINE}/>
  <path d="M3.5 9 8 4h8l4.5 5Z" fill="${c.light}"/>
  <path d="M3.5 9h17M8 4l2 5 2-5 2 5 2-5M10 9l2 12 2-12" fill="none" stroke="${c.dark}" stroke-width="0.8" ${LINE}/>`,

  // Processed materials.
  steel: (c) => `
  <path d="M5 4h14v3.5h-5v9h5V20H5v-3.5h5v-9H5Z" fill="${c.mid}" stroke="${c.dark}" stroke-width="1.1" ${LINE}/>
  <path d="M5.6 4.6h12.8v1.6H5.6Z" fill="${c.light}"/>`,
  glass: (c) => `
  <rect x="5" y="3.5" width="14" height="17" rx="1.2" fill="${c.mid}" fill-opacity="0.55" stroke="${c.dark}" stroke-width="1.2"/>
  <path d="M8 12.5 12.5 8M9 17l7-7" stroke="#ffffff" stroke-width="1.5" opacity="0.9" ${LINE}/>`,
  "titanium-alloy": (c) => `
  <path d="M5 8h13v8H5Z" fill="${c.mid}"/>
  <ellipse cx="5" cy="12" rx="2.5" ry="4" fill="${c.mid}" stroke="${c.dark}" stroke-width="1.1"/>
  <path d="M5 8h13M5 16h13" stroke="${c.dark}" stroke-width="1.1" ${LINE}/>
  <path d="M5.5 10h12" stroke="${c.light}" stroke-width="1.3" ${LINE}/>
  <ellipse cx="18" cy="12" rx="2.5" ry="4" fill="${c.light}" stroke="${c.dark}" stroke-width="1.1"/>
  <ellipse cx="18" cy="12" rx="1.2" ry="2" fill="${c.dark}"/>`,
  optics: (c) => `
  <path d="M2 8h8l11 4M2 16h8l11-4" fill="none" stroke="${c.light}" stroke-width="1.2" ${LINE}/>
  <ellipse cx="10" cy="12" rx="3.5" ry="9" fill="${c.mid}" fill-opacity="0.85" stroke="${c.dark}" stroke-width="1.1"/>
  <path d="M8.6 7.5c-.6 1.4-.9 2.9-.9 4.5" fill="none" stroke="#ffffff" stroke-width="1.1" ${LINE}/>`,

  // Components.
  "hull-plating": (c) => `
  <path d="M4 6.5 12 3.5l8 3V13c0 4-3.5 6.5-8 8-4.5-1.5-8-4-8-8Z" fill="${c.mid}" stroke="${c.dark}" stroke-width="1.2" ${LINE}/>
  <path d="M4.6 7 12 4.2 19.4 7v2.3H4.6Z" fill="${c.light}"/>
  <path d="M12 9.3V20" stroke="${c.dark}" stroke-width="0.9"/>
  <circle cx="7.5" cy="12" r="0.9" fill="${c.dark}"/><circle cx="16.5" cy="12" r="0.9" fill="${c.dark}"/>
  <circle cx="9" cy="16.5" r="0.9" fill="${c.dark}"/><circle cx="15" cy="16.5" r="0.9" fill="${c.dark}"/>`,
  circuits: (c) => `
  <path d="M9 3.5v3M12 3.5v3M15 3.5v3M9 17.5v3M12 17.5v3M15 17.5v3M3.5 9h3M3.5 12h3M3.5 15h3M17.5 9h3M17.5 12h3M17.5 15h3" stroke="${c.light}" stroke-width="1.3" ${LINE}/>
  <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="${c.dark}" stroke="${c.dark}" stroke-width="1"/>
  <rect x="9.5" y="9.5" width="5" height="5" rx="0.8" fill="${c.mid}"/>`,
  "sensor-arrays": (c) => `
  <path d="M15.5 2.8a5 5 0 0 1 5.7 5.7M15.3 5.6a2.4 2.4 0 0 1 3.1 3.1" fill="none" stroke="${c.light}" stroke-width="1.2" ${LINE}/>
  <path d="M10 16.5 12 21M7 21h10" stroke="${c.dark}" stroke-width="1.4" ${LINE}/>
  <path d="M4.5 5.5C3.5 12 8.5 18 16 17.5Z" fill="${c.mid}" stroke="${c.dark}" stroke-width="1.2" ${LINE}/>
  <path d="M9.5 12.5 15 8" stroke="${c.dark}" stroke-width="1.1" ${LINE}/>
  <circle cx="15.3" cy="7.7" r="1.4" fill="${c.light}" stroke="${c.dark}" stroke-width="0.8"/>`,
};

/** The markup of a good's icon (24 x 24 viewBox, sized by CSS). */
export function goodIconMarkup(good) {
  const look = GOODS[good]?.look ?? FALLBACK;
  const draw = DRAW[good];
  const body = draw
    ? draw(look)
    : `<circle cx="12" cy="12" r="8" fill="${look.mid}" stroke="${look.dark}" stroke-width="1.2"/>`;
  return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" focusable="false">${body}</svg>`;
}

/** Every good with a drawn icon (the rest get a plain disc). */
export const DRAWN_GOODS = Object.keys(DRAW);
