import { UAParser } from 'ua-parser-js';

// ==================================================================
// CLIENT INFO: which browser, system and device made a request.
// Used by the activity log and by exception emails.
//
// Two sources, both sent by the browser with every request:
//   1. The User-Agent header, e.g.
//      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ... Chrome/130.0.0.0"
//      ua-parser-js turns it into { browser: Chrome 130, os: Windows }.
//   2. "Client hints" (Sec-CH-UA-* headers). Modern Chrome/Edge freeze
//      parts of the User-Agent (Windows 11 still says "Windows NT 10.0",
//      Android phones say model "K"), so when the browser sends the real
//      values as hints, they win. The app asks for them with the
//      Accept-CH response header (see app.js). Safari and Firefox do not
//      send hints; their User-Agent is used as is.
// ==================================================================

export const CLIENT_HINTS = ['Sec-CH-UA-Platform-Version', 'Sec-CH-UA-Model', 'Sec-CH-UA-Full-Version-List'];

// Hint values are quoted strings: "Windows" -> Windows
const unquote = (value) => (typeof value === 'string' ? value.trim().replace(/^"|"$/g, '') : '');
const majorVersion = (version) => (version ? String(version).split('.')[0] : undefined);

function deviceType(parsed, mobileHint) {
  if (mobileHint === '?1' || parsed.device.type === 'mobile') return 'MOBILE';
  if (parsed.device.type === 'tablet') return 'TABLET';
  if (parsed.device.type) return 'OTHER'; // smart TV, console, wearable...
  return parsed.os.name ? 'DESKTOP' : 'OTHER';
}

export function clientInfo(req) {
  const userAgent = (req.get('user-agent') || '').slice(0, 400);
  const parsed = new UAParser(userAgent).getResult();

  let os = parsed.os.name;
  let osVersion = parsed.os.version;
  const platform = unquote(req.get('sec-ch-ua-platform'));
  const platformVersion = unquote(req.get('sec-ch-ua-platform-version'));
  if (platform) os = platform === 'macOS' ? 'Mac OS' : platform;
  if (platformVersion) {
    // Microsoft's rule: platform version 13 or higher means Windows 11.
    osVersion = platform === 'Windows'
      ? (Number(majorVersion(platformVersion)) >= 13 ? '11' : '10')
      : platformVersion.split('.').slice(0, 2).join('.').replace(/\.0$/, '');
  }

  const model = unquote(req.get('sec-ch-ua-model'));

  return {
    ip: req.ip,
    userAgent,
    browser: parsed.browser.name,
    browserVersion: majorVersion(parsed.browser.version),
    os,
    osVersion,
    deviceType: deviceType(parsed, req.get('sec-ch-ua-mobile')),
    deviceVendor: parsed.device.vendor,
    deviceModel: model || (parsed.device.model === 'K' ? undefined : parsed.device.model)
  };
}

// "Chrome 130 on Windows 11 (Desktop)" - for emails and logs.
export function describeClient(client) {
  if (!client) return 'Unknown';
  const browser = [client.browser, client.browserVersion].filter(Boolean).join(' ') || 'Unknown browser';
  const os = [client.os, client.osVersion].filter(Boolean).join(' ') || 'unknown system';
  const device = [client.deviceVendor, client.deviceModel].filter(Boolean).join(' ');
  const type = client.deviceType ? client.deviceType.charAt(0) + client.deviceType.slice(1).toLowerCase() : 'Unknown';
  return `${browser} on ${os} (${type}${device ? `, ${device}` : ''})`;
}
