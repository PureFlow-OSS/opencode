using Microsoft.Extensions.Options;
using System.Text.Json.Serialization;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<UpdaterOptions>(builder.Configuration.GetSection("Updater"));
builder.Services.AddHttpClient();
builder.Services.AddSingleton(new LocalFeed(Path.Combine(builder.Environment.ContentRootPath, "feed")));

var app = builder.Build();

app.MapGet("/", () => Results.Redirect("/opencode/version"));

app.MapGet("/opencode/version", (IOptions<UpdaterOptions> options) =>
{
  return Results.Text(options.Value.Version.Trim(), "text/plain");
});

app.MapGet("/opencode/url", (HttpRequest request, IOptions<UpdaterOptions> options) =>
{
  return Results.Text(
    $"{GetPublicBaseUrl(options.Value, request).TrimEnd('/')}/opencode/feed",
    "text/plain"
  );
});

app.MapGet("/opencode/latest.json", async (HttpContext context, IHttpClientFactory clientFactory, IOptions<UpdaterOptions> options, LocalFeed feed) =>
{
  if (feed.TryGet("latest.json", out var local)) return await LocalFileAsync(context, local);
  return await ProxyAsync(context, clientFactory, BuildUpstreamUrl(options.Value, "latest.json"));
});

app.MapGet("/opencode/provider-config.json", (IOptions<UpdaterOptions> options) =>
{
  return Results.Json(options.Value.ProviderConfig);
});

app.MapGet("/opencode/feed/{**asset}", async (HttpContext context, IHttpClientFactory clientFactory, IOptions<UpdaterOptions> options, LocalFeed feed, string? asset) =>
{
  var resolvedAsset = (asset ?? "").TrimStart('/');
  if (string.IsNullOrWhiteSpace(resolvedAsset) || resolvedAsset.Contains("..", StringComparison.Ordinal))
    return Results.BadRequest();

  if (feed.TryGet(resolvedAsset, out var local)) return await LocalFileAsync(context, local);
  return await ProxyAsync(context, clientFactory, BuildUpstreamUrl(options.Value, resolvedAsset));
});

app.Run();

static string BuildUpstreamUrl(UpdaterOptions options, string asset)
{
  return $"{options.ReleaseBaseUrlTemplate.Replace("{{version}}", options.Version.Trim(), StringComparison.Ordinal).TrimEnd('/')}/{asset}";
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
}

sealed class AiFactoryConfigOptions
{
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
}

sealed class LocalFeed(string root)
{
  public bool TryGet(string relativePath, out string file)
  {
    file = Path.Combine(root, relativePath.Replace('/', Path.DirectorySeparatorChar));
    return File.Exists(file);
  }
}
