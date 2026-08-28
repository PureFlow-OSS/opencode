using Microsoft.Extensions.Options;
using Microsoft.Extensions.Configuration;
using System.Text.Json.Serialization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Sqlite;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;
using Microsoft.Data.Sqlite;
using Microsoft.AspNetCore.Http.Features;
using System.Data.Common;
using System.Data;
using System.IO.Compression;
using System.Text.RegularExpressions;
using Quartz;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(options =>
{
  options.Limits.MaxRequestBodySize = null;
});
builder.Services.Configure<FormOptions>(options =>
{
  options.MultipartBodyLengthLimit = long.MaxValue;
});
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
builder.Services.AddSingleton<UpdaterChannelStateStore>();
builder.Services.AddSingleton<UpdaterVersionResolver>();
builder.Services.AddSingleton<UpdaterRolloutResolver>();
builder.Services.AddSingleton<ModelCardStore>();
builder.Services.AddSingleton<McpConfigStore>();
var modelCardSyncSeconds = Math.Max(60, betaConfiguration.GetSection("UpdaterBeta:LiteLLM:SyncIntervalSeconds").Get<int?>() ?? 600);
builder.Services.AddQuartz((quartz) =>
{
  var jobKey = new JobKey(nameof(ModelCardSyncJob));
  quartz.AddJob<ModelCardSyncJob>((job) => job.WithIdentity(jobKey).StoreDurably());
  quartz.AddTrigger((trigger) =>
    trigger
      .ForJob(jobKey)
      .WithIdentity($"{nameof(ModelCardSyncJob)}-trigger")
      .StartNow()
      .WithSimpleSchedule((schedule) => schedule.WithInterval(TimeSpan.FromSeconds(modelCardSyncSeconds)).RepeatForever()));
});
builder.Services.AddQuartzHostedService((options) => options.WaitForJobsToComplete = true);
builder.Services.AddDbContext<FeedbackContext>(options =>
{
  var dataDir = Path.Combine(builder.Environment.ContentRootPath, "data");
  Directory.CreateDirectory(dataDir);
  options.UseSqlite($"Data Source={Path.Combine(dataDir, "feedback.db")}");
});
builder.Services.AddSingleton<FeedbackKeyResolver>();
builder.Services.AddSingleton<UpdaterAdminStore>();
builder.Services.AddSingleton<UpdaterConfigStore>();
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
  if (!await HasColumnAsync(db.Database, "Feedbacks", "BetaSentiment"))
    db.Database.ExecuteSqlRaw(@"ALTER TABLE ""Feedbacks"" ADD COLUMN ""BetaSentiment"" TEXT NULL");
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
  LocalFeed feed,
  UpdaterAdminStore store,
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
    userName = await keyResolver.ResolveBetaUserNameAsync(key, betaOptions.Value, clientFactory, request.HttpContext.RequestAborted);
  }

  var category = (body.Category?.Trim() ?? "general").ToLowerInvariant();
  var betaSentiment = body.BetaSentiment?.Trim().ToLowerInvariant();
  if (category == "beta")
  {
    if (betaSentiment is not "positive" and not "negative") betaSentiment = ParseBetaFeedback(body.Text!);
    if (betaSentiment is null)
      return Results.BadRequest(new { error = "Beta feedback requires beta_sentiment 'positive' or 'negative'" });
  }

  var entry = new FeedbackEntry
  {
    Text = body.Text!.Trim(),
    Category = category,
    BetaSentiment = category == "beta" ? betaSentiment : null,
    UserName = userName,
    AppVersion = category == "beta" ? await ResolveActiveBetaVersionAsync(feed, store) ?? body.AppVersion?.Trim() : body.AppVersion?.Trim(),
    Platform = body.Platform?.Trim(),
    AttachmentsJson = body.Attachments is { Length: > 0 } ? JsonSerializer.Serialize(body.Attachments) : null,
    CreatedAt = DateTimeOffset.UtcNow,
  };

  db.Feedbacks.Add(entry);
  await db.SaveChangesAsync(request.HttpContext.RequestAborted);

  return Results.Ok(new { id = entry.Id });
});

app.MapGet("/opencode/feedback", async (FeedbackContext db, LocalFeed feed, UpdaterAdminStore store) =>
{
  var releases = await store.ListReleasesAsync();
  await BackfillBetaFeedbackVersionAsync(db, await ResolveActiveBetaVersionAsync(feed, store, releases), releases);
  var items = (await db.Feedbacks
    .Select(f => new
    {
      id = f.Id,
      text = f.Text,
      category = f.Category,
      beta_sentiment = f.BetaSentiment,
      user_name = f.UserName,
      app_version = f.AppVersion,
      platform = f.Platform,
      attachments = f.AttachmentsJson,
      created_at = f.CreatedAt,
    })
    .ToListAsync())
    .OrderByDescending((item) => item.created_at)
    .ToList();

  return Results.Json(items);
});

app.MapGet("/opencode/admin/releases", async (UpdaterAdminStore store) => Results.Json(await store.ListReleasesAsync()));

app.MapGet("/opencode/admin/releases/status", async (
  UpdaterAdminStore store,
  UpdaterChannelStateStore channelState,
  LocalFeed feed,
  IOptions<UpdaterBetaOptions> betaOptions,
  FeedbackContext feedbackDb
) =>
{
  var releases = await store.ListReleasesAsync();
  var trackedVersion = await ResolveActiveBetaVersionAsync(feed, store, releases);
  await BackfillBetaFeedbackVersionAsync(feedbackDb, trackedVersion, releases);
  var feedbackCounts = string.IsNullOrWhiteSpace(trackedVersion) ? (0L, 0L) : await GetBetaFeedbackCountsAsync(feedbackDb, trackedVersion);
  return Results.Json(new
  {
    releases = releases.Select((release) => trackedVersion is not null && string.Equals(release.Version, trackedVersion, StringComparison.OrdinalIgnoreCase)
      ? release with { PositiveCount = feedbackCounts.Item1, TotalCount = feedbackCounts.Item2 }
      : release),
    normalStopped = await channelState.IsNormalStoppedAsync(),
    betaUserCount = betaOptions.Value.Users.Length,
    betaPositiveThreshold = BetaPositiveThreshold(betaOptions.Value),
    betaRelease = releases.FirstOrDefault((release) => string.Equals(release.Version, trackedVersion, StringComparison.OrdinalIgnoreCase)) is { } betaRelease
      ? betaRelease with { PositiveCount = feedbackCounts.Item1, TotalCount = feedbackCounts.Item2 }
      : null,
    normalRelease = releases.FirstOrDefault((release) => release.Channel == "normal"),
    betaFeedVersion = trackedVersion,
    normalFeedVersion = feed.TryReadVersionFromLatestYml(false),
  });
});

app.MapGet("/opencode/admin/beta/status", async (
  HttpRequest request,
  FeedbackKeyResolver keyResolver,
  IOptions<UpdaterBetaOptions> betaOptions,
  IHttpClientFactory clientFactory
) =>
{
  var key = request.Headers["X-OpenCode-AiFactory-Api-Key"].FirstOrDefault()?.Trim();
  if (string.IsNullOrWhiteSpace(key))
    return Results.Json(new
    {
      betaTester = false,
      userName = (string?)null,
      betaUserCount = betaOptions.Value.Users.Length,
      betaPositiveThreshold = (int)Math.Ceiling(betaOptions.Value.Users.Length / 2.0),
    });

  var userName = await keyResolver.ResolveBetaUserNameAsync(key, betaOptions.Value, clientFactory, request.HttpContext.RequestAborted);
  var betaTester = await keyResolver.IsBetaMemberAsync(key, betaOptions.Value, clientFactory, request.HttpContext.RequestAborted);
  return Results.Json(new
  {
    betaTester,
    userName,
    betaUserCount = betaOptions.Value.Users.Length,
    betaPositiveThreshold = (int)Math.Ceiling(betaOptions.Value.Users.Length / 2.0),
  });
});

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

  var version = await ReadVersionFromLatestYmlAsync(file, request.HttpContext.RequestAborted);
  if (string.IsNullOrWhiteSpace(version))
    return Results.BadRequest(new { error = "latest.yml with a version field is required inside the ZIP" });

  var feedRoot = Path.Combine(request.HttpContext.RequestServices.GetRequiredService<IWebHostEnvironment>().ContentRootPath, "feed", "beta");
  Directory.CreateDirectory(feedRoot);
  CleanDirectory(feedRoot, preserve: ["_archives"]);
  Directory.CreateDirectory(Path.Combine(feedRoot, "_archives"));
  var zipName = Path.GetFileName(file.FileName);
  var zipPath = Path.Combine(feedRoot, "_archives", zipName);
  await using (var source = file.OpenReadStream())
  await using (var destination = File.Create(zipPath))
  {
    await source.CopyToAsync(destination, request.HttpContext.RequestAborted);
  }

  await ExtractZipToDirectoryAsync(zipPath, feedRoot, request.HttpContext.RequestAborted);

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
  LocalFeed feed,
  IOptions<UpdaterBetaOptions> betaOptions,
  HttpRequest request,
  FeedbackContext feedbackDb
) =>
{
  var releases = await store.ListReleasesAsync();
  var release = releases.FirstOrDefault((item) => item.Id == id);
  if (release is null) return Results.NotFound();
  var activeBetaVersion = await ResolveActiveBetaVersionAsync(feed, store, releases);
  if (!string.Equals(release.Version, activeBetaVersion, StringComparison.OrdinalIgnoreCase))
    return Results.BadRequest(new { error = "A newer beta release is active and must be promoted instead" });
  var counts = await GetBetaFeedbackCountsAsync(feedbackDb, release.Version);
  if (counts.positiveCount < BetaPositiveThreshold(betaOptions.Value))
    return Results.BadRequest(new { error = "Not enough validated beta feedback to promote" });

  var promoted = await store.PromoteReleaseAsync(id, request.HttpContext.RequestAborted);
  if (promoted is null) return Results.NotFound();

  CopyDirectory(Path.Combine(request.HttpContext.RequestServices.GetRequiredService<IWebHostEnvironment>().ContentRootPath, "feed", "beta"),
    Path.Combine(request.HttpContext.RequestServices.GetRequiredService<IWebHostEnvironment>().ContentRootPath, "feed"));
  return Results.Ok(promoted with { Channel = "normal", Promoted = true, PositiveCount = counts.positiveCount, TotalCount = counts.totalCount });
});

app.MapPost("/opencode/admin/releases/normal/stop", async (UpdaterChannelStateStore channelState) =>
{
  await channelState.SetNormalStoppedAsync(true);
  return Results.Ok(new { normalStopped = true });
});

app.MapPost("/opencode/admin/releases/normal/clear", async (UpdaterChannelStateStore channelState) =>
{
  await channelState.SetNormalStoppedAsync(false);
  return Results.Ok(new { normalStopped = false });
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

app.MapGet("/opencode/admin/modelcards", async (
  string? channel,
  ModelCardStore modelCards,
  UpdaterConfigStore configStore,
  HttpContext context
) =>
{
  var isBeta = string.Equals(channel, "beta", StringComparison.OrdinalIgnoreCase);
  var config = await configStore.LoadUpdaterOptionsAsync(isBeta, context.RequestAborted);
  var cards = modelCards.BuildSnapshot(isBeta, config.ProviderConfig);
  return Results.Json(new
  {
    version = config.Version,
    isBeta,
    generatedAt = cards.GeneratedAt,
    aifactory = new
    {
      models = cards.Models,
      model_visibility = config.ProviderConfig.AiFactory.ModelVisibility,
    },
  });
});

app.MapGet("/opencode/admin/provider-settings", async (
  string? channel,
  UpdaterConfigStore configStore,
  HttpContext context
) =>
{
  var config = await configStore.LoadUpdaterOptionsAsync(string.Equals(channel, "beta", StringComparison.OrdinalIgnoreCase), context.RequestAborted);
  return Results.Json(new ProviderSettingsRequest { Model = config.ProviderConfig.Model, SmallModel = config.ProviderConfig.SmallModel });
});

app.MapPut("/opencode/admin/provider-settings", async (
  string? channel,
  ProviderSettingsRequest settings,
  UpdaterConfigStore configStore,
  HttpContext context
) =>
{
  if (string.IsNullOrWhiteSpace(settings.Model) || string.IsNullOrWhiteSpace(settings.SmallModel))
    return Results.BadRequest(new { error = "Model and small model are required" });
  return Results.Json(await configStore.SaveProviderSettingsAsync(
    string.Equals(channel, "beta", StringComparison.OrdinalIgnoreCase),
    settings,
    context.RequestAborted
  ));
});

app.MapPut("/opencode/admin/model-settings", async (
  string model,
  string? channel,
  ModelSettingsRequest settings,
  ModelCardStore modelCards,
  UpdaterConfigStore configStore,
  HttpContext context
) =>
{
  if (string.IsNullOrWhiteSpace(model)) return Results.BadRequest(new { error = "Model is required" });
  if (settings.Context is < 0 || settings.Output is < 0)
    return Results.BadRequest(new { error = "Context and output must be positive" });
  await modelCards.SyncAsync(context.RequestAborted);
  var maxInputTokens = modelCards.GetMaxInputTokens(model);
  if (settings.Context is not null && maxInputTokens is not null && settings.Context > maxInputTokens)
    return Results.BadRequest(new { error = $"Context cannot exceed LiteLLM max_input_tokens ({maxInputTokens})" });
  var reasoningVariants = (settings.ReasoningVariants ?? []).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
  if (reasoningVariants.Any((item) => item is not ("low" or "medium" or "high" or "xhigh")))
    return Results.BadRequest(new { error = "Reasoning levels must be low, medium, high, or xhigh" });
  if (settings.DefaultReasoningVariant is not null && !reasoningVariants.Contains(settings.DefaultReasoningVariant, StringComparer.OrdinalIgnoreCase))
    return Results.BadRequest(new { error = "The default reasoning level must be enabled" });
  settings.ReasoningVariants = settings.Reasoning == true ? reasoningVariants : [];
  settings.DefaultReasoningVariant = settings.Reasoning == true ? settings.DefaultReasoningVariant : null;

  var isBeta = string.Equals(channel, "beta", StringComparison.OrdinalIgnoreCase);
  var result = await configStore.SaveModelSettingsAsync(model, isBeta, settings, context.RequestAborted);
  return Results.Json(result);
});

app.MapPost("/opencode/admin/model-settings/sync-context", async (
  string model,
  string? channel,
  ModelCardStore modelCards,
  UpdaterConfigStore configStore,
  HttpContext context
) =>
{
  if (string.IsNullOrWhiteSpace(model)) return Results.BadRequest(new { error = "Model is required" });
  await modelCards.SyncAsync(context.RequestAborted);
  var maxInputTokens = modelCards.GetMaxInputTokens(model);
  if (maxInputTokens is null) return Results.NotFound(new { error = $"LiteLLM has no max_input_tokens value for {model}" });
  return Results.Json(new { context = await configStore.SyncModelContextAsync(
    model,
    string.Equals(channel, "beta", StringComparison.OrdinalIgnoreCase),
    maxInputTokens.Value,
    context.RequestAborted
  ) });
});

app.MapDelete("/opencode/admin/model-settings", async (
  string model,
  string? channel,
  UpdaterConfigStore configStore,
  HttpContext context
) =>
{
  var isBeta = string.Equals(channel, "beta", StringComparison.OrdinalIgnoreCase);
  return await configStore.RemoveModelSettingsAsync(model, isBeta, context.RequestAborted)
    ? Results.NoContent()
    : Results.NotFound();
});

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
  if (rollout.IsBeta && feed.TryGet("changelog.md", false, out var stable)) return await LocalFileAsync(context, stable);
  return Results.NotFound();
});

app.MapGet("/opencode/provider-config.json", async (HttpRequest request, UpdaterRolloutResolver rolloutResolver, McpConfigStore mcps) =>
{
  var rollout = await rolloutResolver.ResolveAsync(request, request.HttpContext.RequestAborted);
  var config = ApplyReasoningSettings(rollout.Options.ProviderConfig);
  config.Mcp = await mcps.ApplyAsync(config.Mcp, rollout.IsBeta ? "beta" : "normal", request.HttpContext.RequestAborted);
  return Results.Json(config);
});

app.MapGet("/opencode/admin/mcp", async (string? channel, UpdaterConfigStore configStore, McpConfigStore mcps, CancellationToken cancellationToken) =>
{
  var selectedChannel = McpConfigStore.NormalizeChannel(channel);
  var options = await configStore.LoadUpdaterOptionsAsync(selectedChannel == "beta", cancellationToken);
  var items = await mcps.ApplyAsync(options.ProviderConfig.Mcp, selectedChannel, cancellationToken);
  return Results.Json(items.OrderBy((item) => item.Key).ToDictionary((item) => item.Key, (item) => item.Value));
});

app.MapPut("/opencode/admin/mcp/{name}", async (string name, string? channel, McpConfigOptions body, McpConfigStore mcps, CancellationToken cancellationToken) =>
{
  var error = McpConfigStore.Validate(name, body);
  if (error is not null) return Results.BadRequest(new { error });
  await mcps.SetAsync(McpConfigStore.NormalizeChannel(channel), name, body, cancellationToken);
  return Results.Ok(new { name = name.Trim(), config = body });
});

app.MapDelete("/opencode/admin/mcp/{name}", async (string name, string? channel, McpConfigStore mcps, CancellationToken cancellationToken) =>
{
  if (string.IsNullOrWhiteSpace(name)) return Results.BadRequest(new { error = "MCP name is required" });
  await mcps.DeleteAsync(McpConfigStore.NormalizeChannel(channel), name, cancellationToken);
  return Results.NoContent();
});

app.MapGet("/opencode/modelcards.json", async (HttpRequest request, UpdaterRolloutResolver rolloutResolver) =>
{
  var rollout = await rolloutResolver.ResolveAsync(request, request.HttpContext.RequestAborted);
  var providerConfig = ApplyReasoningSettings(rollout.Options.ProviderConfig);
  var cards = request.HttpContext.RequestServices.GetRequiredService<ModelCardStore>().BuildSnapshot(rollout.IsBeta, providerConfig, includeHidden: false);

  return Results.Json(new
  {
    version = rollout.Version,
    isBeta = rollout.IsBeta,
    generatedAt = cards.GeneratedAt,
    aifactory = new
    {
      models = cards.Models,
      model_visibility = providerConfig.AiFactory.ModelVisibility,
    },
  });
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

static ProviderConfigOptions ApplyReasoningSettings(ProviderConfigOptions config)
{
  foreach (var rule in config.AiFactory.ModelLimits)
  {
    var variants = (rule.ReasoningVariants ?? []).Where((item) => item is "low" or "medium" or "high" or "xhigh").Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    if (rule.Reasoning != true || variants.Length == 0)
    {
      rule.Options = null;
      rule.Variants = null;
      continue;
    }

    var defaultVariant = variants.Contains(rule.DefaultReasoningVariant, StringComparer.OrdinalIgnoreCase) ? rule.DefaultReasoningVariant! : variants[0];
    rule.Options = new JsonObject { ["reasoningEffort"] = defaultVariant };
    rule.Variants = new JsonObject();
    foreach (var variant in variants) rule.Variants[variant] = new JsonObject { ["reasoningEffort"] = variant };
  }
  return config;
}

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

static async Task<string?> ReadVersionFromLatestYmlAsync(IFormFile file, CancellationToken cancellationToken)
{
  await using var stream = file.OpenReadStream();
  using var archive = new ZipArchive(stream, ZipArchiveMode.Read, leaveOpen: false);
  var latest = archive.GetEntry("latest.yml") ?? archive.GetEntry("latest.yaml");
  if (latest is null) return null;

  await using var latestStream = latest.Open();
  using var reader = new StreamReader(latestStream);
  var content = await reader.ReadToEndAsync(cancellationToken);
  var match = Regex.Match(content, @"(?m)^\s*version:\s*[""']?(?<version>[^""'\r\n#]+)");
  return match.Success ? match.Groups["version"].Value.Trim() : null;
}

static async Task ExtractZipToDirectoryAsync(string zipPath, string targetDirectory, CancellationToken cancellationToken)
{
  using var archive = ZipFile.OpenRead(zipPath);
  foreach (var entry in archive.Entries)
  {
    if (string.IsNullOrWhiteSpace(entry.FullName)) continue;
    var outputPath = Path.GetFullPath(Path.Combine(targetDirectory, entry.FullName));
    if (!outputPath.StartsWith(Path.GetFullPath(targetDirectory), StringComparison.OrdinalIgnoreCase))
      continue;

    if (string.IsNullOrEmpty(entry.Name))
    {
      Directory.CreateDirectory(outputPath);
      continue;
    }

    Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
    await using var input = entry.Open();
    await using var output = File.Create(outputPath);
    await input.CopyToAsync(output, cancellationToken);
  }
}

static void CleanDirectory(string directory, string[]? preserve = null)
{
  var preserveSet = new HashSet<string>(preserve ?? [], StringComparer.OrdinalIgnoreCase);
  foreach (var path in Directory.EnumerateFileSystemEntries(directory))
  {
    var name = Path.GetFileName(path);
    if (preserveSet.Contains(name)) continue;
    if (Directory.Exists(path))
    {
      Directory.Delete(path, true);
      continue;
    }

    File.Delete(path);
  }
}

static void CopyDirectory(string sourceDirectory, string targetDirectory)
{
  Directory.CreateDirectory(targetDirectory);
  foreach (var sourcePath in Directory.EnumerateFileSystemEntries(sourceDirectory, "*", SearchOption.AllDirectories))
  {
    var relative = Path.GetRelativePath(sourceDirectory, sourcePath);
    if (relative.StartsWith("..", StringComparison.Ordinal) || relative.Contains($"{Path.DirectorySeparatorChar}_archives{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
      continue;

    var targetPath = Path.Combine(targetDirectory, relative);
    if (Directory.Exists(sourcePath))
    {
      Directory.CreateDirectory(targetPath);
      continue;
    }

    Directory.CreateDirectory(Path.GetDirectoryName(targetPath)!);
    File.Copy(sourcePath, targetPath, true);
  }
}

static string? ParseBetaFeedback(string text)
{
  var normalized = text.TrimStart();
  var match = Regex.Match(normalized, @"^(Version erfolgreich getestet|Fehler gefunden)\b", RegexOptions.IgnoreCase);
  if (!match.Success) return null;
  return match.Groups[1].Value.Equals("Version erfolgreich getestet", StringComparison.OrdinalIgnoreCase) ? "positive" : "negative";
}

static async Task<(long positiveCount, long totalCount)> GetBetaFeedbackCountsAsync(FeedbackContext db, string version)
{
  var feedbacks = await db.Feedbacks
    .Where((feedback) => feedback.Category == "beta" && feedback.AppVersion == version)
    .Select((feedback) => new { feedback.BetaSentiment, feedback.Text })
    .ToListAsync();

  var totalCount = feedbacks.LongCount();
  var positiveCount = feedbacks.LongCount((feedback) => feedback.BetaSentiment == "positive" || (string.IsNullOrWhiteSpace(feedback.BetaSentiment) && ParseBetaFeedback(feedback.Text) == "positive"));
  return (positiveCount, totalCount);
}

static int BetaPositiveThreshold(UpdaterBetaOptions options) => Math.Max(1, (int)Math.Ceiling(options.Users.Length / 2.0));

static async Task<string?> ResolveActiveBetaVersionAsync(LocalFeed feed, UpdaterAdminStore store, List<ReleaseRecord>? releases = null)
{
  var feedVersion = feed.TryReadVersionFromLatestYml(true);
  if (!string.IsNullOrWhiteSpace(feedVersion)) return feedVersion;
  return (releases ?? await store.ListReleasesAsync()).FirstOrDefault((release) => release.Channel == "beta")?.Version;
}

static async Task BackfillBetaFeedbackVersionAsync(FeedbackContext db, string? version, List<ReleaseRecord> releases)
{
  if (string.IsNullOrWhiteSpace(version)) return;
  var betaVersions = releases.Where((release) => release.Channel == "beta").Select((release) => release.Version).ToArray();
  await db.Feedbacks
    .Where((feedback) => feedback.Category == "beta" && (feedback.AppVersion == null || feedback.AppVersion == "" || !betaVersions.Contains(feedback.AppVersion!)))
    .ExecuteUpdateAsync((setters) => setters.SetProperty((feedback) => feedback.AppVersion, version));
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

    CREATE TABLE IF NOT EXISTS UpdaterChannelState (
      Name TEXT PRIMARY KEY NOT NULL,
      Value INTEGER NOT NULL,
      UpdatedAt TEXT NOT NULL
    );
    """;
  await command.ExecuteNonQueryAsync();

  command.CommandText = """
    UPDATE UpdaterFeedback
    SET ReleaseId = (
      SELECT replacement.Id
      FROM UpdaterReleases original
      JOIN UpdaterReleases replacement ON replacement.Channel = 'beta' AND replacement.Version = original.Version
      WHERE original.Id = UpdaterFeedback.ReleaseId
      ORDER BY replacement.rowid DESC
      LIMIT 1
    )
    WHERE ReleaseId IN (SELECT Id FROM UpdaterReleases WHERE Channel = 'beta');

    DELETE FROM UpdaterReleases
    WHERE Channel = 'beta'
      AND rowid NOT IN (
        SELECT MAX(rowid)
        FROM UpdaterReleases
        WHERE Channel = 'beta'
        GROUP BY Version
      );

    CREATE UNIQUE INDEX IF NOT EXISTS UpdaterReleases_BetaVersion
    ON UpdaterReleases (Version)
    WHERE Channel = 'beta';

    CREATE TABLE IF NOT EXISTS UpdaterMcpConfigs (
      Channel TEXT NOT NULL,
      Name TEXT NOT NULL,
      Config TEXT NOT NULL,
      Deleted INTEGER NOT NULL DEFAULT 0,
      UpdatedAt TEXT NOT NULL,
      PRIMARY KEY (Channel, Name)
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
  public string ModelInfoPath { get; set; } = "/model/info";
  public string ModelsPath { get; set; } = "/v1/models";
  public int SyncIntervalSeconds { get; set; } = 600;
}

sealed record UpdaterRollout(UpdaterOptions Options, string Version, bool IsBeta, string? BetaToken = null);

sealed record ModelCardSnapshot(
  DateTimeOffset GeneratedAt,
  int ModelCount,
  ModelCardEntry[] Models,
  ModelCardSyncInfo Sync
);

sealed record ModelCardSyncInfo(
  string? Source,
  DateTimeOffset SyncedAt,
  bool IsBeta
);

sealed record ModelCardPrice(
  decimal? Input,
  decimal? Output
);

sealed record ModelCardModalities(
  string[] Input,
  string[] Output
);

sealed record ModelCardEntry(
  string Model,
  int? Context,
  int? Output,
  bool? Temperature,
  bool? Reasoning,
  string[]? ReasoningVariants,
  string? DefaultReasoningVariant,
  bool DocumentVision,
  bool DocumentVisionNative,
  bool NativeImageVision,
  string? DocumentOcrModel,
  string? DocumentVisionModel,
  bool? Visible,
  ModelCardPrice? Price,
  ModelCardModalities? Modalities,
  string Source,
  ModelCardConfig? Config,
  ModelCardLiteLLM? LiteLLM
);

sealed record ModelCardConfig(
  string? Pattern,
  int? Context,
  int? Output,
  bool? Temperature,
  bool? Reasoning,
  string[]? ReasoningVariants,
  string? DefaultReasoningVariant,
  bool? DocumentVision,
  bool? DocumentVisionNative,
  bool? NativeImageVision,
  string? DocumentOcrModel,
  string? DocumentVisionModel,
  ModelCardModalities? Modalities
);

sealed record ModelCardLiteLLM(
  string Name,
  string? Object,
  long? Created,
  string? OwnedBy,
  string? Mode,
  string? Provider,
  string? ProviderSpecificEntry,
  int? MaxInputTokens,
  int? MaxOutputTokens,
  decimal? InputCostPerMillionTokens,
  decimal? OutputCostPerMillionTokens,
  bool? SupportsReasoning,
  ModelCardModalities? Modalities
);

sealed record ModelCardData(
  string Name,
  string? Object,
  long? Created,
  string? OwnedBy,
  string? Mode,
  string? Provider,
  string? ProviderSpecificEntry,
  int? Context,
  int? Output,
  bool? Temperature,
  bool? Reasoning,
  decimal? InputPrice,
  decimal? OutputPrice,
  ModelCardModalities? Modalities,
  string Source
)
{
  public decimal? Price => InputPrice is null && OutputPrice is null ? null : (InputPrice ?? 0) + (OutputPrice ?? 0);
}

sealed class ModelCardStore(IOptions<UpdaterBetaOptions> betaOptions, IHttpClientFactory clientFactory, ILogger<ModelCardStore> logger)
{
  readonly SemaphoreSlim syncGate = new(1, 1);
  volatile ModelCardData[] cached = [];
  DateTimeOffset syncedAt = DateTimeOffset.MinValue;
  string? source;

  public ModelCardSnapshot BuildSnapshot(bool isBeta, ProviderConfigOptions providerConfig, bool includeHidden = true)
  {
    var models = cached.Select((model) =>
    {
      var match = providerConfig.AiFactory.ModelLimits
        .Select((rule) => new
        {
          rule,
          score = ScoreRule(rule.Pattern, model.Name),
        })
        .Where((item) => item.score >= 0)
        .OrderByDescending((item) => item.score)
        .FirstOrDefault()?.rule;
      var visibility = providerConfig.AiFactory.ModelVisibility
        .Where((rule) => ScoreRule(rule.Pattern, model.Name) >= 0)
        .LastOrDefault()?.Visible;

      return new ModelCardEntry(
        model.Name,
        match?.Context ?? model.Context,
        match?.Output ?? model.Output,
        match?.Temperature ?? model.Temperature,
        match?.Reasoning ?? model.Reasoning,
        match?.ReasoningVariants,
        match?.DefaultReasoningVariant,
        match?.DocumentVision ?? false,
        match?.DocumentVisionNative ?? false,
        match?.NativeImageVision ?? false,
        match?.DocumentOcrModel,
        match?.DocumentVisionModel,
        visibility,
        model.Price is null ? null : new ModelCardPrice(model.InputPrice is null ? null : model.InputPrice * 1000000m, model.OutputPrice is null ? null : model.OutputPrice * 1000000m),
        match?.Modalities is null ? model.Modalities : new ModelCardModalities(match.Modalities.Input ?? [], match.Modalities.Output ?? []),
        model.Source,
        match is null
          ? null
          : new ModelCardConfig(
            match.Pattern,
            match.Context,
            match.Output,
            match.Temperature,
            match.Reasoning,
            match.ReasoningVariants,
            match.DefaultReasoningVariant,
            match.DocumentVision,
            match.DocumentVisionNative,
            match.NativeImageVision,
            match.DocumentOcrModel,
            match.DocumentVisionModel,
            match.Modalities is null ? null : new ModelCardModalities(match.Modalities.Input ?? [], match.Modalities.Output ?? [])
          ),
        new ModelCardLiteLLM(
          model.Name,
          model.Object,
          model.Created,
          model.OwnedBy,
          model.Mode,
          model.Provider,
          model.ProviderSpecificEntry,
          model.Context,
          model.Output,
          model.InputPrice is null ? null : model.InputPrice * 1000000m,
          model.OutputPrice is null ? null : model.OutputPrice * 1000000m,
          model.Reasoning,
          model.Modalities
        )
      );
    })
      .Where((model) => includeHidden || model.Visible is not false)
      .ToArray();

    return new ModelCardSnapshot(DateTimeOffset.UtcNow, models.Length, models, new ModelCardSyncInfo(source, syncedAt, isBeta));
  }

  public async Task SyncAsync(CancellationToken cancellationToken)
  {
    var beta = betaOptions.Value;
    if (string.IsNullOrWhiteSpace(beta.LiteLLM.BaseUrl)) return;
    if (!await syncGate.WaitAsync(0, cancellationToken)) return;

    try
    {
      var modelInfo = await TryLoadModelInfoAsync(beta, cancellationToken);
      cached = modelInfo.Length > 0 ? modelInfo : await TryLoadModelsAsync(beta, cancellationToken);
      syncedAt = DateTimeOffset.UtcNow;
      source = modelInfo.Length > 0 ? "litellm:/model/info" : "litellm:/v1/models";
      logger.LogInformation("synced model cards from {Source} count={Count}", source, cached.Length);
    }
    finally
    {
      syncGate.Release();
    }
  }

  public int? GetMaxInputTokens(string model) => cached
    .FirstOrDefault((item) => string.Equals(item.Name, model, StringComparison.OrdinalIgnoreCase))
    ?.Context;

  async Task<ModelCardData[]> TryLoadModelInfoAsync(UpdaterBetaOptions beta, CancellationToken cancellationToken)
  {
    using var request = new HttpRequestMessage(HttpMethod.Get, BuildLiteLLMUrl(beta, beta.LiteLLM.ModelInfoPath));
    AddLiteLLMAuth(request, beta);
    using var response = await clientFactory.CreateClient().SendAsync(request, cancellationToken);
    if (!response.IsSuccessStatusCode) return [];
    await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
    using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
    if (document.RootElement.ValueKind != JsonValueKind.Object || !document.RootElement.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array)
      return [];

    return data.EnumerateArray()
      .Select(ParseModelInfoItem)
      .Where((item) => item is not null)
      .Cast<ModelCardData>()
      .ToArray();
  }

  async Task<ModelCardData[]> TryLoadModelsAsync(UpdaterBetaOptions beta, CancellationToken cancellationToken)
  {
    using var request = new HttpRequestMessage(HttpMethod.Get, BuildLiteLLMUrl(beta, beta.LiteLLM.ModelsPath));
    AddLiteLLMAuth(request, beta);
    using var response = await clientFactory.CreateClient().SendAsync(request, cancellationToken);
    if (!response.IsSuccessStatusCode) return [];
    await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
    using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
    if (document.RootElement.ValueKind != JsonValueKind.Object || !document.RootElement.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array)
      return [];

    return data.EnumerateArray()
      .Select((item) =>
      {
        if (item.ValueKind != JsonValueKind.Object || !TryGetString(item, "id", out var name) || string.IsNullOrWhiteSpace(name)) return null;
        return new ModelCardData(
          name,
          ReadString(item, "object"),
          TryGetLong(item, "created"),
          ReadString(item, "owned_by"),
          null,
          null,
          null,
          TryGetInt(item, "max_input_tokens") ?? TryGetInt(item, "context_window") ?? TryGetInt(item, "max_tokens"),
          null,
          null,
          null,
          null,
          null,
          null,
          "litellm:/v1/models"
        );
      })
      .Where((item) => item is not null)
      .Cast<ModelCardData>()
      .ToArray();
  }

  static ModelCardData? ParseModelInfoItem(JsonElement item)
  {
    if (item.ValueKind != JsonValueKind.Object) return null;
    var name = TryGetString(item, "model_name", out var modelName) ? modelName : TryGetString(item, "id", out var id) ? id : null;
    if (string.IsNullOrWhiteSpace(name)) return null;
    var info = item.TryGetProperty("model_info", out var modelInfo) && modelInfo.ValueKind == JsonValueKind.Object ? modelInfo : item;
    return new ModelCardData(
      name,
      ReadString(item, "object"),
      TryGetLong(item, "created"),
      ReadString(item, "owned_by"),
      ReadString(info, "mode"),
      ReadString(info, "litellm_provider"),
      ReadString(info, "provider_specific_entry"),
      TryGetInt(info, "max_input_tokens") ?? TryGetInt(info, "context_window") ?? TryGetInt(info, "max_tokens"),
      TryGetInt(info, "max_output_tokens"),
      TryGetBool(info, "temperature"),
      TryGetBool(info, "reasoning") ?? TryGetBool(info, "supports_reasoning") ?? (TryGetString(info, "mode", out var mode) && mode == "reasoning" ? true : null),
      TryGetPrice(info, "input_cost_per_million_tokens", "input_cost_per_1m_tokens", "input_cost", "input_cost_per_token", "input"),
      TryGetPrice(info, "output_cost_per_million_tokens", "output_cost_per_1m_tokens", "output_cost", "output_cost_per_token", "output"),
      TryGetModalities(info),
      "litellm:/model/info"
    );
  }

  static void AddLiteLLMAuth(HttpRequestMessage request, UpdaterBetaOptions beta)
  {
    var apiKey = string.IsNullOrWhiteSpace(beta.LiteLLM.ApiKey) ? null : beta.LiteLLM.ApiKey.Trim();
    if (apiKey is not null) request.Headers.TryAddWithoutValidation("x-litellm-api-key", apiKey);
  }

  static string BuildLiteLLMUrl(UpdaterBetaOptions beta, string path) =>
    $"{beta.LiteLLM.BaseUrl.TrimEnd('/')}/{path.TrimStart('/')}";

  static bool TryGetString(JsonElement item, string name, out string? value)
  {
    value = item.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.String ? property.GetString()?.Trim() : null;
    return !string.IsNullOrWhiteSpace(value);
  }

  static string? ReadString(JsonElement item, string name)
  {
    return item.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.String ? property.GetString()?.Trim() : null;
  }

  static int? TryGetInt(JsonElement item, params string[] names)
  {
    foreach (var name in names)
      if (item.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.Number && property.TryGetInt32(out var value))
        return value;
    return null;
  }

  static long? TryGetLong(JsonElement item, params string[] names)
  {
    foreach (var name in names)
      if (item.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.Number && property.TryGetInt64(out var value))
        return value;
    return null;
  }

  static bool? TryGetBool(JsonElement item, params string[] names)
  {
    foreach (var name in names)
    {
      if (!item.TryGetProperty(name, out var property)) continue;
      if (property.ValueKind == JsonValueKind.True) return true;
      if (property.ValueKind == JsonValueKind.False) return false;
    }
    return null;
  }

  static decimal? TryGetPrice(JsonElement item, params string[] names)
  {
    foreach (var name in names)
    {
      if (item.TryGetProperty(name, out var property))
      {
        if (property.ValueKind == JsonValueKind.Number && property.TryGetDecimal(out var value)) return value;
        if (property.ValueKind == JsonValueKind.String && decimal.TryParse(property.GetString(), out var parsed)) return parsed;
      }
    }
    if (item.TryGetProperty("cost", out var cost) && cost.ValueKind == JsonValueKind.Object)
      foreach (var name in names)
        if (cost.TryGetProperty(name, out var property))
        {
          if (property.ValueKind == JsonValueKind.Number && property.TryGetDecimal(out var value)) return value;
          if (property.ValueKind == JsonValueKind.String && decimal.TryParse(property.GetString(), out var parsed)) return parsed;
        }
    if (item.TryGetProperty("pricing", out var pricing) && pricing.ValueKind == JsonValueKind.Object)
      foreach (var name in names)
        if (pricing.TryGetProperty(name, out var property))
        {
          if (property.ValueKind == JsonValueKind.Number && property.TryGetDecimal(out var value)) return value;
          if (property.ValueKind == JsonValueKind.String && decimal.TryParse(property.GetString(), out var parsed)) return parsed;
        }
    if (item.TryGetProperty("litellm_params", out var paramsObj) && paramsObj.ValueKind == JsonValueKind.Object)
      foreach (var name in names)
        if (paramsObj.TryGetProperty(name, out var property))
        {
          if (property.ValueKind == JsonValueKind.Number && property.TryGetDecimal(out var value)) return value;
          if (property.ValueKind == JsonValueKind.String && decimal.TryParse(property.GetString(), out var parsed)) return parsed;
        }
    return null;
  }

  static ModelCardModalities? TryGetModalities(JsonElement item)
  {
    if (!item.TryGetProperty("modalities", out var modalities) || modalities.ValueKind != JsonValueKind.Object) return null;
    var input = ReadStrings(modalities, "input");
    var output = ReadStrings(modalities, "output");
    return input.Length == 0 && output.Length == 0 ? null : new ModelCardModalities(input, output);
  }

  static int ScoreRule(string pattern, string model)
  {
    if (pattern == "*") return 0;
    if (string.Equals(pattern, model, StringComparison.OrdinalIgnoreCase)) return 1000 + pattern.Length;
    if (pattern.Contains('*') && WildcardMatch(model, pattern)) return 100 + pattern.Count((x) => x == '*') * -10 + pattern.Length;
    return -1;
  }

  static bool WildcardMatch(string value, string pattern)
  {
    var regex = "^" + Regex.Escape(pattern).Replace("\\*", ".*").Replace("\\?", ".") + "$";
    return Regex.IsMatch(value, regex, RegexOptions.IgnoreCase);
  }

  static string[] ReadStrings(JsonElement item, string name)
  {
    if (!item.TryGetProperty(name, out var property) || property.ValueKind != JsonValueKind.Array) return [];
    return property.EnumerateArray()
      .Where((x) => x.ValueKind == JsonValueKind.String)
      .Select((x) => x.GetString()?.Trim())
      .Where((x) => !string.IsNullOrWhiteSpace(x))
      .Cast<string>()
      .ToArray();
  }
}

sealed class ModelCardSyncJob(ModelCardStore store, ILogger<ModelCardSyncJob> logger) : IJob
{
  public async Task Execute(IJobExecutionContext context)
  {
    logger.LogDebug("running scheduled model card sync");
    await store.SyncAsync(context.CancellationToken);
  }
}

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

  [ConfigurationKeyName("reasoning_variants")]
  [JsonPropertyName("reasoning_variants")]
  public string[]? ReasoningVariants { get; set; }

  [ConfigurationKeyName("default_reasoning_variant")]
  [JsonPropertyName("default_reasoning_variant")]
  public string? DefaultReasoningVariant { get; set; }

  [JsonPropertyName("options")]
  public JsonObject? Options { get; set; }

  [JsonPropertyName("variants")]
  public JsonObject? Variants { get; set; }

  [JsonPropertyName("modalities")]
  public ModalitiesOptions? Modalities { get; set; }

  [ConfigurationKeyName("document_vision")]
  [JsonPropertyName("document_vision")]
  public bool? DocumentVision { get; set; }

  [ConfigurationKeyName("document_vision_native")]
  [JsonPropertyName("document_vision_native")]
  public bool? DocumentVisionNative { get; set; }

  [ConfigurationKeyName("native_image_vision")]
  [JsonPropertyName("native_image_vision")]
  public bool? NativeImageVision { get; set; }

  [ConfigurationKeyName("document_ocr_model")]
  [JsonPropertyName("document_ocr_model")]
  public string? DocumentOcrModel { get; set; }

  [ConfigurationKeyName("document_vision_model")]
  [JsonPropertyName("document_vision_model")]
  public string? DocumentVisionModel { get; set; }
}

sealed class ModelSettingsRequest
{
  [JsonPropertyName("context")]
  public int? Context { get; set; }

  [JsonPropertyName("output")]
  public int? Output { get; set; }

  [JsonPropertyName("temperature")]
  public bool? Temperature { get; set; }

  [JsonPropertyName("reasoning")]
  public bool? Reasoning { get; set; }

  [JsonPropertyName("reasoning_variants")]
  public string[]? ReasoningVariants { get; set; }

  [JsonPropertyName("default_reasoning_variant")]
  public string? DefaultReasoningVariant { get; set; }

  [JsonPropertyName("document_vision")]
  public bool? DocumentVision { get; set; }

  [JsonPropertyName("document_vision_native")]
  public bool? DocumentVisionNative { get; set; }

  [JsonPropertyName("native_image_vision")]
  public bool? NativeImageVision { get; set; }

  [JsonPropertyName("document_ocr_model")]
  public string? DocumentOcrModel { get; set; }

  [JsonPropertyName("document_vision_model")]
  public string? DocumentVisionModel { get; set; }

  [JsonPropertyName("visible")]
  public bool? Visible { get; set; }

  [JsonPropertyName("input_modalities")]
  public string[]? InputModalities { get; set; }

  [JsonPropertyName("output_modalities")]
  public string[]? OutputModalities { get; set; }
}

sealed class ProviderSettingsRequest
{
  [JsonPropertyName("model")]
  public string? Model { get; set; }

  [JsonPropertyName("small_model")]
  public string? SmallModel { get; set; }
}

sealed class UpdaterConfigStore(IWebHostEnvironment environment)
{
  readonly SemaphoreSlim gate = new(1, 1);
  readonly JsonSerializerOptions json = new() { WriteIndented = true };

  public async Task<ModelSettingsRequest> SaveModelSettingsAsync(string model, bool beta, ModelSettingsRequest settings, CancellationToken cancellationToken)
  {
    await gate.WaitAsync(cancellationToken);
    try
    {
      var root = await LoadAsync(beta, cancellationToken);
      var limits = GetModelLimits(root);
      var existing = limits
        .OfType<JsonObject>()
        .FirstOrDefault((rule) => string.Equals(rule["pattern"]?.GetValue<string>(), model, StringComparison.OrdinalIgnoreCase));
      var rule = existing ?? new JsonObject { ["pattern"] = model };
      if (existing is null) limits.Add(rule);

      rule["context"] = settings.Context;
      rule["output"] = settings.Output;
      rule["temperature"] = settings.Temperature;
      rule["reasoning"] = settings.Reasoning;
      rule["reasoning_variants"] = JsonSerializer.SerializeToNode(settings.ReasoningVariants ?? [], json);
      rule["default_reasoning_variant"] = settings.DefaultReasoningVariant;
      rule["document_vision"] = settings.DocumentVision;
      rule["document_vision_native"] = settings.DocumentVisionNative;
      rule["native_image_vision"] = settings.NativeImageVision;
      rule["document_ocr_model"] = settings.DocumentOcrModel;
      rule["document_vision_model"] = settings.DocumentVisionModel;
      rule["modalities"] = new JsonObject
      {
        ["input"] = JsonSerializer.SerializeToNode(settings.InputModalities ?? [], json),
        ["output"] = JsonSerializer.SerializeToNode(settings.OutputModalities ?? [], json),
      };
      if (settings.Visible is not null)
      {
        var visibility = GetModelVisibility(root);
        var existingVisibility = visibility
          .OfType<JsonObject>()
          .FirstOrDefault((rule) => string.Equals(rule["pattern"]?.GetValue<string>(), model, StringComparison.OrdinalIgnoreCase));
        var visibilityRule = existingVisibility ?? new JsonObject { ["pattern"] = model };
        if (existingVisibility is null) visibility.Add(visibilityRule);
        visibilityRule["visible"] = settings.Visible;
      }
      await SaveAsync(root, beta, cancellationToken);
      return settings;
    }
    finally
    {
      gate.Release();
    }
  }

  public async Task<ProviderSettingsRequest> SaveProviderSettingsAsync(bool beta, ProviderSettingsRequest settings, CancellationToken cancellationToken)
  {
    await gate.WaitAsync(cancellationToken);
    try
    {
      var root = await LoadAsync(beta, cancellationToken);
      var provider = GetObject(GetObject(root, "Updater"), "ProviderConfig");
      provider["model"] = settings.Model?.Trim();
      provider["small_model"] = settings.SmallModel?.Trim();
      await SaveAsync(root, beta, cancellationToken);
      return settings;
    }
    finally
    {
      gate.Release();
    }
  }

  public async Task<int> SyncModelContextAsync(string model, bool beta, int context, CancellationToken cancellationToken)
  {
    await gate.WaitAsync(cancellationToken);
    try
    {
      var root = await LoadAsync(beta, cancellationToken);
      var limits = GetModelLimits(root);
      var rule = limits
        .OfType<JsonObject>()
        .FirstOrDefault((item) => string.Equals(item["pattern"]?.GetValue<string>(), model, StringComparison.OrdinalIgnoreCase));
      if (rule is null)
      {
        rule = new JsonObject { ["pattern"] = model };
        limits.Add(rule);
      }
      rule["context"] = context;
      await SaveAsync(root, beta, cancellationToken);
      return context;
    }
    finally
    {
      gate.Release();
    }
  }

  public async Task<bool> RemoveModelSettingsAsync(string model, bool beta, CancellationToken cancellationToken)
  {
    await gate.WaitAsync(cancellationToken);
    try
    {
      var root = await LoadAsync(beta, cancellationToken);
      var limits = GetModelLimits(root);
      var existing = limits
        .OfType<JsonObject>()
        .FirstOrDefault((rule) => string.Equals(rule["pattern"]?.GetValue<string>(), model, StringComparison.OrdinalIgnoreCase));
      if (existing is not null) limits.Remove(existing);
      var visibility = GetModelVisibility(root);
      var existingVisibility = visibility
        .OfType<JsonObject>()
        .FirstOrDefault((rule) => string.Equals(rule["pattern"]?.GetValue<string>(), model, StringComparison.OrdinalIgnoreCase));
      if (existingVisibility is not null) visibility.Remove(existingVisibility);
      if (existing is null && existingVisibility is null) return false;
      await SaveAsync(root, beta, cancellationToken);
      return true;
    }
    finally
    {
      gate.Release();
    }
  }

  public async Task<UpdaterOptions> LoadUpdaterOptionsAsync(bool beta, CancellationToken cancellationToken)
  {
    var stable = await LoadAsync(false, cancellationToken);
    var root = beta ? Merge(stable, await LoadAsync(true, cancellationToken)) : stable;
    return JsonSerializer.Deserialize<UpdaterOptions>(root["Updater"]?.ToJsonString() ?? "{}", new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new UpdaterOptions();
  }

  async Task<JsonObject> LoadAsync(bool beta, CancellationToken cancellationToken)
  {
    var path = Path.Combine(environment.ContentRootPath, beta ? "appsettings.beta.json" : "appsettings.json");
    if (!File.Exists(path)) return new JsonObject();
    await using var stream = File.OpenRead(path);
    return await JsonNode.ParseAsync(stream, cancellationToken: cancellationToken) as JsonObject ?? new JsonObject();
  }

  async Task SaveAsync(JsonObject root, bool beta, CancellationToken cancellationToken)
  {
    var path = Path.Combine(environment.ContentRootPath, beta ? "appsettings.beta.json" : "appsettings.json");
    await File.WriteAllTextAsync(path, root.ToJsonString(json), cancellationToken);
  }

  static JsonArray GetModelLimits(JsonObject root)
  {
    var updater = GetObject(root, "Updater");
    var provider = GetObject(updater, "ProviderConfig");
    var aiFactory = GetObject(provider, "aifactory");
    if (aiFactory["model_limits"] is JsonArray limits) return limits;
    var created = new JsonArray();
    aiFactory["model_limits"] = created;
    return created;
  }

  static JsonArray GetModelVisibility(JsonObject root)
  {
    var updater = GetObject(root, "Updater");
    var provider = GetObject(updater, "ProviderConfig");
    var aiFactory = GetObject(provider, "aifactory");
    if (aiFactory["model_visibility"] is JsonArray visibility) return visibility;
    var created = new JsonArray();
    aiFactory["model_visibility"] = created;
    return created;
  }

  static JsonObject GetObject(JsonObject parent, string name)
  {
    if (parent[name] is JsonObject value) return value;
    var created = new JsonObject();
    parent[name] = created;
    return created;
  }

  static JsonObject Merge(JsonObject stable, JsonObject beta)
  {
    var merged = stable.DeepClone().AsObject();
    foreach (var item in beta)
    {
      if (item.Value is JsonObject betaObject && merged[item.Key] is JsonObject stableObject)
      {
        merged[item.Key] = Merge(stableObject, betaObject);
        continue;
      }
      merged[item.Key] = item.Value?.DeepClone();
    }
    return merged;
  }
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

sealed class McpConfigStore(IWebHostEnvironment env)
{
  readonly string dbPath = Path.Combine(env.ContentRootPath, "data", "feedback.db");

  async Task<SqliteConnection> OpenAsync()
  {
    Directory.CreateDirectory(Path.GetDirectoryName(dbPath)!);
    var connection = new SqliteConnection($"Data Source={dbPath}");
    await connection.OpenAsync();
    return connection;
  }

  public static string NormalizeChannel(string? channel) => string.Equals(channel, "beta", StringComparison.OrdinalIgnoreCase) ? "beta" : "normal";

  public static string? Validate(string name, McpConfigOptions config)
  {
    if (string.IsNullOrWhiteSpace(name)) return "MCP name is required";
    if (name.Trim().Length > 128) return "MCP name must not exceed 128 characters";
    if (config.Type is not ("local" or "remote")) return "MCP type must be local or remote";
    if (config.Type == "local" && config.Command is not { Length: > 0 }) return "Local MCPs require a command";
    if (config.Type == "remote")
    {
      if (!Uri.TryCreate(config.Url, UriKind.Absolute, out var uri)) return "Remote MCPs require an absolute URL";
      if (uri.Scheme is not ("http" or "https")) return "Remote MCP URLs must use HTTP or HTTPS";
    }
    if (config.Timeout is <= 0) return "MCP timeout must be positive";
    if (config.Auth is { Type: not "pat" }) return "Managed authentication must use PAT";
    return null;
  }

  public async Task<Dictionary<string, McpConfigOptions>> ApplyAsync(Dictionary<string, McpConfigOptions> defaults, string channel, CancellationToken cancellationToken)
  {
    var result = new Dictionary<string, McpConfigOptions>(defaults, StringComparer.Ordinal);
    await using var connection = await OpenAsync();
    await using var command = connection.CreateCommand();
    command.CommandText = "SELECT Name, Config, Deleted FROM UpdaterMcpConfigs WHERE Channel = $channel";
    command.Parameters.AddWithValue("$channel", channel);
    await using var reader = await command.ExecuteReaderAsync(cancellationToken);
    while (await reader.ReadAsync(cancellationToken))
    {
      var name = reader.GetString(0);
      if (reader.GetInt64(2) != 0)
      {
        result.Remove(name);
        continue;
      }
      var config = JsonSerializer.Deserialize<McpConfigOptions>(reader.GetString(1));
      if (config is not null) result[name] = config;
    }
    return result;
  }

  public async Task SetAsync(string channel, string name, McpConfigOptions config, CancellationToken cancellationToken)
  {
    await using var connection = await OpenAsync();
    await using var command = connection.CreateCommand();
    command.CommandText = """
      INSERT INTO UpdaterMcpConfigs (Channel, Name, Config, Deleted, UpdatedAt)
      VALUES ($channel, $name, $config, 0, $updatedAt)
      ON CONFLICT(Channel, Name) DO UPDATE SET Config = excluded.Config, Deleted = 0, UpdatedAt = excluded.UpdatedAt
      """;
    command.Parameters.AddWithValue("$channel", channel);
    command.Parameters.AddWithValue("$name", name.Trim());
    command.Parameters.AddWithValue("$config", JsonSerializer.Serialize(config));
    command.Parameters.AddWithValue("$updatedAt", DateTimeOffset.UtcNow.ToString("O"));
    await command.ExecuteNonQueryAsync(cancellationToken);
  }

  public async Task DeleteAsync(string channel, string name, CancellationToken cancellationToken)
  {
    await using var connection = await OpenAsync();
    await using var command = connection.CreateCommand();
    command.CommandText = """
      INSERT INTO UpdaterMcpConfigs (Channel, Name, Config, Deleted, UpdatedAt)
      VALUES ($channel, $name, '{}', 1, $updatedAt)
      ON CONFLICT(Channel, Name) DO UPDATE SET Deleted = 1, UpdatedAt = excluded.UpdatedAt
      """;
    command.Parameters.AddWithValue("$channel", channel);
    command.Parameters.AddWithValue("$name", name.Trim());
    command.Parameters.AddWithValue("$updatedAt", DateTimeOffset.UtcNow.ToString("O"));
    await command.ExecuteNonQueryAsync(cancellationToken);
  }
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
  IOptions<UpdaterBetaOptions> betaOptions,
  UpdaterVersionResolver versionResolver,
  LocalFeed feed,
  UpdaterChannelStateStore channelState,
  IHttpClientFactory clientFactory,
  IMemoryCache cache,
  UpdaterConfigStore configStore
)
{
  public async Task<UpdaterRollout> ResolveAsync(HttpRequest request, CancellationToken cancellationToken)
  {
    var stable = await configStore.LoadUpdaterOptionsAsync(false, cancellationToken);
    if (request.Query.TryGetValue("beta", out var queryBeta))
    {
      var token = queryBeta.FirstOrDefault()?.Trim();
      if (!string.IsNullOrWhiteSpace(token) && cache.TryGetValue($"beta:{token}", out bool cached) && cached)
        return CreateRollout(await configStore.LoadUpdaterOptionsAsync(true, cancellationToken), stable, true, token);
    }

    var beta = betaOptions.Value;
    if (!beta.Enabled || !HasBetaRules(beta)) return CreateRollout(stable, stable, false, null);
    if (string.IsNullOrWhiteSpace(beta.LiteLLM.BaseUrl)) return CreateRollout(stable, stable, false, null);

    var key = request.Headers[beta.HeaderName].FirstOrDefault()?.Trim();
    if (string.IsNullOrWhiteSpace(key)) return CreateRollout(stable, stable, false, null);
    var tokenHash = ComputeHash(key);
    if (!await IsBetaMemberAsync(key, beta, cancellationToken)) return CreateRollout(stable, stable, false, null);
    return CreateRollout(await configStore.LoadUpdaterOptionsAsync(true, cancellationToken), stable, true, tokenHash);
  }

  UpdaterRollout CreateRollout(UpdaterOptions resolved, UpdaterOptions fallback, bool isBeta, string? betaToken)
  {
    var normalStopped = channelState.IsNormalStopped();
    var localVersion = feed.TryReadVersionFromLatestYml(isBeta);
    var version = localVersion ??
      (isBeta
        ? (string.IsNullOrWhiteSpace(resolved.Version) ? fallback.Version.Trim() : resolved.Version.Trim())
        : normalStopped
          ? fallback.Version.Trim()
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
    request.Headers.TryAddWithoutValidation("x-litellm-api-key", ResolveLiteLLMApiKey(beta, key));

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

  [JsonPropertyName("beta_sentiment")]
  public string? BetaSentiment { get; set; }

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
  public string? BetaSentiment { get; set; }
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
      SELECT
        r.Id,
        r.Version,
        r.Channel,
        r.ZipName,
        r.ZipSha256,
        r.ZipSize,
        r.Notes,
        r.Promoted,
        COALESCE(f.PositiveCount, 0),
        COALESCE(f.TotalCount, 0),
        r.CreatedAt,
        r.PromotedAt
      FROM UpdaterReleases r
      LEFT JOIN (
        SELECT ReleaseId, SUM(CASE WHEN Rating = 'positive' THEN 1 ELSE 0 END) AS PositiveCount, COUNT(*) AS TotalCount
        FROM UpdaterFeedback
        WHERE ReleaseId IS NOT NULL
        GROUP BY ReleaseId
      ) f ON f.ReleaseId = r.Id
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
      ON CONFLICT(Version) WHERE Channel = 'beta' DO UPDATE SET
        ZipName = excluded.ZipName,
        ZipSha256 = excluded.ZipSha256,
        ZipSize = excluded.ZipSize,
        Notes = excluded.Notes,
        CreatedAt = excluded.CreatedAt
      """;
    command.Parameters.AddWithValue("$id", Guid.NewGuid().ToString("N"));
    command.Parameters.AddWithValue("$version", body.Version.Trim());
    command.Parameters.AddWithValue("$zipName", body.ZipName?.Trim() ?? "");
    command.Parameters.AddWithValue("$zipSha256", body.ZipSha256?.Trim() ?? "");
    command.Parameters.AddWithValue("$zipSize", body.ZipSize);
    command.Parameters.AddWithValue("$notes", string.IsNullOrWhiteSpace(body.Notes) ? DBNull.Value : body.Notes.Trim());
    command.Parameters.AddWithValue("$createdAt", DateTimeOffset.UtcNow.ToString("O"));
    await command.ExecuteNonQueryAsync();
    return (await ListReleasesAsync()).First((item) => item.Version == body.Version.Trim() && item.Channel == "beta");
  }

  public async Task<ReleaseRecord?> PromoteReleaseAsync(string id, CancellationToken cancellationToken)
  {
    await using var connection = await OpenAsync();
    await using var update = connection.CreateCommand();
    update.CommandText = """
      UPDATE UpdaterReleases
      SET Channel = 'normal', Promoted = 1, PromotedAt = $promotedAt
      WHERE Id = $id
      """;
    update.Parameters.AddWithValue("$id", id);
    update.Parameters.AddWithValue("$promotedAt", DateTimeOffset.UtcNow.ToString("O"));
    var affected = await update.ExecuteNonQueryAsync(cancellationToken);
    if (affected == 0) return null;
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
    var releaseId = string.IsNullOrWhiteSpace(body.ReleaseId) ? await GetCurrentBetaReleaseIdAsync(connection) : body.ReleaseId.Trim();
    var id = Guid.NewGuid().ToString("N");
    await using var command = connection.CreateCommand();
    command.CommandText = """
      INSERT INTO UpdaterFeedback (Id, Channel, ReleaseId, UserName, UserEmail, Rating, Message, CreatedAt)
      VALUES ($id, $channel, $releaseId, $userName, $userEmail, $rating, $message, $createdAt)
      """;
    command.Parameters.AddWithValue("$id", id);
    command.Parameters.AddWithValue("$channel", body.Channel?.Trim() == "beta" ? "beta" : "general");
    command.Parameters.AddWithValue("$releaseId", string.IsNullOrWhiteSpace(releaseId) ? DBNull.Value : releaseId);
    command.Parameters.AddWithValue("$userName", string.IsNullOrWhiteSpace(body.UserName) ? DBNull.Value : body.UserName.Trim());
    command.Parameters.AddWithValue("$userEmail", string.IsNullOrWhiteSpace(body.UserEmail) ? DBNull.Value : body.UserEmail.Trim());
    command.Parameters.AddWithValue("$rating", body.Rating?.Trim() is "positive" or "negative" ? body.Rating.Trim() : "neutral");
    command.Parameters.AddWithValue("$message", body.Message.Trim());
    command.Parameters.AddWithValue("$createdAt", DateTimeOffset.UtcNow.ToString("O"));
    await command.ExecuteNonQueryAsync();
    return (await ListFeedbackAsync()).First(item => item.Id == id);
  }

  async Task<string?> GetCurrentBetaReleaseIdAsync(SqliteConnection connection)
  {
    await using var command = connection.CreateCommand();
    command.CommandText = """
      SELECT Id
      FROM UpdaterReleases
      WHERE Channel = 'beta'
      ORDER BY CreatedAt DESC
      LIMIT 1
      """;
    var result = await command.ExecuteScalarAsync();
    return result?.ToString();
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
    reader.GetString(2) == "normal" || reader.GetInt64(7) > 0,
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

sealed class UpdaterChannelStateStore(IWebHostEnvironment env)
{
  readonly string flagPath = Path.Combine(env.ContentRootPath, "data", "normal-channel-stopped.flag");

  bool Exists()
  {
    Directory.CreateDirectory(Path.GetDirectoryName(flagPath)!);
    return File.Exists(flagPath);
  }

  public Task<bool> IsNormalStoppedAsync() => Task.FromResult(Exists());

  public bool IsNormalStopped() => Exists();

  public Task SetNormalStoppedAsync(bool stopped)
  {
    Directory.CreateDirectory(Path.GetDirectoryName(flagPath)!);
    if (stopped)
      File.WriteAllText(flagPath, DateTimeOffset.UtcNow.ToString("O"));
    else if (File.Exists(flagPath))
      File.Delete(flagPath);
    return Task.CompletedTask;
  }
}

sealed class FeedbackKeyResolver(IMemoryCache cache, ILogger<FeedbackKeyResolver> logger)
{
  const string LiteLLMApiKeyHeader = "x-litellm-api-key";

  public async Task<string> ResolveBetaUserNameAsync(string key, UpdaterBetaOptions beta, IHttpClientFactory clientFactory, CancellationToken cancellationToken)
  {
    var cacheKey = $"username:{ComputeHash(key)}";
    if (cache.TryGetValue(cacheKey, out string? cachedName)) return cachedName ?? string.Empty;

    if (string.IsNullOrWhiteSpace(beta.LiteLLM.BaseUrl))
      return string.Empty;

    using var request = new HttpRequestMessage(HttpMethod.Get, BuildLiteLLMKeyInfoUrl(beta, key));
    request.Headers.TryAddWithoutValidation(LiteLLMApiKeyHeader, ResolveLiteLLMApiKey(beta, key));
    logger.LogDebug("beta username lookup request {Url}", request.RequestUri);

    try
    {
      using var response = await clientFactory.CreateClient().SendAsync(request, cancellationToken);
      if (!response.IsSuccessStatusCode)
      {
        logger.LogWarning("beta username lookup failed {StatusCode} {Url}", response.StatusCode, request.RequestUri);
        cache.Set(cacheKey, "", TimeSpan.FromMinutes(5));
        return string.Empty;
      }

      await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
      using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
      var name = ExtractBetaUserName(document.RootElement, beta);
      logger.LogDebug("beta username lookup result {UserName} {Url}", name ?? "", request.RequestUri);

      cache.Set(cacheKey, name ?? "", TimeSpan.FromMinutes(10));
      return name ?? string.Empty;
    }
    catch (Exception error)
    {
      logger.LogWarning(error, "beta username lookup error {Url}", request.RequestUri);
      cache.Set(cacheKey, "", TimeSpan.FromMinutes(2));
      return string.Empty;
    }
  }

  public async Task<bool> IsBetaMemberAsync(string key, UpdaterBetaOptions beta, IHttpClientFactory clientFactory, CancellationToken cancellationToken)
  {
    if (string.IsNullOrWhiteSpace(beta.LiteLLM.BaseUrl))
      return false;

    using var request = new HttpRequestMessage(HttpMethod.Get, BuildLiteLLMKeyInfoUrl(beta, key));
    request.Headers.TryAddWithoutValidation(LiteLLMApiKeyHeader, ResolveLiteLLMApiKey(beta, key));
    logger.LogDebug("beta membership lookup request {Url}", request.RequestUri);

    try
    {
      using var response = await clientFactory.CreateClient().SendAsync(request, cancellationToken);
      if (!response.IsSuccessStatusCode)
      {
        logger.LogWarning("beta membership lookup failed {StatusCode} {Url}", response.StatusCode, request.RequestUri);
        return false;
      }

      await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
      using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
      var groups = ExtractStrings(document.RootElement, "groups");
      var users = ExtractStrings(document.RootElement, "users");
      var userName = ExtractBetaUserName(document.RootElement, beta);
      var match = MatchesGroups(beta, groups) || MatchesUsers(beta, users) || MatchesAlias(beta, userName);
      logger.LogDebug("beta membership lookup result {Match} {UserName} {Url}", match, userName ?? "", request.RequestUri);
      return match;
    }
    catch (Exception error)
    {
      logger.LogWarning(error, "beta membership lookup error {Url}", request.RequestUri);
      return false;
    }
  }

  static string? ExtractBetaUserName(JsonElement element, UpdaterBetaOptions beta)
  {
    if (element.ValueKind != JsonValueKind.Object) return null;

    var users = ExtractStrings(element, "users");
    foreach (var user in beta.Users)
    {
      if (string.IsNullOrWhiteSpace(user)) continue;
      var match = user.Trim();
      if (users.Contains(match)) return match;
    }

    var groups = ExtractStrings(element, "groups");
    foreach (var group in beta.Groups)
    {
      if (string.IsNullOrWhiteSpace(group)) continue;
      var match = group.Trim();
      if (groups.Contains(match)) return match;
    }

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
      if (property.Value.ValueKind != JsonValueKind.Object && property.Value.ValueKind != JsonValueKind.Array) continue;
      var name = ExtractBetaUserName(property.Value, beta);
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

  static HashSet<string> ExtractStrings(JsonElement element, string name)
  {
    var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var property)) return result;
    if (property.ValueKind != JsonValueKind.Array) return result;
    foreach (var item in property.EnumerateArray())
    {
      if (item.ValueKind != JsonValueKind.String) continue;
      var value = item.GetString()?.Trim();
      if (!string.IsNullOrWhiteSpace(value)) result.Add(value);
    }
    return result;
  }

  static bool MatchesGroups(UpdaterBetaOptions beta, HashSet<string> groups)
  {
    return beta.Groups.Any((group) => !string.IsNullOrWhiteSpace(group) && groups.Contains(group.Trim()));
  }

  static bool MatchesUsers(UpdaterBetaOptions beta, HashSet<string> users)
  {
    return beta.Users.Any((user) => !string.IsNullOrWhiteSpace(user) && users.Contains(user.Trim()));
  }

  static bool MatchesAlias(UpdaterBetaOptions beta, string? userName)
  {
    if (string.IsNullOrWhiteSpace(userName)) return false;
    return beta.Users.Any((user) => string.Equals(user.Trim(), userName.Trim(), StringComparison.OrdinalIgnoreCase));
  }
}
