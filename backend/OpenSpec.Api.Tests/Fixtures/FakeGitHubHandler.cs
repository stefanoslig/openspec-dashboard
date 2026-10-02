using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using Microsoft.AspNetCore.WebUtilities;

namespace OpenSpec.Api.Tests.Fixtures;

public sealed class FakeGitHubHandler : HttpMessageHandler
{
    public const string FirstCommit = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    public const string SecondCommit = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    public static readonly (string Path, string Content)[] Files =
    [
        ("config.yaml", "schema: spec-driven"),
        ("changes/review-sharing/proposal.md", "# Review sharing\n\nRead the committed proposal.\n\n[Tasks](tasks.md)"),
        ("changes/review-sharing/tasks.md", "# Tasks\n\n- [x] Connect GitHub\n- [ ] Review artifacts"),
        ("specs/sharing/spec.md", "# Sharing\n\n### Requirement: Read artifacts\n\n#### Scenario: Open a shared link")
    ];
    public ConcurrentQueue<(string Url, string Body, string? Token)> Requests { get; } = new();
    public ConcurrentDictionary<string, bool> Denied { get; } = new();
    private readonly ConcurrentDictionary<string, string> tokens = new([new("fixture-alice", "alice"), new("fixture-bob", "bob")]);
    private readonly ConcurrentDictionary<string, string> refreshTokens = new();
    public string Commit { get; set; } = FirstCommit;
    public bool Truncated { get; set; }
    public bool RateLimited { get; set; }
    public string? RefreshError { get; set; }
    private int rotation;
    public int RefreshCount { get; private set; }
    public int BranchCount { get; set; } = 2;
    public string? LoginOverride { get; set; }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var url = request.RequestUri!;
        var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken);
        var token = request.Headers.Authorization?.Parameter;
        Requests.Enqueue((url.AbsoluteUri, body, token));
        static HttpResponseMessage Json(object value, HttpStatusCode status = HttpStatusCode.OK) => new(status) { Content = JsonContent.Create(value) };
        if (url.AbsoluteUri == "https://github.com/login/oauth/access_token")
        {
            var fields = QueryHelpers.ParseQuery(body);
            if (fields["grant_type"] == "refresh_token")
            {
                RefreshCount++;
                if (RefreshError is not null) return Json(new { error = RefreshError });
                if (!refreshTokens.TryRemove(fields["refresh_token"].ToString(), out var user)) return Json(new { error = "bad_refresh_token" });
                var number = Interlocked.Increment(ref rotation);
                var access = $"fixture-{user}-{number}";
                var refresh = $"refresh-{user}-{number}";
                tokens[access] = user; refreshTokens[refresh] = user;
                return Json(new { access_token = access, refresh_token = refresh, expires_in = 28800, refresh_token_expires_in = 15897600, token_type = "bearer" });
            }
            var code = fields["code"].ToString();
            if (code is not ("alice" or "bob")) return Json(new { error = "bad_verification_code" });
            refreshTokens[$"refresh-{code}"] = code;
            return Json(new { access_token = $"fixture-{code}", refresh_token = $"refresh-{code}", expires_in = 28800, refresh_token_expires_in = 15897600, token_type = "bearer" });
        }
        if (token is null || !tokens.TryGetValue(token, out var login)) return Json(new { }, HttpStatusCode.Unauthorized);
        if (Denied.ContainsKey(token)) return Json(new { }, HttpStatusCode.Forbidden);
        if (RateLimited) { var limited = Json(new { }, HttpStatusCode.Forbidden); limited.Headers.Add("x-ratelimit-remaining", "0"); return limited; }
        var endpoint = url.AbsolutePath;
        if (endpoint == "/user") return Json(new { id = login == "alice" ? 101 : 102, login = LoginOverride ?? login });
        if (endpoint == "/user/installations") return Json(new { installations = new[] { new { id = 1 } } });
        var repository = new { id = 123, full_name = "acme/roadmap", default_branch = "main" };
        if (endpoint == "/user/installations/1/repositories") return Json(new { repositories = new[] { repository } });
        if (endpoint == "/repos/acme/roadmap") return Json(repository);
        if (endpoint == "/repos/acme/roadmap/branches")
        {
            if (BranchCount == 2) return Json(new[] { new { name = "main" }, new { name = "feature/review" } });
            var page = int.Parse(QueryHelpers.ParseQuery(url.Query)["page"].ToString(), System.Globalization.CultureInfo.InvariantCulture);
            return Json(Enumerable.Range(0, BranchCount).Skip((page - 1) * 100).Take(100).Select(index => new { name = $"branch-{index}" }));
        }
        if (endpoint.StartsWith("/repos/acme/roadmap/commits/", StringComparison.Ordinal))
        {
            var reference = Uri.UnescapeDataString(endpoint.Split("/commits/")[1]);
            if (reference is not ("main" or "feature/review" or FirstCommit or SecondCommit)) return Json(new { }, HttpStatusCode.NotFound);
            var sha = reference is FirstCommit or SecondCommit ? reference : Commit;
            return Json(new { sha, commit = new { tree = new { sha = "root-" + sha }, committer = new { date = "2026-10-01T09:00:00Z" } } });
        }
        if (endpoint.Contains("/git/trees/root-", StringComparison.Ordinal)) return Json(new { truncated = false, tree = new[] { new { path = "openspec", type = "tree", sha = "artifacts" }, new { path = "docs", type = "tree", sha = "docs" } } });
        if (endpoint.EndsWith("/git/trees/docs", StringComparison.Ordinal)) return Json(new { truncated = false, tree = new[] { new { path = "openspec", type = "tree", sha = "artifacts" } } });
        if (endpoint.EndsWith("/git/trees/artifacts", StringComparison.Ordinal)) return Json(new
        {
            truncated = Truncated,
            tree = Files.Select((file, index) => new { path = file.Path, type = "blob", mode = "100644", sha = $"file-{index}", size = Encoding.UTF8.GetByteCount(file.Content) })
                .Concat([new { path = ".hidden/private.md", type = "blob", mode = "100644", sha = "hidden", size = 10 },
                    new { path = "linked.md", type = "blob", mode = "120000", sha = "symlink", size = 10 },
                    new { path = "vendor", type = "commit", mode = "160000", sha = "submodule", size = 10 }])
        });
        if (endpoint.Contains("/git/blobs/file-", StringComparison.Ordinal))
        {
            var index = int.Parse(endpoint.Split("/git/blobs/file-")[1], System.Globalization.CultureInfo.InvariantCulture);
            return Json(new { encoding = "base64", content = Convert.ToBase64String(Encoding.UTF8.GetBytes(Files[index].Content)) });
        }
        throw new InvalidOperationException($"Unexpected fixture request: {url}");
    }

    protected override void Dispose(bool disposing) { /* Shared by multiple test servers. */ }
}
