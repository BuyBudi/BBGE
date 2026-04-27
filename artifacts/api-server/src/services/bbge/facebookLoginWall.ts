// Detects when Facebook redirects the browser to the login wall

const LOGIN_URL_SIGNALS = ["/login", "login.php", "facebook.com/login"];

const LOGIN_TEXT_SIGNALS = [
  "log in to facebook",
  "log into facebook",
  "create new account",
  "sign up for facebook",
  "connect with friends and the world",
  "forgotten password",
  "create a page",
  "see photos and updates from friends",
  "log in",
  "email address or phone number",
];

export interface LoginWallCheck {
  detected: boolean;
  signals: string[];
}

export function detectFacebookLoginWall(params: {
  pageUrl: string;
  pageTitle: string | null;
  visibleText: string;
  price: string | null;
  seller_name: string | null;
  title: string | null;
}): LoginWallCheck {
  const { pageUrl, pageTitle, visibleText, price, seller_name, title } = params;
  const signals: string[] = [];
  const lower = visibleText.toLowerCase();
  const urlLower = pageUrl.toLowerCase();

  // URL contains /login
  if (LOGIN_URL_SIGNALS.some((s) => urlLower.includes(s))) {
    signals.push(`url_contains_login:${pageUrl}`);
  }

  // Page title is only "Facebook" or "Facebook – log in or sign up"
  if (pageTitle) {
    const titleLower = pageTitle.toLowerCase();
    if (
      titleLower === "facebook" ||
      titleLower.includes("log in") ||
      titleLower.includes("sign up")
    ) {
      signals.push(`title_is_login_page:${pageTitle}`);
    }
  }

  // Visible text contains login page phrases
  for (const phrase of LOGIN_TEXT_SIGNALS) {
    if (lower.includes(phrase)) {
      signals.push(`text_contains:"${phrase}"`);
      break; // one match is enough
    }
  }

  // Key listing fields all missing despite being a Facebook URL
  if (!price && !seller_name && (!title || title.toLowerCase() === "facebook")) {
    signals.push("all_listing_fields_absent");
  }

  const detected = signals.length >= 2;
  return { detected, signals };
}
