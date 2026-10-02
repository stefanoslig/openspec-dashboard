using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace OpenSpec.Api.Data;

// Migration scaffolding does not need GitHub credentials or a running application.
public sealed class DashboardDesignTimeFactory : IDesignTimeDbContextFactory<DashboardDbContext>
{
    public DashboardDbContext CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("ConnectionStrings__Dashboard")
            ?? "Host=localhost;Database=openspec;Username=openspec";
        return new(new DbContextOptionsBuilder<DashboardDbContext>().UseNpgsql(connection).Options);
    }
}
