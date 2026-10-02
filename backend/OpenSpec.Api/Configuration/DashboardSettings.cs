using System.Security.Cryptography.X509Certificates;

namespace OpenSpec.Api.Configuration;

public sealed record DashboardSettings
{
    public bool Hosted { get; init; }
    public Uri? PublicOrigin { get; init; }
    public string ClientId { get; init; } = "";
    public string ClientSecret { get; init; } = "";
    public string AppSlug { get; init; } = "";
    public string ConnectionString { get; init; } = "";
    public string CertificatePath { get; init; } = "";
    public string? CertificatePassword { get; init; }
    public bool SecureCookies => PublicOrigin?.Scheme == "https";

    public static DashboardSettings Load(IConfiguration configuration)
    {
        var mode = configuration["DASHBOARD_MODE"] ?? "local";
        if (mode is not ("local" or "hosted")) throw new InvalidOperationException("DASHBOARD_MODE must be local or hosted.");
        if (mode == "local") return new();
        string Required(string name) => !string.IsNullOrWhiteSpace(configuration[name])
            ? configuration[name]! : throw new InvalidOperationException($"{name} is required in hosted mode.");
        var origin = new Uri(Required("PUBLIC_ORIGIN"), UriKind.Absolute);
        if (origin.GetLeftPart(UriPartial.Authority) != configuration["PUBLIC_ORIGIN"] || origin.UserInfo.Length > 0 ||
            (origin.Scheme != "https" && !(origin.Scheme == "http" && origin.Host is "localhost" or "127.0.0.1")))
            throw new InvalidOperationException("PUBLIC_ORIGIN must be an HTTPS origin without a trailing slash (HTTP is allowed on localhost).");
        var slug = Required("GITHUB_APP_SLUG");
        if (!System.Text.RegularExpressions.Regex.IsMatch(slug, "^[a-zA-Z0-9-]+$"))
            throw new InvalidOperationException("GITHUB_APP_SLUG is invalid.");
        return new()
        {
            Hosted = true,
            PublicOrigin = origin,
            ClientId = Required("GITHUB_CLIENT_ID"),
            ClientSecret = Required("GITHUB_CLIENT_SECRET"),
            AppSlug = slug,
            ConnectionString = Required("ConnectionStrings:Dashboard"),
            CertificatePath = Required("DATA_PROTECTION_CERTIFICATE_PATH"),
            CertificatePassword = configuration["DATA_PROTECTION_CERTIFICATE_PASSWORD"]
        };
    }

    public X509Certificate2 LoadCertificate()
    {
        var flags = OperatingSystem.IsMacOS() ? X509KeyStorageFlags.DefaultKeySet : X509KeyStorageFlags.EphemeralKeySet;
        var certificate = X509CertificateLoader.LoadPkcs12FromFile(CertificatePath, CertificatePassword, flags);
        if (!certificate.HasPrivateKey) throw new InvalidOperationException("The data protection certificate needs its private key.");
        return certificate;
    }
}
