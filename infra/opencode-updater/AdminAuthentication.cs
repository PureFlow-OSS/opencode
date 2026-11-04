using System.Net;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;

public sealed class AdminAuthenticationOptions
{
  public string Authority { get; set; } = "https://idp.rrz.co.at/realms/RSH";
  public string ClientId { get; set; } = "opencode-admin";
  public string ClientSecret { get; set; } = "";
  public string PublicOrigin { get; set; } = "";
  public string GroupClaim { get; set; } = "group";
  public string RequiredGroup { get; set; } = "opencodeAdmin";
  public int SessionMinutes { get; set; } = 30;
  public bool AllowHttpLoopback { get; set; }
}

public static class AdminAuthentication
{
  const string CookieScheme = "UpdaterAdminCookie";
  const string OidcScheme = "UpdaterAdminKeycloak";
  const string Policy = "UpdaterAdministrator";
  const string Prefix = "/opencode/auth";

  public static void AddUpdaterAdminAuthentication(this WebApplicationBuilder builder)
  {
    var settings = builder.Configuration.GetSection("AdminAuthentication").Get<AdminAuthenticationOptions>() ?? new();
    var local = settings.AllowHttpLoopback &&
      (builder.Environment.IsDevelopment() || builder.Environment.IsEnvironment("Testing"));
    var origin = Origin(settings.PublicOrigin, local);
    var authority = Origin(settings.Authority, local, allowPath: true);
    var configured = origin is not null && authority is not null &&
      !string.IsNullOrWhiteSpace(settings.ClientId) && !string.IsNullOrWhiteSpace(settings.ClientSecret) &&
      !string.IsNullOrWhiteSpace(settings.GroupClaim) && !string.IsNullOrWhiteSpace(settings.RequiredGroup);
    var state = new State(settings, origin, configured);
    builder.Services.AddSingleton(state);
    builder.Services.AddDataProtection()
      .SetApplicationName("OpenCode.Updater.Admin")
      .PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(builder.Environment.ContentRootPath, "data", "admin-auth-keys")));
    var secure = origin?.Scheme == "http" ? CookieSecurePolicy.None : CookieSecurePolicy.Always;
    builder.Services.AddAntiforgery(options =>
    {
      options.HeaderName = "X-OpenCode-CSRF";
      options.Cookie.Name = "OpenCode.Updater.Admin.Csrf";
      options.Cookie.HttpOnly = true;
      options.Cookie.SameSite = SameSiteMode.Strict;
      options.Cookie.SecurePolicy = secure;
    });
    var authentication = builder.Services.AddAuthentication(options =>
    {
      options.DefaultAuthenticateScheme = CookieScheme;
      options.DefaultSignInScheme = CookieScheme;
      options.DefaultChallengeScheme = CookieScheme;
    }).AddCookie(CookieScheme, options =>
    {
      options.Cookie.Name = "OpenCode.Updater.Admin";
      options.Cookie.Path = "/";
      options.Cookie.HttpOnly = true;
      options.Cookie.SameSite = SameSiteMode.Lax;
      options.Cookie.SecurePolicy = secure;
      options.SlidingExpiration = false;
      options.ExpireTimeSpan = TimeSpan.FromMinutes(Math.Clamp(settings.SessionMinutes, 1, 480));
      options.Events.OnRedirectToLogin = context =>
      {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return Task.CompletedTask;
      };
      options.Events.OnRedirectToAccessDenied = context =>
      {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        return Task.CompletedTask;
      };
    });
    if (configured)
      authentication.AddOpenIdConnect(OidcScheme, options =>
      {
        options.Authority = settings.Authority.TrimEnd('/');
        options.ClientId = settings.ClientId;
        options.ClientSecret = settings.ClientSecret;
        options.SignInScheme = CookieScheme;
        options.ResponseType = OpenIdConnectResponseType.Code;
        options.ResponseMode = OpenIdConnectResponseMode.Query;
        options.UsePkce = true;
        options.RequireHttpsMetadata = authority!.Scheme == "https";
        options.MapInboundClaims = false;
        options.SaveTokens = false;
        options.Scope.Clear();
        options.Scope.Add("openid");
        options.Scope.Add("profile");
        options.CallbackPath = Prefix + "/signin-oidc";
        options.SignedOutCallbackPath = Prefix + "/signout-callback-oidc";
        options.SignedOutRedirectUri = "/";
        options.CorrelationCookie.SameSite = SameSiteMode.Lax;
        options.NonceCookie.SameSite = SameSiteMode.Lax;
        options.CorrelationCookie.SecurePolicy = secure;
        options.NonceCookie.SecurePolicy = secure;
        options.TokenValidationParameters.NameClaimType = "preferred_username";
        options.TokenValidationParameters.ClockSkew = TimeSpan.FromMinutes(1);
        options.Events.OnTokenValidated = context =>
        {
          if (!HasGroup(context.Principal, settings))
          {
            context.HttpContext.RequestServices.GetRequiredService<ILoggerFactory>()
              .CreateLogger("UpdaterAdminAuthentication")
              .LogWarning("Administrator sign-in denied: required group absent from ID token. Claim: {Claim}; claim present: {Present}.",
                settings.GroupClaim, context.Principal?.HasClaim(claim => claim.Type == settings.GroupClaim) == true);
            context.HandleResponse();
            context.Response.Redirect(Prefix + "/forbidden");
            return Task.CompletedTask;
          }
          // Keep only the ID token for RP-initiated logout, never API/refresh tokens in the browser session.
          var properties = context.Properties!;
          properties.StoreTokens([new AuthenticationToken { Name = "id_token", Value = context.ProtocolMessage.IdToken }]);
          var limit = DateTimeOffset.UtcNow.AddMinutes(Math.Clamp(settings.SessionMinutes, 1, 480));
          var tokenExpiry = new DateTimeOffset(context.SecurityToken.ValidTo.ToUniversalTime());
          properties.ExpiresUtc = tokenExpiry < limit ? tokenExpiry : limit;
          return Task.CompletedTask;
        };
        options.Events.OnRemoteFailure = context =>
        {
          context.HandleResponse();
          context.Response.Redirect(Prefix + "/error");
          return Task.CompletedTask;
        };
      });
    builder.Services.AddAuthorization(options => options.AddPolicy(Policy, policy =>
      policy.RequireAuthenticatedUser().RequireAssertion(context => HasGroup(context.User, settings))));
  }

  public static void UseUpdaterAdminAuthentication(this WebApplication app)
  {
    var state = app.Services.GetRequiredService<State>();
    app.Use(async (context, next) =>
    {
      if (context.Request.Path.StartsWithSegments(Prefix)) context.Response.Headers.CacheControl = "no-store";
      // Use a fixed configured origin for OIDC callbacks and CSRF, not arbitrary forwarded Host/Proto headers.
      if (state.Configured && (context.Request.Path.StartsWithSegments(Prefix) || IsAdmin(context)))
      {
        context.Request.Scheme = state.Origin!.Scheme;
        context.Request.Host = HostString.FromUriComponent(state.Origin);
      }
      await next();
    });
    app.UseAuthentication();
    app.UseAuthorization();
    app.Use(async (context, next) =>
    {
      if (!IsAdmin(context))
      {
        await next();
        return;
      }
      context.Response.Headers.CacheControl = "no-store";
      if (!state.Configured)
      {
        await Error(context, StatusCodes.Status503ServiceUnavailable, "admin_authentication_not_configured");
        return;
      }
      if (!await Authorized(context)) return;
      if (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method) &&
          !HttpMethods.IsOptions(context.Request.Method) && !await ValidateCsrf(context)) return;
      await next();
    });

    app.MapGet(Prefix + "/check", (HttpContext context) =>
    {
      context.Response.Headers.CacheControl = "no-store";
      return !state.Configured ? Results.StatusCode(403) :
        context.User.Identity?.IsAuthenticated != true ? Results.StatusCode(401) :
        !HasGroup(context.User, state.Options) ? Results.StatusCode(403) : Results.NoContent();
    });
    app.MapGet(Prefix + "/session", async (HttpContext context, IAntiforgery antiforgery) =>
    {
      context.Response.Headers.CacheControl = "no-store";
      if (!state.Configured)
      {
        await Error(context, 503, "admin_authentication_not_configured");
        return;
      }
      if (!await Authorized(context)) return;
      var tokens = antiforgery.GetAndStoreTokens(context);
      await context.Response.WriteAsJsonAsync(new { userName = context.User.Identity?.Name ?? "Administrator", csrfToken = tokens.RequestToken });
    });
    app.MapGet(Prefix + "/login", (HttpContext context) =>
    {
      context.Response.Headers.CacheControl = "no-store";
      return state.Configured
        ? Results.Challenge(new AuthenticationProperties { RedirectUri = "/" }, [OidcScheme])
        : Page(503, "Anmeldung nicht eingerichtet", "Die Administrator-Anmeldung ist noch nicht konfiguriert.");
    });
    app.MapPost(Prefix + "/logout", async (HttpContext context) =>
    {
      if (!state.Configured) return Results.StatusCode(503);
      if (context.User.Identity?.IsAuthenticated != true) return Results.Unauthorized();
      if (!await ValidateCsrf(context)) return Results.Empty;
      return Results.SignOut(new AuthenticationProperties { RedirectUri = "/" }, [CookieScheme, OidcScheme]);
    });
    app.MapGet(Prefix + "/forbidden", () => !state.Configured
      ? Page(503, "Anmeldung nicht eingerichtet", "Die Administrator-Anmeldung ist noch nicht konfiguriert.")
      : Page(403, "Kein Zugriff", $"Für die Admin Console ist die Keycloak-Gruppe {state.Options.RequiredGroup} erforderlich."));
    app.MapGet(Prefix + "/error", () => Page(401, "Anmeldung fehlgeschlagen",
      "Die Anmeldung konnte nicht abgeschlossen werden. Bitte erneut anmelden oder die Administration kontaktieren."));
  }

  static bool IsAdmin(HttpContext context) => context.Request.Path.StartsWithSegments("/opencode/admin", StringComparison.OrdinalIgnoreCase);

  static async Task<bool> Authorized(HttpContext context)
  {
    var authorization = context.RequestServices.GetRequiredService<IAuthorizationService>();
    if ((await authorization.AuthorizeAsync(context.User, null, Policy)).Succeeded) return true;
    await Error(context, context.User.Identity?.IsAuthenticated == true ? 403 : 401, "administrator_access_required");
    return false;
  }

  static async Task<bool> ValidateCsrf(HttpContext context)
  {
    try
    {
      await context.RequestServices.GetRequiredService<IAntiforgery>().ValidateRequestAsync(context);
      return true;
    }
    catch (AntiforgeryValidationException)
    {
      await Error(context, 400, "invalid_csrf_token");
      return false;
    }
  }

  static bool HasGroup(ClaimsPrincipal? user, AdminAuthenticationOptions settings)
  {
    if (user?.Identity?.IsAuthenticated != true) return false;
    foreach (var claim in user.FindAll(settings.GroupClaim))
    {
      if (string.Equals(claim.Value, settings.RequiredGroup, StringComparison.Ordinal)) return true;
      if (!claim.Value.StartsWith('[')) continue;
      try
      {
        using var value = JsonDocument.Parse(claim.Value);
        if (value.RootElement.ValueKind == JsonValueKind.Array && value.RootElement.EnumerateArray().Any(item =>
          item.ValueKind == JsonValueKind.String && item.GetString() == settings.RequiredGroup)) return true;
      }
      catch (JsonException) { }
    }
    return false;
  }

  static Uri? Origin(string value, bool local, bool allowPath = false)
  {
    if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.UserInfo.Length > 0 || uri.Query.Length > 0 || uri.Fragment.Length > 0)
      return null;
    if (!allowPath && uri.AbsolutePath != "/") return null;
    return uri.Scheme == "https" || (local && uri.Scheme == "http" && uri.IsLoopback) ? uri : null;
  }

  static Task Error(HttpContext context, int status, string code)
  {
    context.Response.StatusCode = status;
    return context.Response.WriteAsJsonAsync(new { error = code });
  }

  static IResult Page(int status, string title, string text) => Results.Content(
    $$"""
    <!doctype html>
    <html lang="de">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>{{WebUtility.HtmlEncode(title)}} · OpenCode Updater</title>
        <style>
          :root { color-scheme: light; --blue: #285d82; --blue-dark: #1d4869; --yellow: #ffd500; --border: #dce3e8; }
          * { box-sizing: border-box; }
          body { margin: 0; background: #f6f8fa; color: #20262c; font: 14px/1.6 "IBM Plex Sans", Assistant, system-ui, -apple-system, "Segoe UI", sans-serif; }
          .hero { background: #fff; border-bottom: 4px solid var(--yellow); }
          .hero-inner { max-width: 1200px; margin: auto; padding: 28px 32px 24px; }
          .eyebrow { margin: 0 0 8px; color: var(--blue); font-size: 11px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
          .brand { margin: 0; color: var(--blue-dark); font-size: 30px; line-height: 1.2; font-weight: 700; }
          .subtitle { margin: 8px 0 0; color: #5f6870; }
          main { max-width: 720px; margin: 64px auto 32px; padding: 0 24px; }
          .card { background: #fff; border: 1px solid var(--border); border-top: 4px solid var(--yellow); border-radius: 12px; padding: 36px; box-shadow: 0 4px 20px #20262c08; }
          .status { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
          .icon { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 12px; background: #eaf1f6; color: var(--blue); flex-shrink: 0; }
          .status .eyebrow { margin: 0; }
          h1 { margin: 0 0 12px; color: var(--blue-dark); font-size: 30px; line-height: 1.25; }
          .message { margin: 0; overflow-wrap: anywhere; font-size: 15px; }
          .hint { margin: 24px 0; padding: 16px 18px; background: #eaf1f6; border-radius: 8px; color: var(--blue-dark); }
          .actions { border-top: 1px solid var(--border); padding-top: 24px; }
          .button { display: inline-flex; justify-content: center; align-items: center; min-height: 44px; padding: 12px 18px; border: 1px solid var(--blue); border-radius: 8px; background: var(--blue); color: #fff; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-decoration: none; text-align: center; }
          .button:hover { background: #214f70; border-color: #214f70; }
          .button:focus-visible { outline: 3px solid var(--yellow); outline-offset: 3px; }
          footer { padding: 24px 0; color: #5f6870; font-size: 12px; text-align: center; }
          @media (max-width: 540px) { .hero-inner { padding: 24px; } main { margin-top: 32px; padding: 0 16px; } .card { padding: 24px; } h1 { font-size: 26px; } .button { width: 100%; } }
        </style>
      </head>
      <body>
        <header class="hero"><div class="hero-inner">
          <p class="eyebrow">OpenCode Updater</p>
          <p class="brand">Admin Console</p>
          <p class="subtitle">Zentrale Verwaltung von OpenCode</p>
        </div></header>
        <main><section class="card" aria-labelledby="page-title">
          <div class="status">
            <span class="icon" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></svg></span>
            <p class="eyebrow">{{(status == 403 ? "Berechtigung erforderlich" : status == 503 ? "Einrichtung ausstehend" : "Anmeldung erforderlich")}}</p>
          </div>
          <h1 id="page-title">{{WebUtility.HtmlEncode(title)}}</h1>
          <p class="message">{{WebUtility.HtmlEncode(text)}}</p>
          <p class="hint">{{(status == 403 ? "Du erwartest Zugriff? Bitte wende dich an die Administration. Nach einer Freischaltung kannst du dich erneut anmelden." : "Bitte versuche die Anmeldung erneut. Falls das Problem bestehen bleibt, hilft dir die Administration weiter.")}}</p>
          <div class="actions"><a class="button" href="{{Prefix}}/login">Erneut mit Keycloak anmelden</a></div>
        </section><footer>RRZ · OpenCode Administration</footer></main>
      </body>
    </html>
    """,
    "text/html; charset=utf-8", statusCode: status);

  sealed record State(AdminAuthenticationOptions Options, Uri? Origin, bool Configured);
}
