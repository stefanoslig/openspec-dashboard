using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using OpenSpec.Api.Api;
using OpenSpec.Api.Auth;
using OpenSpec.Api.Configuration;
using OpenSpec.Api.Data;
using OpenSpec.Api.GitHub;
using OpenSpec.Api.Workspaces;

if (args.Length == 2 && args[0] == "--create-certificate")
{
    await ProtectionCertificate.CreateAsync(args[1]);
    return;
}
var builder = WebApplication.CreateBuilder(args);
var settings = DashboardSettings.Load(builder.Configuration);
builder.Services.AddSingleton(settings);
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<WorkspaceParser>();
builder.Services.AddSingleton<LocalWorkspaceReader>();
builder.Services.AddSingleton<RepositoryCache>();
builder.Services.AddScoped<GitHubRepositoryService>();
builder.Services.AddHttpClient<GitHubClient>().ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
builder.Services.AddHttpClient("GitHubOAuth", client =>
{
    client.Timeout = TimeSpan.FromSeconds(20);
    client.MaxResponseContentBufferSize = 10_000_000;
    client.DefaultRequestHeaders.Accept.ParseAdd("application/json");
    client.DefaultRequestHeaders.UserAgent.ParseAdd("OpenSpec-Desk/1.0");
}).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
if (settings.Hosted) builder.Services.AddDashboardAuthentication(settings);
if (string.IsNullOrEmpty(builder.Configuration["urls"]))
    builder.WebHost.UseUrls($"http://{(settings.Hosted ? "0.0.0.0" : "127.0.0.1")}:{builder.Configuration["PORT"] ?? "4310"}");
builder.Logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning);
builder.Logging.AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Warning);

var app = builder.Build();
if (settings.Hosted)
{
    await using var scope = app.Services.CreateAsyncScope();
    var database = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
    if (args.Contains("--migrate", StringComparer.Ordinal))
    {
        await database.Database.MigrateAsync();
        return;
    }
    if ((await database.Database.GetPendingMigrationsAsync()).Any())
        throw new InvalidOperationException("Database migrations are pending. Run the backend with --migrate before starting it.");
}
app.UseMiddleware<RequestBoundary>();
if (settings.Hosted) { app.UseAuthentication(); app.UseAuthorization(); }
app.MapDashboardEndpoints(settings);
var assets = Directory.Exists(Path.Combine(app.Environment.ContentRootPath, "wwwroot"))
    ? Path.Combine(app.Environment.ContentRootPath, "wwwroot")
    : Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, "../../dist/openspec-dashboard/browser"));
if (Directory.Exists(assets))
{
    var files = new PhysicalFileProvider(assets);
    app.Lifetime.ApplicationStopped.Register(files.Dispose);
    app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = files });
    app.UseStaticFiles(new StaticFileOptions { FileProvider = files });
    app.MapFallback(async context =>
    {
        context.Response.ContentType = "text/html";
        await context.Response.SendFileAsync(Path.Combine(assets, "index.html"), context.RequestAborted);
    });
}
else app.MapFallback(() => Results.Json(new { error = "Build the dashboard first with npm run build." }, statusCode: 503));
await app.RunAsync();

public partial class Program;
