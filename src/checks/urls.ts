/**
 * URL detection and filtering guardrail.
 *
 * This guardrail provides robust URL validation with configuration
 * to prevent credential injection, typosquatting, and scheme-based attacks.
 */

import { z } from 'zod';
import { CheckFn } from '../types';
import { defaultSpecRegistry } from '../registry';

const DEFAULT_PORTS: Record<string, number> = {
  http: 80,
  https: 443,
};

const SCHEME_PREFIX_RE = /^[a-z][a-z0-9+.-]*:\/\//;
const HOSTLESS_SCHEMES = new Set(['data', 'javascript', 'vbscript', 'mailto']);

function normalizeAllowedSchemes(value: unknown): Set<string> {
  if (value === undefined || value === null) {
    return new Set(['https']);
  }

  let rawValues: unknown[];
  if (typeof value === 'string') {
    rawValues = [value];
  } else if (value instanceof Set) {
    rawValues = Array.from(value.values());
  } else if (Array.isArray(value)) {
    rawValues = value;
  } else {
    throw new Error('allowed_schemes must be a string, Set, or Array');
  }

  const normalized = new Set<string>();
  for (const entry of rawValues) {
    if (typeof entry !== 'string') {
      throw new Error('allowed_schemes entries must be strings');
    }
    let cleaned = entry.trim().toLowerCase();
    if (!cleaned) {
      continue;
    }
    if (cleaned.endsWith('://')) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.replace(/:+$/, '');
    if (cleaned) {
      normalized.add(cleaned);
    }
  }

  if (normalized.size === 0) {
    throw new Error('allowed_schemes must include at least one scheme');
  }

  return normalized;
}

/**
 * Configuration schema for URL filtering.
 */
export const UrlsConfig = z.object({
  /** Allowed URLs, domains, or IP addresses */
  url_allow_list: z.array(z.string()).default([]),
  /** Allowed URL schemes/protocols (default: HTTPS only for security) */
  allowed_schemes: z
    .preprocess((val) => normalizeAllowedSchemes(val), z.set(z.string()))
    .default(new Set(['https'])),
  /** Block URLs with userinfo (user:pass@domain) to prevent credential injection */
  block_userinfo: z.boolean().default(true),
  /** Allow subdomains of allowed domains (e.g. api.example.com if example.com is allowed) */
  allow_subdomains: z.boolean().default(false),
});

export type UrlsConfig = z.infer<typeof UrlsConfig>;

/**
 * Context requirements for the URLs guardrail.
 */
export const UrlsContext = z.any();

export type UrlsContext = z.infer<typeof UrlsContext>;

/**
 * Convert IPv4 address string to 32-bit integer for CIDR calculations.
 */
function ipToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => part < 0 || part > 255)) {
    throw new Error(`Invalid IP address: ${ip}`);
  }
  return (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function extractHostCandidate(url: string): string | null {
  if (!url.includes('://')) {
    return null;
  }

  const [, rest] = url.split('://', 2);
  if (!rest) {
    return null;
  }

  const hostAndRest = rest.split(/[/?#]/, 1)[0];
  const withoutCreds = hostAndRest.includes('@')
    ? hostAndRest.split('@').pop() ?? ''
    : hostAndRest;
  if (!withoutCreds) {
    return null;
  }

  if (withoutCreds.startsWith('[')) {
    const closingIndex = withoutCreds.indexOf(']');
    if (closingIndex !== -1) {
      return withoutCreds.slice(0, closingIndex + 1);
    }
    return withoutCreds;
  }

  return withoutCreds.split(':', 1)[0];
}

/**
 * Detect URLs in text using robust regex patterns.
 */
function detectUrls(text: string): string[] {
  // Pattern for cleaning trailing punctuation (] must be escaped)
  const PUNCTUATION_CLEANUP = /[.,;:!?)\\]]+$/;

  const detectedUrls: string[] = [];

  // Pattern 1: URLs with schemes (highest priority)
  const schemePatterns = [
    /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi,
    /ftp:\/\/[^\s<>"{}|\\^`[\]]+/gi,
    /data:[^\s<>"{}|\\^`[\]]+/gi,
    /javascript:[^\s<>"{}|\\^`[\]]+/gi,
    /vbscript:[^\s<>"{}|\\^`[\]]+/gi,
  ];

  const schemeUrls = new Set<string>();
  for (const pattern of schemePatterns) {
    const matches = text.match(pattern) || [];
    for (let match of matches) {
      // Clean trailing punctuation
      match = match.replace(PUNCTUATION_CLEANUP, '');
      if (match) {
        detectedUrls.push(match);
        // Track the domain part to avoid duplicates
        if (match.includes('://')) {
          const domainPart = match.split('://', 2)[1].split('/')[0].split('?')[0].split('#')[0];
          schemeUrls.add(domainPart.toLowerCase());
        }
      }
    }
  }

  // Pattern 2: Domain-like patterns without schemes (exclude already found)
  const domainPattern = /\b(?:www\.)?[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}(?:\/[^\s]*)?/gi;
  const domainMatches = text.match(domainPattern) || [];

  for (let match of domainMatches) {
    // Clean trailing punctuation
    match = match.replace(PUNCTUATION_CLEANUP, '');
    if (match) {
      // Extract just the domain part for comparison
      const domainPart = match.split('/')[0].split('?')[0].split('#')[0].toLowerCase();
      // Only add if we haven't already found this domain with a scheme
      if (!schemeUrls.has(domainPart)) {
        detectedUrls.push(match);
      }
    }
  }

  // Pattern 3: IP addresses (exclude already found)
  const ipPattern = /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?::[0-9]+)?(?:\/[^\s]*)?/g;
  const ipMatches = text.match(ipPattern) || [];

  for (let match of ipMatches) {
    // Clean trailing punctuation
    match = match.replace(PUNCTUATION_CLEANUP, '');
    if (match) {
      // Extract IP part for comparison
      const ipPart = match.split('/')[0].split('?')[0].split('#')[0].toLowerCase();
      if (!schemeUrls.has(ipPart)) {
        detectedUrls.push(match);
      }
    }
  }

  // Advanced deduplication: Remove domains that are already part of full URLs
  const finalUrls: string[] = [];
  const schemeUrlDomains = new Set<string>();

  // First pass: collect all domains from scheme-ful URLs
  for (const url of detectedUrls) {
    if (url.includes('://')) {
      try {
        const parsed = new URL(url);
        if (parsed.hostname) {
          schemeUrlDomains.add(parsed.hostname.toLowerCase());
          // Also add www-stripped version
          const bareDomain = parsed.hostname.toLowerCase().replace(/^www\./, '');
          schemeUrlDomains.add(bareDomain);
        }
      } catch {
        const fallbackHost = extractHostCandidate(url);
        if (fallbackHost) {
          const normalizedHost = fallbackHost.toLowerCase();
          schemeUrlDomains.add(normalizedHost);
          schemeUrlDomains.add(normalizedHost.replace(/^www\./, ''));
        }
      }
      finalUrls.push(url);
    }
  }

  // Second pass: only add scheme-less URLs if their domain isn't already covered
  for (const url of detectedUrls) {
    if (!url.includes('://')) {
      // Check if this domain is already covered by a full URL
      const urlLower = url.toLowerCase().replace(/^www\./, '');
      if (!schemeUrlDomains.has(urlLower)) {
        finalUrls.push(url);
      }
    }
  }

  // Remove empty URLs and return unique list
  return [...new Set(finalUrls.filter((url) => url))];
}

/**
 * Validate URL security properties using WHATWG URL parsing.
 *
 * Ensures scheme compliance, hostname presence (for host-based schemes), and
 * blocks userinfo when configured. Returns structured errors for guardrail
 * reporting while keeping the parsed URL when valid.
 */
function validateUrlSecurity(
  urlString: string,
  config: UrlsConfig
): { parsedUrl: URL | null; reason: string; hadScheme: boolean } {
  try {
    let parsedUrl: URL;
    let originalScheme: string;
    let hadScheme: boolean;

    // Parse URL - preserve original scheme for validation
    if (urlString.includes('://')) {
      // Standard URL with double-slash scheme (http://, https://, ftp://, etc.)
      parsedUrl = new URL(urlString);
      originalScheme = parsedUrl.protocol.replace(/:$/, '');
      hadScheme = true;
    } else if (
      urlString.includes(':') &&
      urlString.split(':', 1)[0].match(/^(data|javascript|vbscript|mailto)$/)
    ) {
      // Special single-colon schemes
      parsedUrl = new URL(urlString);
      originalScheme = parsedUrl.protocol.replace(/:$/, '');
      hadScheme = true;
    } else {
      // Add http scheme for parsing, but remember this is a default
      parsedUrl = new URL(`http://${urlString}`);
      originalScheme = 'http'; // Default scheme for scheme-less URLs
      hadScheme = false;
    }

    // Basic validation: must have scheme and hostname (except for special schemes)
    if (!parsedUrl.protocol) {
      return { parsedUrl: null, reason: 'Invalid URL format', hadScheme: false };
    }

    // Special schemes like data: and javascript: don't need hostname
    const parsedScheme = parsedUrl.protocol.replace(/:$/, '').toLowerCase();
    if (!HOSTLESS_SCHEMES.has(parsedScheme) && !parsedUrl.hostname) {
      return { parsedUrl: null, reason: 'Invalid URL format', hadScheme };
    }

    // Security validations - use original scheme
    // Only check allowed_schemes if the URL explicitly had a scheme
    const normalizedScheme = originalScheme.toLowerCase();

    if (hadScheme && !config.allowed_schemes.has(normalizedScheme)) {
      return { parsedUrl: null, reason: `Blocked scheme: ${normalizedScheme}`, hadScheme };
    }

    if (config.block_userinfo && (parsedUrl.username || parsedUrl.password)) {
      return { parsedUrl: null, reason: 'Contains userinfo (potential credential injection)', hadScheme };
    }

    // Everything else (IPs, localhost, private IPs) goes through allow list logic
    return { parsedUrl, reason: '', hadScheme };
  } catch (error) {
    // Provide specific error information for debugging
    const errorName = error instanceof Error ? error.name : 'Error';
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { parsedUrl: null, reason: `URL parsing error: ${errorName}: ${errorMessage}`, hadScheme: false };
  }
}

function safeGetPort(parsed: URL, scheme: string): number | null {
  if (parsed.port) {
    const portNumber = Number(parsed.port);
    if (Number.isInteger(portNumber) && portNumber >= 0 && portNumber <= 65535) {
      return portNumber;
    }
    return null;
  }

  if (scheme) {
    const defaultPort = DEFAULT_PORTS[scheme as keyof typeof DEFAULT_PORTS];
    if (typeof defaultPort === 'number') {
      return defaultPort;
    }
  }

  return null;
}

function isIpv4Address(value: string): boolean {
  try {
    ipToInt(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if port matching should block the URL.
 *
 * Only enforces port matching when the allow list entry explicitly specifies
 * a non-default port. Explicit default ports (e.g., :443 for https) are
 * treated as equivalent to no port being specified.
 *
 * @param urlPort - The URL's port number (or default for its scheme)
 * @param urlParsed - The parsed URL object
 * @param allowedPort - The allow list entry's port number (or default for its scheme)
 * @param allowedParsed - The parsed allow list entry URL object
 * @param urlScheme - The URL's scheme
 * @param allowedScheme - The allow list entry's scheme
 * @returns true if the port doesn't match and should be blocked, false otherwise
 */
function shouldBlockDueToPortMismatch(
  urlPort: number | null,
  urlParsed: URL,
  allowedPort: number | null,
  allowedParsed: URL,
  urlScheme: string,
  allowedScheme: string
): boolean {
  // Only enforce port matching when allow list entry explicitly specifies a non-default port
  const allowedHasNonDefaultPort = allowedParsed.port && 
    (allowedPort !== DEFAULT_PORTS[allowedScheme as keyof typeof DEFAULT_PORTS]);
  
  if (!allowedHasNonDefaultPort) {
    return false; // No port restriction when allow list has no non-default port
  }
  
  // Allow list has explicit non-default port, so URL must match exactly
  const urlHasNonDefaultPort = urlParsed.port && 
    (urlPort !== DEFAULT_PORTS[urlScheme as keyof typeof DEFAULT_PORTS]);
  
  return !urlHasNonDefaultPort || allowedPort !== urlPort;
}

/**
 * Check if URL is allowed based on the allow list configuration.
 *
 * @param parsedUrl - The parsed URL to check
 * @param allowList - List of allowed URL patterns
 * @param allowSubdomains - Whether to allow subdomains
 * @param hadScheme - Whether the original URL had an explicit scheme
 */
function isUrlAllowed(parsedUrl: URL, allowList: string[], allowSubdomains: boolean, hadScheme: boolean): boolean {
  if (allowList.length === 0) {
    return false;
  }

  const urlHost = parsedUrl.hostname?.toLowerCase();
  if (!urlHost) {
    return false;
  }

  const urlDomain = urlHost.replace(/^www\./, '');
  const schemeLower = parsedUrl.protocol ? parsedUrl.protocol.replace(/:$/, '').toLowerCase() : '';
  const urlPort = safeGetPort(parsedUrl, schemeLower);
  const hostIndicatesPort = Boolean(parsedUrl.host) && parsedUrl.host.includes(':') && !parsedUrl.host.startsWith('[');
  if (urlPort === null && hostIndicatesPort) {
    return false;
  }

  const urlPath = parsedUrl.pathname || '/';
  const urlQuery = parsedUrl.search ? parsedUrl.search.slice(1) : '';
  const urlFragment = parsedUrl.hash ? parsedUrl.hash.slice(1) : '';
  const urlIsIp = isIpv4Address(urlHost);
  const urlIpInt = urlIsIp ? ipToInt(urlHost) : null;

  for (const allowedEntry of allowList) {
    const normalizedEntry = allowedEntry.toLowerCase().trim();
    if (!normalizedEntry) {
      continue;
    }

    // Handle CIDR notation before URL parsing
    // CIDR blocks like "10.0.0.0/8" should not be parsed as URLs
    const cidrMatch = normalizedEntry.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/);
    if (cidrMatch) {
      // Only match against IP URLs
      if (!urlIsIp || urlIpInt === null) {
        continue;
      }

      const [, network, prefixStr] = cidrMatch;
      const prefix = Number(prefixStr);

      if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
        console.warn(`Warning: Invalid CIDR prefix in allow list: "${normalizedEntry}"`);
        continue;
      }

      // Validate /0 must use 0.0.0.0 for clarity
      // Any other network address with /0 is ambiguous and likely a configuration error
      if (prefix === 0 && network !== '0.0.0.0') {
        console.warn(
          `Warning: CIDR /0 prefix must use 0.0.0.0, not "${network}". Entry: "${normalizedEntry}"`
        );
        continue;
      }

      try {
        const networkInt = ipToInt(network);
        const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
        if ((networkInt & mask) === (urlIpInt & mask)) {
          return true;
        }
      } catch (error) {
        console.warn(
          `Warning: Invalid CIDR network address in allow list: "${normalizedEntry}" - ${error instanceof Error ? error.message : error}`
        );
      }

      continue; // Skip URL parsing for CIDR entries
    }

    const hasExplicitScheme = SCHEME_PREFIX_RE.test(normalizedEntry);

    let parsedAllowed: URL;
    try {
      parsedAllowed = hasExplicitScheme
        ? new URL(normalizedEntry)
        : new URL(`http://${normalizedEntry}`);
    } catch (error) {
      console.warn(
        `Warning: Invalid URL in allow list: "${normalizedEntry}" - ${error instanceof Error ? error.message : error}`
      );
      continue;
    }

    const allowedHost = (parsedAllowed.hostname || '').toLowerCase();
    if (!allowedHost) {
      continue;
    }

    const allowedScheme = hasExplicitScheme ? parsedAllowed.protocol.replace(/:$/, '').toLowerCase() : '';
    const allowedPort = safeGetPort(parsedAllowed, allowedScheme);
    const allowIndicatesPort = Boolean(parsedAllowed.host) && parsedAllowed.host.includes(':') && !parsedAllowed.host.startsWith('[');
    if (allowedPort === null && allowIndicatesPort) {
      continue;
    }

    const allowedPath = parsedAllowed.pathname || '';
    const allowedQuery = parsedAllowed.search ? parsedAllowed.search.slice(1) : '';
    const allowedFragment = parsedAllowed.hash ? parsedAllowed.hash.slice(1) : '';

    const allowedHostIsIp = isIpv4Address(allowedHost);
    if (allowedHostIsIp) {
      if (!urlIsIp || urlIpInt === null) {
        continue;
      }

      // Scheme matching for IPs: only enforce when BOTH allow list entry AND URL have explicit schemes
      if (hasExplicitScheme && hadScheme && allowedScheme !== schemeLower) {
        continue;
      }

      // Port matching: only enforce when allow list entry explicitly specifies a non-default port
      if (shouldBlockDueToPortMismatch(urlPort, parsedUrl, allowedPort, parsedAllowed, schemeLower, allowedScheme)) {
        continue;
      }

      // Exact IP match
      if (ipToInt(allowedHost) === urlIpInt) {
        return true;
      }

      continue;
    }

    const allowedDomain = allowedHost.replace(/^www\./, '');

    // Port matching: only enforce when allow list entry explicitly specifies a non-default port
    if (shouldBlockDueToPortMismatch(urlPort, parsedUrl, allowedPort, parsedAllowed, schemeLower, allowedScheme)) {
      continue;
    }

    const hostMatches =
      urlDomain === allowedDomain || (allowSubdomains && urlDomain.endsWith(`.${allowedDomain}`));
    if (!hostMatches) {
      continue;
    }

    // Scheme matching for domains: only enforce when BOTH allow list entry AND URL have explicit schemes
    if (hasExplicitScheme && hadScheme && allowedScheme !== schemeLower) {
      continue;
    }

    // Path matching: only enforce when allow list entry explicitly specifies a non-root path
    // Note: Empty string ('') and root ('/') are both treated as "no path restriction"
    if (allowedPath && allowedPath !== '/') {
      // Normalize trailing slashes to avoid double-slash issues when checking subpaths
      // e.g., if allowedPath is "/api/", we normalize to "/api" before adding "/"
      // so we check "/api/" not "/api//" when matching "/api/users"
      const normalizedAllowedPath = allowedPath.replace(/\/+$/, '');
      const normalizedUrlPath = urlPath.replace(/\/+$/, '');
      
      if (normalizedUrlPath !== normalizedAllowedPath && !normalizedUrlPath.startsWith(`${normalizedAllowedPath}/`)) {
        continue;
      }
    }

    if (allowedQuery && allowedQuery !== urlQuery) {
      continue;
    }

    if (allowedFragment && allowedFragment !== urlFragment) {
      continue;
    }

    return true;
  }

  return false;
}

/**
 * Main URL filtering function.
 */
export const urls: CheckFn<UrlsContext, string, UrlsConfig> = async (ctx, data, config) => {
  const actualConfig = UrlsConfig.parse(config || {});

  // Detect URLs in the text
  const detectedUrls = detectUrls(data);

  const allowed: string[] = [];
  const blocked: string[] = [];
  const blockedReasons: string[] = [];

  for (const urlString of detectedUrls) {
    // Validate URL with security checks
    const { parsedUrl, reason, hadScheme } = validateUrlSecurity(urlString, actualConfig);

    if (parsedUrl === null) {
      blocked.push(urlString);
      blockedReasons.push(`${urlString}: ${reason}`);
      continue;
    }

    // Check against allow list
    // Special schemes (data:, javascript:, mailto:) don't have meaningful hosts
    // so they only need scheme validation, not host-based allow list checking
    const parsedScheme = parsedUrl.protocol.replace(/:$/, '').toLowerCase();
    if (HOSTLESS_SCHEMES.has(parsedScheme)) {
      // For hostless schemes, only scheme permission matters (no allow list needed)
      // They were already validated for scheme permission in validateUrlSecurity
      allowed.push(urlString);
    } else if (
      isUrlAllowed(parsedUrl, actualConfig.url_allow_list, actualConfig.allow_subdomains, hadScheme)
    ) {
      allowed.push(urlString);
    } else {
      blocked.push(urlString);
      blockedReasons.push(`${urlString}: Not in allow list`);
    }
  }

  const tripwireTriggered = blocked.length > 0;

  return {
    tripwireTriggered: tripwireTriggered,
    info: {
      guardrail_name: 'URL Filter',
      config: {
        allowed_schemes: Array.from(actualConfig.allowed_schemes),
        block_userinfo: actualConfig.block_userinfo,
        allow_subdomains: actualConfig.allow_subdomains,
        url_allow_list: actualConfig.url_allow_list,
      },
      detected: detectedUrls,
      allowed: allowed,
      blocked: blocked,
      blocked_reasons: blockedReasons,
    },
  };
};

// Register the URL filter
defaultSpecRegistry.register(
  'URL Filter',
  urls,
  'URL filtering using regex + standard URL parsing with direct configuration.',
  'text/plain',
  UrlsContext,
  UrlsConfig
);
