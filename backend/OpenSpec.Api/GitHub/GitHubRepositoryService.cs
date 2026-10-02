using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using OpenSpec.Api.Workspaces;

namespace OpenSpec.Api.GitHub;

public sealed record RepositoryChoice(string Name, string DefaultBranch);
public sealed class GitHubRepositoryService(GitHubClient github, WorkspaceParser parser, RepositoryCache cache, TimeProvider clock)
{
    public static string RepositoryName(string? input)
    {
        var name = Regex.Replace((input ?? "").Trim(), "^https://github.com/", "", RegexOptions.IgnoreCase).TrimEnd('/');
        if (name.EndsWith(".git", StringComparison.Ordinal)) name = name[..^4];
        if (!Regex.IsMatch(name, @"^[a-z\d][a-z\d-]{0,38}/[a-z\d_.-]{1,100}$", RegexOptions.IgnoreCase) || name.Split('/')[^1] is "." or "..")
            throw new WorkspaceException("Enter a GitHub repository as owner/repository or its GitHub URL.");
        return name;
    }

    public static string ArtifactFolder(string input)
    {
        var folder = input.Trim().TrimEnd('/');
        if (folder.Length is 0 or > 1024 || folder.Contains('\\') || folder.Any(char.IsControl) ||
            folder.Split('/').Length > 20 || folder.Split('/').Any(part => part is "" or "." or ".."))
            throw new WorkspaceException("Enter a repository-relative artifact folder, such as openspec.");
        return folder;
    }

    private async Task<List<JsonElement>> PagesAsync(string endpoint, string? field, string token, CancellationToken cancellationToken)
    {
        List<JsonElement> results = [];
        for (var page = 1; page <= 10; page++)
        {
            var response = await github.GetAsync($"{endpoint}?per_page=100&page={page}", token, cancellationToken);
            var items = (field is null ? response : response.GetProperty(field)).EnumerateArray().ToArray();
            results.AddRange(items);
            if (items.Length < 100) return results;
        }
        throw new WorkspaceException("This selection has more than 1,000 entries. Enter the repository or branch name directly.");
    }

    public async Task<IReadOnlyList<RepositoryChoice>> RepositoriesAsync(string token, CancellationToken cancellationToken)
    {
        var installations = await PagesAsync("/user/installations", "installations", token, cancellationToken);
        List<RepositoryChoice> results = [];
        foreach (var installation in installations)
        {
            var repositories = await PagesAsync($"/user/installations/{installation.GetProperty("id").GetInt64()}/repositories", "repositories", token, cancellationToken);
            results.AddRange(repositories.Select(repo => new RepositoryChoice(repo.Text("full_name"), repo.Text("default_branch"))));
        }
        return results.OrderBy(repo => repo.Name, StringComparer.Ordinal).ToArray();
    }

    public async Task<IReadOnlyList<string>> BranchesAsync(string? repository, string token, CancellationToken cancellationToken) =>
        (await PagesAsync($"/repos/{RepositoryName(repository)}/branches", null, token, cancellationToken)).Select(branch => branch.Text("name")).ToArray();

    public async Task<Workspace> ReadAsync(string? repository, string? reference, string folder, string token, CancellationToken cancellationToken)
    {
        folder = ArtifactFolder(folder);
        var name = RepositoryName(repository);
        var repo = await github.GetAsync($"/repos/{name}", token, cancellationToken);
        var selected = string.IsNullOrWhiteSpace(reference) ? repo.Text("default_branch") : reference.Trim();
        if (selected.Length is 0 or > 256 || selected.Any(char.IsControl)) throw new WorkspaceException("Enter a valid branch or commit.");
        // Always check the viewer's Contents permission before consulting the commit cache.
        var commit = await github.GetAsync($"/repos/{name}/commits/{Uri.EscapeDataString(selected)}", token, cancellationToken);
        var committedAt = commit.GetProperty("commit").GetProperty("committer").OptionalText("date");
        var source = new WorkspaceSource("github", repo.Text("full_name"), selected, commit.Text("sha"),
            committedAt is null ? null : DateTimeOffset.Parse(committedAt, System.Globalization.CultureInfo.InvariantCulture), $"https://github.com/{repo.Text("full_name")}", folder);
        var key = $"{repo.GetProperty("id").GetInt64()}:{source.Commit}:{folder}";
        if (cache.Get(key) is { } cached) return cached with { Source = source, Name = source.Repository, LoadedAt = clock.GetUtcNow() };
        var tree = commit.GetProperty("commit").GetProperty("tree").Text("sha");
        var treeEndpoint = $"/repos/{source.Repository}/git/trees/";
        foreach (var segment in folder.Split('/'))
        {
            var directory = await github.GetAsync(treeEndpoint + Uri.EscapeDataString(tree), token, cancellationToken);
            if (directory.GetProperty("truncated").GetBoolean()) throw new WorkspaceException("GitHub truncated this directory listing. Choose a smaller artifact folder.");
            var entry = directory.GetProperty("tree").EnumerateArray().FirstOrDefault(item => item.Text("path") == segment && item.Text("type") == "tree");
            if (entry.ValueKind == JsonValueKind.Undefined) throw new WorkspaceException($"No {folder} folder found at the selected revision.");
            tree = entry.Text("sha");
        }
        var listing = await github.GetAsync(treeEndpoint + Uri.EscapeDataString(tree) + "?recursive=1", token, cancellationToken);
        var entries = listing.GetProperty("tree");
        if (listing.GetProperty("truncated").GetBoolean() || entries.GetArrayLength() > 10_000)
            throw new WorkspaceException("This artifact folder has too many entries to read completely.");
        List<JsonElement> files = [];
        List<string> warnings = [];
        long declaredBytes = 0;
        foreach (var entry in entries.EnumerateArray())
        {
            var path = entry.Text("path");
            var parts = path.Split('/');
            if (parts.Length > 21) throw new WorkspaceException("This workspace exceeds the supported folder depth (20).");
            if (parts.Any(part => part is "" or "." or "..") || path.Contains('\\') || path.Any(char.IsControl)) throw new WorkspaceException("GitHub returned an invalid artifact path.");
            if (parts.Any(part => part.StartsWith('.') && part != ".openspec.yaml")) continue;
            if (entry.OptionalText("mode") == "120000" || entry.Text("type") == "commit") { warnings.Add($"Skipped linked entry: {path}"); continue; }
            if (entry.Text("type") != "blob" || !LocalWorkspaceReader.IsArtifact(path)) continue;
            var size = entry.GetProperty("size").GetInt64();
            if (size < 0) throw new WorkspaceException("GitHub returned an invalid artifact size.");
            declaredBytes += size;
            LocalWorkspaceReader.CheckSize(size, declaredBytes, files.Count + 1);
            files.Add(entry);
        }
        List<ArtifactFile> contents = [];
        long bytes = 0;
        foreach (var batch in files.Chunk(5))
        {
            var loaded = await Task.WhenAll(batch.Select(async file =>
            {
                var blob = await github.GetAsync($"/repos/{source.Repository}/git/blobs/{Uri.EscapeDataString(file.Text("sha"))}", token, cancellationToken);
                if (blob.Text("encoding") != "base64") throw new WorkspaceException("GitHub returned an unsupported artifact encoding.");
                byte[] decoded;
                try { decoded = Convert.FromBase64String(blob.Text("content")); }
                catch (FormatException) { throw new WorkspaceException("GitHub returned an unreadable artifact.", 502); }
                LocalWorkspaceReader.CheckSize(decoded.LongLength, Interlocked.Add(ref bytes, decoded.LongLength), files.Count);
                return new ArtifactFile(file.Text("path"), Encoding.UTF8.GetString(decoded));
            }));
            contents.AddRange(loaded);
        }
        var workspace = parser.Build(contents, source.Repository, folder, source: source, initialWarnings: warnings);
        cache.Set(key, workspace);
        return workspace;
    }
}
