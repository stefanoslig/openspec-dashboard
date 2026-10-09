import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { iconPaths } from './icon-paths';

export type IconName = keyof typeof iconPaths;

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
  protected readonly path = computed(() => iconPaths[this.name()]);
}
