using Microsoft.Extensions.Caching.Memory;
using OpenSpec.Api.Workspaces;

namespace OpenSpec.Api.GitHub;

public sealed class RepositoryCache : IDisposable
{
    private readonly MemoryCache cache = new(new MemoryCacheOptions { SizeLimit = 40_000_000 });
    public Workspace? Get(string key) => cache.Get<Workspace>(key);
    public void Set(string key, Workspace workspace)
    {
        var bytes = System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(workspace).LongLength;
        cache.Set(key, workspace, new MemoryCacheEntryOptions
        {
            Size = Math.Max(2_000_000, bytes),
            AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(15)
        });
    }
    public void Dispose() => cache.Dispose();
}
