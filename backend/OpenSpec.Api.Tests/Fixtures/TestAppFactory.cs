using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using OpenSpec.Api.GitHub;

namespace OpenSpec.Api.Tests.Fixtures;

public sealed class TestClock : TimeProvider
{
    public DateTimeOffset Now { get; set; } = DateTimeOffset.UtcNow;
    public override DateTimeOffset GetUtcNow() => Now;
}

public sealed class TestAppFactory(TestDatabase? database = null, FakeGitHubHandler? github = null, TestClock? clock = null, string origin = "https://desk.example") : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root is not null && !File.Exists(Path.Combine(root.FullName, "OpenSpec.slnx"))) root = root.Parent;
        builder.UseContentRoot(Path.Combine(root?.FullName ?? throw new InvalidOperationException("Repository root was not found."), "backend/OpenSpec.Api"));
        builder.UseSetting("DASHBOARD_MODE", database is null ? "local" : "hosted");
        if (database is not null)
        {
            builder.UseSetting("PUBLIC_ORIGIN", origin);
            builder.UseSetting("GITHUB_CLIENT_ID", "fixture-client");
            builder.UseSetting("GITHUB_CLIENT_SECRET", "fixture-secret");
            builder.UseSetting("GITHUB_APP_SLUG", "fixture-desk");
            builder.UseSetting("ConnectionStrings:Dashboard", database.ConnectionString);
            builder.UseSetting("DATA_PROTECTION_CERTIFICATE_PATH", database.CertificatePath);
        }
        builder.ConfigureTestServices(services =>
        {
            if (clock is not null) { services.RemoveAll<TimeProvider>(); services.AddSingleton<TimeProvider>(clock); }
            if (github is not null)
            {
                services.AddHttpClient<GitHubClient>().ConfigurePrimaryHttpMessageHandler(() => github);
                services.AddHttpClient("GitHubOAuth").ConfigurePrimaryHttpMessageHandler(() => github);
            }
        });
    }

    public HttpClient Viewer(bool cookies = true)
    {
        var client = CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri(database is null ? "http://localhost" : origin), AllowAutoRedirect = false, HandleCookies = cookies });
        client.DefaultRequestHeaders.Add("X-OpenSpec-Client", "dashboard");
        return client;
    }
}
