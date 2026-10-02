using System.Net;
using System.Net.Http.Json;
using OpenSpec.Api.GitHub;
using OpenSpec.Api.Tests.Fixtures;
using OpenSpec.Api.Workspaces;

namespace OpenSpec.Api.Tests;

public sealed class WorkspaceTests
{
    private readonly WorkspaceParser parser = new(TimeProvider.System);

    [Fact]
    public void MarkdownCountsActualTasksAndHeadings()
    {
        var info = WorkspaceParser.InspectMarkdown("- [x] Done\n- [ ] Pending\n  - [X] Nested\n\n~~~md\n- [ ] Example\n~~~\n\n### Requirement: Read\n#### Scenario: Open");
        Assert.Equal(new MarkdownInfo(2, 3, 1, 1, ""), info);
        Assert.Equal("Read this proposal.", WorkspaceParser.InspectMarkdown("# Proposal\n\nRead this **proposal**.").Summary);
    }

    [Fact]
    public async Task LocalReaderPreservesDemoAndTaskProgress()
    {
        var workspace = await new LocalWorkspaceReader(parser).ReadAsync(Path.Combine(AppContext.BaseDirectory, "Demo"), true, default);
        Assert.Equal("Atlas", workspace.Name);
        Assert.Equal(3, workspace.Changes.Count);
        Assert.Single(workspace.Changes, change => change.Archived);
        var active = Assert.Single(workspace.Changes, change => change.Name == "add-project-invitations");
        Assert.Equal((5, 9, "In progress"), (active.Completed, active.Total, active.Status));
        Assert.Contains("changes/add-project-invitations/specs/projects/membership/spec.md", active.Documents);
        Assert.Equal("projects/access", workspace.Specs[0].Capability);
        Assert.Equal(2, workspace.Specs[0].Requirements);
    }

    [Fact]
    public async Task LocalReaderSkipsSymlinksAndReportsInvalidYaml()
    {
        var folder = Path.Combine(Path.GetTempPath(), "openspec-local-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(folder, "openspec"));
        try
        {
            await File.WriteAllTextAsync(Path.Combine(folder, "private.md"), "outside");
            File.CreateSymbolicLink(Path.Combine(folder, "openspec/linked.md"), Path.Combine(folder, "private.md"));
            await File.WriteAllTextAsync(Path.Combine(folder, "openspec/config.yaml"), "schema: [");
            var data = await new LocalWorkspaceReader(parser).ReadAsync(folder, false, default);
            Assert.Single(data.Documents);
            Assert.Equal(2, data.Warnings.Count);
            Assert.Contains(data.Warnings, warning => warning.Contains("symbolic link", StringComparison.Ordinal));
            Assert.Empty((await new LocalWorkspaceReader(parser).ReadAsync(Path.Combine(folder, "openspec"), false, default)).Changes);
        }
        finally { Directory.Delete(folder, true); }
        await Assert.ThrowsAsync<WorkspaceException>(() => new LocalWorkspaceReader(parser).ReadAsync("relative", false, default));
    }

    [Fact]
    public async Task LocalHttpBoundaryRejectsForeignOriginsAndMutations()
    {
        await using var factory = new TestAppFactory();
        using var client = factory.Viewer();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/workspace")).StatusCode);
        Assert.Equal("local", (await client.GetFromJsonAsync<System.Text.Json.JsonElement>("/api/session")).GetProperty("mode").GetString());
        Assert.Equal(HttpStatusCode.MethodNotAllowed, (await client.PostAsync("/api/workspace", null)).StatusCode);
        client.DefaultRequestHeaders.Add("Origin", "https://evil.example");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/workspace")).StatusCode);
        client.DefaultRequestHeaders.Remove("Origin");
        client.DefaultRequestHeaders.Host = "evil.example";
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/workspace")).StatusCode);
        client.DefaultRequestHeaders.Host = "localhost";
        client.DefaultRequestHeaders.Add("Sec-Fetch-Site", "cross-site");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/workspace")).StatusCode);
        client.DefaultRequestHeaders.Remove("Sec-Fetch-Site");
        client.DefaultRequestHeaders.Remove("X-OpenSpec-Client");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/workspace")).StatusCode);
    }

    [Fact]
    public async Task GitHubReadsTheSelectedSubtreeAndRechecksAccessBeforeCacheHits()
    {
        var fixture = new FakeGitHubHandler();
        using var cache = new RepositoryCache();
        var service = new GitHubRepositoryService(new(new HttpClient(fixture)), parser, cache, TimeProvider.System);
        var workspace = await service.ReadAsync("https://github.com/acme/roadmap.git", "feature/review", "docs/openspec", "fixture-alice", default);
        var expected = parser.Build(FakeGitHubHandler.Files.Select(file => new ArtifactFile(file.Path, file.Content)), "acme/roadmap", "docs/openspec");
        Assert.Equal(expected.Documents, workspace.Documents);
        Assert.Equal("feature/review", workspace.Source!.Ref);
        Assert.Equal(FakeGitHubHandler.FirstCommit, workspace.Source.Commit);
        Assert.Null(workspace.Changes[0].Modified);
        Assert.Equal(2, workspace.Warnings.Count);
        var reads = fixture.Requests.Count(request => request.Url.Contains("/git/blobs/", StringComparison.Ordinal));
        await service.ReadAsync("acme/roadmap", "main", "docs/openspec", "fixture-bob", default);
        Assert.Equal(reads, fixture.Requests.Count(request => request.Url.Contains("/git/blobs/", StringComparison.Ordinal)));
        fixture.Denied["fixture-bob"] = true;
        Assert.Equal(403, (await Assert.ThrowsAsync<WorkspaceException>(() => service.ReadAsync("acme/roadmap", "main", "docs/openspec", "fixture-bob", default))).Status);
        fixture.Commit = FakeGitHubHandler.SecondCommit;
        Assert.Equal(FakeGitHubHandler.SecondCommit, (await service.ReadAsync("acme/roadmap", "main", "docs/openspec", "fixture-alice", default)).Source!.Commit);
        Assert.Equal(FakeGitHubHandler.FirstCommit, (await service.ReadAsync("acme/roadmap", FakeGitHubHandler.FirstCommit, "docs/openspec", "fixture-alice", default)).Source!.Commit);
    }

    [Fact]
    public async Task GitHubRejectsIncompleteTreesAndPaginatesListings()
    {
        var fixture = new FakeGitHubHandler { Truncated = true };
        using var cache = new RepositoryCache();
        var service = new GitHubRepositoryService(new(new HttpClient(fixture)), parser, cache, TimeProvider.System);
        await Assert.ThrowsAsync<WorkspaceException>(() => service.ReadAsync("acme/roadmap", "main", "openspec", "fixture-alice", default));
        fixture.Truncated = false;
        fixture.BranchCount = 101;
        Assert.Equal(101, (await service.BranchesAsync("acme/roadmap", "fixture-alice", default)).Count);
        fixture.RateLimited = true;
        Assert.Equal(429, (await Assert.ThrowsAsync<WorkspaceException>(() => service.BranchesAsync("acme/roadmap", "fixture-alice", default))).Status);
    }

    [Theory]
    [InlineData("../secret")]
    [InlineData("docs/../openspec")]
    [InlineData("/tmp")]
    [InlineData("docs\\openspec")]
    [InlineData("docs//openspec")]
    public void RejectsUnsafeArtifactFolders(string folder) => Assert.Throws<WorkspaceException>(() => GitHubRepositoryService.ArtifactFolder(folder));

    [Fact]
    public void RejectsOversizedArtifactsAndInvalidRepositories()
    {
        Assert.Throws<WorkspaceException>(() => LocalWorkspaceReader.CheckSize(2_000_001, 2_000_001, 1));
        Assert.Throws<WorkspaceException>(() => LocalWorkspaceReader.CheckSize(1, 20_000_001, 1));
        Assert.Throws<WorkspaceException>(() => LocalWorkspaceReader.CheckSize(1, 1, 2001));
        foreach (var name in new[] { "owner/..", "owner/repo/../../secret", "https://internal.example/repo", "owner/repo?token=x" })
            Assert.Throws<WorkspaceException>(() => GitHubRepositoryService.RepositoryName(name));
    }
}
