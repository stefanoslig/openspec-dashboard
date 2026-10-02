using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using OpenSpec.Api.Data;

namespace OpenSpec.Api.Auth;

public sealed class PostgresTicketStore(IDbContextFactory<DashboardDbContext> factory, IDataProtectionProvider protection, TimeProvider clock) : ITicketStore
{
    private readonly IDataProtector protector = protection.CreateProtector("OpenSpec.SessionTicket.v1");
    public static string Hash(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    public async Task<string> StoreAsync(AuthenticationTicket ticket)
    {
        var key = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        await using var db = await factory.CreateDbContextAsync();
        db.Sessions.Add(new()
        {
            TokenHash = Hash(key),
            UserId = Guid.Parse(ticket.Principal.FindFirstValue(ClaimTypes.NameIdentifier)!),
            ProtectedTicket = protector.Protect(TicketSerializer.Default.Serialize(ticket)),
            ExpiresAt = ticket.Properties.ExpiresUtc ?? clock.GetUtcNow().AddDays(7)
        });
        await db.SaveChangesAsync();
        return key;
    }

    public async Task RenewAsync(string key, AuthenticationTicket ticket)
    {
        await using var db = await factory.CreateDbContextAsync();
        var hash = Hash(key);
        var protectedTicket = protector.Protect(TicketSerializer.Default.Serialize(ticket));
        var expires = ticket.Properties.ExpiresUtc ?? clock.GetUtcNow().AddDays(7);
        await db.Sessions.Where(session => session.TokenHash == hash)
            .ExecuteUpdateAsync(update => update.SetProperty(session => session.ProtectedTicket, protectedTicket).SetProperty(session => session.ExpiresAt, expires));
    }

    public async Task<AuthenticationTicket?> RetrieveAsync(string key)
    {
        await using var db = await factory.CreateDbContextAsync();
        var hash = Hash(key);
        var now = clock.GetUtcNow();
        var session = await db.Sessions.AsNoTracking().SingleOrDefaultAsync(session => session.TokenHash == hash && session.ExpiresAt > now);
        if (session is null) return null;
        try { return TicketSerializer.Default.Deserialize(protector.Unprotect(session.ProtectedTicket)); }
        catch (CryptographicException) { return null; }
    }

    public async Task RemoveAsync(string key)
    {
        await using var db = await factory.CreateDbContextAsync();
        var hash = Hash(key);
        await db.Sessions.Where(session => session.TokenHash == hash).ExecuteDeleteAsync();
    }
}
