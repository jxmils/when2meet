/** Marks the cells a fill would change directly on When2meet's "Your Availability" grid. */
import type { PlannedChange } from '@w2msync/core';

const STYLE_ID = 'w2msync-preview-style';
const ATTR = 'data-w2msync';

const CSS = `
[${ATTR}="add"] {
  box-shadow: inset 0 0 0 2px #1a7f37 !important;
  background-image: repeating-linear-gradient(45deg, rgba(26,127,55,.55) 0 3px, transparent 3px 7px) !important;
}
[${ATTR}="remove"] {
  box-shadow: inset 0 0 0 2px #cf222e !important;
  background-image: repeating-linear-gradient(-45deg, rgba(207,34,46,.5) 0 3px, transparent 3px 7px) !important;
}`;

export function showPreview(changes: readonly PlannedChange[]): number {
  clearPreview();
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.append(style);
  }
  let shown = 0;
  for (const change of changes) {
    const cell = document.getElementById(`YouTime${change.slot}`);
    if (!cell) continue;
    cell.setAttribute(ATTR, change.to === '1' ? 'add' : 'remove');
    shown++;
  }
  return shown;
}

export function clearPreview(): void {
  for (const cell of document.querySelectorAll(`[${ATTR}]`)) cell.removeAttribute(ATTR);
}

export function scrollGridIntoView(): void {
  document.getElementById('YouGrid')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
