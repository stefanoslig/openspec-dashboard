import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

const paths = {
  overview: 'M4 4h6v8H4zM14 4h6v4h-6zM14 12h6v8h-6zM4 16h6v4H4z',
  change: 'M12 3.5l8.5 8.5-8.5 8.5L3.5 12z',
  spec: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4',
  archive: 'M3.5 5h17v4h-17zM5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  tasks:
    'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8.5 12.5l2.5 2.5 4.5-5.5',
  code: 'M9 8l-4 4 4 4M15 8l4 4-4 4',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  refresh: 'M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4',
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
  'arrow-left': 'M19 12H5M11 6l-6 6 6 6',
  external: 'M8 16l8-8M9 8h7v7',
  close: 'M7 7l10 10M17 7L7 17',
};
export type IconName = keyof typeof paths;

@Component({
  selector: 'app-icon',
  template: `<svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="path()" /></svg>`,
  styles: `
    :host {
      display: inline-flex;
      flex-shrink: 0;
      width: 18px;
      height: 18px;
    }
    svg {
      width: 100%;
      height: 100%;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Icon {
  readonly name = input.required<IconName>();
  protected readonly path = computed(() => paths[this.name()]);
}
