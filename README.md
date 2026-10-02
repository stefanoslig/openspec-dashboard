# OpenSpec Desk

A read-only dashboard for OpenSpec artifacts, with local-folder and hosted GitHub modes. Angular 22 renders the interface, an ASP.NET Core 10 API reads Markdown and YAML through a shared C# parser. Local mode needs no account. Hosted mode lets teams connect repositories through GitHub’s installation UI and share artifact links without changing repository pipelines. Hosted mode uses PostgreSQL for accounts, sessions, and encrypted GitHub credentials. Local mode needs no database. Neither mode requires the OpenSpec CLI.

![dashboard](./dashboard.png)

## Run locally

Requires the latest .NET 10 SDK, Node.js 22.22.3 or newer (Angular 22 compatibility), and npm. `global.json` selects stable .NET 10 SDKs.

```sh
npm ci
dotnet restore OpenSpec.slnx
npm start
```

Open **http://127.0.0.1:4310**. The start command builds the app and starts the local service. Change the port with the `PORT` environment variable.

The sample workspace opens first. Click **Atlas** in the sidebar, enter an absolute repository path or the path to its `openspec/` folder, and choose **Open folder**. Home-relative paths such as `~/Projects/my-app` work. The most recently chosen path is remembered in this browser.

Use **Refresh workspace** after files change on disk. The current document remains selected. No repository files are written by the app.

## Host for a team

One app deployment serves multiple repositories and organizations. Every viewer signs in with GitHub and needs read access to the repository. A repository owner installs the GitHub App and selects repositories on GitHub; viewers then choose a repository, branch or commit, and artifact folder in the dashboard. The default folder is `openspec`; nested paths such as `docs/openspec` work.

### Register a GitHub App once

In GitHub Settings → Developer settings → GitHub Apps, create an app with:

- Homepage URL: your dashboard origin, such as `https://specs.example.com`.
- Callback URL: `https://specs.example.com/auth/github/callback`.
- Setup URL: `https://specs.example.com/`, so installation returns to the dashboard.
- Repository permissions: **Contents: Read-only**. Metadata read access is included by GitHub. No organization or account permissions are needed.
- Installation availability: **Any account**, for use across organizations.
- Webhooks: disable **Active**. Refresh currently uses API reads.
- Leave **Request user authorization (OAuth) during installation** unchecked. The dashboard starts sign-in with its own state and PKCE challenge.
- Keep expiring user access tokens enabled. Generate a client secret and record the **client ID** and app slug; no private key is needed for this user-token flow.

For local integration development, use `http://127.0.0.1:4310` as the origin in all three URLs. Keep a separate app registration for production.

### Configure and run

1. Create a PostgreSQL database and database user for the dashboard. Any PostgreSQL host works; this is independent of the repositories being viewed.
2. Install dependencies and create a data-protection certificate **once**:

   ```sh
   npm ci
   dotnet restore OpenSpec.slnx
   npm run auth:certificate
   cp .env.example .env
   ```

3. Fill in `.env`:

   - `PUBLIC_ORIGIN`: browser URL, without a trailing slash; HTTPS except on localhost.
   - `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_SLUG`: your GitHub App registration.
   - `ConnectionStrings__Dashboard`: an Npgsql connection string, for example `Host=localhost;Port=5432;Database=openspec;Username=openspec;Password=...;GSS Encryption Mode=Disable`. This example uses password authentication without Kerberos. For a remote database, configure certificate-verified TLS (`SSL Mode=VerifyFull`) and the provider's CA when needed. See [Npgsql connection security](https://www.npgsql.org/doc/security).
   - `DATA_PROTECTION_CERTIFICATE_PATH`: the absolute path printed by `npm run auth:certificate`.
   - `DATA_PROTECTION_CERTIFICATE_PASSWORD`: certificate password, if one was used. The generator reads this variable when provided; otherwise its PFX is protected by file access permissions.

4. Apply migrations and start the app:

   ```sh
   npm run db:migrate
   npm run start:hosted
   ```

Keep `.env` and `.secrets/` private. Back up the certificate alongside your deployment secrets, separately from database backups. All instances must use the same database, GitHub App, and certificate. Replacing the certificate without retaining the old decryption certificate makes existing data-protection keys unreadable. This certificate protects application secrets; HTTPS uses your hosting provider's TLS certificate.

The API refuses hosted startup when configuration is missing or migrations are pending. Run migrations as one deployment step before starting replicas. EF Core records applied migrations; running the command again is safe. Use a database role with schema permissions for migrations and a role with table read/write permissions for the running service where your host supports separate roles.

### Deploy

Use a host that runs ASP.NET Core or containers, plus PostgreSQL. No repository pipeline changes are required. Build the Angular assets and API into one deployment:

```sh
npm ci
npm run build
dotnet publish backend/OpenSpec.Api -c Release -o publish
cp -R dist/openspec-dashboard/browser publish/wwwroot
```

Inject the environment values, then run `dotnet OpenSpec.Api.dll --migrate` once and `dotnet OpenSpec.Api.dll` from the `publish` directory. Run behind HTTPS with the public `Host` header preserved. Hosted mode binds to `0.0.0.0:4310`; `PORT` or `ASPNETCORE_URLS` can change the listener. Local filesystem endpoints are disabled in hosted mode.

The Dockerfile builds both parts and runs the API as a non-root user. Node is used only in the frontend build stage. Mount the certificate as a secret readable by the container user; set its container path in the environment:

```sh
docker build -t openspec-desk .
# Use a container-accessible database address in .env.
docker run --rm --env-file .env \
  -e DATA_PROTECTION_CERTIFICATE_PATH=/run/secrets/data-protection.pfx \
  --mount type=bind,src=/absolute/path/data-protection.pfx,dst=/run/secrets/data-protection.pfx,readonly \
  openspec-desk --migrate
# Run the same command with -p 127.0.0.1:4310:4310 and without --migrate to serve the app.
```

`/health/live` is a liveness endpoint. Database availability is checked during hosted startup. Sessions are shared across replicas; sticky sessions and Redis are unnecessary. Each process has its own bounded cache of immutable artifact revisions.

### Read and share

1. **Sign in with GitHub**. Maintainers choose **Connect repositories on GitHub** to install the app or grant it more repositories. GitHub may require organization approval.
2. Choose an authorized repository and branch. A blank branch uses the repository default; a commit SHA opens a fixed revision.
3. Open a document and choose **Copy link**. Shared links include the repository, artifact folder, document, and resolved commit. Recipients sign in and return to that document. The browser address retains the selected branch for links that should follow future commits.
4. Use **Refresh workspace** to read the latest branch commit. Links pinned to a commit keep that revision.

Sign-in is **GitHub only**. GitHub user access tokens limit reads to permissions shared by the app and the viewer. ASP.NET Core manages OAuth state, browser correlation, PKCE, and HttpOnly cookies. Cookies reference server-side sessions; database records store hashed session identifiers and protected authentication tickets. App sessions expire after seven days and survive server restarts. Sign-out removes the current session across instances.

GitHub access and refresh tokens live in separate provider-connection records, encrypted with ASP.NET Core Data Protection. The shared key ring is stored in PostgreSQL and encrypted with the certificate. Expiring GitHub tokens refresh automatically when needed. A database row lock prevents instances from reusing the same rotating refresh token. A revoked or expired connection requires GitHub sign-in again. Expired sessions and OAuth attempts are removed periodically.

Each workspace read checks GitHub access before consulting the bounded commit cache. A branch is resolved once, then all files are read from that commit. Hosted documents omit modification dates because Git trees do not include file history; the dashboard displays the selected revision instead.

Authentication reference: [GitHub App user access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app).

## Reading

- Overview of active changes, published specifications, task counts, and archives.
- Change pages group proposal, design, tasks, nested delta specs, and extra artifacts.
- Full-text search across Markdown and YAML, including archived changes.
- Markdown reader with an outline, internal document links, tables, code blocks, and disabled task checkboxes.
- Source view for every artifact; YAML configuration and metadata are also browsable.
- Task progress excludes fenced examples. Published specs are only files under `openspec/specs/**/spec.md`; proposed specs remain under their change.

The local example project is fictional. Repository documents load when you open a workspace or follow a hosted artifact link after signing in.

## Development and verification

Run these in separate terminals for live frontend development:

```sh
npm run serve:api
npm run dev
```

Open http://127.0.0.1:4200. The Angular dev server proxies API reads to port 4310.

```sh
npm test
npm run build
dotnet build OpenSpec.slnx
npx playwright install chromium

# Use a disposable PostgreSQL database; each test creates and removes its own schema.
export TEST_DATABASE_CONNECTION='Host=localhost;Database=openspec_test;Username=openspec;Password=...'
npm run test:db
npm run test:ui
```

The xUnit tests cover parsing, local boundaries, GitHub pagination, commit consistency, cache authorization, and artifact limits. PostgreSQL integration tests exercise the actual ASP.NET authentication middleware, migrations, encrypted storage, OAuth forgery/replay, sign-out, session persistence after restart, and concurrent token refresh across instances. `npm test` runs the tests that need no database; `npm run test:db` requires the connection string above.

Playwright covers local reading and the hosted sign-in, branch, document-link, sharing, and mobile flows. Its hosted fixture runs ASP.NET Core against a temporary database schema, so browser tests also need `TEST_DATABASE_CONNECTION`. GitHub responses and consent are mocked; live sign-in requires your registered GitHub App. Production never includes test hosts or fixtures.

See [the backend guide](backend/README.md) for the C# structure, request flow, and migration commands.

Angular disk caching is disabled in this project because the installed LMDB native addon crashed on this Mac. This does not affect the running app.

## Current boundaries

- Reads local folders or GitHub.com repositories through the API; it does not clone, commit, push, edit artifacts, or execute implementation tasks. GitHub Enterprise Server, GitLab, and Azure DevOps connectors are not implemented.
- Refresh is manual. One workspace is open at a time.
- Reads custom documents and schemas, but task progress currently uses a change's `tasks.md`. Progress describes checked tasks, not OpenSpec workflow readiness or implementation correctness.
- External OpenSpec stores are not resolved automatically. Open the store repository directly.
- Markdown images are represented by their alt text, raw HTML is escaped, and Mermaid is shown as code. External images are not fetched.
- Symbolic links inside the selected OpenSpec folder are skipped. Limits: 2,000 artifacts, 2 MB per artifact, 20 MB total, and 20 nested directory levels.
- Local mode binds to loopback and rejects foreign hosts, cross-site requests, and mutations. Hosted mode uses GitHub sign-in, an explicit public origin, and read-only repository endpoints.
- Local artifact links assume the recipient has opened the same folder. Hosted links carry workspace identity and require the recipient’s own repository access; artifact-only invitations are not supported.
- Repository and branch lists support up to 1,000 entries per GitHub listing. Enter a repository or branch directly if the picker reports that limit. Truncated artifact trees are rejected rather than shown as complete.

## Add another repository provider

`WorkspaceParser` builds the response model from `ArtifactFile` records. Local and hosted readers share it. `GitHubRepositoryService` resolves a branch to one commit, reads only the selected folder, enforces limits, and caches parsed revisions. A future provider should follow the same boundary and verify the current viewer's content access before every cache lookup. Authentication and repository/branch listing belong to the provider integration.

## A path toward repository editing

1. **Repository context:** extend the hosted branch/commit display with changed-artifact comparisons. Add branch, commit, and dirty-state metadata for local folders through a Git adapter.
2. **Artifact editing:** store the original file revision (SHA-256 is already returned by the reader), offer an editor plus diff preview, and reject a save if the file changed since it was read. Write atomically after a successful revision check. A rejected save offers reload, comparison, or a three-way merge; never silently overwrite.
3. **Branch and review workflow:** use an isolated worktree or branch, validate with the OpenSpec CLI, then commit and prepare a PR. Compare the expected base commit before updating a branch. Keep unrelated local changes out of the app's commits.
4. **Conflict resolution:** distinguish a file changed locally from a branch that diverged remotely. Preserve base, local draft, and latest content for a three-way comparison and explicit resolution.
5. **Implementation execution:** running an agent to implement a change is a separate feature from editing Markdown. It would need an isolated checkout, an execution log, cancellation, and review of the resulting code.

Remote writes and implementation execution are future work.

OpenSpec references: [CLI](https://openspec.dev/docs/cli), [custom schemas](https://openspec.dev/docs/customize-schemas).
