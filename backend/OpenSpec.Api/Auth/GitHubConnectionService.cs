using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using OpenSpec.Api.Configuration;
using OpenSpec.Api.Data;
using OpenSpec.Api.GitHub;
using OpenSpec.Api.Workspaces;

namespace OpenSpec.Api.Auth;

public sealed record GitHubCredentials(string AccessToken, string? RefreshToken);

public sealed class GitHubConnectionService(DashboardDbContext db, IDataProtectionProvider protection,
    GitHubClient github, DashboardSettings settings, TimeProvider clock)
{
    private IDataProtector Protector(Guid userId) => protection.CreateProtector("OpenSpec.GitHubCredentials.v1", settings.ClientId, userId.ToString());

    private void SetCredentials(ProviderConnection connection, JsonElement response)
    {
        if (response.OptionalText("access_token") is not { Length: > 0 } access || response.TryGetProperty("error", out _))
            throw new WorkspaceException("GitHub did not return valid credentials. Try signing in again.", 502);
        DateTimeOffset? Expires(string field)
        {
            if (!response.TryGetProperty(field, out var value)) return null;
            if (!value.TryGetInt64(out var seconds) || seconds is <= 0 or > 31_622_400)
                throw new WorkspaceException("GitHub returned an invalid token expiry.", 502);
            return clock.GetUtcNow().AddSeconds(seconds);
        }
        connection.ProtectedCredentials = Protector(connection.UserId).Protect(JsonSerializer.Serialize(new GitHubCredentials(access, response.OptionalText("refresh_token"))));
        connection.AccessExpiresAt = Expires("expires_in");
        connection.RefreshExpiresAt = Expires("refresh_token_expires_in");
    }

    public async Task<AppUser> ConnectAsync(long githubId, string login, JsonElement tokens, CancellationToken cancellationToken)
    {
        if (githubId <= 0 || string.IsNullOrWhiteSpace(login) || login.Length > 100) throw new WorkspaceException("GitHub returned an invalid account.", 502);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        // Signing in twice concurrently must reuse the same stable GitHub identity.
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({githubId})", cancellationToken);
        var user = await db.Users.SingleOrDefaultAsync(user => user.GitHubId == githubId, cancellationToken);
        if (user is null) { user = new() { GitHubId = githubId, Login = login, CreatedAt = clock.GetUtcNow() }; db.Users.Add(user); }
        user.Login = login;
        var connection = await db.ProviderConnections.FromSqlInterpolated($"SELECT * FROM \"ProviderConnections\" WHERE \"UserId\" = {user.Id} AND \"Provider\" = 'github' FOR UPDATE").SingleOrDefaultAsync(cancellationToken);
        if (connection is null) { connection = new() { UserId = user.Id }; db.ProviderConnections.Add(connection); }
        SetCredentials(connection, tokens);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return user;
    }

    public async Task<string> AccessTokenAsync(Guid userId, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        // Refresh tokens rotate. This lock coordinates refresh across all app instances.
        var connection = await db.ProviderConnections.FromSqlInterpolated($"SELECT * FROM \"ProviderConnections\" WHERE \"UserId\" = {userId} AND \"Provider\" = 'github' FOR UPDATE").SingleOrDefaultAsync(cancellationToken);
        if (connection?.ProtectedCredentials is null) throw Reconnect();
        var credentials = JsonSerializer.Deserialize<GitHubCredentials>(Protector(userId).Unprotect(connection.ProtectedCredentials))!;
        if (connection.AccessExpiresAt is null || connection.AccessExpiresAt > clock.GetUtcNow().AddMinutes(1))
        {
            await transaction.CommitAsync(cancellationToken);
            return credentials.AccessToken;
        }
        JsonElement? refreshed = null;
        if (credentials.RefreshToken is not null && (connection.RefreshExpiresAt is null || connection.RefreshExpiresAt > clock.GetUtcNow()))
        {
            refreshed = await github.ExchangeAsync(new()
            {
                ["client_id"] = settings.ClientId,
                ["client_secret"] = settings.ClientSecret,
                ["grant_type"] = "refresh_token",
                ["refresh_token"] = credentials.RefreshToken
            }, cancellationToken);
        }
        if (refreshed is null || refreshed.Value.OptionalText("error") is "bad_refresh_token" or "invalid_grant" or "expired_refresh_token")
        {
            connection.ProtectedCredentials = null;
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            throw Reconnect();
        }
        // Temporary provider errors throw before SaveChanges and leave credentials intact.
        SetCredentials(connection, refreshed.Value);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return refreshed.Value.Text("access_token");
    }

    private static WorkspaceException Reconnect() => new("Your GitHub connection expired. Sign in again.", 401);
}
