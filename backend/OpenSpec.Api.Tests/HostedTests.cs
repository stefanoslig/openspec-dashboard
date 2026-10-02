using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using OpenSpec.Api.Tests.Fixtures;

namespace OpenSpec.Api.Tests;

public sealed class HostedTests
{
    private const string WorkspaceUrl = "/api/workspace?provider=github&repository=acme%2Froadmap";
    private static string Cookie(HttpResponseMessage response, string prefix) => response.Headers.GetValues("Set-Cookie")
        .Last(value => value.StartsWith(prefix, StringComparison.Ordinal) && !value.Contains("expires=Thu, 01 Jan 1970", StringComparison.OrdinalIgnoreCase)).Split(';')[0];

    private static async Task<(string Cookie, HttpResponseMessage Response)> SignIn(HttpClient client, string returnTo = "/")
    {
        var begin = await client.GetAsync("/auth/github?returnTo=" + Uri.EscapeDataString(returnTo));
        Assert.Equal(HttpStatusCode.Redirect, begin.StatusCode);
        var location = begin.Headers.Location!;
        var query = QueryHelpers.ParseQuery(location.Query);
        Assert.Equal("S256", query["code_challenge_method"]);
        var request = new HttpRequestMessage(HttpMethod.Get, "/auth/github/callback?state=" + Uri.EscapeDataString(query["state"].ToString()) + "&code=alice");
        request.Headers.Add("Cookie", Cookie(begin, ".AspNetCore.Correlation."));
        var response = await client.SendAsync(request);
        Assert.Equal(returnTo.StartsWith("//", StringComparison.Ordinal) ? "/" : returnTo, response.Headers.Location?.OriginalString);
        return (Cookie(response, "__Host-openspec-session="), response);
    }

    [PostgresFact, Trait("Category", "PostgreSQL")]
    public async Task HostedSignInKeepsSecretsEncryptedAndHonorsPermissionsAndLogout()
    {
        await using var database = await TestDatabase.CreateAsync();
        var github = new FakeGitHubHandler();
        await using var factory = new TestAppFactory(database, github);
        using var client = factory.Viewer(false);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(WorkspaceUrl)).StatusCode);
        var login = await SignIn(client, "/artifact?provider=github&repo=acme%2Froadmap&path=proposal.md");
        client.DefaultRequestHeaders.Add("Cookie", login.Cookie);
        var session = await client.GetFromJsonAsync<JsonElement>("/api/session");
        Assert.Equal("alice", session.GetProperty("user").GetProperty("login").GetString());
        Assert.DoesNotContain("fixture-alice", session.GetRawText(), StringComparison.Ordinal);
        Assert.DoesNotContain("fixture-alice", login.Cookie, StringComparison.Ordinal);
        var cookieHeader = login.Response.Headers.GetValues("Set-Cookie").Last(value => value.StartsWith("__Host-openspec-session=", StringComparison.Ordinal));
        Assert.Contains("httponly", cookieHeader, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("secure", cookieHeader, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=lax", cookieHeader, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(WorkspaceUrl)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/workspace?path=/tmp")).StatusCode);
        Assert.Equal(HttpStatusCode.MethodNotAllowed, (await client.PostAsync(WorkspaceUrl, null)).StatusCode);
        await using var db = database.Open();
        var connection = await db.ProviderConnections.SingleAsync();
        Assert.DoesNotContain("fixture-alice", connection.ProtectedCredentials!, StringComparison.Ordinal);
        var record = await db.Sessions.SingleAsync();
        Assert.Equal(64, record.TokenHash.Length);
        Assert.DoesNotContain(record.TokenHash, login.Cookie, StringComparison.Ordinal);
        Assert.All(await db.DataProtectionKeys.ToListAsync(), key => Assert.Contains("encryptedSecret", key.Xml!, StringComparison.Ordinal));
        github.Denied["fixture-alice"] = true;
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync(WorkspaceUrl)).StatusCode);
        client.DefaultRequestHeaders.Add("Origin", "https://evil.example");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsync("/api/logout", null)).StatusCode);
        client.DefaultRequestHeaders.Remove("Origin");
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/logout", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(WorkspaceUrl)).StatusCode);
    }

    [PostgresFact, Trait("Category", "PostgreSQL")]
    public async Task SignInCrossesInstancesAndRejectsForgeryReplayAndExpiredState()
    {
        await using var database = await TestDatabase.CreateAsync();
        var github = new FakeGitHubHandler();
        var clock = new TestClock();
        await using var first = new TestAppFactory(database, github, clock);
        using var start = first.Viewer(false);
        var begin = await start.GetAsync("/auth/github");
        var state = QueryHelpers.ParseQuery(begin.Headers.Location!.Query)["state"].ToString();
        var callback = "/auth/github/callback?state=" + Uri.EscapeDataString(state) + "&code=alice";
        await using var second = new TestAppFactory(database, github, clock);
        using var complete = second.Viewer(false);
        Assert.Equal("/?authError=signin", (await complete.GetAsync(callback)).Headers.Location!.OriginalString);
        Assert.Empty(github.Requests);
        complete.DefaultRequestHeaders.Add("Cookie", Cookie(begin, ".AspNetCore.Correlation."));
        var signedIn = await complete.GetAsync(callback);
        Assert.Equal("/", signedIn.Headers.Location!.OriginalString);
        Assert.Equal("/?authError=signin", (await complete.GetAsync(callback)).Headers.Location!.OriginalString);
        var sessionCookie = Cookie(signedIn, "__Host-openspec-session=");
        start.DefaultRequestHeaders.Add("Cookie", sessionCookie);
        Assert.Equal(HttpStatusCode.OK, (await start.GetAsync(WorkspaceUrl)).StatusCode);
        await first.DisposeAsync();
        complete.DefaultRequestHeaders.Remove("Cookie");
        complete.DefaultRequestHeaders.Add("Cookie", sessionCookie);
        Assert.Equal(HttpStatusCode.OK, (await complete.GetAsync(WorkspaceUrl)).StatusCode);
        await complete.PostAsync("/api/logout", null);
        Assert.Equal(HttpStatusCode.Unauthorized, (await complete.GetAsync(WorkspaceUrl)).StatusCode);
        complete.DefaultRequestHeaders.Remove("Cookie");
        await SignIn(complete, "//evil.example");
        begin = await complete.GetAsync("/auth/github");
        state = QueryHelpers.ParseQuery(begin.Headers.Location!.Query)["state"].ToString();
        clock.Now = clock.Now.AddMinutes(11);
        complete.DefaultRequestHeaders.Add("Cookie", Cookie(begin, ".AspNetCore.Correlation."));
        Assert.Equal("/?authError=signin", (await complete.GetAsync("/auth/github/callback?state=" + Uri.EscapeDataString(state) + "&code=alice")).Headers.Location!.OriginalString);
    }

    [PostgresFact, Trait("Category", "PostgreSQL")]
    public async Task RotatesRefreshTokensOnceAcrossInstancesAndPreservesSessionsAcrossRestart()
    {
        await using var database = await TestDatabase.CreateAsync();
        var github = new FakeGitHubHandler();
        var clock = new TestClock();
        var first = new TestAppFactory(database, github, clock);
        using var original = first.Viewer(false);
        var login = await SignIn(original);
        original.DefaultRequestHeaders.Add("Cookie", login.Cookie);
        await first.DisposeAsync();
        await using var second = new TestAppFactory(database, github, clock);
        await using var third = new TestAppFactory(database, github, clock);
        using var left = second.Viewer(false);
        using var right = third.Viewer(false);
        left.DefaultRequestHeaders.Add("Cookie", login.Cookie);
        right.DefaultRequestHeaders.Add("Cookie", login.Cookie);
        clock.Now = clock.Now.AddHours(8);
        var responses = await Task.WhenAll(left.GetAsync(WorkspaceUrl), right.GetAsync(WorkspaceUrl));
        Assert.All(responses, response => Assert.Equal(HttpStatusCode.OK, response.StatusCode));
        Assert.Equal(1, github.RefreshCount);
        clock.Now = clock.Now.AddHours(8);
        github.RefreshError = "temporarily_unavailable";
        Assert.Equal(HttpStatusCode.BadGateway, (await left.GetAsync(WorkspaceUrl)).StatusCode);
        github.RefreshError = null;
        Assert.Equal(HttpStatusCode.OK, (await right.GetAsync(WorkspaceUrl)).StatusCode);
        Assert.Contains(github.Requests, request => request.Body.Contains("refresh_token=refresh-alice-1", StringComparison.Ordinal));
        clock.Now = clock.Now.AddHours(8);
        github.RefreshError = "bad_refresh_token";
        Assert.Equal(HttpStatusCode.Unauthorized, (await left.GetAsync(WorkspaceUrl)).StatusCode);
        var count = github.RefreshCount;
        Assert.Equal(HttpStatusCode.Unauthorized, (await right.GetAsync(WorkspaceUrl)).StatusCode);
        Assert.Equal(count, github.RefreshCount);
        Assert.Equal("alice", (await left.GetFromJsonAsync<JsonElement>("/api/session")).GetProperty("user").GetProperty("login").GetString());
        clock.Now = clock.Now.AddDays(7);
        Assert.Equal(JsonValueKind.Null, (await left.GetFromJsonAsync<JsonElement>("/api/session")).GetProperty("user").ValueKind);
    }
}
