using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using OpenSpec.Api.Auth;
using OpenSpec.Api.Configuration;
using OpenSpec.Api.GitHub;
using OpenSpec.Api.Workspaces;

namespace OpenSpec.Api.Api;

public static class DashboardEndpoints
{
    public static void MapDashboardEndpoints(this WebApplication app, DashboardSettings settings)
    {
        app.MapGet("/health/live", () => Results.Ok(new { status = "ok" }));
        app.MapGet("/api/session", (HttpContext context) => Results.Ok(settings.Hosted
            ? (object)new
            {
                mode = "hosted",
                user = context.User.Identity?.IsAuthenticated == true ? new { login = context.User.Identity.Name } : null,
                installationUrl = $"https://github.com/apps/{settings.AppSlug}/installations/new"
            }
            : new { mode = "local" }));
        if (settings.Hosted)
        {
            app.MapGet("/auth/github", (string? returnTo) => Results.Challenge(new AuthenticationProperties
            { RedirectUri = AuthenticationRegistration.ReturnPath(returnTo, settings.PublicOrigin!), IsPersistent = true }, [AuthenticationRegistration.GitHubScheme]));
            app.MapPost("/api/logout", async (HttpContext context) =>
            {
                await context.SignOutAsync(AuthenticationRegistration.SessionScheme);
                return Results.NoContent();
            });
            var api = app.MapGroup("/api").RequireAuthorization();
            api.MapGet("/repositories", async (HttpContext context, GitHubConnectionService connections, GitHubRepositoryService repositories, CancellationToken cancellationToken) =>
                Results.Ok(await repositories.RepositoriesAsync(await Token(context, connections, cancellationToken), cancellationToken)));
            api.MapGet("/branches", async (HttpContext context, string? repository, GitHubConnectionService connections, GitHubRepositoryService repositories, CancellationToken cancellationToken) =>
                Results.Ok(await repositories.BranchesAsync(repository, await Token(context, connections, cancellationToken), cancellationToken)));
            api.MapGet("/workspace", async (HttpContext context, GitHubConnectionService connections, GitHubRepositoryService repositories, CancellationToken cancellationToken) =>
            {
                if (context.Request.Query.ContainsKey("path")) throw new WorkspaceException("Local folders are unavailable in hosted mode.");
                if (context.Request.Query["provider"] != "github") throw new WorkspaceException("Choose a supported repository provider.");
                return Results.Ok(await repositories.ReadAsync(context.Request.Query["repository"], context.Request.Query["ref"],
                    context.Request.Query["folder"].FirstOrDefault() ?? "openspec", await Token(context, connections, cancellationToken), cancellationToken));
            });
        }
        else
        {
            app.MapGet("/api/workspace", async (string? path, LocalWorkspaceReader reader, CancellationToken cancellationToken) =>
                Results.Ok(await reader.ReadAsync(path ?? Path.Combine(AppContext.BaseDirectory, "Demo"), path is null, cancellationToken)));
        }
        app.Map("/api/{**path}", () => Results.NotFound(new { error = "Unknown endpoint." }));
    }

    private static Task<string> Token(HttpContext context, GitHubConnectionService connections, CancellationToken cancellationToken) =>
        connections.AccessTokenAsync(Guid.Parse(context.User.FindFirstValue(ClaimTypes.NameIdentifier)!), cancellationToken);
}
