using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

static class ProviderDefaults
{
  public const string CapabilityHeader = "X-OpenCode-Config-Capabilities";
  public const string Capability = "agent-compaction-defaults-v1";

  public static ProviderSettingsRequest Read(ProviderConfigOptions config) => new()
  {
    Model = config.Model,
    SmallModel = config.SmallModel,
    TitleModel = config.Agents?.GetValueOrDefault("title")?.Model,
    CompactionModel = config.Agents?.GetValueOrDefault("compaction")?.Model,
    CompactionAuto = config.Compaction?.Auto,
    CompactionBuffer = config.Compaction?.Buffer,
    CompactionKeepTokens = config.Compaction?.Keep?.Tokens,
  };

  public static string? Validate(ProviderSettingsRequest settings)
  {
    foreach (var model in new[] { settings.TitleModel, settings.CompactionModel })
      if (!string.IsNullOrWhiteSpace(model) && !Regex.IsMatch(model.Trim(), @"\Aaifactory/[^\s#]+(?:#[^\s/#]+)?\z"))
        return "Agent models must use aifactory/<model-id>";
    if (settings.CompactionKeepTokens < 0) return "Retained tokens must be a non-negative integer";
    var buffer = settings.CompactionBuffer?.Trim();
    if (!string.IsNullOrEmpty(buffer)
        && !Regex.IsMatch(buffer, @"\A[1-9]\d?(?:\.\d+)?%\z")
        && !(int.TryParse(buffer, NumberStyles.None, CultureInfo.InvariantCulture, out var tokens) && tokens >= 0))
      return "Compaction buffer must be a non-negative token count or a percentage from 1% to below 100%";
    return null;
  }

  public static void Apply(JsonObject provider, ProviderSettingsRequest settings)
  {
    Set(provider, ["agents", "title", "model"], JsonValue.Create(Clean(settings.TitleModel)));
    Set(provider, ["agents", "compaction", "model"], JsonValue.Create(Clean(settings.CompactionModel)));
    Set(provider, ["compaction", "auto"], JsonValue.Create(settings.CompactionAuto));
    var buffer = Clean(settings.CompactionBuffer);
    Set(provider, ["compaction", "buffer"], buffer is null ? null
      : buffer.EndsWith('%') ? JsonValue.Create(buffer)
      : JsonValue.Create(int.Parse(buffer, CultureInfo.InvariantCulture)));
    Set(provider, ["compaction", "keep", "tokens"], JsonValue.Create(settings.CompactionKeepTokens));
  }

  public static void FilterForClient(ProviderConfigOptions config, HttpRequest request)
  {
    if (request.Headers[CapabilityHeader].ToString().Split(',', StringSplitOptions.TrimEntries).Contains(Capability)) return;
    // Older clients validate the whole document; unsupported fields must not invalidate their model configuration.
    config.Agents = null;
    config.Compaction = null;
  }

  static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

  static void Set(JsonObject root, ReadOnlySpan<string> path, JsonNode? value)
  {
    if (path.Length == 1)
    {
      if (value is null) root.Remove(path[0]);
      else root[path[0]] = value;
      return;
    }
    var child = root[path[0]] as JsonObject;
    if (child is null && value is null) return;
    if (child is null) root[path[0]] = child = new JsonObject();
    Set(child, path[1..], value);
    if (child.Count == 0) root.Remove(path[0]);
  }
}

sealed class ProviderAgentOptions
{
  [JsonPropertyName("model")]
  [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  public string? Model { get; set; }
}

sealed class ProviderCompactionOptions
{
  [JsonPropertyName("auto")]
  [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  public bool? Auto { get; set; }

  [JsonPropertyName("buffer")]
  [JsonConverter(typeof(CompactionBufferConverter))]
  [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  public string? Buffer { get; set; }

  [JsonPropertyName("keep")]
  [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  public ProviderCompactionKeepOptions? Keep { get; set; }
}

sealed class ProviderCompactionKeepOptions
{
  [JsonPropertyName("tokens")]
  [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  public int? Tokens { get; set; }
}

// Configuration binding uses strings, but OpenCode expects token counts as JSON numbers and percentages as strings.
sealed class CompactionBufferConverter : JsonConverter<string>
{
  public override string? Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options) => reader.TokenType switch
  {
    JsonTokenType.String => reader.GetString()?.Trim(),
    JsonTokenType.Number when reader.TryGetInt32(out var tokens) => tokens.ToString(CultureInfo.InvariantCulture),
    _ => throw new JsonException("Compaction buffer must be a string or integer"),
  };

  public override void Write(Utf8JsonWriter writer, string value, JsonSerializerOptions options)
  {
    if (int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var tokens)) writer.WriteNumberValue(tokens);
    else writer.WriteStringValue(value);
  }
}
