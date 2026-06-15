using Microsoft.Extensions.Options;
using Microsoft.Extensions.Configuration;
using System.Text.Json.Serialization;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Sqlite;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;
using Microsoft.Data.Sqlite;
using System.Data.Common;
using System.Data;

var builder = WebApplication.CreateBuilder(args);
var betaConfiguration = new ConfigurationBuilder()
  .SetBasePath(builder.Environment.ContentRootPath)
  .AddJsonFile("appsettings.beta.json", optional: true, reloadOnChange: true)
  .Build();

builder.Services.Configure<UpdaterOptions>(builder.Configuration.GetSection("Updater"));
builder.Services.Configure<UpdaterOptions>("beta", betaConfiguration.GetSection("Updater"));
builder.Services.Configure<UpdaterBetaOptions>(betaConfiguration.GetSection("UpdaterBeta"));
builder.Services.AddHttpClient();
builder.Services.AddMemoryCache();
builder.Services.AddCors((options) =>
{
  options.AddDefaultPolicy((policy) => policy
    .AllowAnyOrigin()
    .AllowAnyHeader()
    .AllowAnyMethod());
});
builder.Services.AddSingleton(new LocalFeed(Path.Combine(builder.Environment.ContentRootPath, "feed")));
builder.Services.AddSingleton<UpdaterVersionResolver>();
builder.Services.AddSingleton<UpdaterRolloutResolver>();
builder.Services.AddDbContext<FeedbackContext>(options =>
{
  var dataDir = Path.Combine(builder.Environment.ContentRootPath, "data");
  Directory.CreateDirectory(dataDir);
  options.UseSqlite($"Data Source={Path.Combine(dataDir, "feedback.db")}");
});
builder.Services.AddSingleton<FeedbackKeyResolver>();
builder.Services.AddSingleton<UpdaterAdminStore>();
builder.Services.ConfigureHttpJsonOptions(options =>
{
  options.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
});

var app = builder.Build();

app.UseCors();

using (var scope = app.Services.CreateScope())
{
  var db = scope.ServiceProvider.GetRequiredService<FeedbackContext>();
  db.Database.EnsureCreated();
  if (!await HasColumnAsync(db.Database, "Feedbacks", "AttachmentsJson"))
    db.Database.ExecuteSqlRaw(@"ALTER TABLE ""Feedbacks"" ADD COLUMN ""AttachmentsJson"" TEXT NULL");
  await EnsureAdminTablesAsync(db.Database.GetDbConnection(), scope.ServiceProvider.GetRequiredService<IWebHostEnvironment>());
}

app.MapGet("/opencode/admin", () => Results.Redirect("/opencode/admin/"));

app.MapGet("/opencode/admin/", () =>
{
  var root = Path.Combine(app.Environment.ContentRootPath, "admin-ui", "dist", "admin-ui");
  var index = Path.Combine(root, "index.html");
  return File.Exists(index) ? Results.File(index, "text/html; charset=utf-8") : Results.NotFound();
});

app.MapPost("/opencode/feedback", async (
  HttpRequest request,
  FeedbackContext db,
  FeedbackKeyResolver keyResolver,
  IOptions<UpdaterBetaOptions> betaOptions,
  IHttpClientFactory clientFactory
) =>
{
  var body = await JsonSerializer.DeserializeAsync<FeedbackRequest>(
    request.Body,
    new JsonSerializerOptions { PropertyNameCaseInsensitive = true },
    request.HttpContext.RequestAborted
  );

  if (body is null || string.IsNullOrWhiteSpace(body.Text))
    return Results.BadRequest(new { error = "Feedback text is required" });

  var key = body.Key ?? request.Headers["X-OpenCode-AiFactory-Api-Key"].FirstOrDefault()?.Trim();
  var userName = string.Empty;

  if (!string.IsNullOrWhiteSpace(key))
  {
    userName = await keyResolver.ResolveUserNameAsync(key, betaOptions.Value, clientFactory, request.HttpContext.RequestAborted);
  }

  var entry = new FeedbackEntry
  {
    Text = body.Text!.Trim(),
    Category = body.Category?.Trim() ?? "general",
    UserName = userName,
    AppVersion = body.AppVersion?.Trim(),
    Platform = body.Platform?.Trim(),
    AttachmentsJson = body.Attachments is { Length: > 0 } ? JsonSerializer.Serialize(body.Attachments) : null,
    CreatedAt = DateTimeOffset.UtcNow,
  };

  db.Feedbacks.Add(entry);
  await db.SaveChangesAsync(request.HttpContext.RequestAborted);

  return Results.Ok(new { id = entry.Id });
});

app.MapGet("/opencode/feedback", async (FeedbackContext db) =>
{
  var items = await db.Feedbacks
    .OrderByDescending(f => f.CreatedAt)
    .Select(f => new
    {
      id = f.Id,
      text = f.Text,
      category = f.Category,
      user_name = f.UserName,
      app_version = f.AppVersion,
      platform = f.Platform,
      attachments = f.AttachmentsJson,
      created_at = f.CreatedAt,
    })
    .ToListAsync();

  return Results.Json(items);
});

app.MapGet("/opencode/admin/releases", async (UpdaterAdminStore store) => Results.Json(await store.ListReleasesAsync()));

app.MapPost("/opencode/admin/releases/upload", async (
  HttpRequest request,
  UpdaterAdminStore store
) =>
{
  if (!request.HasFormContentType)
    return Results.BadRequest(new { error = "Multipart form data is required" });

  var form = await request.ReadFormAsync(request.HttpContext.RequestAborted);
  var file = form.Files.GetFile("archive");
  if (file is null)
    return Results.BadRequest(new { error = "ZIP archive is required" });

  var version = form["version"].ToString().Trim();
  if (string.IsNullOrWhiteSpace(version))
    return Results.BadRequest(new { error = "Version is required" });

  var release = await store.UploadReleaseAsync(new UploadReleaseRequest(
    version,
    file.FileName,
    await ComputeSha256Async(file, request.HttpContext.RequestAborted),
    file.Length,
    form["notes"].ToString()
  ));
  return Results.Ok(release);
});

app.MapPost("/opencode/admin/releases/{id}/promote", async (
  string id,
  UpdaterAdminStore store,
  HttpRequest request
) =>
{
  var promoted = await store.PromoteReleaseAsync(id, request.HttpContext.RequestAborted);
  return promoted is null ? Results.NotFound() : Results.Ok(promoted);
});

app.MapGet("/opencode/admin/feedback", async (UpdaterAdminStore store) => Results.Json(await store.ListFeedbackAsync()));

app.MapPost("/opencode/admin/feedback", async (
  HttpRequest request,
  UpdaterAdminStore store
) =>
{
  var body = await JsonSerializer.DeserializeAsync<CreateFeedbackRequest>(
    request.Body,
    new JsonSerializerOptions { PropertyNameCaseInsensitive = true },
    request.HttpContext.RequestAborted
  );

  if (body is null || string.IsNullOrWhiteSpace(body.Message))
    return Results.BadRequest(new { error = "Message is required" });

  var feedback = await store.CreateFeedbackAsync(body);
  return Results.Ok(feedback);
});

app.MapGet("/opencode/admin/audit", async (UpdaterAdminStore store) => Results.Json(await store.ListAuditAsync()));

app.MapGet("/", () => Results.Redirect("/opencode/version"));

app.MapGet("/opencode/version", async (HttpRequest request, UpdaterRolloutResolver rolloutResolver) =>
{
  var rollout = await rolloutResolver.ResolveAsync(request, request.HttpContext.RequestAborted);
  return Results.Text(rollout.Version, "text/plain");
});

app.MapGet("/opencode/url", async (HttpRequest request, UpdaterRolloutResolver rolloutResolver) =>
{
  var rollout = await rolloutResolver.ResolveAsync(request, request.HttpContext.RequestAborted);
  return Results.Text(BuildFeedUrl(rollout, request), "text/plain");
});

app.MapGet("/opencode/config", async (HttpRequest request, UpdaterRolloutResolver rolloutResolver) =>
{
  var rollout = await rolloutResolver.ResolveAsync(request, request.HttpContext.RequestAborted);
  return Results.Json(new
  {
    version = rollout.Version,
    url = BuildFeedUrl(rollout, request),
    motd = rollout.Options.Motd,
  });
});

app.MapGet("/opencode/latest.json", async (HttpContext context, LocalFeed feed, UpdaterRolloutResolver rolloutResolver) =>
{
  var rollout = await rolloutResolver.ResolveAsync(context.Request, context.RequestAborted);
  if (feed.TryGet("latest.json", rollout.IsBeta, out var local)) return await LocalFileAsync(context, local);
  return Results.NotFound();
});

app.MapGet("/opencode/changelog.md", async (HttpContext context, LocalFeed feed, UpdaterRolloutResolver rolloutResolver) =>
{
  var rollout = await rolloutResolver.ResolveAsync(context.Request, context.RequestAborted);
  if (feed.TryGet("changelog.md", rollout.IsBeta, out var local)) return await LocalFileAsync(context, local);
  return Results.NotFound();
});

app.MapGet("/opencode/provider-config.json", async (HttpRequest request, UpdaterRolloutResolver rolloutResolver) =>
{
  var rollout = await rolloutResolver.ResolveAsync(request, request.HttpContext.RequestAborted);
  return Results.Json(rollout.Options.ProviderConfig);
});

app.MapGet("/opencode/feed/{**asset}", async (HttpContext context, LocalFeed feed, UpdaterRolloutResolver rolloutResolver, string? asset) =>
{
  var rollout = await rolloutResolver.ResolveAsync(context.Request, context.RequestAborted);
  var resolvedAsset = (asset ?? "").TrimStart('/');
  if (string.IsNullOrWhiteSpace(resolvedAsset) || resolvedAsset.Contains("..", StringComparison.Ordinal))
    return Results.BadRequest();

  if (feed.TryGet(resolvedAsset, rollout.IsBeta, out var local)) return await LocalFileAsync(context, local);
  return Results.NotFound();
});

app.Run();

static string GetPublicBaseUrl(UpdaterOptions options, HttpRequest request)
{
  if (!string.IsNullOrWhiteSpace(options.PublicBaseUrl)) return options.PublicBaseUrl;
  return $"{request.Scheme}://{request.Host}{request.PathBase}";
}

static string BuildFeedUrl(UpdaterRollout rollout, HttpRequest request)
{
  var baseUrl = $"{GetPublicBaseUrl(rollout.Options, request).TrimEnd('/')}/opencode/feed";
  return rollout.IsBeta && !string.IsNullOrWhiteSpace(rollout.BetaToken) ? $"{baseUrl}?beta={rollout.BetaToken}" : baseUrl;
}


static async Task<IResult> LocalFileAsync(HttpContext context, string path)
{
  var extension = Path.GetExtension(path).ToLowerInvariant();
  context.Response.StatusCode = StatusCodes.Status200OK;
  context.Response.ContentType = extension switch
  {
    ".yml" => "text/yaml; charset=utf-8",
    ".json" => "application/json; charset=utf-8",
    ".md" => "text/markdown; charset=utf-8",
    ".blockmap" => "application/octet-stream",
    ".exe" => "application/octet-stream",
    _ => "application/octet-stream",
  };
  context.Response.ContentLength = new FileInfo(path).Length;

  await using var stream = File.OpenRead(path);
  await stream.CopyToAsync(context.Response.Body, context.RequestAborted);

  return Results.Empty;
}

static async Task<string> ComputeSha256Async(IFormFile file, CancellationToken cancellationToken)
{
  await using var stream = file.OpenReadStream();
  var hash = await System.Security.Cryptography.SHA256.HashDataAsync(stream, cancellationToken);
  return Convert.ToHexString(hash).ToLowerInvariant();
}

static async Task EnsureAdminTablesAsync(DbConnection connection, IWebHostEnvironment env)
{
  Directory.CreateDirectory(Path.Combine(env.ContentRootPath, "data"));
  if (connection.State != ConnectionState.Open) await connection.OpenAsync();
  await using var command = connection.CreateCommand();
  command.CommandText = """
    CREATE TABLE IF NOT EXISTS UpdaterReleases (
      Id TEXT PRIMARY KEY NOT NULL,
      Version TEXT NOT NULL,
      Channel TEXT NOT NULL,
      ZipName TEXT NOT NULL,
      ZipSha256 TEXT NOT NULL,
      ZipSize INTEGER NOT NULL,
      Notes TEXT NULL,
      Promoted INTEGER NOT NULL DEFAULT 0,
      PositiveCount INTEGER NOT NULL DEFAULT 0,
      TotalCount INTEGER NOT NULL DEFAULT 0,
      CreatedAt TEXT NOT NULL,
      PromotedAt TEXT NULL
    );

    CREATE TABLE IF NOT EXISTS UpdaterFeedback (
      Id TEXT PRIMARY KEY NOT NULL,
      Channel TEXT NOT NULL,
      ReleaseId TEXT NULL,
      UserName TEXT NULL,
      UserEmail TEXT NULL,
      Rating TEXT NOT NULL,
      Message TEXT NOT NULL,
      CreatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS UpdaterAudit (
      Id TEXT PRIMARY KEY NOT NULL,
      FeedbackId TEXT NOT NULL,
      Actor TEXT NOT NULL,
      Action TEXT NOT NULL,
      Details TEXT NOT NULL,
      CreatedAt TEXT NOT NULL
    );
    """;
  await command.ExecuteNonQueryAsync();
}

static async Task<bool> HasColumnAsync(Microsoft.EntityFrameworkCore.Infrastructure.DatabaseFacade database, string table, string column)
{
  await database.OpenConnectionAsync();
  await using var command = database.GetDbConnection().CreateCommand();
  command.CommandText = $"PRAGMA table_info(\"{table}\")";
  await using var reader = await command.ExecuteReaderAsync();
  while (await reader.ReadAsync())
  {
    if (!reader.IsDBNull(1) && string.Equals(reader.GetString(1), column, StringComparison.OrdinalIgnoreCase))
      return true;
  }

  return false;
}

sealed class UpdaterOptions
{
  public string Version { get; set; } = "1.14.35";
  public string PublicBaseUrl { get; set; } = "http://10.53.7.23";
  public MotdOptions Motd { get; set; } = new();
  public ProviderConfigOptions ProviderConfig { get; set; } = new();
}

sealed class UpdaterBetaOptions
{
  public bool Enabled { get; set; }
  public string HeaderName { get; set; } = "X-OpenCode-AiFactory-Api-Key";
  public string[] Groups { get; set; } = [];
  public string[] Users { get; set; } = [];
  public LiteLLMBetaOptions LiteLLM { get; set; } = new();
}

sealed class LiteLLMBetaOptions
{
  public string BaseUrl { get; set; } = "";
  public string KeyInfoPath { get; set; } = "/key/info";
  public string ApiKey { get; set; } = "";
}

sealed record UpdaterRollout(UpdaterOptions Options, string Version, bool IsBeta, string? BetaToken = null);

sealed class MotdOptions
{
  [JsonPropertyName("text")]
  public string Text { get; set; } = "RRZ AI Factory";

  [JsonPropertyName("enabled")]
  public bool Enabled { get; set; } = true;
}

sealed class ProviderConfigOptions
{
  [JsonPropertyName("model")]
  public string? Model { get; set; }

  [ConfigurationKeyName("small_model")]
  [JsonPropertyName("small_model")]
  public string? SmallModel { get; set; }

  [JsonPropertyName("aifactory")]
  public AiFactoryConfigOptions AiFactory { get; set; } = new();

  [JsonPropertyName("mcp")]
  public Dictionary<string, McpConfigOptions> Mcp { get; set; } = [];
}

sealed class AiFactoryConfigOptions
{
  [ConfigurationKeyName("model_limits")]
  [JsonPropertyName("model_limits")]
  public List<ModelLimitRuleOptions> ModelLimits { get; set; } = [];

  [ConfigurationKeyName("model_visibility")]
  [JsonPropertyName("model_visibility")]
  public List<ModelVisibilityRuleOptions> ModelVisibility { get; set; } = [];
}

sealed class ModelLimitRuleOptions
{
  [JsonPropertyName("pattern")]
  public string Pattern { get; set; } = "*";

  [JsonPropertyName("context")]
  public int? Context { get; set; }

  [JsonPropertyName("output")]
  public int? Output { get; set; }

  [JsonPropertyName("temperature")]
  public bool? Temperature { get; set; }

  [JsonPropertyName("reasoning")]
  public bool? Reasoning { get; set; }

  [JsonPropertyName("modalities")]
  public ModalitiesOptions? Modalities { get; set; }
}

sealed class ModelVisibilityRuleOptions
{
  [JsonPropertyName("pattern")]
  public string Pattern { get; set; } = "*";

  [JsonPropertyName("visible")]
  public bool? Visible { get; set; }
}

sealed class ModalitiesOptions
{
  [JsonPropertyName("input")]
  public string[]? Input { get; set; }

  [JsonPropertyName("output")]
  public string[]? Output { get; set; }
}

sealed class McpConfigOptions
{
  [JsonPropertyName("type")]
  public string Type { get; set; } = "";

  [JsonPropertyName("enabled")]
  public bool? Enabled { get; set; }

  [JsonPropertyName("timeout")]
  public int? Timeout { get; set; }

  [JsonPropertyName("environment")]
  public Dictionary<string, string>? Environment { get; set; }

  [JsonPropertyName("command")]
  public string[]? Command { get; set; }

  [JsonPropertyName("url")]
  public string? Url { get; set; }

  [JsonPropertyName("headers")]
  public Dictionary<string, string>? Headers { get; set; }

  [JsonPropertyName("oauth")]
  public McpOAuthConfigOptions? OAuth { get; set; }

  [JsonPropertyName("auth")]
  public McpManagedAuthOptions? Auth { get; set; }
}

sealed class McpOAuthConfigOptions
{
  [JsonPropertyName("clientId")]
  public string? ClientId { get; set; }

  [JsonPropertyName("clientSecret")]
  public string? ClientSecret { get; set; }

  [JsonPropertyName("scope")]
  public string? Scope { get; set; }

  [JsonPropertyName("redirectUri")]
  public string? RedirectUri { get; set; }
}

sealed class McpManagedAuthOptions
{
  [JsonPropertyName("type")]
  public string Type { get; set; } = "";

  [JsonPropertyName("label")]
  public string? Label { get; set; }

  [JsonPropertyName("description")]
  public string? Description { get; set; }

  [JsonPropertyName("placeholder")]
  public string? Placeholder { get; set; }

  [JsonPropertyName("header")]
  public string? Header { get; set; }

  [JsonPropertyName("prefix")]
  public string? Prefix { get; set; }
}

sealed class LocalFeed(string root)
{
  public bool TryGet(string relativePath, bool beta, out string file)
  {
    file = Path.Combine(
      beta ? Path.Combine(root, "beta") : root,
      relativePath.Replace('/', Path.DirectorySeparatorChar)
    );
    return File.Exists(file);
  }

  public string? TryReadVersionFromLatestYml(bool beta)
  {
    var path = Path.Combine(beta ? Path.Combine(root, "beta") : root, "latest.yml");
    if (!File.Exists(path)) return null;

    var version = File
      .ReadLines(path)
      .Select((line) => line.Trim())
      .FirstOrDefault((line) => line.StartsWith("version:", StringComparison.OrdinalIgnoreCase));

    if (string.IsNullOrWhiteSpace(version)) return null;

    var value = version["version:".Length..].Trim().Trim('"');
    return string.IsNullOrWhiteSpace(value) ? null : value;
  }
}

sealed class UpdaterVersionResolver(IOptions<UpdaterOptions> options, LocalFeed feed)
{
  public string Resolve(bool beta = false)
  {
    return feed.TryReadVersionFromLatestYml(beta) ?? options.Value.Version.Trim();
  }
}

sealed class UpdaterRolloutResolver(
  IOptionsMonitor<UpdaterOptions> options,
  IOptions<UpdaterBetaOptions> betaOptions,
  UpdaterVersionResolver versionResolver,
  LocalFeed feed,
  IHttpClientFactory clientFactory,
  IMemoryCache cache
)
{
  public async Task<UpdaterRollout> ResolveAsync(HttpRequest request, CancellationToken cancellationToken)
  {
    if (request.Query.TryGetValue("beta", out var queryBeta))
    {
      var token = queryBeta.FirstOrDefault()?.Trim();
      if (!string.IsNullOrWhiteSpace(token) && cache.TryGetValue($"beta:{token}", out bool cached) && cached)
        return CreateRollout(options.Get("beta"), true, token);
    }

    var beta = betaOptions.Value;
    if (!beta.Enabled || !HasBetaRules(beta)) return CreateRollout(options.CurrentValue, false, null);
    if (string.IsNullOrWhiteSpace(beta.LiteLLM.BaseUrl)) return CreateRollout(options.CurrentValue, false, null);

    var key = request.Headers[beta.HeaderName].FirstOrDefault()?.Trim();
    if (string.IsNullOrWhiteSpace(key)) return CreateRollout(options.CurrentValue, false, null);
    var tokenHash = ComputeHash(key);
    if (!await IsBetaMemberAsync(key, beta, cancellationToken)) return CreateRollout(options.CurrentValue, false, null);
    return CreateRollout(options.Get("beta"), true, tokenHash);
  }

  UpdaterRollout CreateRollout(UpdaterOptions resolved, bool isBeta, string? betaToken)
  {
    var fallback = options.CurrentValue;
    var localVersion = feed.TryReadVersionFromLatestYml(isBeta);
    var version = localVersion ??
      (isBeta
        ? (string.IsNullOrWhiteSpace(resolved.Version) ? fallback.Version.Trim() : resolved.Version.Trim())
        : versionResolver.Resolve());
    var selected = new UpdaterOptions
    {
      Version = string.IsNullOrWhiteSpace(resolved.Version) ? fallback.Version : resolved.Version,
      PublicBaseUrl = string.IsNullOrWhiteSpace(resolved.PublicBaseUrl) ? fallback.PublicBaseUrl : resolved.PublicBaseUrl,
      Motd = resolved.Motd,
      ProviderConfig = resolved.ProviderConfig,
    };
    return new UpdaterRollout(
      selected,
      version,
      isBeta,
      betaToken
    );
  }

  async Task<bool> IsBetaMemberAsync(string key, UpdaterBetaOptions beta, CancellationToken cancellationToken)
  {
    var cacheKey = $"beta:{ComputeHash(key)}";
    if (cache.TryGetValue(cacheKey, out bool cached)) return cached;

    using var request = new HttpRequestMessage(HttpMethod.Get, BuildLiteLLMKeyInfoUrl(beta, key));
    request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", ResolveLiteLLMApiKey(beta, key));

    try
    {
      using var response = await clientFactory.CreateClient().SendAsync(request, cancellationToken);
      if (!response.IsSuccessStatusCode)
      {
        cache.Set(cacheKey, false, TimeSpan.FromMinutes(2));
        return false;
      }

      await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
      using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
      var groups = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
      var users = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
      CollectGroupCandidates(document.RootElement, groups);
      CollectUserCandidates(document.RootElement, users);
      var match = MatchesGroups(beta, groups) || MatchesUsers(beta, users);
      cache.Set(cacheKey, match, TimeSpan.FromMinutes(5));
      return match;
    }
    catch
    {
      cache.Set(cacheKey, false, TimeSpan.FromMinutes(1));
      return false;
    }
  }

  static bool HasBetaRules(UpdaterBetaOptions beta)
  {
    return beta.Groups.Length > 0 || beta.Users.Length > 0;
  }

  static bool MatchesGroups(UpdaterBetaOptions beta, HashSet<string> groups)
  {
    return beta.Groups.Any((group) => groups.Contains(group));
  }

  static bool MatchesUsers(UpdaterBetaOptions beta, HashSet<string> users)
  {
    return beta.Users.Any((user) => users.Contains(user));
  }

  static string ResolveLiteLLMApiKey(UpdaterBetaOptions beta, string userKey)
  {
    return string.IsNullOrWhiteSpace(beta.LiteLLM.ApiKey) ? userKey : beta.LiteLLM.ApiKey.Trim();
  }

  static string BuildLiteLLMKeyInfoUrl(UpdaterBetaOptions beta, string userKey)
  {
    var url = $"{beta.LiteLLM.BaseUrl.TrimEnd('/')}/{beta.LiteLLM.KeyInfoPath.TrimStart('/')}";
    if (string.IsNullOrWhiteSpace(beta.LiteLLM.ApiKey)) return url;
    return $"{url}?key={Uri.EscapeDataString(userKey)}";
  }

  static string ComputeHash(string value)
  {
    var bytes = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(value));
    return Convert.ToHexString(bytes);
  }

  static void CollectGroupCandidates(JsonElement value, HashSet<string> output)
  {
    switch (value.ValueKind)
    {
      case JsonValueKind.Object:
        foreach (var property in value.EnumerateObject())
        {
          if (property.Value.ValueKind == JsonValueKind.String && IsGroupField(property.Name))
          {
            var text = property.Value.GetString()?.Trim();
            if (!string.IsNullOrWhiteSpace(text)) output.Add(text);
            continue;
          }

          if (property.Value.ValueKind == JsonValueKind.Array && IsGroupField(property.Name))
          {
            foreach (var item in property.Value.EnumerateArray())
            {
              if (item.ValueKind != JsonValueKind.String) continue;
              var text = item.GetString()?.Trim();
              if (!string.IsNullOrWhiteSpace(text)) output.Add(text);
            }
            continue;
          }

          CollectGroupCandidates(property.Value, output);
        }
        break;
      case JsonValueKind.Array:
        foreach (var item in value.EnumerateArray()) CollectGroupCandidates(item, output);
        break;
    }
  }

  static void CollectUserCandidates(JsonElement value, HashSet<string> output)
  {
    switch (value.ValueKind)
    {
      case JsonValueKind.Object:
        foreach (var property in value.EnumerateObject())
        {
          if (property.Value.ValueKind == JsonValueKind.String && IsUserField(property.Name))
          {
            AddCandidate(output, property.Value.GetString());
            if (property.Name.Equals("key_alias", StringComparison.OrdinalIgnoreCase))
              AddCandidate(output, property.Value.GetString()?.Split(" - ", 2, StringSplitOptions.TrimEntries)[0]);
            continue;
          }

          if (property.Value.ValueKind == JsonValueKind.Array && IsUserField(property.Name))
          {
            foreach (var item in property.Value.EnumerateArray())
            {
              if (item.ValueKind != JsonValueKind.String) continue;
              AddCandidate(output, item.GetString());
            }
            continue;
          }

          CollectUserCandidates(property.Value, output);
        }
        break;
      case JsonValueKind.Array:
        foreach (var item in value.EnumerateArray()) CollectUserCandidates(item, output);
        break;
    }
  }

  static void AddCandidate(HashSet<string> output, string? value)
  {
    var text = value?.Trim();
    if (!string.IsNullOrWhiteSpace(text)) output.Add(text);
  }

  static bool IsGroupField(string name)
  {
    return name.Equals("group", StringComparison.OrdinalIgnoreCase) ||
      name.Equals("groups", StringComparison.OrdinalIgnoreCase) ||
      name.Equals("team_id", StringComparison.OrdinalIgnoreCase) ||
      name.Equals("team_alias", StringComparison.OrdinalIgnoreCase) ||
      name.Equals("team", StringComparison.OrdinalIgnoreCase) ||
      name.Equals("tags", StringComparison.OrdinalIgnoreCase);
  }

  static bool IsUserField(string name)
  {
    return name.Equals("user", StringComparison.OrdinalIgnoreCase) ||
      name.Equals("users", StringComparison.OrdinalIgnoreCase) ||
      name.Equals("username", StringComparison.OrdinalIgnoreCase) ||
      name.Equals("user_name", StringComparison.OrdinalIgnoreCase) ||
      name.Equals("display_name", StringComparison.OrdinalIgnoreCase) ||
      name.Equals("key_alias", StringComparison.OrdinalIgnoreCase) ||
      name.Equals("key_name", StringComparison.OrdinalIgnoreCase);
  }
}

sealed class FeedbackRequest
{
  [JsonPropertyName("text")]
  public string? Text { get; set; }

  [JsonPropertyName("category")]
  public string? Category { get; set; }

  [JsonPropertyName("key")]
  public string? Key { get; set; }

  [JsonPropertyName("app_version")]
  public string? AppVersion { get; set; }

  [JsonPropertyName("platform")]
  public string? Platform { get; set; }

  [JsonPropertyName("attachments")]
  public FeedbackAttachment[]? Attachments { get; set; }
}

sealed class FeedbackAttachment
{
  [JsonPropertyName("name")]
  public string? Name { get; set; }

  [JsonPropertyName("type")]
  public string? Type { get; set; }

  [JsonPropertyName("data")]
  public string? Data { get; set; }
}

sealed class FeedbackEntry
{
  public int Id { get; set; }
  public string Text { get; set; } = "";
  public string Category { get; set; } = "general";
  public string UserName { get; set; } = "";
  public string? AppVersion { get; set; }
  public string? Platform { get; set; }
  public string? AttachmentsJson { get; set; }
  public DateTimeOffset CreatedAt { get; set; }
}

sealed class FeedbackContext(DbContextOptions options) : DbContext(options)
{
  public DbSet<FeedbackEntry> Feedbacks => Set<FeedbackEntry>();
}

sealed class UpdaterAdminStore(IWebHostEnvironment env)
{
  readonly string dbPath = Path.Combine(env.ContentRootPath, "data", "feedback.db");

  async Task<SqliteConnection> OpenAsync()
  {
    Directory.CreateDirectory(Path.GetDirectoryName(dbPath)!);
    var connection = new SqliteConnection($"Data Source={dbPath}");
    await connection.OpenAsync();
    return connection;
  }

  public async Task<List<ReleaseRecord>> ListReleasesAsync()
  {
    await using var connection = await OpenAsync();
    await using var command = connection.CreateCommand();
    command.CommandText = """
      SELECT Id, Version, Channel, ZipName, ZipSha256, ZipSize, Notes, Promoted, PositiveCount, TotalCount, CreatedAt, PromotedAt
      FROM UpdaterReleases
      ORDER BY CreatedAt DESC
      """;
    await using var reader = await command.ExecuteReaderAsync();
    var items = new List<ReleaseRecord>();
    while (await reader.ReadAsync()) items.Add(ReadRelease(reader));
    return items;
  }

  public async Task<ReleaseRecord> UploadReleaseAsync(UploadReleaseRequest body)
  {
    await using var connection = await OpenAsync();
    await using var command = connection.CreateCommand();
    command.CommandText = """
      INSERT INTO UpdaterReleases (Id, Version, Channel, ZipName, ZipSha256, ZipSize, Notes, Promoted, PositiveCount, TotalCount, CreatedAt)
      VALUES ($id, $version, 'beta', $zipName, $zipSha256, $zipSize, $notes, 0, 0, 0, $createdAt)
      """;
    command.Parameters.AddWithValue("$id", Guid.NewGuid().ToString("N"));
    command.Parameters.AddWithValue("$version", body.Version.Trim());
    command.Parameters.AddWithValue("$zipName", body.ZipName?.Trim() ?? "");
    command.Parameters.AddWithValue("$zipSha256", body.ZipSha256?.Trim() ?? "");
    command.Parameters.AddWithValue("$zipSize", body.ZipSize);
    command.Parameters.AddWithValue("$notes", string.IsNullOrWhiteSpace(body.Notes) ? DBNull.Value : body.Notes.Trim());
    command.Parameters.AddWithValue("$createdAt", DateTimeOffset.UtcNow.ToString("O"));
    await command.ExecuteNonQueryAsync();
    return (await ListReleasesAsync()).First();
  }

  public async Task<ReleaseRecord?> PromoteReleaseAsync(string id, CancellationToken cancellationToken)
  {
    await using var connection = await OpenAsync();
    await using var lookup = connection.CreateCommand();
    lookup.CommandText = """
      SELECT Id, Version, Channel, ZipName, ZipSha256, ZipSize, Notes, Promoted, PositiveCount, TotalCount, CreatedAt, PromotedAt
      FROM UpdaterReleases
      WHERE Id = $id
      LIMIT 1
      """;
    lookup.Parameters.AddWithValue("$id", id);
    await using var reader = await lookup.ExecuteReaderAsync(cancellationToken);
    if (!await reader.ReadAsync(cancellationToken)) return null;

    var release = ReadRelease(reader);
    if (release.TotalCount == 0 || release.PositiveCount * 2 < release.TotalCount) return release;

    await using var update = connection.CreateCommand();
    update.CommandText = """
      UPDATE UpdaterReleases
      SET Channel = 'normal', Promoted = 1, PromotedAt = $promotedAt
      WHERE Id = $id
      """;
    update.Parameters.AddWithValue("$id", id);
    update.Parameters.AddWithValue("$promotedAt", DateTimeOffset.UtcNow.ToString("O"));
    await update.ExecuteNonQueryAsync(cancellationToken);
    return (await ListReleasesAsync()).FirstOrDefault(item => item.Id == id);
  }

  public async Task<List<FeedbackRecord>> ListFeedbackAsync()
  {
    await using var connection = await OpenAsync();
    await using var command = connection.CreateCommand();
    command.CommandText = """
      SELECT Id, Channel, ReleaseId, UserName, UserEmail, Rating, Message, CreatedAt
      FROM UpdaterFeedback
      ORDER BY CreatedAt DESC
      """;
    await using var reader = await command.ExecuteReaderAsync();
    var items = new List<FeedbackRecord>();
    while (await reader.ReadAsync()) items.Add(ReadFeedback(reader));
    return items;
  }

  public async Task<FeedbackRecord> CreateFeedbackAsync(CreateFeedbackRequest body)
  {
    await using var connection = await OpenAsync();
    var id = Guid.NewGuid().ToString("N");
    await using var command = connection.CreateCommand();
    command.CommandText = """
      INSERT INTO UpdaterFeedback (Id, Channel, ReleaseId, UserName, UserEmail, Rating, Message, CreatedAt)
      VALUES ($id, $channel, $releaseId, $userName, $userEmail, $rating, $message, $createdAt)
      """;
    command.Parameters.AddWithValue("$id", id);
    command.Parameters.AddWithValue("$channel", body.Channel?.Trim() == "beta" ? "beta" : "general");
    command.Parameters.AddWithValue("$releaseId", string.IsNullOrWhiteSpace(body.ReleaseId) ? DBNull.Value : body.ReleaseId.Trim());
    command.Parameters.AddWithValue("$userName", string.IsNullOrWhiteSpace(body.UserName) ? DBNull.Value : body.UserName.Trim());
    command.Parameters.AddWithValue("$userEmail", string.IsNullOrWhiteSpace(body.UserEmail) ? DBNull.Value : body.UserEmail.Trim());
    command.Parameters.AddWithValue("$rating", body.Rating?.Trim() is "positive" or "negative" ? body.Rating.Trim() : "neutral");
    command.Parameters.AddWithValue("$message", body.Message.Trim());
    command.Parameters.AddWithValue("$createdAt", DateTimeOffset.UtcNow.ToString("O"));
    await command.ExecuteNonQueryAsync();
    return (await ListFeedbackAsync()).First(item => item.Id == id);
  }

  public async Task<List<AuditRecord>> ListAuditAsync()
  {
    await using var connection = await OpenAsync();
    await using var command = connection.CreateCommand();
    command.CommandText = """
      SELECT Id, FeedbackId, Actor, Action, Details, CreatedAt
      FROM UpdaterAudit
      ORDER BY CreatedAt DESC
      """;
    await using var reader = await command.ExecuteReaderAsync();
    var items = new List<AuditRecord>();
    while (await reader.ReadAsync()) items.Add(ReadAudit(reader));
    return items;
  }

  static ReleaseRecord ReadRelease(SqliteDataReader reader) => new(
    reader.GetString(0),
    reader.GetString(1),
    reader.GetString(2),
    reader.GetString(3),
    reader.GetString(4),
    reader.GetInt64(5),
    reader.IsDBNull(6) ? null : reader.GetString(6),
    reader.GetInt64(7) > 0,
    reader.GetInt64(8),
    reader.GetInt64(9),
    DateTimeOffset.Parse(reader.GetString(10)),
    reader.IsDBNull(11) ? null : DateTimeOffset.Parse(reader.GetString(11))
  );

  static FeedbackRecord ReadFeedback(SqliteDataReader reader) => new(
    reader.GetString(0),
    reader.GetString(1),
    reader.IsDBNull(2) ? null : reader.GetString(2),
    reader.IsDBNull(3) ? null : reader.GetString(3),
    reader.IsDBNull(4) ? null : reader.GetString(4),
    reader.GetString(5),
    reader.GetString(6),
    DateTimeOffset.Parse(reader.GetString(7))
  );

  static AuditRecord ReadAudit(SqliteDataReader reader) => new(
    reader.GetString(0),
    reader.GetString(1),
    reader.GetString(2),
    reader.GetString(3),
    reader.GetString(4),
    DateTimeOffset.Parse(reader.GetString(5))
  );
}

sealed record UploadReleaseRequest(string Version, string? ZipName, string? ZipSha256, long ZipSize, string? Notes);
sealed record CreateFeedbackRequest(string? Channel, string? ReleaseId, string? UserName, string? UserEmail, string? Rating, string Message);
sealed record ReleaseRecord(string Id, string Version, string Channel, string ZipName, string ZipSha256, long ZipSize, string? Notes, bool Promoted, long PositiveCount, long TotalCount, DateTimeOffset CreatedAt, DateTimeOffset? PromotedAt);
sealed record FeedbackRecord(string Id, string Channel, string? ReleaseId, string? UserName, string? UserEmail, string Rating, string Message, DateTimeOffset CreatedAt);
sealed record AuditRecord(string Id, string FeedbackId, string Actor, string Action, string Details, DateTimeOffset CreatedAt);

sealed class FeedbackKeyResolver(IMemoryCache cache)
{
  public async Task<string> ResolveUserNameAsync(string key, UpdaterBetaOptions beta, IHttpClientFactory clientFactory, CancellationToken cancellationToken)
  {
    var cacheKey = $"username:{ComputeHash(key)}";
    if (cache.TryGetValue(cacheKey, out string? cachedName)) return cachedName ?? string.Empty;

    if (string.IsNullOrWhiteSpace(beta.LiteLLM.BaseUrl))
      return string.Empty;

    using var request = new HttpRequestMessage(HttpMethod.Get, BuildLiteLLMKeyInfoUrl(beta, key));
    request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", ResolveLiteLLMApiKey(beta, key));

    try
    {
      using var response = await clientFactory.CreateClient().SendAsync(request, cancellationToken);
      if (!response.IsSuccessStatusCode)
      {
        cache.Set(cacheKey, "", TimeSpan.FromMinutes(5));
        return string.Empty;
      }

      await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
      using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
      var name = ExtractUserName(document.RootElement);

      cache.Set(cacheKey, name ?? "", TimeSpan.FromMinutes(10));
      return name ?? string.Empty;
    }
    catch
    {
      cache.Set(cacheKey, "", TimeSpan.FromMinutes(2));
      return string.Empty;
    }
  }

  static string? ExtractUserName(JsonElement element)
  {
    if (element.ValueKind != JsonValueKind.Object) return null;

    foreach (var property in element.EnumerateObject())
    {
      if (property.Value.ValueKind != JsonValueKind.String) continue;

      var fieldName = property.Name.ToLowerInvariant();
      if (fieldName == "display_name" || fieldName == "user_name" || fieldName == "username" || fieldName == "user" || fieldName == "key_alias")
      {
        var value = property.Value.GetString()?.Trim();
        if (!string.IsNullOrWhiteSpace(value))
        {
          if (fieldName == "key_alias")
          {
            var parts = value.Split(" - ", 2, StringSplitOptions.TrimEntries);
            return parts[0];
          }
          return value;
        }
      }
    }

    foreach (var property in element.EnumerateObject())
    {
      var name = ExtractUserName(property.Value);
      if (!string.IsNullOrEmpty(name)) return name;
    }

    return null;
  }

  static string ResolveLiteLLMApiKey(UpdaterBetaOptions beta, string userKey)
  {
    return string.IsNullOrWhiteSpace(beta.LiteLLM.ApiKey) ? userKey : beta.LiteLLM.ApiKey.Trim();
  }

  static string BuildLiteLLMKeyInfoUrl(UpdaterBetaOptions beta, string userKey)
  {
    var url = $"{beta.LiteLLM.BaseUrl.TrimEnd('/')}/{beta.LiteLLM.KeyInfoPath.TrimStart('/')}";
    if (string.IsNullOrWhiteSpace(beta.LiteLLM.ApiKey)) return url;
    return $"{url}?key={Uri.EscapeDataString(userKey)}";
  }

  static string ComputeHash(string value)
  {
    var bytes = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(value));
    return Convert.ToHexString(bytes);
  }
}
