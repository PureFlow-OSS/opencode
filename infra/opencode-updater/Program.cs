using Microsoft.Extensions.Options;
using Microsoft.Extensions.Configuration;
using System.Text.Json.Serialization;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;

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
builder.Services.ConfigureHttpJsonOptions(options =>
{
  options.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
});

var app = builder.Build();

app.UseCors();

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

sealed class UpdaterOptions
{
  public string Version { get; set; } = "1.14.33";
  public string PublicBaseUrl { get; set; } = "http://10.53.7.23";
  public MotdOptions Motd { get; set; } = new();
  public ProviderConfigOptions ProviderConfig { get; set; } = new();
}

sealed class UpdaterBetaOptions
{
  public bool Enabled { get; set; }
  public string HeaderName { get; set; } = "X-OpenCode-AiFactory-Api-Key";
  public string[] Groups { get; set; } = [];
  public LiteLLMBetaOptions LiteLLM { get; set; } = new();
}

sealed class LiteLLMBetaOptions
{
  public string BaseUrl { get; set; } = "";
  public string KeyInfoPath { get; set; } = "/key/info";
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
    if (!beta.Enabled || beta.Groups.Length == 0) return CreateRollout(options.CurrentValue, false, null);
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

    using var request = new HttpRequestMessage(HttpMethod.Get, BuildLiteLLMKeyInfoUrl(beta));
    request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", key);

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
      CollectGroupCandidates(document.RootElement, groups);
      var match = beta.Groups.Any((group) => groups.Contains(group));
      cache.Set(cacheKey, match, TimeSpan.FromMinutes(5));
      return match;
    }
    catch
    {
      cache.Set(cacheKey, false, TimeSpan.FromMinutes(1));
      return false;
    }
  }

  static string BuildLiteLLMKeyInfoUrl(UpdaterBetaOptions beta)
  {
    return $"{beta.LiteLLM.BaseUrl.TrimEnd('/')}/{beta.LiteLLM.KeyInfoPath.TrimStart('/')}";
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

  static bool IsGroupField(string name)
  {
    return name.Equals("group", StringComparison.OrdinalIgnoreCase) ||
      name.Equals("groups", StringComparison.OrdinalIgnoreCase) ||
      name.Equals("team_id", StringComparison.OrdinalIgnoreCase) ||
      name.Equals("team_alias", StringComparison.OrdinalIgnoreCase) ||
      name.Equals("team", StringComparison.OrdinalIgnoreCase) ||
      name.Equals("tags", StringComparison.OrdinalIgnoreCase);
  }
}
