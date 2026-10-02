import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { HttpErrorResponse, httpResource } from '@angular/common/http';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { WorkspaceStore } from '../../core/workspace-store';
@Component({
  selector: 'app-workspace-navigation',
  imports: [RouterLink],
  templateUrl: './workspace-navigation.html',
  styleUrl: './workspace-navigation.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceNavigation {
  protected readonly store = inject(WorkspaceStore);
  protected readonly router = inject(Router);
  readonly #currentUrl = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );
  readonly picker = viewChild<ElementRef<HTMLDetailsElement>>('picker');
  readonly folder = viewChild<ElementRef<HTMLInputElement>>('folder');
  readonly repositoryInput = viewChild<ElementRef<HTMLInputElement>>('repositoryInput');
  protected readonly selectedRepository = signal('');
  protected readonly branches = httpResource<string[]>(() => {
    const repository = this.selectedRepository() || this.store.selection().repository;
    return this.store.hosted() && this.store.session()?.user && repository
      ? {
          url: '/api/branches',
          params: { repository },
          headers: { 'X-OpenSpec-Client': 'dashboard' },
        }
      : undefined;
  });
  protected readonly branchChoices = computed(() =>
    this.branches.hasValue() ? this.branches.value() : [],
  );
  protected readonly branchError = computed(() => {
    const error = this.branches.error();
    return error instanceof HttpErrorResponse
      ? (error.error?.error ?? 'Branches could not be loaded.')
      : '';
  });
  openPicker(): void {
    const picker = this.picker();
    if (picker) picker.nativeElement.open = true;
    if (this.store.hosted()) this.repositoryInput()?.nativeElement.focus();
    else this.folder()?.nativeElement.focus();
  }
  protected readonly navigation = [
    { label: 'Overview', view: 'overview', icon: '◫' },
    { label: 'Changes', view: 'changes', icon: '◇' },
    { label: 'Specifications', view: 'specs', icon: '▤' },
    { label: 'Archive', view: 'archive', icon: '▱' },
    { label: 'All artifacts', view: 'artifacts', icon: '≡' },
  ];
  protected isActive(view: string): boolean {
    return (
      !this.#currentUrl().startsWith('/artifact') &&
      (this.router.parseUrl(this.#currentUrl()).queryParams['view'] ?? 'overview') === view
    );
  }
  protected openFolder(event: Event, path: string, picker: HTMLDetailsElement): void {
    event.preventDefault();
    if (!path.trim()) return;
    this.store.open(path);
    picker.open = false;
    void this.router.navigate(['/']);
  }
  protected openRepository(
    event: Event,
    repository: string,
    ref: string,
    folder: string,
    picker: HTMLDetailsElement,
  ): void {
    event.preventDefault();
    if (!repository.trim()) return;
    this.store.openRepository(repository, ref, folder);
    picker.open = false;
  }
}
