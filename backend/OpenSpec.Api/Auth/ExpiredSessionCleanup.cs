using Microsoft.EntityFrameworkCore;
using OpenSpec.Api.Data;

namespace OpenSpec.Api.Auth;

public sealed class ExpiredSessionCleanup(IDbContextFactory<DashboardDbContext> factory, TimeProvider clock, ILogger<ExpiredSessionCleanup> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromHours(1), clock);
        do
        {
            try
            {
                await using var db = await factory.CreateDbContextAsync(stoppingToken);
                var now = clock.GetUtcNow();
                await db.Sessions.Where(session => session.ExpiresAt <= now).ExecuteDeleteAsync(stoppingToken);
                await db.OAuthAttempts.Where(attempt => attempt.ExpiresAt <= now).ExecuteDeleteAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception) { logger.LogWarning("Expired authentication records could not be removed; the next cleanup will retry."); }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
