// On phones the panel is a sheet at the foot of the screen. Dragging its
// grip (or its head) makes it shorter or taller, and the height the player
// leaves it at is kept for the next panel, in this browser. Dragged nearly
// all the way down, it folds to its head; a tap on the grip folds it or
// opens it again, and so does a tap on a folded sheet. Moving the map folds
// it too, and picking something new opens it again.

const STORE_KEY = 'driftworks-sheet';
/** A folded sheet shows the grip and the panel's head, in pixels. */
export const FOLDED = 92;
/** Dragged below this, a sheet folds when let go. */
const FOLD_BELOW = FOLDED + 48;
const DRAG_THRESHOLD = 6;
/** Keyboard steps, as a share of the screen's height. */
const STEP = 0.1;
/** The shortest height kept for the next panel, as a share of the screen. */
const MIN_SHARE = 0.2;

function load() {
  try {
    const share = Number(localStorage.getItem(STORE_KEY));
    return share > 0 && share <= 1 ? share : null;
  } catch {
    return null;
  }
}

function store(share) {
  try {
    localStorage.setItem(STORE_KEY, String(share));
  } catch {
    // Without storage the height lasts until the page closes.
  }
}

/**
 * panel: the sheet; grip: its handle; body: the part that scrolls; app: the
 * element its height is a share of; isPhone(): whether the panel is a sheet
 * now; tallest(): its greatest height in pixels; onResize(byPlayer): called
 * after each change, byPlayer when the player dragged, tapped or moved the
 * map.
 */
export function createSheet({ panel, grip, body, app, isPhone, tallest, onResize }) {
  let folded = false;
  let share = load();
  let drag = null;
  let swallowClick = false;

  const isOpen = () => isPhone() && !panel.hidden;

  function apply(byPlayer) {
    panel.classList.toggle('is-folded', folded);
    if (share) panel.style.setProperty('--dw-sheet-max', `${(share * 100).toFixed(1)}%`);
    else panel.style.removeProperty('--dw-sheet-max');
    grip.setAttribute('aria-expanded', String(!folded));
    grip.setAttribute('aria-label', folded ? 'Show the whole panel' : 'Fold the panel down');
    onResize(byPlayer);
  }

  function setFolded(next, byPlayer = true) {
    if (folded === next) return;
    folded = next;
    // Folded, the sheet shows the head at the top of the panel.
    if (folded) body.scrollTop = 0;
    apply(byPlayer);
  }

  /** Remembers a height in pixels for this and the next panels. */
  function keep(px) {
    share = Math.max(MIN_SHARE, Math.min(1, px / Math.max(1, app.clientHeight)));
    store(share);
  }

  // ---- Dragging the grip or the head ----

  const handleOf = (target) => target.closest('.dw-sheet-grip') ?? (target.closest('button, a, input, select, textarea, label') ? null : target.closest('.dw-panel-head'));

  panel.addEventListener('pointerdown', (e) => {
    if (!isOpen() || drag || (e.pointerType === 'mouse' && e.button !== 0) || !handleOf(e.target)) return;
    drag = { id: e.pointerId, y: e.clientY, from: panel.getBoundingClientRect().height, height: null };
  });

  panel.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = drag.y - e.clientY;
    if (drag.height === null) {
      if (Math.abs(dy) < DRAG_THRESHOLD) return;
      panel.setPointerCapture(e.pointerId);
      panel.classList.add('is-dragging');
      folded = false;
      panel.classList.remove('is-folded');
    }
    drag.height = Math.max(FOLDED, Math.min(tallest(), drag.from + dy));
    panel.style.setProperty('--dw-sheet-max', `${Math.round(drag.height)}px`);
    onResize(true);
  });

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const { height } = drag;
    drag = null;
    if (height === null) return;
    panel.classList.remove('is-dragging');
    // The press ends in a click on the grip or the head: it was a drag, not a tap.
    swallowClick = true;
    setTimeout(() => (swallowClick = false), 0);
    if (height < FOLD_BELOW) {
      folded = true;
      body.scrollTop = 0;
    } else keep(height);
    apply(true);
  }
  panel.addEventListener('pointerup', endDrag);
  panel.addEventListener('pointercancel', endDrag);

  panel.addEventListener(
    'click',
    (e) => {
      if (swallowClick) {
        swallowClick = false;
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      // A tap on a folded sheet (not on one of its buttons) opens it.
      if (folded && isOpen() && !e.target.closest('.dw-sheet-grip, button, a, input, select, textarea, label')) setFolded(false);
    },
    true,
  );

  grip.addEventListener('click', () => {
    if (isOpen()) setFolded(!folded);
  });

  grip.addEventListener('keydown', (e) => {
    if (!isOpen() || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const height = panel.getBoundingClientRect().height + (e.key === 'ArrowUp' ? 1 : -1) * STEP * app.clientHeight;
    if (height < FOLD_BELOW) {
      setFolded(true);
      return;
    }
    folded = false;
    keep(Math.min(tallest(), height));
    apply(true);
  });

  apply(false);

  return {
    /** Folds the sheet down to its head, when it is open on a phone. */
    fold() {
      if (isOpen() && !drag) setFolded(true);
    },
    /** Opens the sheet to the height last chosen: something new is in it. */
    open() {
      setFolded(false, false);
    },
  };
}
