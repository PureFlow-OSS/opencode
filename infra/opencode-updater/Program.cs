using Microsoft.Extensions.Options;
using Microsoft.Extensions.Configuration;
using System.Text.Json.Serialization;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<UpdaterOptions>(builder.Configuration.GetSection("Updater"));
builder.Services.AddHttpClient();
builder.Services.AddSingleton(new LocalFeed(Path.Combine(builder.Environment.ContentRootPath, "feed")));
builder.Services.AddSingleton<UpdaterVersionResolver>();

var app = builder.Build();

app.MapGet("/", () => Results.Redirect("/opencode/version"));

app.MapGet("/opencode/version", (UpdaterVersionResolver versionResolver) =>
{
  return Results.Text(versionResolver.Resolve(), "text/plain");
});

app.MapGet("/opencode/url", (HttpRequest request, IOptions<UpdaterOptions> options) =>
{
  return Results.Text(
    $"{GetPublicBaseUrl(options.Value, request).TrimEnd('/')}/opencode/feed",
    "text/plain"
  );
});

app.MapGet("/opencode/latest.json", async (HttpContext context, IHttpClientFactory clientFactory, IOptions<UpdaterOptions> options, UpdaterVersionResolver versionResolver, LocalFeed feed) =>
{
  if (feed.TryGet("latest.json", out var local)) return await LocalFileAsync(context, local);
  return await ProxyAsync(context, clientFactory, BuildUpstreamUrl(options.Value, versionResolver.Resolve(), "latest.json"));
});

app.MapGet("/opencode/provider-config.json", (IOptions<UpdaterOptions> options) =>
{
  return Results.Json(options.Value.ProviderConfig);
});

app.MapGet("/opencode/feed/{**asset}", async (HttpContext context, IHttpClientFactory clientFactory, IOptions<UpdaterOptions> options, UpdaterVersionResolver versionResolver, LocalFeed feed, string? asset) =>
{
  var resolvedAsset = (asset ?? "").TrimStart('/');
  if (string.IsNullOrWhiteSpace(resolvedAsset) || resolvedAsset.Contains("..", StringComparison.Ordinal))
    return Results.BadRequest();

  if (feed.TryGet(resolvedAsset, out var local)) return await LocalFileAsync(context, local);
  return await ProxyAsync(context, clientFactory, BuildUpstreamUrl(options.Value, versionResolver.Resolve(), resolvedAsset));
});

app.Run();

static string BuildUpstreamUrl(UpdaterOptions options, string version, string asset)
{
  return $"{options.ReleaseBaseUrlTemplate.Replace("{{version}}", version.Trim(), StringComparison.Ordinal).TrimEnd('/')}/{asset}";
}

static string GetPublicBaseUrl(UpdaterOptions options, HttpRequest request)
{
  if (!string.IsNullOrWhiteSpace(options.PublicBaseUrl)) return options.PublicBaseUrl;
  return $"{request.Scheme}://{request.Host}{request.PathBase}";
}

static async Task<IResult> ProxyAsync(HttpContext context, IHttpClientFactory clientFactory, string upstreamUrl)
{
  using var request = new HttpRequestMessage(HttpMethod.Get, upstreamUrl);
  using var response = await clientFactory.CreateClient().SendAsync(
    request,
    HttpCompletionOption.ResponseHeadersRead,
    context.RequestAborted
  );

  context.Response.StatusCode = (int)response.StatusCode;

  if (response.Content.Headers.ContentType?.ToString() is { Length: > 0 } contentType)
    context.Response.ContentType = contentType;

  if (response.Content.Headers.ContentLength is { } contentLength)
    context.Response.ContentLength = contentLength;

  if (response.Content.Headers.ContentDisposition?.ToString() is { Length: > 0 } contentDisposition)
    context.Response.Headers.ContentDisposition = contentDisposition;

  await using var stream = await response.Content.ReadAsStreamAsync(context.RequestAborted);
  await stream.CopyToAsync(context.Response.Body, context.RequestAborted);

  return Results.Empty;
}

static async Task<IResult> LocalFileAsync(HttpContext context, string path)
{
  var extension = Path.GetExtension(path).ToLowerInvariant();
  context.Response.StatusCode = StatusCodes.Status200OK;
  context.Response.ContentType = extension switch
  {
    ".yml" => "text/yaml; charset=utf-8",
    ".json" => "application/json; charset=utf-8",
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
  public string Version { get; set; } = "1.14.28";
  public string PublicBaseUrl { get; set; } = "http://10.53.7.23";
  public string ReleaseBaseUrlTemplate { get; set; } = "https://github.com/anomalyco/opencode/releases/download/v{{version}}";
  public ProviderConfigOptions ProviderConfig { get; set; } = new();
}

sealed class ProviderConfigOptions
{
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
  public bool TryGet(string relativePath, out string file)
  {
    file = Path.Combine(root, relativePath.Replace('/', Path.DirectorySeparatorChar));
    return File.Exists(file);
  }

  public string? TryReadVersionFromLatestYml()
  {
    var path = Path.Combine(root, "latest.yml");
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
  public string Resolve()
  {
    return feed.TryReadVersionFromLatestYml() ?? options.Value.Version.Trim();
  }
}
