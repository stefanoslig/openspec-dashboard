import { computed, inject, Service, signal } from '@angular/core';
import { HttpErrorResponse, httpResource } from '@angular/common/http';
import { NavigationEnd, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { Workspace } from './workspace.model';

const headers = { 'X-OpenSpec-Client': 'dashboard' };
interface Session {
  mode: 'local' | 'hosted';
  user?: { login: string } | null;
  installationUrl?: string;
}
function message(error: unknown): string {
  if (!error) return '';
  return error instanceof HttpErrorResponse && typeof error.error?.error === 'string'
    ? error.error.error
    : 'Could not reach the dashboard service. Try again shortly.';
}

@Service()
export class WorkspaceStore {
  readonly #router = inject(Router);
  readonly #url = toSignal(
    this.#router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.#router.url },
  );
  readonly #path = signal(this.#rememberedPath());
  readonly query = signal('');
  readonly copyStatus = signal('');
  readonly sessionResource = httpResource<Session>(() => ({ url: '/api/session', headers }));
  readonly session = computed(() =>
    this.sessionResource.hasValue() ? this.sessionResource.value() : undefined,
  );
  readonly hosted = computed(() => this.session()?.mode === 'hosted');
  readonly #selectionKey = computed(() => {
    const params = this.#router.parseUrl(this.#url()).queryParams;
    return JSON.stringify([
      params['provider'] ?? 'github',
      params['repo'] ?? '',
      params['ref'] ?? '',
      params['folder'] ?? 'openspec',
    ]);
  });
  readonly selection = computed(() => {
    const [provider, repository, ref, folder] = JSON.parse(this.#selectionKey()) as string[];
    return { provider, repository, ref, folder };
  });
  readonly resource = httpResource<Workspace>(() => {
    if (!this.session()) return undefined;
    if (this.hosted()) {
      if (!this.session()?.user || !this.selection().repository) return undefined;
      return { url: '/api/workspace', params: this.selection(), headers };
    }
    return {
      url: '/api/workspace',
      params: this.#path() ? { path: this.#path() } : undefined,
      headers,
    };
  });
  readonly repositories = httpResource<{ name: string; defaultBranch: string }[]>(() =>
    this.hosted() && this.session()?.user ? { url: '/api/repositories', headers } : undefined,
  );
  readonly repositoryChoices = computed(() =>
    this.repositories.hasValue() ? this.repositories.value() : [],
  );
  readonly workspace = computed(() =>
    this.resource.hasValue() ? this.resource.value() : undefined,
  );
  readonly needsSignIn = computed(
    () =>
      this.hosted() &&
      (!this.session()?.user ||
        [this.resource.error(), this.repositories.error()].some(
          (error) => error instanceof HttpErrorResponse && error.status === 401,
        )),
  );
  readonly signInUrl = computed(() => '/auth/github?returnTo=' + encodeURIComponent(this.#url()));
  readonly authError = computed(() =>
    this.#router.parseUrl(this.#url()).queryParams['authError']
      ? 'GitHub sign-in could not be completed. Please try again.'
      : '',
  );
  readonly path = this.#path.asReadonly();
  readonly active = computed(
    () => this.workspace()?.changes.filter((change) => !change.archived) ?? [],
  );
  readonly archived = computed(
    () => this.workspace()?.changes.filter((change) => change.archived) ?? [],
  );
  readonly taskCount = computed(() =>
    this.active().reduce((count, change) => count + change.total, 0),
  );
  readonly completedCount = computed(() =>
    this.active().reduce((count, change) => count + change.completed, 0),
  );
  readonly error = computed(() => message(this.resource.error() ?? this.sessionResource.error()));
  readonly repositoryError = computed(() => message(this.repositories.error()));
  readonly snapshotLink = computed(() => {
    const source = this.workspace()?.source;
    if (!source) return '';
    const url = this.#router.parseUrl(this.#url());
    url.queryParams = {
      ...url.queryParams,
      provider: source.provider,
      repo: source.repository,
      folder: source.folder,
      ref: source.commit,
    };
    delete url.queryParams['authError'];
    return this.#router.serializeUrl(url);
  });
  open(path: string): void {
    if (this.hosted()) return;
    const next = path.trim();
    this.query.set('');
    if (next === this.#path()) this.resource.reload();
    else this.#path.set(next);
    try {
      localStorage.setItem('openspec-desk-path', next);
    } catch {
      /* Storage may be unavailable. */
    }
  }
  openRepository(repository: string, ref: string, folder: string): void {
    this.query.set('');
    this.copyStatus.set('');
    void this.#router.navigate(['/'], {
      queryParams: {
        provider: 'github',
        repo: repository.trim(),
        ref: ref.trim() || null,
        folder: folder.trim() || 'openspec',
      },
      queryParamsHandling: 'replace',
    });
  }
  sourceLink(path: string): string {
    const source = this.workspace()?.source;
    return source
      ? `${source.url}/blob/${source.commit}/${(source.folder + '/' + path).split('/').map(encodeURIComponent).join('/')}`
      : '';
  }
  async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(
        new URL(this.snapshotLink(), window.location.origin).href,
      );
      this.copyStatus.set('Link copied');
    } catch {
      this.copyStatus.set('Use the revision link to copy its address.');
    }
  }
  async logout(): Promise<void> {
    try {
      const response = await fetch('/api/logout', { method: 'POST', headers });
      if (!response.ok) throw new Error();
      window.location.assign('/');
    } catch {
      this.copyStatus.set('Could not sign out. Try again.');
    }
  }
  #rememberedPath(): string {
    try {
      return localStorage.getItem('openspec-desk-path') ?? '';
    } catch {
      return '';
    }
  }
}
