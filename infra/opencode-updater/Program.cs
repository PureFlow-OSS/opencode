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
builder.Services.Configure<UpdaterOptions>(builder.Configuration.GetSection("Updater"));
builder.Services.AddHttpClient();
builder.Services.AddMemoryCache();
builder.Services.AddCors((options) =>
{
  options.AddDefaultPolicy((policy) => policy
    .AllowAnyOrigin()
    .AllowAnyHeader()
    .AllowAnyMethod());
});
builder.Services.AddSingleton(new LocalFeed(Path.Combine(builder.Environment.ContentRootPath, "data", "feed")));
builder.Services.AddSingleton<FeedOperationGate>();
builder.Services.AddSingleton<UpdaterChannelStateStore>();
builder.Services.AddSingleton<UpdaterVersionResolver>();
builder.Services.AddSingleton<UpdaterRolloutResolver>();
builder.Services.AddSingleton<ModelCardStore>();
builder.Services.AddSingleton<McpConfigStore>();
builder.Services.AddSingleton<McpStoreStore>();
var modelCardSyncSeconds = Math.Max(
  60,
  new ConfigurationBuilder()
    .SetBasePath(builder.Environment.ContentRootPath)
    .AddJsonFile("appsettings.beta.json", optional: true, reloadOnChange: true)
    .Build()
    .GetSection("UpdaterBeta:LiteLLM:SyncIntervalSeconds")
    .Get<int?>() ?? 600
);
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

app.Use(async (context, next) =>
{
  if (context.Request.Path.Equals("/opencode/feedback") || context.Request.Path.Equals("/opencode/admin/feedback"))
  {
    context.Response.Headers["Deprecation"] = "true";
    if (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method))
    {
      context.Response.StatusCode = StatusCodes.Status410Gone;
      await context.Response.WriteAsJsonAsync(new { error = "Feedback endpoints are deprecated" });
      return;
    }
  }

  await next();
});

using (var scope = app.Services.CreateScope())
{
  var db = scope.ServiceProvider.GetRequiredService<FeedbackContext>();
  db.Database.EnsureCreated();
  if (!await HasColumnAsync(db.Database, "Feedbacks", "AttachmentsJson"))
    db.Database.ExecuteSqlRaw(@"ALTER TABLE ""Feedbacks"" ADD COLUMN ""AttachmentsJson"" TEXT NULL");
  if (!await HasColumnAsync(db.Database, "Feedbacks", "BetaSentiment"))
    db.Database.ExecuteSqlRaw(@"ALTER TABLE ""Feedbacks"" ADD COLUMN ""BetaSentiment"" TEXT NULL");
  await EnsureAdminTablesAsync(db.Database.GetDbConnection(), scope.ServiceProvider.GetRequiredService<IWebHostEnvironment>());
  FeedPublication.MigrateLegacy(scope.ServiceProvider.GetRequiredService<IWebHostEnvironment>());
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
  UpdaterConfigStore configStore,
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
  var beta = await configStore.LoadBetaOptionsAsync(request.HttpContext.RequestAborted);

  if (!string.IsNullOrWhiteSpace(key))
  {
    userName = await keyResolver.ResolveBetaUserNameAsync(key, beta, clientFactory, request.HttpContext.RequestAborted);
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
    AppVersion = category == "beta"
      ? await ResolveActiveVersionAsync(
          feed,
          store,
          string.IsNullOrWhiteSpace(key) ? UpdaterChannel.Normal : await keyResolver.ResolveChannelAsync(key, beta, clientFactory, request.HttpContext.RequestAborted)
        ) ?? body.AppVersion?.Trim()
      : body.AppVersion?.Trim(),
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
  await BackfillBetaFeedbackVersionAsync(db, await ResolveActiveVersionAsync(feed, store, UpdaterChannel.Beta, releases), releases);
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
  UpdaterConfigStore configStore,
  LocalFeed feed
) =>
{
  var beta = await configStore.LoadBetaOptionsAsync();
  var releases = await store.ListReleasesAsync();
  var channelStates = new[]
  {
    feed.Status(UpdaterChannel.Beta, channelState, releases),
    feed.Status(UpdaterChannel.AiGilde, channelState, releases),
    feed.Status(UpdaterChannel.Normal, channelState, releases),
  };
  return Results.Json(new
  {
    releases,
    channels = channelStates,
    normalStopped = channelState.IsStopped(UpdaterChannel.Normal),
    betaUserCount = beta.Users.Length,
    betaPositiveThreshold = ChannelPositiveThreshold(UpdaterChannel.Beta, beta),
    aiGildeUserCount = beta.AiGildeUsers.Length,
    aiGildePositiveThreshold = ChannelPositiveThreshold(UpdaterChannel.AiGilde, beta),
    aiGildeFeedVersion = channelStates[1].Version,
    betaRelease = releases.FirstOrDefault((release) => release.Channel == "beta"),
    normalRelease = releases.FirstOrDefault((release) => release.Channel == "normal"),
    betaFeedVersion = channelStates[0].Version,
    normalFeedVersion = channelStates[2].Version,
  });
});

app.MapGet("/opencode/admin/beta/status", async (
  HttpRequest request,
  FeedbackKeyResolver keyResolver,
  UpdaterConfigStore configStore,
  IHttpClientFactory clientFactory
) =>
{
  var beta = await configStore.LoadBetaOptionsAsync();
  var key = request.Headers["X-OpenCode-AiFactory-Api-Key"].FirstOrDefault()?.Trim();
  if (string.IsNullOrWhiteSpace(key))
    return Results.Json(new
    {
      betaTester = false,
      userName = (string?)null,
      betaUserCount = beta.Users.Length,
      betaPositiveThreshold = ChannelPositiveThreshold(UpdaterChannel.Beta, beta),
      aiGildeUserCount = beta.AiGildeUsers.Length,
      aiGildePositiveThreshold = ChannelPositiveThreshold(UpdaterChannel.AiGilde, beta),
    });

  var userName = await keyResolver.ResolveBetaUserNameAsync(key, beta, clientFactory, request.HttpContext.RequestAborted);
  var betaTester = await keyResolver.ResolveChannelAsync(key, beta, clientFactory, request.HttpContext.RequestAborted) != UpdaterChannel.Normal;
  return Results.Json(new
  {
    betaTester,
    userName,
    betaUserCount = beta.Users.Length,
    betaPositiveThreshold = ChannelPositiveThreshold(UpdaterChannel.Beta, beta),
    aiGildeUserCount = beta.AiGildeUsers.Length,
    aiGildePositiveThreshold = ChannelPositiveThreshold(UpdaterChannel.AiGilde, beta),
  });
});

app.MapGet("/opencode/admin/testers", async (UpdaterConfigStore configStore, CancellationToken cancellationToken) =>
{
  var beta = await configStore.LoadBetaOptionsAsync(cancellationToken);
  return Results.Json(new
  {
    betaUsers = beta.Users,
    betaGroups = beta.Groups,
    aiGildeUsers = beta.AiGildeUsers,
    aiGildeGroups = beta.AiGildeGroups,
  });
});

app.MapGet("/opencode/admin/testers/search", async (
  HttpRequest request,
  UpdaterConfigStore configStore,
  FeedbackKeyResolver keyResolver,
  IHttpClientFactory clientFactory,
  CancellationToken cancellationToken
) =>
{
  var term = request.Query["q"].FirstOrDefault()?.Trim() ?? "";
  var beta = await configStore.LoadBetaOptionsAsync(cancellationToken);
  if (string.IsNullOrWhiteSpace(beta.LiteLLM.BaseUrl))
    return Results.BadRequest(new { error = "LiteLLM base URL is not configured" });
  if (string.IsNullOrWhiteSpace(beta.LiteLLM.ApiKey))
    return Results.BadRequest(new { error = "LiteLLM management API key is required to search keys" });

  try
  {
    var keyListUrl = BuildLiteLLMKeyListUrl(beta) + "?size=100&return_full_object=true" + (term == "" ? "" : "&search=" + Uri.EscapeDataString(term));
    using var keyListRequest = new HttpRequestMessage(HttpMethod.Get, keyListUrl);
    keyListRequest.Headers.TryAddWithoutValidation("x-litellm-api-key", beta.LiteLLM.ApiKey.Trim());
    using var keyListResponse = await clientFactory.CreateClient().SendAsync(keyListRequest, cancellationToken);
    if (!keyListResponse.IsSuccessStatusCode)
      return Results.BadRequest(new { error = "LiteLLM key list failed with " + keyListResponse.StatusCode });

    await using var stream = await keyListResponse.Content.ReadAsStreamAsync(cancellationToken);
    using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
    var keys = document.RootElement.ValueKind == JsonValueKind.Array ? document.RootElement : default;
    if (
      keys.ValueKind == JsonValueKind.Undefined &&
      document.RootElement.ValueKind == JsonValueKind.Object &&
      document.RootElement.TryGetProperty("keys", out var keysProperty) &&
      keysProperty.ValueKind == JsonValueKind.Array
    )
      keys = keysProperty;
    if (keys.ValueKind != JsonValueKind.Array)
      return Results.BadRequest(new { error = "Unexpected LiteLLM key list response" });

    var keyHashes = keys.EnumerateArray()
      .Select(ExtractKeyNameOrHash)
      .OfType<KeyListEntry>()
      .Where((entry) => !string.IsNullOrWhiteSpace(entry.Name) || !string.IsNullOrWhiteSpace(entry.Hash))
      .ToArray();

    return Results.Json(new
    {
      results = (await Task.WhenAll(keyHashes.Select((entry) => ResolveKeyEntryNameAsync(entry, beta, keyResolver, clientFactory, cancellationToken))))
        .Where((name) => !string.IsNullOrWhiteSpace(name))
        .Select((name) => name!)
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .Where((name) => term.Length == 0 || name.Contains(term, StringComparison.OrdinalIgnoreCase))
        .OrderBy((name) => name, StringComparer.OrdinalIgnoreCase)
        .Select((name) => new
        {
          userName = name,
          currentChannel = beta.Users.Contains(name, StringComparer.OrdinalIgnoreCase) ? "beta"
            : beta.AiGildeUsers.Contains(name, StringComparer.OrdinalIgnoreCase) ? "ai-gilde"
            : "none",
        })
        .Take(25)
        .ToArray(),
    });
  }
  catch (Exception error) when (error is not OperationCanceledException)
  {
    return Results.Json(new { error = "LiteLLM tester search is unavailable" }, statusCode: StatusCodes.Status502BadGateway);
  }
});

app.MapPut("/opencode/admin/testers", async (UpdaterTesterRequest body, UpdaterConfigStore configStore, CancellationToken cancellationToken) =>
{
  await configStore.SaveTesterListsAsync(
    NormalizeTesterList(body.BetaUsers),
    NormalizeTesterList(body.BetaGroups),
    NormalizeTesterList(body.AiGildeUsers),
    NormalizeTesterList(body.AiGildeGroups),
    cancellationToken
  );
  var beta = await configStore.LoadBetaOptionsAsync(cancellationToken);
  return Results.Json(new
  {
    betaUsers = beta.Users,
    betaGroups = beta.Groups,
    aiGildeUsers = beta.AiGildeUsers,
    aiGildeGroups = beta.AiGildeGroups,
  });
});

app.MapPost("/opencode/admin/releases/upload", async (
  HttpRequest request,
  UpdaterAdminStore store,
  LocalFeed feed,
  FeedOperationGate gate
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

  using var operation = await gate.EnterAsync(request.HttpContext.RequestAborted);
  var published = feed.ChannelPath(UpdaterChannel.Beta);
  var staging = published + ".staging-" + Guid.NewGuid().ToString("N");
  var archiveDirectory = Path.Combine(staging, "_archives");
  var zipName = Path.GetFileName(file.FileName);
  var zipPath = Path.Combine(archiveDirectory, zipName);
  Directory.CreateDirectory(staging);
  Directory.CreateDirectory(archiveDirectory);
  try
  {
  if (Directory.Exists(Path.Combine(published, "_archives")))
    FeedPublication.Copy(Path.Combine(published, "_archives"), archiveDirectory);
  await using (var source = file.OpenReadStream())
  await using (var destination = File.Create(zipPath))
  {
    await source.CopyToAsync(destination, request.HttpContext.RequestAborted);
  }

  await ExtractZipToDirectoryAsync(zipPath, staging, request.HttpContext.RequestAborted);
  var error = LocalFeed.Validate(staging, version);
  if (error is not null)
    return Results.Conflict(new { error });

  var upload = new UploadReleaseRequest(
    version,
    file.FileName,
    await ComputeSha256Async(file, request.HttpContext.RequestAborted),
    file.Length,
    form["notes"].ToString()
  );
  var release = await FeedPublication.PublishAsync(staging, published, () => store.UploadReleaseAsync(upload));
  return Results.Ok(release);
  }
  finally
  {
    if (Directory.Exists(staging)) Directory.Delete(staging, true);
  }
});

app.MapPost("/opencode/admin/releases/{id}/promote", async (
  string id,
  UpdaterAdminStore store,
  LocalFeed feed,
  FeedOperationGate gate,
  HttpRequest request
) =>
{
  using var operation = await gate.EnterAsync(request.HttpContext.RequestAborted);
  var releases = await store.ListReleasesAsync();
  var release = releases.FirstOrDefault((item) => item.Id == id);
  if (release is null) return Results.NotFound();
  if (release.Channel is not ("beta" or "ai-gilde"))
    return Results.BadRequest(new { error = "Only beta and AI-Gilde releases can be promoted" });
  var releaseChannel = UpdaterChannelInfo.Parse(release.Channel);
  var activeVersion = await ResolveActiveVersionAsync(feed, store, releaseChannel, releases);
  if (!string.Equals(release.Version, activeVersion, StringComparison.OrdinalIgnoreCase))
    return Results.BadRequest(new { error = $"A newer {release.Channel} release is active and must be promoted instead" });
  var target = releaseChannel == UpdaterChannel.Beta ? UpdaterChannel.AiGilde : UpdaterChannel.Normal;
  var source = feed.ChannelPath(releaseChannel);
  var validationError = LocalFeed.Validate(source, release.Version);
  if (validationError is not null)
    return Results.Conflict(new { error = validationError });

  var staging = feed.ChannelPath(target) + ".staging-" + Guid.NewGuid().ToString("N");
  try
  {
    FeedPublication.Copy(source, staging, excludeArchives: true);
    var stagedError = LocalFeed.Validate(staging, release.Version);
    if (stagedError is not null) return Results.Conflict(new { error = stagedError });
    var promoted = await FeedPublication.PublishAsync(staging, feed.ChannelPath(target), async () =>
      await store.PromoteReleaseAsync(id, UpdaterChannelName(target), request.HttpContext.RequestAborted)
        ?? throw new InvalidOperationException("Release disappeared during promotion"));
    return Results.Ok(promoted);
  }
  finally
  {
    if (Directory.Exists(staging)) Directory.Delete(staging, true);
  }
});

app.MapPost("/opencode/admin/releases/{channel}/stop", async (string channel, UpdaterChannelStateStore channelState) =>
{
  if (UpdaterChannelInfo.TryParse(channel) is not { } selected)
    return Results.BadRequest(new { error = "channel must be normal, beta, or ai-gilde" });
  await channelState.SetStoppedAsync(selected, true);
  return Results.Ok(new { channel, stopped = true });
});

app.MapPost("/opencode/admin/releases/{channel}/clear", async (string channel, UpdaterChannelStateStore channelState) =>
{
  if (UpdaterChannelInfo.TryParse(channel) is not { } selected)
    return Results.BadRequest(new { error = "channel must be normal, beta, or ai-gilde" });
  await channelState.SetStoppedAsync(selected, false);
  return Results.Ok(new { channel, stopped = false });
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
  if (UpdaterChannelInfo.TryParse(channel) is not { } selectedChannel)
    return Results.BadRequest(new { error = "channel must be normal, beta, or ai-gilde" });
  var config = await configStore.LoadUpdaterOptionsAsync(selectedChannel, context.RequestAborted);
  var cards = modelCards.BuildSnapshot(selectedChannel != UpdaterChannel.Normal, config.ProviderConfig);
  return Results.Json(new
    {
      version = config.Version,
    isBeta = selectedChannel != UpdaterChannel.Normal,
      generatedAt = cards.GeneratedAt,
      aifactory = new
      {
        models = cards.Models,
        model_visibility = config.ProviderConfig.AiFactory.ModelVisibility,
      },
    });
});

app.MapPost("/opencode/admin/modelcards/sync", async (ModelCardStore modelCards, HttpContext context) =>
{
  var synced = await modelCards.SyncAsync(context.RequestAborted, force: true);
  var (source, syncedAt, count) = modelCards.GetSyncInfo();
  return Results.Json(new { synced, source, synced_at = syncedAt, count });
});

app.MapGet("/opencode/admin/model-limits/report", async (
  string? channel,
  UpdaterConfigStore configStore,
  ModelCardStore modelCards,
  HttpContext context
) =>
{
  if (UpdaterChannelInfo.TryParse(channel) is not { } selectedChannel)
    return Results.BadRequest(new { error = "channel must be normal, beta, or ai-gilde" });
  var config = await configStore.LoadUpdaterOptionsAsync(selectedChannel, context.RequestAborted);
  var limits = config.ProviderConfig.AiFactory.ModelLimits
    .Select((rule) =>
    {
      var matched = modelCards.MatchModels(rule.Pattern);
      return new ModelLimitReportEntry(rule.Pattern, matched, matched.Length == 0 && rule.Pattern != "*", rule.Pattern == "*");
    })
    .ToArray();
  var visibility = config.ProviderConfig.AiFactory.ModelVisibility
    .Select((rule) =>
    {
      var matched = modelCards.MatchModels(rule.Pattern);
      return new ModelVisibilityReportEntry(rule.Pattern, rule.Visible, matched.Length == 0 && rule.Pattern != "*", rule.Pattern == "*");
    })
    .ToArray();
  var (source, syncedAt, count) = modelCards.GetSyncInfo();
  return Results.Json(new ModelLimitsReport(selectedChannel != UpdaterChannel.Normal, count, source, syncedAt == DateTimeOffset.MinValue ? null : syncedAt, limits, visibility));
});

app.MapPost("/opencode/admin/model-limits/cleanup", async (
  ModelLimitsCleanupRequest body,
  string? channel,
  UpdaterConfigStore configStore,
  HttpContext context
) =>
{
  var patterns = (body.Patterns ?? [])
    .Where((item) => !string.IsNullOrWhiteSpace(item))
    .Select((item) => item.Trim())
    .Where((item) => item != "*")
    .Distinct(StringComparer.OrdinalIgnoreCase)
    .ToArray();
  if (patterns.Length == 0) return Results.BadRequest(new { error = "No removable patterns provided" });
  if (UpdaterChannelInfo.TryParse(channel) is not { } selectedChannel)
    return Results.BadRequest(new { error = "channel must be normal, beta, or ai-gilde" });
  var removed = await configStore.RemoveModelPatternsAsync(selectedChannel, patterns, context.RequestAborted);
  return Results.Json(new { channel = UpdaterChannelName(selectedChannel), removed, patterns });
});

app.MapGet("/opencode/admin/provider-settings", async (
  string? channel,
  UpdaterConfigStore configStore,
  HttpContext context
) =>
{
  if (UpdaterChannelInfo.TryParse(channel) is not { } selectedChannel)
    return Results.BadRequest(new { error = "channel must be normal, beta, or ai-gilde" });
  var config = await configStore.LoadUpdaterOptionsAsync(selectedChannel, context.RequestAborted);
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
  if (UpdaterChannelInfo.TryParse(channel) is not { } selectedChannel)
    return Results.BadRequest(new { error = "channel must be normal, beta, or ai-gilde" });
  return Results.Json(await configStore.SaveProviderSettingsAsync(
    selectedChannel,
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

  if (UpdaterChannelInfo.TryParse(channel) is not { } selectedChannel)
    return Results.BadRequest(new { error = "channel must be normal, beta, or ai-gilde" });
  var result = await configStore.SaveModelSettingsAsync(model, selectedChannel, settings, context.RequestAborted);
  return Results.Json(result);
});

app.MapPost("/opencode/admin/model-settings/promote", async (
  string model,
  string? channel,
  UpdaterConfigStore configStore,
  HttpContext context
) =>
{
  if (string.IsNullOrWhiteSpace(model)) return Results.BadRequest(new { error = "Model is required" });
  if (string.IsNullOrWhiteSpace(channel) || UpdaterChannelInfo.TryParse(channel) is not { } target)
    return Results.BadRequest(new { error = "channel must be ai-gilde or normal" });
  if (target is not (UpdaterChannel.AiGilde or UpdaterChannel.Normal))
    return Results.BadRequest(new { error = "Beta has no predecessor channel" });
  return Results.Json(await configStore.PromoteModelSettingsAsync(
    model,
    target == UpdaterChannel.AiGilde ? UpdaterChannel.Beta : UpdaterChannel.AiGilde,
    target,
    context.RequestAborted
  ));
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
  if (UpdaterChannelInfo.TryParse(channel) is not { } selectedChannel)
    return Results.BadRequest(new { error = "channel must be normal, beta, or ai-gilde" });
  await modelCards.SyncAsync(context.RequestAborted);
  var maxInputTokens = modelCards.GetMaxInputTokens(model);
  if (maxInputTokens is null) return Results.NotFound(new { error = $"LiteLLM has no max_input_tokens value for {model}" });
  return Results.Json(new { context = await configStore.SyncModelContextAsync(
    model,
    selectedChannel,
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
  if (UpdaterChannelInfo.TryParse(channel) is not { } selectedChannel)
    return Results.BadRequest(new { error = "channel must be normal, beta, or ai-gilde" });
  return await configStore.RemoveModelSettingsAsync(model, selectedChannel, context.RequestAborted)
    ? Results.NoContent()
    : Results.NotFound();
});

app.MapGet("/", () => Results.Redirect("/opencode/version"));

app.MapGet("/opencode/version", async (HttpRequest request, UpdaterRolloutResolver rolloutResolver) =>
{
  var rollout = await rolloutResolver.ResolveAsync(request, request.HttpContext.RequestAborted);
  if (await request.HttpContext.RequestServices.GetRequiredService<UpdaterChannelStateStore>().IsStoppedAsync(rollout.Channel))
    return Results.Json(new { error = $"{UpdaterChannelName(rollout.Channel)} release delivery is stopped" }, statusCode: StatusCodes.Status503ServiceUnavailable);
  return Results.Text(rollout.Version, "text/plain");
});

app.MapGet("/opencode/url", async (HttpRequest request, UpdaterRolloutResolver rolloutResolver) =>
{
  var rollout = await rolloutResolver.ResolveAsync(request, request.HttpContext.RequestAborted);
  if (await request.HttpContext.RequestServices.GetRequiredService<UpdaterChannelStateStore>().IsStoppedAsync(rollout.Channel))
    return Results.Json(new { error = $"{UpdaterChannelName(rollout.Channel)} release delivery is stopped" }, statusCode: StatusCodes.Status503ServiceUnavailable);
  return Results.Text(BuildFeedUrl(rollout, request), "text/plain");
});

app.MapGet("/opencode/config", async (HttpRequest request, UpdaterRolloutResolver rolloutResolver) =>
{
  var rollout = await rolloutResolver.ResolveAsync(request, request.HttpContext.RequestAborted);
  if (request.HttpContext.RequestServices.GetRequiredService<UpdaterChannelStateStore>().IsStopped(rollout.Channel))
    return Results.Json(new { error = "Release delivery is stopped" }, statusCode: StatusCodes.Status503ServiceUnavailable);
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
  if (context.RequestServices.GetRequiredService<UpdaterChannelStateStore>().IsStopped(rollout.Channel))
    return Results.Json(new { error = "Release delivery is stopped" }, statusCode: StatusCodes.Status503ServiceUnavailable);
  if (feed.TryGet("latest.json", rollout.Channel, out var local)) return await ServeLegacyTauriManifestAsync(context, local, rollout);
  return Results.NotFound();
});

app.MapGet("/opencode/changelog.md", async (HttpContext context, LocalFeed feed, UpdaterRolloutResolver rolloutResolver) =>
{
  var rollout = await rolloutResolver.ResolveAsync(context.Request, context.RequestAborted);
  if (feed.TryGet("changelog.md", rollout.Channel, out var local)) return await LocalFileAsync(context, local);
  if (rollout.Channel != UpdaterChannel.Normal && feed.TryGet("changelog.md", UpdaterChannel.Normal, out var stable)) return await LocalFileAsync(context, stable);
  return Results.NotFound();
});

app.MapGet("/opencode/provider-config.json", async (HttpRequest request, UpdaterRolloutResolver rolloutResolver, McpConfigStore mcps) =>
{
  var rollout = await rolloutResolver.ResolveAsync(request, request.HttpContext.RequestAborted);
  var config = ApplyReasoningSettings(rollout.Options.ProviderConfig);
  config.Mcp = await mcps.ApplyAsync(config.Mcp, UpdaterChannelName(rollout.Channel), request.HttpContext.RequestAborted);
  return Results.Json(config);
});

app.MapGet("/opencode/mcp-store.json", async (McpStoreStore store, CancellationToken cancellationToken) =>
  Results.Json(await store.ListPublicAsync(cancellationToken)));

app.MapGet("/opencode/admin/mcp", async (string? channel, UpdaterConfigStore configStore, McpConfigStore mcps, CancellationToken cancellationToken) =>
{
  if (UpdaterChannelInfo.TryParse(channel) is not { } selectedChannel)
    return Results.BadRequest(new { error = "channel must be normal, beta, or ai-gilde" });
  var options = await configStore.LoadUpdaterOptionsAsync(selectedChannel, cancellationToken);
  var items = await mcps.ApplyAsync(options.ProviderConfig.Mcp, UpdaterChannelName(selectedChannel), cancellationToken);
  return Results.Json(items.OrderBy((item) => item.Key).ToDictionary((item) => item.Key, (item) => item.Value));
});

app.MapPut("/opencode/admin/mcp/{name}", async (string name, string? channel, McpConfigOptions body, McpConfigStore mcps, CancellationToken cancellationToken) =>
{
  var error = McpConfigStore.Validate(name, body);
  if (error is not null) return Results.BadRequest(new { error });
  if (UpdaterChannelInfo.TryParse(channel) is not { } selectedChannel)
    return Results.BadRequest(new { error = "channel must be normal, beta, or ai-gilde" });
  await mcps.SetAsync(UpdaterChannelName(selectedChannel), name, body, cancellationToken);
  return Results.Ok(new { name = name.Trim(), config = body });
});

app.MapDelete("/opencode/admin/mcp/{name}", async (string name, string? channel, McpConfigStore mcps, CancellationToken cancellationToken) =>
{
  if (string.IsNullOrWhiteSpace(name)) return Results.BadRequest(new { error = "MCP name is required" });
  if (UpdaterChannelInfo.TryParse(channel) is not { } selectedChannel)
    return Results.BadRequest(new { error = "channel must be normal, beta, or ai-gilde" });
  await mcps.DeleteAsync(UpdaterChannelName(selectedChannel), name, cancellationToken);
  return Results.NoContent();
});

app.MapGet("/opencode/admin/mcp-store", async (McpStoreStore store, CancellationToken cancellationToken) =>
{
  var items = await store.ListAsync(cancellationToken);
  return Results.Json(items.OrderByDescending((item) => item.UpdatedAt));
});

app.MapPut("/opencode/admin/mcp-store/{name}", async (string name, McpStoreOptions body, McpStoreStore store, CancellationToken cancellationToken) =>
{
  var error = McpStoreStore.Validate(name, body);
  if (error is not null) return Results.BadRequest(new { error });
  await store.SetAsync(name, body, cancellationToken);
  return Results.Ok(new { name = name.Trim(), item = body });
});

app.MapDelete("/opencode/admin/mcp-store/{name}", async (string name, McpStoreStore store, CancellationToken cancellationToken) =>
{
  if (string.IsNullOrWhiteSpace(name)) return Results.BadRequest(new { error = "Store entry name is required" });
  await store.DeleteAsync(name, cancellationToken);
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
  if (context.RequestServices.GetRequiredService<UpdaterChannelStateStore>().IsStopped(rollout.Channel))
    return Results.Json(new { error = "Release delivery is stopped" }, statusCode: StatusCodes.Status503ServiceUnavailable);
  var resolvedAsset = (asset ?? "").TrimStart('/');
  if (string.IsNullOrWhiteSpace(resolvedAsset) || resolvedAsset.Contains("..", StringComparison.Ordinal))
    return Results.BadRequest();

  if (feed.TryGet(resolvedAsset, rollout.Channel, out var local)) return await LocalFileAsync(context, local);
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
  return rollout.Channel != UpdaterChannel.Normal && !string.IsNullOrWhiteSpace(rollout.ChannelToken)
    ? $"{baseUrl}?beta={rollout.ChannelToken}"
    : baseUrl;
}

static string BuildAssetUrl(UpdaterRollout rollout, HttpRequest request, string asset)
{
  return AppendChannelToken(new UriBuilder($"{GetPublicBaseUrl(rollout.Options, request).TrimEnd('/')}/opencode/feed/{Uri.EscapeDataString(asset)}"), rollout);
}

static string AppendChannelToken(UriBuilder url, UpdaterRollout rollout)
{
  if (rollout.Channel == UpdaterChannel.Normal || string.IsNullOrWhiteSpace(rollout.ChannelToken)) return url.Uri.ToString();
  var query = url.Query.TrimStart('?')
    .Split('&', StringSplitOptions.RemoveEmptyEntries)
    .Where((part) => !part.StartsWith("beta=", StringComparison.OrdinalIgnoreCase))
    .Append($"beta={rollout.ChannelToken}");
  url.Query = string.Join("&", query);
  return url.Uri.ToString();
}

static async Task<IResult> ServeLegacyTauriManifestAsync(HttpContext context, string path, UpdaterRollout rollout)
{
  await using var stream = File.OpenRead(path);
  JsonObject? manifest;
  try { manifest = await JsonNode.ParseAsync(stream, cancellationToken: context.RequestAborted) as JsonObject; }
  catch (JsonException)
  {
    return Results.Json(new { error = "latest.json contains invalid JSON" }, statusCode: StatusCodes.Status400BadRequest);
  }
  if (manifest is null)
    return Results.Json(new { error = "latest.json must contain a JSON object" }, statusCode: StatusCodes.Status400BadRequest);

  if (manifest["platforms"] is JsonObject platforms)
  {
    foreach (var platform in platforms)
    {
      if (platform.Value is not JsonObject target || target["url"] is not JsonValue url) continue;
      if (!url.TryGetValue<string>(out var installer) || string.IsNullOrWhiteSpace(installer))
        return Results.Json(new { error = "latest.json platform URLs must be non-empty strings" }, statusCode: StatusCodes.Status400BadRequest);
      if (Uri.TryCreate(installer, UriKind.Absolute, out var absolute))
      {
        if (absolute.Scheme is not "http" and not "https")
          return Results.Json(new { error = "latest.json installer URLs must use HTTP or HTTPS" }, statusCode: StatusCodes.Status400BadRequest);
        var publicBase = new Uri(GetPublicBaseUrl(rollout.Options, context.Request).TrimEnd('/'));
        if (absolute.Scheme == publicBase.Scheme && absolute.Authority == publicBase.Authority)
          target["url"] = AppendChannelToken(new UriBuilder(absolute), rollout);
        continue;
      }

      var asset = Path.GetFileName(installer);
      if (
        string.IsNullOrWhiteSpace(asset) ||
        asset != installer ||
        installer.Contains('/') ||
        installer.Contains('\\') ||
        asset is "." or ".."
      )
        return Results.Json(new { error = "latest.json platform URLs must be absolute URLs or asset basenames" }, statusCode: StatusCodes.Status400BadRequest);
      target["url"] = BuildAssetUrl(rollout, context.Request, asset);
    }
  }

  return Results.Text(manifest.ToJsonString(), "application/json; charset=utf-8");
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
    if (!outputPath.StartsWith(Path.GetFullPath(targetDirectory) + Path.DirectorySeparatorChar, StringComparison.Ordinal))
      throw new InvalidDataException("Archive entry escapes the release directory");

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

static string? ParseBetaFeedback(string text)
{
  var normalized = text.TrimStart();
  var match = Regex.Match(normalized, @"^(Version erfolgreich getestet|Fehler gefunden)\b", RegexOptions.IgnoreCase);
  if (!match.Success) return null;
  return match.Groups[1].Value.Equals("Version erfolgreich getestet", StringComparison.OrdinalIgnoreCase) ? "positive" : "negative";
}

static string[] NormalizeTesterList(string[]? values) =>
  (values ?? [])
    .Select((value) => value.Trim())
    .Where((value) => value.Length > 0)
    .Distinct(StringComparer.OrdinalIgnoreCase)
    .ToArray();

static string? ExtractKeyName(JsonElement key)
{
  if (key.ValueKind != JsonValueKind.Object) return null;
  foreach (var field in new[] { "key_alias", "key_name", "alias", "name" })
  {
    if (!key.TryGetProperty(field, out var property) || property.ValueKind != JsonValueKind.String) continue;
    var value = property.GetString()?.Trim();
    if (string.IsNullOrWhiteSpace(value)) continue;
    return value.Split(" - ", 2, StringSplitOptions.TrimEntries)[0];
  }
  foreach (var field in new[] { "user", "user_id", "username", "display_name", "team", "team_id", "team_alias" })
  {
    if (!key.TryGetProperty(field, out var property) || property.ValueKind != JsonValueKind.String) continue;
    var value = property.GetString()?.Trim();
    if (!string.IsNullOrWhiteSpace(value)) return value;
  }
  return null;
}

static KeyListEntry? ExtractKeyNameOrHash(JsonElement entry)
{
  if (entry.ValueKind == JsonValueKind.String)
  {
    var hash = entry.GetString()?.Trim();
    return string.IsNullOrWhiteSpace(hash) ? null : new KeyListEntry(null, hash);
  }
  if (entry.ValueKind != JsonValueKind.Object) return null;
  var name = ExtractKeyName(entry);
  return string.IsNullOrWhiteSpace(name) && entry.TryGetProperty("key", out var keyProperty) && keyProperty.ValueKind == JsonValueKind.String
    ? new KeyListEntry(name, keyProperty.GetString()?.Trim())
    : new KeyListEntry(name, null);
}

static async Task<string?> ResolveKeyEntryNameAsync(KeyListEntry entry, UpdaterBetaOptions beta, FeedbackKeyResolver keyResolver, IHttpClientFactory clientFactory, CancellationToken cancellationToken)
{
  if (!string.IsNullOrWhiteSpace(entry.Name)) return entry.Name;
  if (string.IsNullOrWhiteSpace(entry.Hash)) return null;
  var name = await keyResolver.ResolveBetaUserNameAsync(entry.Hash, beta, clientFactory, cancellationToken);
  return string.IsNullOrWhiteSpace(name) ? null : name;
}

static string BuildLiteLLMKeyListUrl(UpdaterBetaOptions beta) =>
  $"{beta.LiteLLM.BaseUrl.TrimEnd('/')}/{beta.LiteLLM.KeyListPath.TrimStart('/')}";

static string UpdaterChannelName(UpdaterChannel channel) => UpdaterChannelInfo.Name(channel);

static int ChannelPositiveThreshold(UpdaterChannel channel, UpdaterBetaOptions options) =>
  Math.Max(1, (int)Math.Ceiling((channel == UpdaterChannel.Beta ? options.Users : options.AiGildeUsers).Length / 2.0));

static async Task<string?> ResolveActiveVersionAsync(LocalFeed feed, UpdaterAdminStore store, UpdaterChannel channel, List<ReleaseRecord>? releases = null)
{
  var feedVersion = feed.TryReadVersionFromLatestYml(channel);
  if (!string.IsNullOrWhiteSpace(feedVersion)) return feedVersion;
  return (releases ?? await store.ListReleasesAsync())
    .FirstOrDefault((release) => release.Channel == UpdaterChannelName(channel))?.Version;
}

static async Task BackfillBetaFeedbackVersionAsync(FeedbackContext db, string? version, List<ReleaseRecord> releases)
{
  if (string.IsNullOrWhiteSpace(version)) return;
  var betaVersions = releases.Where((release) => release.Channel is "beta" or "ai-gilde").Select((release) => release.Version).ToArray();
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

    CREATE TABLE IF NOT EXISTS UpdaterMcpStore (
      Name TEXT PRIMARY KEY NOT NULL,
      Config TEXT NOT NULL,
      Deleted INTEGER NOT NULL DEFAULT 0,
      UpdatedAt TEXT NOT NULL
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
  public string[] AiGildeGroups { get; set; } = [];
  public string[] AiGildeUsers { get; set; } = [];
  public LiteLLMBetaOptions LiteLLM { get; set; } = new();
}

sealed class LiteLLMBetaOptions
{
  public string BaseUrl { get; set; } = "";
  public string KeyInfoPath { get; set; } = "/key/info";
  public string KeyListPath { get; set; } = "/key/list";
  public string ApiKey { get; set; } = "";
  public string ModelInfoPath { get; set; } = "/model/info";
  public string ModelsPath { get; set; } = "/v1/models";
  public int SyncIntervalSeconds { get; set; } = 600;
}

sealed record UpdaterRollout(UpdaterOptions Options, string Version, UpdaterChannel Channel, string? ChannelToken = null)
{
  public bool IsBeta => Channel != UpdaterChannel.Normal;
}

enum UpdaterChannel { Normal, AiGilde, Beta }

static class UpdaterChannelInfo
{
  public static string Name(UpdaterChannel channel) => channel switch
  {
    UpdaterChannel.Beta => "beta",
    UpdaterChannel.AiGilde => "ai-gilde",
    _ => "normal",
  };

  public static UpdaterChannel? TryParse(string? channel) => channel?.Trim().ToLowerInvariant() switch
  {
    null or "" or "normal" or "stable" => UpdaterChannel.Normal,
    "beta" => UpdaterChannel.Beta,
    "ai-gilde" => UpdaterChannel.AiGilde,
    _ => null,
  };

  public static UpdaterChannel Parse(string? channel) => TryParse(channel) ?? UpdaterChannel.Normal;
}

sealed record UpdaterTesterRequest(string[]? BetaUsers, string[]? BetaGroups, string[]? AiGildeUsers, string[]? AiGildeGroups);

record KeyListEntry(string? Name, string? Hash);

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
  bool DocumentOcrNativePdf,
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
  bool? DocumentOcrNativePdf,
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

sealed class ModelCardStore(UpdaterConfigStore configStore, IHttpClientFactory clientFactory, ILogger<ModelCardStore> logger)
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
        match?.DocumentOcrNativePdf ?? false,
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
            match.DocumentOcrNativePdf,
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

  public async Task<bool> SyncAsync(CancellationToken cancellationToken, bool force = false)
  {
    var beta = await configStore.LoadBetaOptionsAsync(cancellationToken);
    if (string.IsNullOrWhiteSpace(beta.LiteLLM.BaseUrl)) return false;
    var acquired = force
      ? await syncGate.WaitAsync(TimeSpan.FromSeconds(30), cancellationToken)
      : await syncGate.WaitAsync(0, cancellationToken);
    if (!acquired) return false;

    try
    {
      var modelInfo = await TryLoadModelInfoAsync(beta, cancellationToken);
      cached = modelInfo.Length > 0 ? modelInfo : await TryLoadModelsAsync(beta, cancellationToken);
      syncedAt = DateTimeOffset.UtcNow;
      source = modelInfo.Length > 0 ? "litellm:/model/info" : "litellm:/v1/models";
      logger.LogInformation("synced model cards from {Source} count={Count}", source, cached.Length);
      return true;
    }
    finally
    {
      syncGate.Release();
    }
  }

  public int? GetMaxInputTokens(string model) => cached
    .FirstOrDefault((item) => string.Equals(item.Name, model, StringComparison.OrdinalIgnoreCase))
    ?.Context;

  public string[] GetModelNames() => cached.Select((item) => item.Name).ToArray();

  public (string? Source, DateTimeOffset SyncedAt, int Count) GetSyncInfo() => (source, syncedAt, cached.Length);

  public string[] MatchModels(string pattern) => string.IsNullOrWhiteSpace(pattern)
    ? []
    : cached.Select((item) => item.Name).Where((name) => ScoreRule(pattern, name) >= 0).ToArray();

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

  public static int ScoreRule(string pattern, string model)
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

  [ConfigurationKeyName("document_ocr_native_pdf")]
  [JsonPropertyName("document_ocr_native_pdf")]
  public bool? DocumentOcrNativePdf { get; set; }

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

  [JsonPropertyName("document_ocr_native_pdf")]
  public bool? DocumentOcrNativePdf { get; set; }

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

sealed record ModelLimitReportEntry(string Pattern, string[] MatchedModels, bool Stale, bool Fallback);

sealed record ModelVisibilityReportEntry(string Pattern, bool? Visible, bool Stale, bool Fallback);

sealed record ModelLimitsReport(bool IsBeta, int ModelCount, string? Source, DateTimeOffset? SyncedAt, ModelLimitReportEntry[] Limits, ModelVisibilityReportEntry[] Visibility);

sealed record ModelLimitsCleanupRequest(string[] Patterns);

sealed record ModelSettingsPromotionResult(bool Promoted, bool CopiedLimits, bool CopiedVisibility);

sealed class UpdaterConfigStore(IWebHostEnvironment environment)
{
  readonly SemaphoreSlim gate = new(1, 1);
  readonly JsonSerializerOptions json = new() { WriteIndented = true };

  public async Task<ModelSettingsRequest> SaveModelSettingsAsync(string model, UpdaterChannel channel, ModelSettingsRequest settings, CancellationToken cancellationToken)
  {
    await gate.WaitAsync(cancellationToken);
    try
    {
      var root = await LoadChannelAsync(channel, cancellationToken);
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
      rule["document_ocr_native_pdf"] = settings.DocumentOcrNativePdf;
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
      await SaveAsync(root, channel, cancellationToken);
      return settings;
    }
    finally
    {
      gate.Release();
    }
  }

  public async Task<ProviderSettingsRequest> SaveProviderSettingsAsync(UpdaterChannel channel, ProviderSettingsRequest settings, CancellationToken cancellationToken)
  {
    await gate.WaitAsync(cancellationToken);
    try
    {
      var root = await LoadChannelAsync(channel, cancellationToken);
      var provider = GetObject(GetObject(root, "Updater"), "ProviderConfig");
      provider["model"] = settings.Model?.Trim();
      provider["small_model"] = settings.SmallModel?.Trim();
      await SaveAsync(root, channel, cancellationToken);
      return settings;
    }
    finally
    {
      gate.Release();
    }
  }

  public async Task<int> SyncModelContextAsync(string model, UpdaterChannel channel, int context, CancellationToken cancellationToken)
  {
    await gate.WaitAsync(cancellationToken);
    try
    {
      var root = await LoadChannelAsync(channel, cancellationToken);
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
      await SaveAsync(root, channel, cancellationToken);
      return context;
    }
    finally
    {
      gate.Release();
    }
  }

  public async Task<bool> RemoveModelSettingsAsync(string model, UpdaterChannel channel, CancellationToken cancellationToken)
  {
    await gate.WaitAsync(cancellationToken);
    try
    {
      var root = await LoadChannelAsync(channel, cancellationToken);
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
      await SaveAsync(root, channel, cancellationToken);
      return true;
    }
    finally
    {
      gate.Release();
    }
  }

  public async Task<int> RemoveModelPatternsAsync(UpdaterChannel channel, IEnumerable<string> patterns, CancellationToken cancellationToken)
  {
    await gate.WaitAsync(cancellationToken);
    try
    {
      var root = await LoadChannelAsync(channel, cancellationToken);
      var limits = GetModelLimits(root);
      var visibility = GetModelVisibility(root);
      var removed = 0;
      foreach (var pattern in patterns)
      {
        var normalized = pattern?.Trim();
        if (string.IsNullOrWhiteSpace(normalized) || normalized == "*") continue;
        foreach (var rule in limits.OfType<JsonObject>()
                   .Where((rule) => string.Equals(rule["pattern"]?.GetValue<string>(), normalized, StringComparison.OrdinalIgnoreCase))
                   .ToArray())
        {
          limits.Remove(rule);
          removed++;
        }
        foreach (var rule in visibility.OfType<JsonObject>()
                   .Where((rule) => string.Equals(rule["pattern"]?.GetValue<string>(), normalized, StringComparison.OrdinalIgnoreCase))
                   .ToArray())
        {
          visibility.Remove(rule);
        }
      }
      if (removed > 0) await SaveAsync(root, channel, cancellationToken);
      return removed;
    }
    finally
    {
      gate.Release();
    }
  }

  public async Task<UpdaterOptions> LoadUpdaterOptionsAsync(UpdaterChannel channel, CancellationToken cancellationToken)
  {
    var root = await LoadChannelAsync(channel, cancellationToken);
    var updater = root["Updater"] as JsonObject ?? new JsonObject();
    var options = JsonSerializer.Deserialize<UpdaterOptions>(updater.ToJsonString(), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new UpdaterOptions();
    if (channel != UpdaterChannel.Normal)
    {
      // Model policy is independent; release metadata may still use the normal
      // fallback when a newly configured stage has no feed or explicit version.
      var normal = await LoadUpdaterOptionsAsync(UpdaterChannel.Normal, cancellationToken);
      if (!updater.Any((item) => item.Key.Equals("Version", StringComparison.OrdinalIgnoreCase))) options.Version = normal.Version;
      if (!updater.Any((item) => item.Key.Equals("PublicBaseUrl", StringComparison.OrdinalIgnoreCase))) options.PublicBaseUrl = normal.PublicBaseUrl;
    }
    return options;
  }

  public async Task<UpdaterBetaOptions> LoadBetaOptionsAsync(CancellationToken cancellationToken = default)
  {
    var root = await LoadAsync(true, cancellationToken);
    return JsonSerializer.Deserialize<UpdaterBetaOptions>(root["UpdaterBeta"]?.ToJsonString() ?? "{}", new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new UpdaterBetaOptions();
  }

  public async Task SaveTesterListsAsync(string[] betaUsers, string[] betaGroups, string[] aiGildeUsers, string[] aiGildeGroups, CancellationToken cancellationToken)
  {
    await gate.WaitAsync(cancellationToken);
    try
    {
      var root = await LoadAsync(true, cancellationToken);
      var beta = GetObject(root, "UpdaterBeta");
      beta["Users"] = JsonSerializer.SerializeToNode(betaUsers, json);
      beta["Groups"] = JsonSerializer.SerializeToNode(betaGroups, json);
      beta["AiGildeUsers"] = JsonSerializer.SerializeToNode(aiGildeUsers, json);
      beta["AiGildeGroups"] = JsonSerializer.SerializeToNode(aiGildeGroups, json);
      await SaveAsync(root, UpdaterChannel.Beta, cancellationToken);
    }
    finally
    {
      gate.Release();
    }
  }

  public async Task<ModelSettingsPromotionResult> PromoteModelSettingsAsync(string model, UpdaterChannel source, UpdaterChannel target, CancellationToken cancellationToken)
  {
    await gate.WaitAsync(cancellationToken);
    try
    {
      var sourceRoot = await LoadChannelAsync(source, cancellationToken);
      var targetRoot = await LoadChannelAsync(target, cancellationToken);
      var limit = MaterializeModelRule(GetModelLimits(sourceRoot), model);
      var visibility = MaterializeModelRule(GetModelVisibility(sourceRoot), model, visibility: true);
      var copiedLimit = false;
      var copiedVisibility = false;

      if (limit is not null)
      {
        ReplaceModelRule(GetModelLimits(targetRoot), model, limit);
        copiedLimit = true;
      }
      if (visibility is not null)
      {
        ReplaceModelRule(GetModelVisibility(targetRoot), model, visibility);
        copiedVisibility = true;
      }
      if (!copiedLimit && !copiedVisibility) return new ModelSettingsPromotionResult(false, false, false);

      await SaveAsync(targetRoot, target, cancellationToken);
      return new ModelSettingsPromotionResult(true, copiedLimit, copiedVisibility);
    }
    finally
    {
      gate.Release();
    }
  }

  async Task<JsonObject> LoadAsync(bool beta, CancellationToken cancellationToken)
  {
    var path = Path.Combine(environment.ContentRootPath, beta ? "appsettings.beta.json" : "appsettings.json");
    if (!File.Exists(path)) return new JsonObject();
    await using var stream = File.OpenRead(path);
    return await JsonNode.ParseAsync(stream, cancellationToken: cancellationToken) as JsonObject ?? new JsonObject();
  }

  async Task<JsonObject> LoadChannelAsync(UpdaterChannel channel, CancellationToken cancellationToken)
  {
    var path = ChannelPath(channel);
    if (!File.Exists(path)) return new JsonObject();
    await using var stream = File.OpenRead(path);
    return await JsonNode.ParseAsync(stream, cancellationToken: cancellationToken) as JsonObject ?? new JsonObject();
  }

  async Task SaveAsync(JsonObject root, UpdaterChannel channel, CancellationToken cancellationToken)
  {
    var path = ChannelPath(channel);
    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
    await File.WriteAllTextAsync(path, root.ToJsonString(json), cancellationToken);
  }

  string ChannelPath(UpdaterChannel channel)
  {
    var file = channel switch
    {
      UpdaterChannel.Beta => "appsettings.beta.json",
      UpdaterChannel.AiGilde => "appsettings.ai-gilde.json",
      _ => "appsettings.json",
    };
    var path = Path.Combine(environment.ContentRootPath, file);
    // Existing installations may bind-mount this file. Otherwise use the persistent
    // data volume, so a newly configured third stage survives container recreation.
    return channel == UpdaterChannel.AiGilde && !File.Exists(path)
      ? Path.Combine(environment.ContentRootPath, "data", file)
      : path;
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

  static JsonObject? MaterializeModelRule(JsonArray rules, string model, bool visibility = false)
  {
    var matches = rules.OfType<JsonObject>()
      .Select((rule) => new { rule, score = ModelCardStore.ScoreRule(rule["pattern"]?.GetValue<string>() ?? "", model) })
      .Where((item) => item.score >= 0);
    var selected = visibility ? matches.LastOrDefault()?.rule : matches.OrderByDescending((item) => item.score).FirstOrDefault()?.rule;
    if (selected is null) return null;
    var materialized = selected.DeepClone().AsObject();
    materialized["pattern"] = model;
    return materialized;
  }

  static void ReplaceModelRule(JsonArray rules, string model, JsonObject rule)
  {
    foreach (var existing in rules.OfType<JsonObject>()
               .Where((rule) => string.Equals(rule["pattern"]?.GetValue<string>(), model, StringComparison.OrdinalIgnoreCase))
               .ToArray())
      rules.Remove(existing);
    rules.Add(rule);
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

sealed class McpStoreOptions
{
  [JsonPropertyName("oauthRequired")]
  public bool OAuthRequired { get; set; }

  [JsonPropertyName("name")]
  public string Name { get; set; } = "";

  [JsonPropertyName("description")]
  public string? Description { get; set; }

  [JsonPropertyName("url")]
  public string Url { get; set; } = "";

  [JsonPropertyName("headerNames")]
  public string[] HeaderNames { get; set; } = [];

  [JsonPropertyName("headerPlaceholder")]
  public string? HeaderPlaceholder { get; set; }

  [JsonPropertyName("enabled")]
  public bool Enabled { get; set; } = true;

  [JsonPropertyName("updatedAt")]
  public string? UpdatedAt { get; set; }
}

sealed class McpStoreStore(IWebHostEnvironment env)
{
  readonly string dbPath = Path.Combine(env.ContentRootPath, "data", "feedback.db");

  async Task<SqliteConnection> OpenAsync()
  {
    Directory.CreateDirectory(Path.GetDirectoryName(dbPath)!);
    var connection = new SqliteConnection($"Data Source={dbPath}");
    await connection.OpenAsync();
    return connection;
  }

  public static string? Validate(string name, McpStoreOptions config)
  {
    if (string.IsNullOrWhiteSpace(name)) return "Store entry name is required";
    if (name.Trim().Length > 128) return "Store entry name must not exceed 128 characters";
    if (!Uri.TryCreate(config.Url, UriKind.Absolute, out var uri)) return "Store entries require an absolute URL";
    if (uri.Scheme is not ("http" or "https")) return "Store URLs must use HTTP or HTTPS";
    if (!config.OAuthRequired && config.HeaderNames.Length == 0) return "Store entries require at least one header name or OAuth";
    if (config.HeaderNames.Any((header) => string.IsNullOrWhiteSpace(header) || header.Trim().Length > 128)) return "Header names must be non-empty and at most 128 characters";
    if (new HashSet<string>(config.HeaderNames.Select((header) => header.Trim()), StringComparer.OrdinalIgnoreCase).Count != config.HeaderNames.Length) return "Header names must be unique";
    return null;
  }

  public async Task<List<McpStoreOptions>> ListAsync(CancellationToken cancellationToken)
  {
    await using var connection = await OpenAsync();
    await using var command = connection.CreateCommand();
    command.CommandText = "SELECT Name, Config FROM UpdaterMcpStore WHERE Deleted = 0 ORDER BY Name";
    await using var reader = await command.ExecuteReaderAsync(cancellationToken);
    var items = new List<McpStoreOptions>();
    while (await reader.ReadAsync(cancellationToken))
    {
      var config = JsonSerializer.Deserialize<McpStoreOptions>(reader.GetString(1));
      if (config is null) continue;
      config.Name = reader.GetString(0);
      items.Add(config);
    }
    return items;
  }

  public async Task<List<object>> ListPublicAsync(CancellationToken cancellationToken)
  {
    var items = await ListAsync(cancellationToken);
    return items
      .Where((item) => item.Enabled)
      .Select((item) => (object)new
      {
        name = item.Name,
        description = item.Description,
        url = item.Url,
        headerNames = item.HeaderNames,
        headerPlaceholder = item.HeaderPlaceholder,
        oauthRequired = item.OAuthRequired,
      })
      .ToList();
  }

  public async Task SetAsync(string name, McpStoreOptions config, CancellationToken cancellationToken)
  {
    await using var connection = await OpenAsync();
    await using var command = connection.CreateCommand();
    command.CommandText = """
      INSERT INTO UpdaterMcpStore (Name, Config, Deleted, UpdatedAt)
      VALUES ($name, $config, 0, $updatedAt)
      ON CONFLICT(Name) DO UPDATE SET Config = excluded.Config, Deleted = 0, UpdatedAt = excluded.UpdatedAt
      """;
    command.Parameters.AddWithValue("$name", name.Trim());
    command.Parameters.AddWithValue("$config", JsonSerializer.Serialize(new
    {
      description = config.Description,
      url = config.Url,
      headerNames = config.HeaderNames,
      headerPlaceholder = config.HeaderPlaceholder,
      oauthRequired = config.OAuthRequired,
      enabled = config.Enabled,
    }));
    command.Parameters.AddWithValue("$updatedAt", DateTimeOffset.UtcNow.ToString("O"));
    await command.ExecuteNonQueryAsync(cancellationToken);
  }

  public async Task DeleteAsync(string name, CancellationToken cancellationToken)
  {
    await using var connection = await OpenAsync();
    await using var command = connection.CreateCommand();
    command.CommandText = """
      INSERT INTO UpdaterMcpStore (Name, Config, Deleted, UpdatedAt)
      VALUES ($name, '{}', 1, $updatedAt)
      ON CONFLICT(Name) DO UPDATE SET Deleted = 1, UpdatedAt = excluded.UpdatedAt
      """;
    command.Parameters.AddWithValue("$name", name.Trim());
    command.Parameters.AddWithValue("$updatedAt", DateTimeOffset.UtcNow.ToString("O"));
    await command.ExecuteNonQueryAsync(cancellationToken);
  }
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

  public static string NormalizeChannel(string? channel) => UpdaterChannelInfo.Name(UpdaterChannelInfo.Parse(channel));

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
  public string ChannelPath(UpdaterChannel channel) => Path.Combine(root, ChannelName(channel));

  public ChannelStatus Status(UpdaterChannel channel, UpdaterChannelStateStore state, IReadOnlyList<ReleaseRecord> releases)
  {
    var version = TryReadVersionFromLatestYml(channel);
    var release = releases.FirstOrDefault((item) => item.Channel == ChannelName(channel) && item.Version == version)
      ?? releases.FirstOrDefault((item) => item.Version == version)
      ?? releases.FirstOrDefault((item) => item.Channel == ChannelName(channel));
    return new ChannelStatus(ChannelName(channel), version ?? release?.Version, release, state.IsStopped(channel), FilesAvailable(channel));
  }

  public bool FilesAvailable(UpdaterChannel channel) => Validate(ChannelPath(channel), TryReadVersionFromLatestYml(channel)) is null;

  public static string? Validate(string directory, string? expectedVersion)
  {
    var latest = Path.Combine(directory, "latest.yml");
    if (!File.Exists(latest)) return "Release package latest.yml is missing";
    var content = File.ReadAllText(latest);
    var version = Regex.Match(content, @"(?m)^\s*version:\s*[""']?(?<value>[^""'\r\n#]+)");
    if (!version.Success || string.IsNullOrWhiteSpace(expectedVersion) || version.Groups["value"].Value.Trim() != expectedVersion)
      return "Release package version does not match the release record";
    var installer = Regex.Match(content, @"(?m)^path:\s*[""']?(?<value>[^""'\r\n#]+)");
    if (!installer.Success) installer = Regex.Match(content, @"(?m)^\s*-\s*url:\s*[""']?(?<value>[^""'\r\n#]+)");
    if (!installer.Success) return "Release package has no installer reference";
    var relative = installer.Groups["value"].Value.Trim();
    var prefix = Path.GetFullPath(directory) + Path.DirectorySeparatorChar;
    var path = Path.GetFullPath(Path.Combine(directory, relative));
    if (!path.StartsWith(prefix, StringComparison.Ordinal) || !File.Exists(path))
      return "Release package installer is missing";
    return null;
  }

  static string ChannelName(UpdaterChannel channel) => channel switch
  {
    UpdaterChannel.Beta => "beta",
    UpdaterChannel.AiGilde => "ai-gilde",
    _ => "normal",
  };

  public bool TryGet(string relativePath, UpdaterChannel channel, out string file)
  {
    var channelRoot = ChannelPath(channel);
    file = Path.Combine(channelRoot, relativePath.Replace('/', Path.DirectorySeparatorChar));
    return File.Exists(file);
  }

  public bool TryGet(string relativePath, bool beta, out string file) =>
    TryGet(relativePath, beta ? UpdaterChannel.Beta : UpdaterChannel.Normal, out file);

  public string? TryReadVersionFromLatestYml(UpdaterChannel channel)
  {
    var channelRoot = ChannelPath(channel);
    var path = Path.Combine(channelRoot, "latest.yml");
    if (!File.Exists(path)) return null;

    var version = File
      .ReadLines(path)
      .Select((line) => line.Trim())
      .FirstOrDefault((line) => line.StartsWith("version:", StringComparison.OrdinalIgnoreCase));

    if (string.IsNullOrWhiteSpace(version)) return null;

    var value = version["version:".Length..].Trim().Trim('"', '\'');
    return string.IsNullOrWhiteSpace(value) ? null : value;
  }

  public string? TryReadVersionFromLatestYml(bool beta) =>
    TryReadVersionFromLatestYml(beta ? UpdaterChannel.Beta : UpdaterChannel.Normal);
}

sealed class UpdaterVersionResolver(IOptions<UpdaterOptions> options, LocalFeed feed)
{
  public string Resolve(UpdaterChannel channel = UpdaterChannel.Normal) =>
    feed.TryReadVersionFromLatestYml(channel) ?? options.Value.Version.Trim();
}

sealed class UpdaterRolloutResolver(
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
    var stable = await configStore.LoadUpdaterOptionsAsync(UpdaterChannel.Normal, cancellationToken);
    if (request.Query.TryGetValue("beta", out var queryBeta) && queryBeta.Count > 0)
    {
      var token = queryBeta.FirstOrDefault()?.Trim();
      if (!string.IsNullOrWhiteSpace(token) && cache.TryGetValue($"channel:{token}", out UpdaterChannel cached) && cached != UpdaterChannel.Normal)
        return CreateRollout(await configStore.LoadUpdaterOptionsAsync(cached, cancellationToken), stable, cached, token);
    }

    var beta = await configStore.LoadBetaOptionsAsync(cancellationToken);
    if (!beta.Enabled || !HasBetaRules(beta)) return CreateRollout(stable, stable, UpdaterChannel.Normal, null);
    if (string.IsNullOrWhiteSpace(beta.LiteLLM.BaseUrl)) return CreateRollout(stable, stable, UpdaterChannel.Normal, null);

    var key = request.Headers[beta.HeaderName].FirstOrDefault()?.Trim();
    if (string.IsNullOrWhiteSpace(key)) return CreateRollout(stable, stable, UpdaterChannel.Normal, null);
    var tokenHash = ComputeHash(key);
    var channel = await ResolveChannelAsync(key, beta, cancellationToken);
    if (channel == UpdaterChannel.Normal) return CreateRollout(stable, stable, UpdaterChannel.Normal, null);
    return CreateRollout(await configStore.LoadUpdaterOptionsAsync(channel, cancellationToken), stable, channel, tokenHash);
  }

  UpdaterRollout CreateRollout(UpdaterOptions resolved, UpdaterOptions fallback, UpdaterChannel channel, string? channelToken)
  {
    var normalStopped = channelState.IsNormalStopped();
    var localVersion = feed.TryReadVersionFromLatestYml(channel);
    var version = localVersion ??
      (channel != UpdaterChannel.Normal
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
      channel,
      channelToken
    );
  }

  public async Task<UpdaterChannel> ResolveChannelAsync(string key, UpdaterBetaOptions beta, CancellationToken cancellationToken)
  {
    var cacheKey = $"channel:{ComputeHash(key)}";
    if (cache.TryGetValue(cacheKey, out UpdaterChannel cached)) return cached;

    using var request = new HttpRequestMessage(HttpMethod.Get, BuildLiteLLMKeyInfoUrl(beta, key));
    request.Headers.TryAddWithoutValidation("x-litellm-api-key", ResolveLiteLLMApiKey(beta, key));

    try
    {
      using var response = await clientFactory.CreateClient().SendAsync(request, cancellationToken);
      if (!response.IsSuccessStatusCode)
      {
        cache.Set(cacheKey, UpdaterChannel.Normal, TimeSpan.FromMinutes(2));
        return UpdaterChannel.Normal;
      }

      await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
      using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
      var groups = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
      var users = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
      CollectGroupCandidates(document.RootElement, groups);
      CollectUserCandidates(document.RootElement, users);
      var channel =
        MatchesGroups(beta.Groups, groups) || MatchesUsers(beta.Users, users) ? UpdaterChannel.Beta :
        MatchesGroups(beta.AiGildeGroups, groups) || MatchesUsers(beta.AiGildeUsers, users) ? UpdaterChannel.AiGilde :
        UpdaterChannel.Normal;
      cache.Set(cacheKey, channel, TimeSpan.FromMinutes(channel == UpdaterChannel.Normal ? 2 : 5));
      return channel;
    }
    catch
    {
      cache.Set(cacheKey, UpdaterChannel.Normal, TimeSpan.FromMinutes(1));
      return UpdaterChannel.Normal;
    }
  }

  static bool HasBetaRules(UpdaterBetaOptions beta)
  {
    return beta.Groups.Length > 0 || beta.Users.Length > 0 || beta.AiGildeGroups.Length > 0 || beta.AiGildeUsers.Length > 0;
  }

  static bool MatchesGroups(string[] configured, HashSet<string> groups)
  {
    return configured.Any((group) => groups.Contains(group));
  }

  static bool MatchesUsers(string[] configured, HashSet<string> users)
  {
    return configured.Any((user) => users.Contains(user));
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
    return await PromoteReleaseAsync(id, "normal", cancellationToken);
  }

  public async Task<ReleaseRecord?> PromoteReleaseAsync(string id, string channel, CancellationToken cancellationToken)
  {
    await using var connection = await OpenAsync();
    await using var update = connection.CreateCommand();
    update.CommandText = """
      UPDATE UpdaterReleases
      SET Channel = $channel, Promoted = 1, PromotedAt = $promotedAt
      WHERE Id = $id
      """;
    update.Parameters.AddWithValue("$id", id);
    update.Parameters.AddWithValue("$channel", channel);
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
  string Flag(UpdaterChannel channel) => Path.Combine(env.ContentRootPath, "data", $"{channel switch
  {
    UpdaterChannel.Beta => "beta",
    UpdaterChannel.AiGilde => "ai-gilde",
    _ => "normal",
  }}-channel-stopped.flag");

  public bool IsStopped(UpdaterChannel channel) => File.Exists(Flag(channel));
  public Task<bool> IsStoppedAsync(UpdaterChannel channel) => Task.FromResult(IsStopped(channel));
  public bool IsNormalStopped() => IsStopped(UpdaterChannel.Normal);

  public Task SetStoppedAsync(UpdaterChannel channel, bool stopped)
  {
    var flagPath = Flag(channel);
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

  public async Task<UpdaterChannel> ResolveChannelAsync(string key, UpdaterBetaOptions beta, IHttpClientFactory clientFactory, CancellationToken cancellationToken)
  {
    if (string.IsNullOrWhiteSpace(beta.LiteLLM.BaseUrl)) return UpdaterChannel.Normal;
    var cacheKey = $"feedback-channel:{ComputeHash(key)}:{ComputeHash($"{beta.LiteLLM.BaseUrl}|{string.Join(",", beta.Users)}|{string.Join(",", beta.Groups)}|{string.Join(",", beta.AiGildeUsers)}|{string.Join(",", beta.AiGildeGroups)}")}";
    if (cache.TryGetValue(cacheKey, out UpdaterChannel cached)) return cached;

    using var request = new HttpRequestMessage(HttpMethod.Get, BuildLiteLLMKeyInfoUrl(beta, key));
    request.Headers.TryAddWithoutValidation(LiteLLMApiKeyHeader, ResolveLiteLLMApiKey(beta, key));
    logger.LogDebug("channel lookup request {Url}", request.RequestUri);

    try
    {
      using var response = await clientFactory.CreateClient().SendAsync(request, cancellationToken);
      if (!response.IsSuccessStatusCode)
      {
        logger.LogWarning("channel lookup failed {StatusCode} {Url}", response.StatusCode, request.RequestUri);
        cache.Set(cacheKey, UpdaterChannel.Normal, TimeSpan.FromMinutes(2));
        return UpdaterChannel.Normal;
      }

      await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
      using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
      var groups = ExtractStrings(document.RootElement, "groups");
      var users = ExtractStrings(document.RootElement, "users");
      var userName = ExtractBetaUserName(document.RootElement, beta);
      var channel =
        MatchesGroups(beta.Groups, groups) || MatchesUsers(beta.Users, users) || MatchesAlias(beta.Users, userName) ? UpdaterChannel.Beta :
        MatchesGroups(beta.AiGildeGroups, groups) || MatchesUsers(beta.AiGildeUsers, users) || MatchesAlias(beta.AiGildeUsers, userName) ? UpdaterChannel.AiGilde :
        UpdaterChannel.Normal;
      cache.Set(cacheKey, channel, TimeSpan.FromMinutes(channel == UpdaterChannel.Normal ? 2 : 5));
      return channel;
    }
    catch (Exception error)
    {
      logger.LogWarning(error, "channel lookup error {Url}", request.RequestUri);
      cache.Set(cacheKey, UpdaterChannel.Normal, TimeSpan.FromMinutes(1));
      return UpdaterChannel.Normal;
    }
  }

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

  static bool MatchesGroups(string[] configured, HashSet<string> groups)
  {
    return configured.Any((group) => !string.IsNullOrWhiteSpace(group) && groups.Contains(group.Trim()));
  }

  static bool MatchesUsers(string[] configured, HashSet<string> users)
  {
    return configured.Any((user) => !string.IsNullOrWhiteSpace(user) && users.Contains(user.Trim()));
  }

  static bool MatchesAlias(string[] configured, string? userName)
  {
    if (string.IsNullOrWhiteSpace(userName)) return false;
    return configured.Any((user) => string.Equals(user.Trim(), userName.Trim(), StringComparison.OrdinalIgnoreCase));
  }
}
