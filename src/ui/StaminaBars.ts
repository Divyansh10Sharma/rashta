/**
 * Two stamina bars: yours, and whoever you are currently fighting.
 *
 * GAME_DESIGN.md asks for exactly these two. The opponent's bar is the only
 * way to know whether the rider you have been hitting for the last ten seconds
 * is nearly down or barely scratched, and without it combat is guesswork.
 *
 * Plain DOM, and written to only when a value actually changes — at display
 * rate that is the difference between free and a slice of the frame budget.
 */

export interface StaminaBars {
  root: HTMLElement;
  /**
   * `theirs` is null when nobody is in range, which hides that bar entirely
   * rather than showing an empty one for nobody.
   */
  update: (
    mine: number,
    theirs: number | null,
    theirName: string,
    weapon: string | null,
  ) => void;
  dispose: () => void;
}

/** Below this fraction the bar goes red: you are one clean hit from down. */
const CRITICAL = 0.25;

function bar(label: string): {
  wrap: HTMLElement;
  fill: HTMLElement;
  name: HTMLElement;
} {
  const wrap = document.createElement('div');
  wrap.className = 'stamina';
  const name = document.createElement('span');
  name.className = 'stamina-name';
  name.textContent = label;
  const track = document.createElement('div');
  track.className = 'stamina-track';
  const fill = document.createElement('div');
  fill.className = 'stamina-fill';
  track.append(fill);
  wrap.append(name, track);
  return { wrap, fill, name };
}

export function createStaminaBars(parent: HTMLElement): StaminaBars {
  const root = document.createElement('div');
  root.className = 'stamina-bars';

  const mine = bar('You');
  const theirs = bar('');
  const weapon = document.createElement('span');
  weapon.className = 'stamina-weapon';
  mine.wrap.append(weapon);

  root.append(mine.wrap, theirs.wrap);
  parent.append(root);

  let lastMine = -1;
  let lastTheirs = -2;
  let lastName = '';
  let lastWeapon: string | null = '';

  const paint = (
    fill: HTMLElement,
    value: number,
    previous: number,
  ): boolean => {
    const rounded = Math.round(Math.max(0, Math.min(100, value)));
    if (rounded === previous) return false;
    fill.style.width = `${rounded}%`;
    fill.classList.toggle('is-critical', rounded / 100 < CRITICAL);
    return true;
  };

  const update = (
    mineValue: number,
    theirsValue: number | null,
    theirName: string,
    carried: string | null,
  ): void => {
    if (paint(mine.fill, mineValue, lastMine)) {
      lastMine = Math.round(Math.max(0, Math.min(100, mineValue)));
    }

    if (carried !== lastWeapon) {
      weapon.textContent = carried ?? '';
      lastWeapon = carried;
    }

    if (theirsValue === null) {
      if (lastTheirs !== -1) {
        theirs.wrap.classList.add('is-hidden');
        lastTheirs = -1;
      }
      return;
    }
    if (lastTheirs === -1) theirs.wrap.classList.remove('is-hidden');
    if (theirName !== lastName) {
      theirs.name.textContent = theirName;
      lastName = theirName;
    }
    if (paint(theirs.fill, theirsValue, lastTheirs)) {
      lastTheirs = Math.round(Math.max(0, Math.min(100, theirsValue)));
    }
  };

  return {
    root,
    update,
    dispose: () => root.remove(),
  };
}
