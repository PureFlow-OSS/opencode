using System.Diagnostics;
using System.Text;
using System.Windows.Forms;

var options = args
  .Chunk(2)
  .Where(chunk => chunk.Length == 2 && chunk[0].StartsWith("--", StringComparison.Ordinal))
  .ToDictionary(chunk => chunk[0][2..], chunk => chunk[1], StringComparer.OrdinalIgnoreCase);

var logPath = options.TryGetValue("log-path", out var logPathValue)
  ? logPathValue
  : Path.Combine(Path.GetTempPath(), $"opencode-installer-{Guid.NewGuid():N}.log");

File.AppendAllText(logPath, $"{DateTimeOffset.Now:O} helper started{Environment.NewLine}", Encoding.UTF8);
var statusThread = new Thread(() =>
{
  MessageBox.Show(
    "OpenCode wurde beendet. Das Update wird jetzt vorbereitet.",
    "OpenCode Updater",
    MessageBoxButtons.OK,
    MessageBoxIcon.Information
  );
});
statusThread.SetApartmentState(ApartmentState.STA);
statusThread.Start();

try
{
  if (!options.TryGetValue("parent-pid", out var parentPidRaw) || !int.TryParse(parentPidRaw, out var parentPid))
    throw new InvalidOperationException("Missing --parent-pid");
  if (!options.TryGetValue("installer-path", out var installerPath) || string.IsNullOrWhiteSpace(installerPath))
    throw new InvalidOperationException("Missing --installer-path");

  var installDir = options.TryGetValue("install-dir", out var installDirValue) ? installDirValue : null;
  var packageFile = options.TryGetValue("package-file", out var packageFileValue) ? packageFileValue : null;

  // This process is about to delete a directory after the app exits. Resolve every path before
  // touching it, require the fixed corporate directory, and prove the installer is outside it.
  const string RequiredInstallDir = @"C:\Entwicklung\OpenCode";
  var installer = Path.GetFullPath(installerPath);
  if (!File.Exists(installer))
    throw new FileNotFoundException("Installer does not exist", installer);

  var installRoot = string.IsNullOrWhiteSpace(installDir) ? null : Path.GetFullPath(installDir);
  if (installRoot is null || !string.Equals(installRoot, RequiredInstallDir, StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException($@"Invalid install directory: {installDir}");
  if (installer.StartsWith(installRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException("Installer must be staged outside the installation directory");

  try
  {
    using var parent = Process.GetProcessById(parentPid);
    while (!parent.HasExited)
    {
      Thread.Sleep(200);
    }
  }
  catch (ArgumentException)
  {
    File.AppendAllText(logPath, $"{DateTimeOffset.Now:O} parent already exited{Environment.NewLine}", Encoding.UTF8);
  }

  Thread.Sleep(750);

  if (Directory.Exists(installRoot))
  {
    File.AppendAllText(logPath, $"{DateTimeOffset.Now:O} cleanup path {installRoot}{Environment.NewLine}", Encoding.UTF8);
    foreach (var entry in Directory.EnumerateFileSystemEntries(installRoot))
    {
      var removed = false;
      for (var attempt = 1; attempt <= 5 && !removed; attempt++)
      {
        try
        {
          File.AppendAllText(logPath, $"{DateTimeOffset.Now:O} removing {entry} attempt {attempt}{Environment.NewLine}", Encoding.UTF8);
          if (Directory.Exists(entry))
          {
            Directory.Delete(entry, true);
          }
          else
          {
            File.Delete(entry);
          }
          removed = true;
        }
        catch (Exception ex)
        {
          File.AppendAllText(logPath, $"{DateTimeOffset.Now:O} remove failed {entry} {ex.Message}{Environment.NewLine}", Encoding.UTF8);
          Thread.Sleep(400);
        }
      }

      if (!removed)
        File.AppendAllText(logPath, $"{DateTimeOffset.Now:O} giving up on {entry}{Environment.NewLine}", Encoding.UTF8);
    }
  }
  else
  {
    File.AppendAllText(logPath, $"{DateTimeOffset.Now:O} cleanup skipped{Environment.NewLine}", Encoding.UTF8);
  }

  var installerArgs = new List<string> { "--updated", "--force-run" };
  if (!string.IsNullOrWhiteSpace(packageFile))
    installerArgs.Add($"--package-file={packageFile}");
  // NSIS only treats /D as a fixed destination when it is the final argument and unquoted.
  installerArgs.Add($"/D={RequiredInstallDir}");

  var startInfo = new ProcessStartInfo
  {
    FileName = installer,
    UseShellExecute = true,
    WorkingDirectory = Path.GetDirectoryName(installerPath) ?? Environment.CurrentDirectory,
    Arguments = string.Join(" ", installerArgs.Select(QuoteArgument)),
  };

  File.AppendAllText(logPath, $"{DateTimeOffset.Now:O} starting installer {installerPath} {startInfo.Arguments}{Environment.NewLine}", Encoding.UTF8);
  if (statusThread.IsAlive)
    statusThread.Join(200);
  Process.Start(startInfo);
  File.AppendAllText(logPath, $"{DateTimeOffset.Now:O} installer start command sent{Environment.NewLine}", Encoding.UTF8);
  return;
}
catch (Exception ex)
{
  File.AppendAllText(logPath, $"{DateTimeOffset.Now:O} helper failed {ex}{Environment.NewLine}", Encoding.UTF8);
  MessageBox.Show(
    $"Der OpenCode-Updater konnte nicht gestartet werden.\n\nLogdatei:\n{logPath}\n\n{ex.Message}",
    "OpenCode Updater",
    MessageBoxButtons.OK,
    MessageBoxIcon.Error
  );
  Environment.ExitCode = 1;
}

static string QuoteArgument(string value)
{
  if (value.Length == 0) return "\"\"";
  if (!value.Any(ch => char.IsWhiteSpace(ch) || ch == '"')) return value;
  return $"\"{value.Replace("\"", "\\\"")}\"";
}
