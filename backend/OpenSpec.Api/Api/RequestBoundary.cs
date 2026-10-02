using OpenSpec.Api.Configuration;
using OpenSpec.Api.Workspaces;

namespace OpenSpec.Api.Api;

public sealed class RequestBoundary(RequestDelegate next, DashboardSettings settings, ILogger<RequestBoundary> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var request = context.Request;
        var response = context.Response;
        response.Headers.XContentTypeOptions = "nosniff";
        response.Headers["Referrer-Policy"] = "no-referrer";
        response.Headers.CacheControl = "no-store";
        response.Headers.ContentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
        async Task Reject(int status, string error) { response.StatusCode = status; await response.WriteAsJsonAsync(new { error }, context.RequestAborted); }
        var allowedHost = settings.Hosted ? string.Equals(request.Host.Value, settings.PublicOrigin!.Authority, StringComparison.OrdinalIgnoreCase)
            : request.Host.Host is "localhost" or "127.0.0.1";
        if (!allowedHost) { await Reject(403, settings.Hosted ? "Unrecognized host." : "Local access only."); return; }
        var origin = settings.Hosted ? settings.PublicOrigin!.GetLeftPart(UriPartial.Authority) : $"http://{request.Host}";
        if (request.Headers.Origin.Count > 0 && request.Headers.Origin != origin) { await Reject(403, "Cross-origin access is disabled."); return; }
        var api = request.Path.StartsWithSegments("/api");
        if (request.Headers["Sec-Fetch-Site"] == "cross-site" && (api || !settings.Hosted)) { await Reject(403, "Cross-site API access is disabled."); return; }
        if (api && request.Headers["X-OpenSpec-Client"] != "dashboard") { await Reject(403, "Open the dashboard to read a workspace."); return; }
        if (!HttpMethods.IsGet(request.Method) && !(settings.Hosted && request.Path == "/api/logout" && HttpMethods.IsPost(request.Method)))
        { await Reject(405, "This dashboard is read-only."); return; }
        // A configured public origin makes callback URLs deterministic behind an HTTPS proxy.
        // Forwarded headers from clients are never trusted.
        if (settings.Hosted) request.Scheme = settings.PublicOrigin!.Scheme;
        try { await next(context); }
        catch (WorkspaceException exception) { await Reject(exception.Status, exception.Message); }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested) { }
        catch (Exception exception)
        {
            logger.LogError("Request failed with {ExceptionType}; trace {TraceId}", exception.GetType().Name, context.TraceIdentifier);
            if (!response.HasStarted) await Reject(500, "The request could not be completed. Refresh and try again.");
        }
    }
}
