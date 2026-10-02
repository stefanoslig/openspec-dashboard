using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Markdig;
using Markdig.Syntax;
using Markdig.Syntax.Inlines;
using Markdig.Extensions.TaskLists;
using YamlDotNet.RepresentationModel;

namespace OpenSpec.Api.Workspaces;

public sealed class WorkspaceParser(TimeProvider clock)
{
    private static readonly MarkdownPipeline Pipeline = new MarkdownPipelineBuilder().UseTaskLists().Build();
    private static readonly string[] Order = ["refine.md", "proposal.md", "design.md", "tasks.md"];
    private static readonly Dictionary<string, string> Labels = new()
    {
        ["proposal"] = "Proposal",
        ["design"] = "Design",
        ["tasks"] = "Tasks",
        ["refine"] = "Requirements",
        ["spec"] = "Specification"
    };

    public static string Humanize(string value)
    {
        var words = Regex.Replace(value, @"^\d{4}-\d{2}-\d{2}-", "").Replace('-', ' ').Replace('_', ' ');
        return words.Length == 0 ? words : char.ToUpperInvariant(words[0]) + words[1..];
    }

    public static MarkdownInfo InspectMarkdown(string content)
    {
        var document = Markdown.Parse(content, Pipeline);
        var tasks = document.Descendants<TaskList>().ToArray();
        var headings = document.Descendants<HeadingBlock>().Select(block =>
            string.Concat(block.Inline?.Descendants<LiteralInline>().Select(inline => inline.Content.ToString()) ?? [])).ToArray();
        var paragraph = document.OfType<ParagraphBlock>().FirstOrDefault();
        var summary = paragraph is null ? "" : content.Substring(paragraph.Span.Start, paragraph.Span.Length);
        summary = summary.Replace("*", "").Replace("`", "");
        return new(tasks.Count(task => task.Checked), tasks.Length,
            headings.Count(text => text.StartsWith("Requirement:", StringComparison.OrdinalIgnoreCase)),
            headings.Count(text => text.StartsWith("Scenario:", StringComparison.OrdinalIgnoreCase)), summary[..Math.Min(summary.Length, 240)]);
    }

    private static Dictionary<string, string?> Configuration(string content)
    {
        var yaml = new YamlStream();
        yaml.Load(new StringReader(content));
        if (yaml.Documents.Count == 0 || yaml.Documents[0].RootNode is not YamlMappingNode mapping) return [];
        return mapping.Children.Where(pair => pair.Key is YamlScalarNode)
            .ToDictionary(pair => ((YamlScalarNode)pair.Key).Value ?? "", pair => (pair.Value as YamlScalarNode)?.Value);
    }

    public Workspace Build(IEnumerable<ArtifactFile> files, string name, string root, bool isDemo = false,
        WorkspaceSource? source = null, IEnumerable<string>? initialWarnings = null)
    {
        var warnings = initialWarnings?.ToList() ?? [];
        var documents = files.Select(file =>
        {
            var markdown = file.Path.EndsWith(".md", StringComparison.OrdinalIgnoreCase);
            var filename = Path.GetFileNameWithoutExtension(file.Path);
            var info = InspectMarkdown(markdown ? file.Content : "");
            return new Artifact(file.Path, Labels.GetValueOrDefault(filename) ?? Humanize(filename), file.Content,
                markdown ? "markdown" : "yaml", file.Modified, Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(file.Content))),
                info.Completed, info.Total, info.Requirements, info.Scenarios, info.Summary);
        }).OrderBy(doc => doc.Path, StringComparer.Ordinal).ToArray();
        Dictionary<string, string?> configuration = [];
        try { configuration = Configuration(documents.FirstOrDefault(doc => Regex.IsMatch(doc.Path, @"^config\.ya?ml$"))?.Content ?? ""); }
        catch (YamlDotNet.Core.YamlException) { warnings.Add("config.yaml could not be parsed. Its source is still available in Artifacts."); }
        if (configuration.ContainsKey("store")) warnings.Add("This project declares an external OpenSpec store. Connect to that store repository to read its artifacts; store registration is not resolved automatically.");
        var schema = configuration.GetValueOrDefault("schema") ?? "spec-driven";
        var changes = documents.Select(doc => (Document: doc, Parts: doc.Path.Split('/')))
            .Where(item => item.Parts.Length >= 3 && item.Parts[0] == "changes" && item.Parts.Length >= (item.Parts[1] == "archive" ? 4 : 3))
            .GroupBy(item => string.Join('/', item.Parts.Take(item.Parts[1] == "archive" ? 3 : 2)))
            .Select(group =>
            {
                var id = group.Key;
                var changeName = id.Split('/')[^1];
                var docs = group.Select(item => item.Document).ToArray();
                var tasks = docs.FirstOrDefault(doc => doc.Path == $"{id}/tasks.md");
                var proposal = docs.FirstOrDefault(doc => doc.Path == $"{id}/proposal.md");
                var changeSchema = schema;
                try { changeSchema = Configuration(docs.FirstOrDefault(doc => doc.Path == $"{id}/.openspec.yaml")?.Content ?? "").GetValueOrDefault("schema") ?? schema; }
                catch (YamlDotNet.Core.YamlException) { warnings.Add($"Invalid metadata in {changeName}."); }
                var total = tasks?.Total ?? 0;
                var completed = tasks?.Completed ?? 0;
                var status = total == 0 ? "Draft" : completed == total ? "Complete" : completed > 0 ? "In progress" : "Planned";
                return new Change(id, changeName, Humanize(changeName), id.StartsWith("changes/archive/", StringComparison.Ordinal), changeSchema,
                    status, completed, total, proposal?.Summary ?? "Open this change to explore its artifacts.", docs.Max(doc => doc.Modified),
                    docs.OrderBy(doc => { var rank = Array.IndexOf(Order, doc.Path[(id.Length + 1)..]); return rank < 0 ? 10 : rank; })
                        .ThenBy(doc => doc.Path, StringComparer.Ordinal).Select(doc => doc.Path).ToArray());
            }).OrderByDescending(change => change.Modified).ThenBy(change => change.Id, StringComparer.Ordinal).ToArray();
        var specs = documents.Where(doc => doc.Path.StartsWith("specs/", StringComparison.Ordinal) && doc.Path.EndsWith("/spec.md", StringComparison.Ordinal))
            .Select(doc => new Specification(doc.Path, doc.Path[6..^8], doc.Requirements, doc.Scenarios)).ToArray();
        return new(name, root, isDemo, schema, clock.GetUtcNow(), documents, changes, specs, warnings, source);
    }
}
