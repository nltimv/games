// Where the game runs: on the Games Hub website, or inside a native app
// (apps/<game>/). The app build writes two meta tags into the page:
//
//   <meta name="games-app" content="android">        (or "ios")
//   <meta name="games-api-base" content="https://games.example">
//
// On the website neither tag exists: the page and the API share an origin.

function meta(name) {
  try {
    return globalThis.document?.querySelector(`meta[name="${name}"]`)?.getAttribute('content')?.trim() ?? '';
  } catch {
    return '';
  }
}

/** 'android', 'ios', or '' on the website. */
export function appPlatform() {
  return meta('games-app');
}

/** True inside the Android or iOS app, where there is no Games Hub to go back to. */
export function isApp() {
  return appPlatform() !== '';
}

/** Origin of the Games Hub server for API calls, without a trailing slash; '' means this page's origin. */
export function apiBase() {
  return meta('games-api-base').replace(/\/+$/, '');
}
