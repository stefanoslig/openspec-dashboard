using System.Runtime.InteropServices;
using OpenSpec.Api.Tests.Fixtures;

// Test-only entry point. The production image contains neither this host nor its fixtures.
await using var database = await TestDatabase.CreateAsync();
await using var factory = new TestAppFactory(database, new FakeGitHubHandler(), origin: "http://127.0.0.1:4312");
factory.UseKestrel(4312);
factory.StartServer();
Console.WriteLine("Hosted browser fixture listening on http://127.0.0.1:4312");
using var shutdown = new CancellationTokenSource();
Console.CancelKeyPress += (_, args) => { args.Cancel = true; shutdown.Cancel(); };
using var termination = OperatingSystem.IsWindows() ? null : PosixSignalRegistration.Create(PosixSignal.SIGTERM, context => { context.Cancel = true; shutdown.Cancel(); });
try { await Task.Delay(Timeout.Infinite, shutdown.Token); }
catch (OperationCanceledException) when (shutdown.IsCancellationRequested) { }
