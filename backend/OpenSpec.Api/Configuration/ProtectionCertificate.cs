using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace OpenSpec.Api.Configuration;

public static class ProtectionCertificate
{
    public static async Task CreateAsync(string path)
    {
        path = Path.GetFullPath(path);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        using var rsa = RSA.Create(3072);
        var request = new CertificateRequest("CN=OpenSpec Data Protection", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        using var certificate = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-1), DateTimeOffset.UtcNow.AddYears(5));
        var options = new FileStreamOptions { Mode = FileMode.CreateNew, Access = FileAccess.Write, Share = FileShare.None };
        if (!OperatingSystem.IsWindows()) options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
        await using var file = new FileStream(path, options);
        await file.WriteAsync(certificate.Export(X509ContentType.Pfx, Environment.GetEnvironmentVariable("DATA_PROTECTION_CERTIFICATE_PASSWORD")));
        Console.WriteLine($"Data protection certificate created: {path}");
    }
}
