using Microsoft.Data.Sqlite;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

sealed class PluginStoreOptions
{
  [JsonPropertyName("name")]
  public string Name { get; set; } = "";
  [JsonPropertyName("package")]
  public string Package { get; set; } = "";
  [JsonPropertyName("description")]
  public string? Description { get; set; }
  [JsonPropertyName("enabled")]
  public bool Enabled { get; set; } = true;
  [JsonPropertyName("updatedAt")]
  public string? UpdatedAt { get; set; }
}

sealed class PluginStoreStore(IWebHostEnvironment env)
{
  readonly string dbPath = Path.Combine(env.ContentRootPath, "data", "feedback.db");

  public static string? Validate(string name, PluginStoreOptions config)
  {
    if (string.IsNullOrWhiteSpace(name) || name.Trim().Length > 128)
      return "Store entry names must contain between 1 and 128 characters";
    if (string.IsNullOrWhiteSpace(config.Package) || config.Package.Trim().Length > 256 ||
        !Regex.IsMatch(config.Package.Trim(), @"\A(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*(?:@[a-zA-Z0-9][a-zA-Z0-9.+_-]*)?\z", RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1)))
      return "Use an npm package with an optional version or dist-tag, for example @company/plugin@1.2.3";
    if (config.Description?.Length > 4000) return "Descriptions must not exceed 4000 characters";
    return null;
  }

  async Task<SqliteConnection> OpenAsync()
  {
    Directory.CreateDirectory(Path.GetDirectoryName(dbPath)!);
    var connection = new SqliteConnection($"Data Source={dbPath}");
    await connection.OpenAsync();
    return connection;
  }

  public async Task<List<PluginStoreOptions>> ListAsync(CancellationToken cancellationToken)
  {
    await using var connection = await OpenAsync();
    await using var command = connection.CreateCommand();
    command.CommandText = "SELECT Name, Config, UpdatedAt FROM UpdaterPluginStore WHERE Deleted = 0 ORDER BY Name";
    await using var reader = await command.ExecuteReaderAsync(cancellationToken);
    var items = new List<PluginStoreOptions>();
    while (await reader.ReadAsync(cancellationToken))
    {
      var item = JsonSerializer.Deserialize<PluginStoreOptions>(reader.GetString(1));
      if (item is null) continue;
      item.Name = reader.GetString(0);
      item.UpdatedAt = reader.GetString(2);
      items.Add(item);
    }
    return items;
  }

  public async Task SetAsync(string name, PluginStoreOptions config, CancellationToken cancellationToken)
  {
    config.Name = name.Trim();
    config.Package = config.Package.Trim();
    config.Description = config.Description?.Trim();
    config.UpdatedAt = DateTimeOffset.UtcNow.ToString("O");
    await using var connection = await OpenAsync();
    await using var command = connection.CreateCommand();
    command.CommandText = """
      INSERT INTO UpdaterPluginStore (Name, Config, Deleted, UpdatedAt)
      VALUES ($name, $config, 0, $updatedAt)
      ON CONFLICT(Name) DO UPDATE SET Config = excluded.Config, Deleted = 0, UpdatedAt = excluded.UpdatedAt
      """;
    command.Parameters.AddWithValue("$name", config.Name);
    command.Parameters.AddWithValue("$config", JsonSerializer.Serialize(config));
    command.Parameters.AddWithValue("$updatedAt", config.UpdatedAt);
    await command.ExecuteNonQueryAsync(cancellationToken);
  }

  public async Task DeleteAsync(string name, CancellationToken cancellationToken)
  {
    await using var connection = await OpenAsync();
    await using var command = connection.CreateCommand();
    command.CommandText = """
      INSERT INTO UpdaterPluginStore (Name, Config, Deleted, UpdatedAt)
      VALUES ($name, '{}', 1, $updatedAt)
      ON CONFLICT(Name) DO UPDATE SET Deleted = 1, UpdatedAt = excluded.UpdatedAt
      """;
    command.Parameters.AddWithValue("$name", name.Trim());
    command.Parameters.AddWithValue("$updatedAt", DateTimeOffset.UtcNow.ToString("O"));
    await command.ExecuteNonQueryAsync(cancellationToken);
  }
}
