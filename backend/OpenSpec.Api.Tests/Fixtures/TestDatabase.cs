using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using OpenSpec.Api.Data;

namespace OpenSpec.Api.Tests.Fixtures;

public sealed class PostgresFactAttribute : FactAttribute
{
    public PostgresFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("TEST_DATABASE_CONNECTION")))
            Skip = "Set TEST_DATABASE_CONNECTION to run PostgreSQL integration tests.";
    }
}

public sealed class TestDatabase : IAsyncDisposable
{
    private readonly string adminConnection;
    private readonly string schema = "test_" + Guid.NewGuid().ToString("N");
    private readonly string directory = Path.Combine(Path.GetTempPath(), "openspec-auth-" + Guid.NewGuid().ToString("N"));
    public string ConnectionString { get; }
    public string CertificatePath => Path.Combine(directory, "test.pfx");
    public DashboardDbContext Open() => new(new DbContextOptionsBuilder<DashboardDbContext>().UseNpgsql(ConnectionString).Options);

    private TestDatabase(string connection)
    {
        adminConnection = connection;
        ConnectionString = new NpgsqlConnectionStringBuilder(connection) { SearchPath = schema, Timeout = 5 }.ConnectionString;
    }

    public static async Task<TestDatabase> CreateAsync()
    {
        var database = new TestDatabase(Environment.GetEnvironmentVariable("TEST_DATABASE_CONNECTION")
            ?? throw new InvalidOperationException("Set TEST_DATABASE_CONNECTION to a disposable PostgreSQL database."));
        await using var admin = new NpgsqlConnection(database.adminConnection);
        await admin.OpenAsync();
        await using var command = new NpgsqlCommand($"CREATE SCHEMA {database.schema}", admin);
        await command.ExecuteNonQueryAsync();
        Directory.CreateDirectory(database.directory);
        using var rsa = RSA.Create(2048);
        var request = new CertificateRequest("CN=OpenSpec Test", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        using var certificate = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-1), DateTimeOffset.UtcNow.AddDays(1));
        await File.WriteAllBytesAsync(database.CertificatePath, certificate.Export(X509ContentType.Pfx));
        await using var db = database.Open();
        await db.Database.MigrateAsync();
        return database;
    }

    public async ValueTask DisposeAsync()
    {
        await using var admin = new NpgsqlConnection(adminConnection);
        await admin.OpenAsync();
        await using var command = new NpgsqlCommand($"DROP SCHEMA {schema} CASCADE", admin);
        await command.ExecuteNonQueryAsync();
        Directory.Delete(directory, true);
    }
}
