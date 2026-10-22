sealed class FeedOperationGate
{
  readonly SemaphoreSlim gate = new(1, 1);

  public async Task<IDisposable> EnterAsync(CancellationToken cancellationToken)
  {
    await gate.WaitAsync(cancellationToken);
    return new Lease(gate);
  }

  sealed class Lease(SemaphoreSlim gate) : IDisposable
  {
    public void Dispose() => gate.Release();
  }
}

static class FeedPublication
{
  public static async Task<T> PublishAsync<T>(string staging, string target, Func<Task<T>> save)
  {
    var backup = target + ".rollback-" + Guid.NewGuid().ToString("N");
    if (Directory.Exists(target)) Directory.Move(target, backup);
    T result;
    try
    {
      Directory.Move(staging, target);
      result = await save();
    }
    catch
    {
      if (Directory.Exists(target)) Directory.Delete(target, true);
      if (Directory.Exists(backup)) Directory.Move(backup, target);
      throw;
    }

    // Publication has committed. An old backup must not turn success into a retry.
    try
    {
      if (Directory.Exists(backup)) Directory.Delete(backup, true);
    }
    catch (IOException error) { Console.Error.WriteLine($"Release backup retained: {error.Message}"); }
    catch (UnauthorizedAccessException error) { Console.Error.WriteLine($"Release backup retained: {error.Message}"); }
    return result;
  }

  public static void Copy(string source, string target, bool excludeArchives = false)
  {
    Directory.CreateDirectory(target);
    foreach (var file in Directory.EnumerateFiles(source))
      File.Copy(file, Path.Combine(target, Path.GetFileName(file)), true);
    foreach (var directory in Directory.EnumerateDirectories(source))
    {
      if (excludeArchives && Path.GetFileName(directory) == "_archives") continue;
      Copy(directory, Path.Combine(target, Path.GetFileName(directory)), excludeArchives);
    }
  }

  public static void MigrateLegacy(IWebHostEnvironment env)
  {
    var legacy = Path.Combine(env.ContentRootPath, "feed");
    var durable = Path.Combine(env.ContentRootPath, "data", "feed");
    Directory.CreateDirectory(durable);
    foreach (var channel in new[] { "beta", "ai-gilde", "normal" })
    {
      var source = channel == "normal" ? legacy : Path.Combine(legacy, channel);
      var target = Path.Combine(durable, channel);
      if (!Directory.Exists(source) || Directory.Exists(target)) continue;
      var staging = target + ".migration-" + Guid.NewGuid().ToString("N");
      if (channel != "normal") Copy(source, staging);
      else
      {
        Directory.CreateDirectory(staging);
        foreach (var file in Directory.EnumerateFiles(source))
          File.Copy(file, Path.Combine(staging, Path.GetFileName(file)));
        foreach (var directory in Directory.EnumerateDirectories(source))
        {
          if (Path.GetFileName(directory) is "beta" or "ai-gilde") continue;
          Copy(directory, Path.Combine(staging, Path.GetFileName(directory)));
        }
      }
      Directory.Move(staging, target);
    }
  }
}

sealed record ChannelStatus(string Channel, string? Version, ReleaseRecord? Release, bool Stopped, bool FilesAvailable);
