using System.Text;

namespace OpenSpec.Api.Workspaces;

public sealed class LocalWorkspaceReader(WorkspaceParser parser)
{
    public async Task<Workspace> ReadAsync(string input, bool isDemo, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(input)) throw new WorkspaceException("Enter the path to a repository or its openspec folder.");
        input = input.Trim();
        if (input == "~" || input.StartsWith("~/", StringComparison.Ordinal)) input = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) + input[1..];
        if (!Path.IsPathFullyQualified(input)) throw new WorkspaceException("Use an absolute folder path, such as ~/Projects/my-app.");
        if (!Directory.Exists(input)) throw new WorkspaceException("That folder could not be opened. Check the path and its permissions.");
        var selected = CanonicalPath(input);
        var root = Path.GetFileName(selected) == "openspec" ? selected : Path.Combine(selected, "openspec");
        if (!Directory.Exists(root)) throw new WorkspaceException("No openspec folder found. Select a repository containing openspec/, or openspec/ itself.");
        root = CanonicalPath(root);
        var files = new List<ArtifactFile>();
        var warnings = new List<string>();
        long bytes = 0;
        var entries = 0;
        async Task Walk(string directory, int depth)
        {
            if (depth > 20) throw new WorkspaceException("This workspace exceeds the supported folder depth (20).");
            foreach (var entry in new DirectoryInfo(directory).EnumerateFileSystemInfos())
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (++entries > 10_000) throw new WorkspaceException("This openspec folder contains too many entries (maximum 10,000).");
                var relative = Path.GetRelativePath(root, entry.FullName).Replace(Path.DirectorySeparatorChar, '/');
                if (entry.Attributes.HasFlag(FileAttributes.ReparsePoint)) { warnings.Add($"Skipped symbolic link: {relative}"); continue; }
                if (entry.Name.StartsWith('.') && entry.Name != ".openspec.yaml") continue;
                if (entry is DirectoryInfo) { await Walk(entry.FullName, depth + 1); continue; }
                if (entry is not FileInfo file || !IsArtifact(file.Name)) continue;
                CheckSize(file.Length, bytes + file.Length, files.Count + 1);
                var canonical = CanonicalPath(file.FullName);
                if (!canonical.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal)) { warnings.Add($"Skipped file outside openspec: {relative}"); continue; }
                // Cap the actual read as well: a file may grow after its metadata was read.
                await using var stream = File.OpenRead(canonical);
                using var buffer = new MemoryStream();
                var chunk = new byte[16_384];
                int count;
                while ((count = await stream.ReadAsync(chunk, cancellationToken)) > 0)
                {
                    CheckSize(buffer.Length + count, bytes + buffer.Length + count, files.Count + 1);
                    buffer.Write(chunk, 0, count);
                }
                bytes += buffer.Length;
                files.Add(new(relative, Encoding.UTF8.GetString(buffer.ToArray()), new DateTimeOffset(file.LastWriteTimeUtc)));
            }
        }
        try { await Walk(root, 0); }
        catch (IOException) { throw new WorkspaceException("That folder could not be read. Check the path and its permissions."); }
        catch (UnauthorizedAccessException) { throw new WorkspaceException("That folder could not be read. Check the path and its permissions."); }
        return parser.Build(files, isDemo ? "Atlas" : Path.GetFileName(Path.GetDirectoryName(root))!, root, isDemo, initialWarnings: warnings);
    }

    internal static string CanonicalPath(string path)
    {
        var absolute = Path.GetFullPath(path);
        var current = Path.GetPathRoot(absolute)!;
        foreach (var part in absolute[current.Length..].Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, part);
            FileSystemInfo info = Directory.Exists(current) ? new DirectoryInfo(current) : new FileInfo(current);
            if (info.LinkTarget is not null) current = info.ResolveLinkTarget(true)!.FullName;
        }
        return Path.TrimEndingDirectorySeparator(current);
    }

    public static bool IsArtifact(string name) => Path.GetExtension(name).ToLowerInvariant() is ".md" or ".yaml" or ".yml";
    public static void CheckSize(long fileBytes, long totalBytes, int count)
    {
        if (fileBytes > 2_000_000 || totalBytes > 20_000_000 || count > 2000)
            throw new WorkspaceException("Workspace too large: maximum 2 MB per artifact, 20 MB total, and 2,000 artifacts.");
    }
}
