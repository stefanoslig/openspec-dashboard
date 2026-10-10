import {
  afterRenderEffect,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  input,
  output,
  untracked,
} from '@angular/core';

// A heading above this line of the viewport, in pixels from its top, counts as read.
const readingLine = 110;

/** The last heading above the reading line, or the first when none has reached it. */
function headingAtLine(headings: HTMLElement[]): HTMLElement | undefined {
  let current = headings[0];
  for (const heading of headings) {
    if (heading.getBoundingClientRect().top > readingLine) break;
    current = heading;
  }
  return current;
}

// The last headings of a page cannot reach the line, so its end is a case of its own.
const atPageEnd = () =>
  scrollY > 0 && scrollY + innerHeight >= document.documentElement.scrollHeight - 2;

/** Follows the reader through the headings of a rendered document, and scrolls to one on request. */
@Directive({ selector: '[appScrollSpy]' })
export class ScrollSpy {
  /** The headings of the document in order, with the ids they should carry. */
  readonly headings = input.required<{ id: string }[]>();
  /** Id of a heading to scroll to once rendered; empty for none. */
  readonly target = input('');
  /** Id of the heading last asked for: at the end of the page it stays active while below the line. */
  readonly requested = input('');
  /** Id of the heading being read. */
  readonly active = output<string>();
  /** Fires once `target` has been handled, found or not, so the owner can clear it. */
  readonly reached = output<void>();
  readonly #host: HTMLElement = inject(ElementRef).nativeElement;

  constructor() {
    const track = () => this.#track();
    window.addEventListener('scroll', track, { passive: true });
    inject(DestroyRef).onDestroy(() => window.removeEventListener('scroll', track));
    afterRenderEffect(() => {
      // The sanitizer behind [innerHTML] drops id attributes, so the headings get theirs here.
      const ids = this.headings();
      this.#headingElements().forEach((heading, index) => (heading.id = ids[index]?.id ?? ''));
      const target = this.target();
      if (target) {
        this.scrollTo(target);
        // Reported even when no heading carries the id: a target left armed would scroll again on every render.
        this.reached.emit();
      }
      // Tracking reads the requested heading, which must not re-run this effect.
      untracked(() => this.#track());
    });
  }

  scrollTo(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }
  #headingElements(): HTMLElement[] {
    return [...this.#host.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')];
  }
  /** Reports the heading being read. */
  #track(): void {
    const headings = this.#headingElements();
    const current =
      headings.length && atPageEnd() ? this.#requestedOrLast(headings) : headingAtLine(headings);
    this.active.emit(current?.id ?? '');
  }
  /** At the end of the page: the heading asked for while it is still below the line, else the last. */
  #requestedOrLast(headings: HTMLElement[]): HTMLElement {
    const requested = headings.find((heading) => heading.id === this.requested());
    return requested && requested.getBoundingClientRect().top > readingLine
      ? requested
      : headings[headings.length - 1];
  }
}
