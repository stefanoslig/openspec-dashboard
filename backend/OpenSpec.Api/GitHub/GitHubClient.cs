using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using OpenSpec.Api.Workspaces;

namespace OpenSpec.Api.GitHub;

public sealed class GitHubClient(HttpClient client)
{
    public Task<JsonElement> GetAsync(string endpoint, string token, CancellationToken cancellationToken) =>
        SendAsync(new HttpRequestMessage(HttpMethod.Get, "https://api.github.com" + endpoint), token, cancellationToken);

    public Task<JsonElement> ExchangeAsync(Dictionary<string, string> fields, CancellationToken cancellationToken) =>
        SendAsync(new HttpRequestMessage(HttpMethod.Post, "https://github.com/login/oauth/access_token")
        { Content = new FormUrlEncodedContent(fields) }, null, cancellationToken);

    private async Task<JsonElement> SendAsync(HttpRequestMessage request, string? token, CancellationToken cancellationToken)
    {
        using (request)
        {
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            request.Headers.UserAgent.ParseAdd("OpenSpec-Desk/1.0");
            request.Headers.Add("X-GitHub-Api-Version", "2026-03-10");
            if (token is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(20));
            try
            {
                using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
                if (response.StatusCode == HttpStatusCode.Unauthorized) throw new WorkspaceException("Your GitHub session expired. Sign in again.", 401);
                if (response.StatusCode == HttpStatusCode.TooManyRequests || response.StatusCode == HttpStatusCode.Forbidden &&
                    response.Headers.TryGetValues("x-ratelimit-remaining", out var remaining) && remaining.Contains("0"))
                    throw new WorkspaceException("GitHub’s rate limit was reached. Try again after it resets.", 429);
                if (response.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.NotFound)
                    throw new WorkspaceException("GitHub access is unavailable. Check the repository, branch, and app installation permissions.", 403);
                if (!response.IsSuccessStatusCode) throw new WorkspaceException("GitHub could not complete this request. Try again shortly.", 502);
                await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
                using var buffer = new MemoryStream();
                var chunk = new byte[16_384];
                int count;
                while ((count = await stream.ReadAsync(chunk, timeout.Token)) > 0)
                {
                    if (buffer.Length + count > 10_000_000) throw new WorkspaceException("GitHub returned too much data for this request.");
                    buffer.Write(chunk, 0, count);
                }
                using var document = JsonDocument.Parse(buffer.ToArray());
                return document.RootElement.Clone();
            }
            catch (HttpRequestException) { throw new WorkspaceException("GitHub could not be reached. Try again shortly.", 502); }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { throw new WorkspaceException("GitHub could not be reached. Try again shortly.", 502); }
            catch (JsonException) { throw new WorkspaceException("GitHub returned an unreadable response.", 502); }
        }
    }
}

internal static class GitHubJson
{
    public static string Text(this JsonElement element, string property) => element.GetProperty(property).GetString()!;
    public static string? OptionalText(this JsonElement element, string property) => element.ValueKind == JsonValueKind.Object && element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}
