namespace OpenSpec.Api.Workspaces;

public sealed class WorkspaceException(string message, int status = 400) : Exception(message)
{
    public int Status { get; } = status;
}

public sealed record ArtifactFile(string Path, string Content, DateTimeOffset? Modified = null);
public sealed record MarkdownInfo(int Completed, int Total, int Requirements, int Scenarios, string Summary);
public sealed record Artifact(string Path, string Title, string Content, string Format, DateTimeOffset? Modified,
    string Revision, int Completed, int Total, int Requirements, int Scenarios, string Summary);
public sealed record Change(string Id, string Name, string Title, bool Archived, string Schema, string Status,
    int Completed, int Total, string Summary, DateTimeOffset? Modified, IReadOnlyList<string> Documents);
public sealed record Specification(string Path, string Capability, int Requirements, int Scenarios);
public sealed record WorkspaceSource(string Provider, string Repository, string Ref, string Commit, DateTimeOffset? CommittedAt,
    string Url, string Folder = "openspec");
public sealed record Workspace(string Name, string Root, bool IsDemo, string Schema, DateTimeOffset LoadedAt,
    IReadOnlyList<Artifact> Documents, IReadOnlyList<Change> Changes, IReadOnlyList<Specification> Specs,
    IReadOnlyList<string> Warnings, WorkspaceSource? Source = null);
