// Hard-detection for the Facebook login wall — must fire BEFORE scoring.
//
// Rule: ANY SINGLE strong condition is sufficient to classify as login_required.
// This prevents a fake 40% score when Facebook returns its login page.

export interface LoginWallCheck {
  detected: boolean;
  trigger: string | null; // the first condition that fired
  signals: string[];
}

// ─── Hard-stop conditions — any one alone is definitive ─────────────────────

/** URL of the page the browser landed on (Playwright page.url()) */
function urlIsLoginPage(url: string): string | null {
  const u = url.toLowerCase();
  // Facebook redirects to /login/?next=... or /login/
  if (u.includes("/login/") || u.includes("/login?") || u.endsWith("/login")) {
    return `page_url_is_login:${url}`;
  }
  return null;
}

/** Canonical URL extracted from <link rel="canonical"> or og:url in the HTML */
function canonicalIsLoginPage(canonical: string | null): string | null {
  if (!canonical) return null;
  const c = canonical.toLowerCase();
  if (c.includes("facebook.com/login") || c.includes("/login.php")) {
    return `canonical_url_is_login:${canonical}`;
  }
  return null;
}

/** Page title is exactly "Facebook" (the login page title) */
function titleIsLoginPage(title: string | null): string | null {
  if (!title) return null;
  const t = title.trim().toLowerCase();
  if (t === "facebook") return `title_exactly_facebook:${title}`;
  if (t.includes("log into facebook") || t.includes("log in to facebook")) {
    return `title_contains_login_phrase:${title}`;
  }
  return null;
}

// Phrases that appear on the Facebook login page but NOT on listing pages
const HARD_LOGIN_PHRASES = [
  "log into facebook",
  "log in to facebook",
  "create new account",
  "forgot password?",
  "forgotten password",
  "connect with friends and the world around you",
  "email address or phone number",
  "facebook helps you connect",
];

function textContainsLoginPhrase(visibleText: string): string | null {
  const lower = visibleText.toLowerCase();
  for (const phrase of HARD_LOGIN_PHRASES) {
    if (lower.includes(phrase)) {
      return `text_contains_login_phrase:"${phrase}"`;
    }
  }
  return null;
}

/**
 * All three primary listing fields are absent — on a real listing this cannot
 * happen. When combined with a Facebook URL, it's conclusive.
 */
function allKeyFieldsAbsent(
  price: string | null,
  sellerName: string | null,
  description: string | null,
): string | null {
  if (!price && !sellerName && !description) {
    return "all_key_fields_absent(price+seller+description=null)";
  }
  return null;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function detectFacebookLoginWall(params: {
  pageUrl: string;
  canonicalUrl?: string | null;
  pageTitle: string | null;
  visibleText: string;
  price: string | null;
  seller_name: string | null;
  description: string | null;
}): LoginWallCheck {
  const { pageUrl, canonicalUrl, pageTitle, visibleText, price, seller_name, description } =
    params;

  const signals: string[] = [];

  // Evaluate all hard conditions
  const checks = [
    urlIsLoginPage(pageUrl),
    canonicalIsLoginPage(canonicalUrl ?? null),
    titleIsLoginPage(pageTitle),
    textContainsLoginPhrase(visibleText),
    allKeyFieldsAbsent(price, seller_name, description),
  ];

  for (const result of checks) {
    if (result) signals.push(result);
  }

  // ANY single signal is sufficient — do not require two
  const detected = signals.length >= 1;

  return {
    detected,
    trigger: signals[0] ?? null,
    signals,
  };
}
