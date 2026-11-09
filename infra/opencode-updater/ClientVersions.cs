using Microsoft.Data.Sqlite;

sealed record ClientVersionReport(string UserName, string Version, string Channel, string LastSeenAt);

// One latest observation per resolved user; no API keys or device identifiers are stored.
sealed class ClientVersionStore(IWebHostEnvironment environment)
{
  string ConnectionString => $"Data Source={Path.Combine(environment.ContentRootPath, "data", "feedback.db")}";

  public async Task RecordAsync(string userName, string version, UpdaterChannel channel, CancellationToken cancellationToken)
  {
    await using var connection = new SqliteConnection(ConnectionString);
    await connection.OpenAsync(cancellationToken);
    await using var command = connection.CreateCommand();
    // Reporting is optional: do not hold up update checks behind another SQLite writer.
    command.CommandTimeout = 1;
    command.CommandText = """
      INSERT INTO UpdaterClientVersions (UserName, Version, Channel, LastSeenAt)
      VALUES ($user, $version, $channel, $seen)
      ON CONFLICT(UserName) DO UPDATE SET Version = excluded.Version, Channel = excluded.Channel, LastSeenAt = excluded.LastSeenAt;
      """;
    command.Parameters.AddWithValue("$user", userName);
    command.Parameters.AddWithValue("$version", version);
    command.Parameters.AddWithValue("$channel", UpdaterChannelInfo.Name(channel));
    command.Parameters.AddWithValue("$seen", DateTimeOffset.UtcNow.ToString("O"));
    await command.ExecuteNonQueryAsync(cancellationToken);
  }

  public async Task<List<ClientVersionReport>> ListAsync(CancellationToken cancellationToken)
  {
    await using var connection = new SqliteConnection(ConnectionString);
    await connection.OpenAsync(cancellationToken);
    await using var command = connection.CreateCommand();
    command.CommandText = "SELECT UserName, Version, Channel, LastSeenAt FROM UpdaterClientVersions ORDER BY UserName COLLATE NOCASE;";
    await using var reader = await command.ExecuteReaderAsync(cancellationToken);
    var reports = new List<ClientVersionReport>();
    while (await reader.ReadAsync(cancellationToken))
      reports.Add(new(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3)));
    return reports;
  }
}
