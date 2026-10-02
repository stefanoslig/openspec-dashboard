using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OAuth;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using OpenSpec.Api.Configuration;
using OpenSpec.Api.Data;
using OpenSpec.Api.GitHub;
using OpenSpec.Api.Workspaces;

namespace OpenSpec.Api.Auth;

public static class AuthenticationRegistration
{
    public const string SessionScheme = "OpenSpec";
    public const string GitHubScheme = "GitHub";

    public static IServiceCollection AddDashboardAuthentication(this IServiceCollection services, DashboardSettings settings)
    {
        services.AddDbContextFactory<DashboardDbContext>(options => options.UseNpgsql(settings.ConnectionString,
            postgres => postgres.CommandTimeout(30)));
        services.AddDataProtection().SetApplicationName("OpenSpec.Desk." + settings.ClientId)
            .PersistKeysToDbContext<DashboardDbContext>().ProtectKeysWithCertificate(settings.LoadCertificate());
        services.AddSingleton<PostgresTicketStore>();
        services.AddScoped<GitHubConnectionService>();
        services.AddHostedService<ExpiredSessionCleanup>();
        services.AddAuthentication(SessionScheme).AddCookie(SessionScheme, options =>
        {
            options.Cookie.Name = settings.SecureCookies ? "__Host-openspec-session" : "openspec-session";
            options.Cookie.Path = "/";
            options.Cookie.HttpOnly = true;
            options.Cookie.SameSite = SameSiteMode.Lax;
            options.Cookie.SecurePolicy = settings.SecureCookies ? CookieSecurePolicy.Always : CookieSecurePolicy.SameAsRequest;
            options.ExpireTimeSpan = TimeSpan.FromDays(7);
            options.SlidingExpiration = false;
            options.Events.OnRedirectToLogin = context => WriteError(context.HttpContext, 401, "Sign in with GitHub to open this repository.");
            options.Events.OnRedirectToAccessDenied = context => WriteError(context.HttpContext, 403, "Access denied.");
        }).AddOAuth(GitHubScheme, options =>
        {
            options.SignInScheme = SessionScheme;
            options.ClientId = settings.ClientId;
            options.ClientSecret = settings.ClientSecret;
            options.CallbackPath = "/auth/github/callback";
            options.AuthorizationEndpoint = "https://github.com/login/oauth/authorize";
            options.TokenEndpoint = "https://github.com/login/oauth/access_token";
            options.UserInformationEndpoint = "https://api.github.com/user";
            options.UsePkce = true;
            options.SaveTokens = false;
            options.RemoteAuthenticationTimeout = TimeSpan.FromMinutes(10);
            options.CorrelationCookie.Path = "/";
            options.CorrelationCookie.SameSite = SameSiteMode.Lax;
            options.CorrelationCookie.SecurePolicy = settings.SecureCookies ? CookieSecurePolicy.Always : CookieSecurePolicy.SameAsRequest;
            options.Events.OnRedirectToAuthorizationEndpoint = async context =>
            {
                var db = context.HttpContext.RequestServices.GetRequiredService<DashboardDbContext>();
                var now = context.HttpContext.RequestServices.GetRequiredService<TimeProvider>().GetUtcNow();
                var state = QueryHelpers.ParseQuery(new Uri(context.RedirectUri).Query)["state"].ToString();
                await using var transaction = await db.Database.BeginTransactionAsync(context.HttpContext.RequestAborted);
                await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(174819, 2)", context.HttpContext.RequestAborted);
                await db.OAuthAttempts.Where(attempt => attempt.ExpiresAt <= now).ExecuteDeleteAsync(context.HttpContext.RequestAborted);
                if (await db.OAuthAttempts.CountAsync(context.HttpContext.RequestAborted) >= 1000)
                    throw new WorkspaceException("Sign-in is busy. Try again shortly.", 503);
                db.OAuthAttempts.Add(new() { StateHash = PostgresTicketStore.Hash(state), ExpiresAt = now.AddMinutes(10) });
                await db.SaveChangesAsync(context.HttpContext.RequestAborted);
                await transaction.CommitAsync(context.HttpContext.RequestAborted);
                context.Response.Redirect(context.RedirectUri);
            };
            options.Events.OnCreatingTicket = async context =>
            {
                var provider = context.HttpContext.RequestServices;
                var cancellationToken = context.HttpContext.RequestAborted;
                var db = provider.GetRequiredService<DashboardDbContext>();
                var hash = PostgresTicketStore.Hash(context.Request.Query["state"].ToString());
                var now = provider.GetRequiredService<TimeProvider>().GetUtcNow();
                if (await db.OAuthAttempts.Where(attempt => attempt.StateHash == hash && attempt.ExpiresAt > now).ExecuteDeleteAsync(cancellationToken) != 1)
                    throw new WorkspaceException("This sign-in attempt expired. Try again.", 401);
                var profile = await provider.GetRequiredService<GitHubClient>().GetAsync("/user", context.AccessToken!, cancellationToken);
                var user = await provider.GetRequiredService<GitHubConnectionService>().ConnectAsync(profile.GetProperty("id").GetInt64(), profile.Text("login"), context.TokenResponse.Response!.RootElement, cancellationToken);
                context.Identity!.AddClaim(new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()));
                context.Identity.AddClaim(new Claim(ClaimTypes.Name, user.Login));
            };
            options.Events.OnTicketReceived = async context =>
            {
                // Rotate the app session when a viewer signs in again.
                await context.HttpContext.SignOutAsync(SessionScheme);
                context.Properties!.IsPersistent = true;
                context.Properties.ExpiresUtc = context.HttpContext.RequestServices.GetRequiredService<TimeProvider>().GetUtcNow().AddDays(7);
            };
            options.Events.OnRemoteFailure = context =>
            {
                context.HandleResponse();
                context.Response.Redirect("/?authError=signin");
                return Task.CompletedTask;
            };
        });
        services.AddOptions<CookieAuthenticationOptions>(SessionScheme).Configure<PostgresTicketStore>((options, store) => options.SessionStore = store);
        services.AddOptions<OAuthOptions>(GitHubScheme).Configure<IHttpClientFactory>((options, clients) => options.Backchannel = clients.CreateClient("GitHubOAuth"));
        services.AddAuthorization();
        return services;
    }

    private static Task WriteError(HttpContext context, int status, string error)
    {
        context.Response.StatusCode = status;
        return context.Response.WriteAsJsonAsync(new { error });
    }

    public static string ReturnPath(string? value, Uri origin)
    {
        if (value is null || value.Length > 3000 || !Uri.TryCreate(origin, value, out var url) ||
            url.GetLeftPart(UriPartial.Authority) != origin.GetLeftPart(UriPartial.Authority) || url.AbsolutePath is not ("/" or "/artifact")) return "/";
        return url.PathAndQuery + url.Fragment;
    }
}
