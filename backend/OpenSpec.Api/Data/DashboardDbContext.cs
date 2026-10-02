using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace OpenSpec.Api.Data;

public sealed class DashboardDbContext(DbContextOptions<DashboardDbContext> options) : DbContext(options), IDataProtectionKeyContext
{
    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<ProviderConnection> ProviderConnections => Set<ProviderConnection>();
    public DbSet<LoginSession> Sessions => Set<LoginSession>();
    public DbSet<OAuthAttempt> OAuthAttempts => Set<OAuthAttempt>();
    public DbSet<DataProtectionKey> DataProtectionKeys { get; set; } = null!;

    protected override void OnModelCreating(ModelBuilder model)
    {
        model.Entity<AppUser>(entity =>
        {
            entity.ToTable("Users"); entity.HasKey(user => user.Id);
            entity.HasIndex(user => user.GitHubId).IsUnique();
            entity.Property(user => user.Login).HasMaxLength(100);
        });
        model.Entity<ProviderConnection>(entity =>
        {
            entity.ToTable("ProviderConnections"); entity.HasKey(connection => new { connection.UserId, connection.Provider });
            entity.Property(connection => connection.Provider).HasMaxLength(30);
            entity.HasOne<AppUser>().WithMany().HasForeignKey(connection => connection.UserId).OnDelete(DeleteBehavior.Cascade);
        });
        model.Entity<LoginSession>(entity =>
        {
            entity.ToTable("Sessions"); entity.HasKey(session => session.TokenHash);
            entity.Property(session => session.TokenHash).HasMaxLength(64);
            entity.HasIndex(session => session.ExpiresAt);
            entity.HasOne<AppUser>().WithMany().HasForeignKey(session => session.UserId).OnDelete(DeleteBehavior.Cascade);
        });
        model.Entity<OAuthAttempt>(entity =>
        {
            entity.ToTable("OAuthAttempts"); entity.HasKey(attempt => attempt.StateHash);
            entity.Property(attempt => attempt.StateHash).HasMaxLength(64);
            entity.HasIndex(attempt => attempt.ExpiresAt);
        });
    }
}

public sealed class AppUser
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public long GitHubId { get; set; }
    public required string Login { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class ProviderConnection
{
    public Guid UserId { get; set; }
    public string Provider { get; set; } = "github";
    public string? ProtectedCredentials { get; set; }
    public DateTimeOffset? AccessExpiresAt { get; set; }
    public DateTimeOffset? RefreshExpiresAt { get; set; }
}

public sealed class LoginSession
{
    public required string TokenHash { get; set; }
    public Guid UserId { get; set; }
    public required byte[] ProtectedTicket { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
}

public sealed class OAuthAttempt
{
    public required string StateHash { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
}
