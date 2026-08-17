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
  ws: 80,
  wss: 443,
};

const SCHEME_PREFIX_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const HOSTLESS_SCHEMES = new Set(['data', 'javascript', 'vbscript', 'mailto']);
const ASCII_URL_CONTROL_RE = /[\t\n\r]/;
// WHATWG removes TAB/LF/CR inside a URL. Every other ECMAScript whitespace
// character remains a token boundary and must not be absorbed as URL content.
const NON_CONTROL_WHITESPACE_CHARACTER_CLASS =
  '\\x0b\\x0c\\x20\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff';
const NON_CONTROL_WHITESPACE_RE = new RegExp(`[${NON_CONTROL_WHITESPACE_CHARACTER_CLASS}]`, 'u');
const URL_WHITESPACE_RE = /\s/u;
const TRAILING_URL_CONTROL_RE = /[\t\n\r]+$/;
const AMBIGUOUS_URL_REASON = 'Ambiguous URL containing ASCII control characters';

const AUTHORITY_SCHEMES = ['http', 'https', 'ftp', 'ws', 'wss', 'file'];
const DETECTED_HOSTLESS_SCHEMES = ['data', 'javascript', 'vbscript', 'mailto'];
const DETECTED_SCHEMES = new Set([...AUTHORITY_SCHEMES, ...DETECTED_HOSTLESS_SCHEMES]);
const DETECTED_SCHEME_IN_TOKEN_RE = new RegExp(
  `(?:^|[^a-z0-9])(?:${[...DETECTED_SCHEMES].join('|')}):`,
  'i'
);
const DETECTED_HOSTLESS_SCHEME_ONLY_RE = new RegExp(
  `^(?:${DETECTED_HOSTLESS_SCHEMES.join('|')}):$`,
  'i'
);
const CONTROL_GAP_PATTERN = '[\\t\\n\\r]*';
const withOptionalControls = (scheme: string): string => scheme.split('').join(CONTROL_GAP_PATTERN);
const CONTROL_TOLERANT_AUTHORITY_PREFIXES = AUTHORITY_SCHEMES.map(
  (scheme) => `${withOptionalControls(scheme)}${CONTROL_GAP_PATTERN}:`
);
const CONTROL_TOLERANT_HOSTLESS_PREFIXES = DETECTED_HOSTLESS_SCHEMES.map(
  (scheme) => `${withOptionalControls(scheme)}${CONTROL_GAP_PATTERN}:`
);
const GENERIC_SCHEME_PATTERN = '[a-z][a-z0-9+.-]*';
const CONTROL_TOLERANT_GENERIC_AUTHORITY_PREFIX =
  `${GENERIC_SCHEME_PATTERN}${CONTROL_GAP_PATTERN}:${CONTROL_GAP_PATTERN}` +
  `\\/${CONTROL_GAP_PATTERN}\\/`;
const EXPLICIT_AUTHORITY_URL_PREFIX_PATTERN = `${GENERIC_SCHEME_PATTERN}:\\/\\/`;
const EXPLICIT_HOSTLESS_URL_PREFIX_PATTERN = `(?:${DETECTED_HOSTLESS_SCHEMES.join('|')}):`;
const EXPLICIT_URL_PREFIX_PATTERN = `(?:${EXPLICIT_AUTHORITY_URL_PREFIX_PATTERN}|${EXPLICIT_HOSTLESS_URL_PREFIX_PATTERN})`;
const WHITESPACE_BRIDGE_EXPLICIT_OWNER_RE = new RegExp(
  `(?<![a-z0-9])(?:(?:${AUTHORITY_SCHEMES.join('|')}):|` + `${GENERIC_SCHEME_PATTERN}://)[^\\s@]*`,
  'gi'
);
const WHITESPACE_BRIDGE_SCHEME_RELATIVE_OWNER_RE = /(?<![:/\\])[/\\]{2,}[^\s@]*/g;
const SCHEME_RELATIVE_BASE_URL = 'http://url-filter.invalid/';
const SCHEME_RELATIVE_URL_RE = /(?<![a-z0-9+.:/\\-])[/\\]{2,}[^\s]+/gi;
const hasExplicitAuthorityScheme = (value: string): boolean => SCHEME_PREFIX_RE.test(value);
const EXPLICIT_AUTHORITY_URL_LINE_BOUNDARY_PATTERN = `(?:\\r\\n?|\\n)\\t*(?=${EXPLICIT_AUTHORITY_URL_PREFIX_PATTERN})`;
const EXPLICIT_URL_LINE_BOUNDARY_PATTERN = `(?:\\r\\n?|\\n)\\t*(?=${EXPLICIT_URL_PREFIX_PATTERN})`;
const EXPLICIT_AUTHORITY_URL_LINE_BOUNDARY_RE = new RegExp(
  EXPLICIT_AUTHORITY_URL_LINE_BOUNDARY_PATTERN,
  'i'
);
const EXPLICIT_URL_LINE_BOUNDARY_RE = new RegExp(EXPLICIT_URL_LINE_BOUNDARY_PATTERN, 'i');
// WHATWG parsing removes TAB/LF/CR throughout a URL before interpreting it.
// Authority URLs only split before another authority URL: a following hostless
// scheme can become part of the authority after control removal. Hostless URLs
// can split before any explicit URL because their payload has no authority.
// Any control left inside the resulting candidate fails closed.
const CONTROL_TOLERANT_URL_CANDIDATE_RE = new RegExp(
  `(?<![a-z0-9])(?:` +
    `(?:${CONTROL_TOLERANT_GENERIC_AUTHORITY_PREFIX})` +
    `(?:(?!${EXPLICIT_AUTHORITY_URL_LINE_BOUNDARY_PATTERN})[^${NON_CONTROL_WHITESPACE_CHARACTER_CLASS}])+|` +
    `(?:${CONTROL_TOLERANT_AUTHORITY_PREFIXES.join(
      '|'
    )})(?:(?!${EXPLICIT_AUTHORITY_URL_LINE_BOUNDARY_PATTERN})[^${NON_CONTROL_WHITESPACE_CHARACTER_CLASS}])+|` +
    `(?:${CONTROL_TOLERANT_HOSTLESS_PREFIXES.join(
      '|'
    )})(?:(?!${EXPLICIT_URL_LINE_BOUNDARY_PATTERN})[^${NON_CONTROL_WHITESPACE_CHARACTER_CLASS}])+` +
    `)`,
  'gi'
);
const CONTROL_BEARING_TOKEN_RE = new RegExp(
  `[^${NON_CONTROL_WHITESPACE_CHARACTER_CLASS}]*[\\t\\n\\r]` +
    `[^${NON_CONTROL_WHITESPACE_CHARACTER_CLASS}]*`,
  'g'
);
const SCHEMELESS_DOMAIN_SEPARATOR_PATTERN =
  '(?:[.\\u3002\\uff0e\\uff61]|%2e|%e3%80%82|%ef%bc%8e|%ef%bd%a1)';
const SCHEMELESS_DOMAIN_SEPARATOR_RUN_START_PATTERN =
  '(?<![.\\u3002\\uff0e\\uff61])' +
  '(?<!%2e)' +
  '(?<!%e3%80%82)' +
  '(?<!%ef%bc%8e)' +
  '(?<!%ef%bd%a1)';
const SCHEMELESS_PERCENT_ESCAPE_PATTERN = '%[0-9a-f]{2}';
const SCHEMELESS_TOKEN_START_PATTERN = '(?<![^\\s<>"{}|\\\\^`\\[\\]])';
const SCHEMELESS_USERINFO_START_PATTERN = `(?:${SCHEMELESS_TOKEN_START_PATTERN}|(?<=[/\\\\]{2}))`;
const SCHEMELESS_DOMAIN_LABEL_CHARACTER_PATTERN =
  '[^\\s./@:?#<>"{}|\\\\^`\\[\\]\\u3002\\uff0e\\uff61]';
const SCHEMELESS_DOMAIN_LABEL_PATTERN =
  `(?:(?!${SCHEMELESS_DOMAIN_SEPARATOR_PATTERN})` +
  `${SCHEMELESS_DOMAIN_LABEL_CHARACTER_PATTERN})+`;
const SCHEMELESS_DOMAIN_RE = new RegExp(
  `(?<![\\p{L}\\p{N}%_.-])(?:www\\.)?${SCHEMELESS_DOMAIN_LABEL_PATTERN}` +
    `(?:${SCHEMELESS_DOMAIN_SEPARATOR_PATTERN}${SCHEMELESS_DOMAIN_LABEL_PATTERN})+` +
    `(?:${SCHEMELESS_DOMAIN_SEPARATOR_PATTERN})?(?::[0-9]+)?(?:[/?#][^\\s]*)?`,
  'giu'
);
const SCHEMELESS_EMPTY_LABEL_HOST_RE = new RegExp(
  `(?:` +
    `(?<![\\p{L}\\p{N}%_.-])${SCHEMELESS_DOMAIN_SEPARATOR_RUN_START_PATTERN}` +
    `(?:${SCHEMELESS_DOMAIN_SEPARATOR_PATTERN})+` +
    `${SCHEMELESS_DOMAIN_LABEL_PATTERN}` +
    `(?:${SCHEMELESS_DOMAIN_SEPARATOR_PATTERN}${SCHEMELESS_DOMAIN_LABEL_PATTERN})+|` +
    `${SCHEMELESS_DOMAIN_SEPARATOR_RUN_START_PATTERN}` +
    `(?:${SCHEMELESS_DOMAIN_SEPARATOR_PATTERN}){2,}${SCHEMELESS_DOMAIN_LABEL_PATTERN}` +
    `)`,
  'giu'
);
const SCHEMELESS_ASCII_OR_PERCENT_HOST_CHARACTER_PATTERN = `(?:[a-z0-9-]|${SCHEMELESS_PERCENT_ESCAPE_PATTERN})`;
const SCHEMELESS_ASCII_OR_PERCENT_HOST_LABEL_PATTERN = `${SCHEMELESS_ASCII_OR_PERCENT_HOST_CHARACTER_PATTERN}+`;
const SCHEMELESS_ASCII_OR_PERCENT_DOTTED_HOST_RE = new RegExp(
  `(?<![a-zA-Z0-9%.-])${SCHEMELESS_ASCII_OR_PERCENT_HOST_LABEL_PATTERN}` +
    `(?:${SCHEMELESS_DOMAIN_SEPARATOR_PATTERN}${SCHEMELESS_ASCII_OR_PERCENT_HOST_LABEL_PATTERN})+` +
    `(?:${SCHEMELESS_DOMAIN_SEPARATOR_PATTERN})?(?::[0-9]+)?(?:[/?#][^\\s]*)?`,
  'gi'
);
const SCHEMELESS_IDNA_HOST_CHARACTER_PATTERN =
  '(?:(?![<>"{}|\\\\^`\\[\\]\\u3002\\uff0e\\uff61])' +
  '(?:[\\p{L}\\p{N}\\p{S}\\p{M}\\p{Cf}-]|(?=[^\\x00-\\x7f])\\p{P}))';
const SCHEMELESS_IDNA_HOST_LABEL_PATTERN = `${SCHEMELESS_IDNA_HOST_CHARACTER_PATTERN}+`;
const SCHEMELESS_ASCII_BOUNDARY_PATTERN =
  '[\\s\\x21-\\x24\\x26-\\x2c\\x2f\\x3a-\\x40\\x5b-\\x60\\x7b-\\x7e]';
const SCHEMELESS_IDNA_CANDIDATE_BOUNDARY_PATTERN =
  `(?:(?<=${SCHEMELESS_ASCII_BOUNDARY_PATTERN})|` +
  '(?<![\\p{L}\\p{N}\\p{S}\\p{M}\\p{Cf}\\p{P}%_.-]))';
const SCHEMELESS_IDNA_DOTTED_HOST_RE = new RegExp(
  `${SCHEMELESS_IDNA_CANDIDATE_BOUNDARY_PATTERN}${SCHEMELESS_IDNA_HOST_LABEL_PATTERN}` +
    `(?:${SCHEMELESS_DOMAIN_SEPARATOR_PATTERN}${SCHEMELESS_IDNA_HOST_LABEL_PATTERN})+` +
    `(?:${SCHEMELESS_DOMAIN_SEPARATOR_PATTERN})?(?::[0-9]+)?(?:[/?#][^\\s]*)?`,
  'giu'
);
const SCHEMELESS_IDNA_SPECIAL_HOST_WITH_SUFFIX_RE = new RegExp(
  `${SCHEMELESS_IDNA_CANDIDATE_BOUNDARY_PATTERN}` +
    `${SCHEMELESS_IDNA_HOST_LABEL_PATTERN}(?::[0-9]+)?[/?#][^\\s]*`,
  'giu'
);
const SCHEMELESS_SPECIAL_HOST_BOUNDARY_PATTERN = '(?<![a-zA-Z0-9%])';
const SCHEMELESS_IPV4_RE = new RegExp(
  `${SCHEMELESS_SPECIAL_HOST_BOUNDARY_PATTERN}(?:[0-9]{1,3}\\.){3}` +
    '[0-9]{1,3}(?::[0-9]+)?(?:[/?#][^\\s]*)?',
  'g'
);
const SCHEMELESS_LEGACY_IPV4_RE = new RegExp(
  `${SCHEMELESS_SPECIAL_HOST_BOUNDARY_PATTERN}(?:0x[0-9a-f]+|[0-9]+)` +
    '(?:\\.(?:0x[0-9a-f]+|[0-9]+)){1,3}\\.?(?::[0-9]+)?(?:[/?#][^\\s]*)?',
  'gi'
);
const SCHEMELESS_LEGACY_IPV4_NUMBER_PATTERN = '(?:0x[0-9a-f]+|[0-9]+)';
const SCHEMELESS_ENCODED_LEGACY_IPV4_RE = new RegExp(
  `${SCHEMELESS_SPECIAL_HOST_BOUNDARY_PATTERN}${SCHEMELESS_LEGACY_IPV4_NUMBER_PATTERN}` +
    `(?:${SCHEMELESS_DOMAIN_SEPARATOR_PATTERN}${SCHEMELESS_LEGACY_IPV4_NUMBER_PATTERN}){1,3}` +
    `(?:${SCHEMELESS_DOMAIN_SEPARATOR_PATTERN})?(?::[0-9]+)?(?:[/?#][^\\s]*)?`,
  'gi'
);
const SCHEMELESS_NUMERIC_IPV4_WITH_SUFFIX_RE = new RegExp(
  `${SCHEMELESS_SPECIAL_HOST_BOUNDARY_PATTERN}[0-9]+(?:${SCHEMELESS_DOMAIN_SEPARATOR_PATTERN})?` +
    `(?::[0-9]+)?[/?#][^\\s]*`,
  'g'
);
const SCHEMELESS_HEX_IPV4_WITH_SUFFIX_RE = new RegExp(
  `${SCHEMELESS_SPECIAL_HOST_BOUNDARY_PATTERN}0x[0-9a-f]+(?:${SCHEMELESS_DOMAIN_SEPARATOR_PATTERN})?` +
    `(?::[0-9]+)?[/?#][^\\s]*`,
  'gi'
);
const SCHEMELESS_PERCENT_ENCODED_HOST_PATTERN = `${SCHEMELESS_ASCII_OR_PERCENT_HOST_CHARACTER_PATTERN}+`;
const SCHEMELESS_PERCENT_ENCODED_HOST_WITH_SUFFIX_RE = new RegExp(
  `${SCHEMELESS_SPECIAL_HOST_BOUNDARY_PATTERN}${SCHEMELESS_PERCENT_ENCODED_HOST_PATTERN}` +
    `(?::[0-9]+)?[/?#][^\\s]*`,
  'gi'
);
const SCHEMELESS_IPV6_RE = new RegExp(
  `${SCHEMELESS_SPECIAL_HOST_BOUNDARY_PATTERN}\\[[0-9a-f:.]+\\]` + '(?::[0-9]+)?(?:[/?#][^\\s]*)?',
  'gi'
);
const SCHEMELESS_LOCALHOST_RE = new RegExp(
  `${SCHEMELESS_SPECIAL_HOST_BOUNDARY_PATTERN}localhost(?:${SCHEMELESS_DOMAIN_SEPARATOR_PATTERN})?` +
    `(?::[0-9]+)?(?:[/?#][^\\s]*)?`,
  'gi'
);
const SCHEMELESS_USERINFO_URL_RE = new RegExp(
  `${SCHEMELESS_USERINFO_START_PATTERN}[^\\s/]*@` +
    `(?:\\[[0-9a-f:.]+\\]|[^\\s/?#<>"{}|\\\\^\`\\[\\]]+)` +
    `(?:[/?#][^\\s]*)?`,
  'giu'
);
const EMAIL_LOCAL_ATOM_SPECIAL_CHARACTERS = new Set("!#$%&'*+/=?^_`{|}~-");
const EMAIL_UNICODE_LOCAL_ATOM_RE = /[\p{L}\p{N}\p{M}]/u;
const EMAIL_DOT_CHARACTERS = new Set(['.', '\u3002', '\uff0e', '\uff61']);
const TRAILING_SCHEMELESS_UNICODE_DOT_RE = /[\u3002\uff0e\uff61]+$/u;
const EMAIL_TRAILING_BOUNDARY_RE = /[\s.,;!?()[\]{}<>\u3002\uff0e\uff61]/u;
const EMAIL_HOST_SCAN_BOUNDARY_RE = /[\s,;!?()[\]{}<>/\\?:@]/u;
// Keep whole-input scheme-less candidates when control removal moves a dotted
// authority fragment across a userinfo or path boundary.
const CONTROL_SEPARATED_SCHEMELESS_AUTHORITY_RE =
  /^(?:(?:[\p{L}\p{N}-]+\.)+[\p{L}\p{N}-]*[\t\n\r][@\\/?#]|[\p{L}\p{N}-]+[\t\n\r][\\/]\.[\p{L}\p{N}-]+(?::\d+)?(?:[\\/?#]|$))/iu;
// A disruptor adjacent to a dotted authority plus a trailing URL suffix
// distinguishes these URL tokens from ordinary dotted filenames.
const DISRUPTED_SCHEMELESS_DOTTED_AUTHORITY_RE =
  /(?<![\p{L}\p{N}-])(?:[\p{L}\p{N}-]+(?:[\\/?#@;]|%2[ef]|%5c)+\.[\p{L}\p{N}-]+|[\p{L}\p{N}-]+\.(?:(?:[\\/?#@;]|%2[ef]|%5c)+[\p{L}\p{N}-]+|[\p{L}\p{N}-]+(?:[\\/?#@;]|%2[ef]|%5c)+[\p{L}\p{N}-]+))(?::\d+)?[\\/?#][^\s]*$/iu;
type SchemelessCandidatePattern = {
  pattern: RegExp;
  shouldScan: (value: string) => boolean;
  shouldInclude?: (candidate: string) => boolean;
  shouldIncludeAt?: (value: string, start: number) => boolean;
  allowNumericLeadingFinalLabel?: boolean;
  ownsToken?: boolean;
};
const SCHEMELESS_DOMAIN_SEPARATOR_RE = new RegExp(SCHEMELESS_DOMAIN_SEPARATOR_PATTERN, 'i');
const hasDomainSeparator = (value: string): boolean => SCHEMELESS_DOMAIN_SEPARATOR_RE.test(value);
const hasUrlSuffix = (value: string): boolean => /[/?#]/.test(value);
const hasNonAsciiCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7f) {
      return true;
    }
  }
  return false;
};
const getSchemelessAuthority = (value: string): string => value.split(/[\\/?#]/, 1)[0];
const hasPercentOrPunycode = (value: string): boolean => value.includes('%') || /xn--/i.test(value);
const hasPercentOrPunycodeInAuthority = (value: string): boolean =>
  hasPercentOrPunycode(getSchemelessAuthority(value));
const hasNonAsciiAuthority = (value: string): boolean =>
  hasNonAsciiCharacter(getSchemelessAuthority(value));
const hasExplicitPortInAuthority = (value: string): boolean =>
  /:\d+$/.test(getSchemelessAuthority(value));
const hasNonDnsAsciiPunctuationInAuthority = (value: string): boolean =>
  /[!$&'()*+,=_~]/.test(getSchemelessAuthority(value));
const isEmailLocalAtomCharacter = (character: string): boolean =>
  isAsciiAlphanumeric(character) ||
  EMAIL_LOCAL_ATOM_SPECIAL_CHARACTERS.has(character) ||
  EMAIL_UNICODE_LOCAL_ATOM_RE.test(character);
const isOrdinaryEmailLocalPart = (value: string): boolean => {
  if (!value || value[0] === '.' || value.at(-1) === '.') {
    return false;
  }
  let previousWasDot = false;
  for (const character of value) {
    if (character === '.') {
      if (previousWasDot) {
        return false;
      }
      previousWasDot = true;
    } else {
      if (!isEmailLocalAtomCharacter(character)) {
        return false;
      }
      previousWasDot = false;
    }
  }
  return true;
};
const isOrdinaryEmailHost = (value: string): boolean => {
  if (!value || /[%\\/?#:@\s]/u.test(value)) {
    return false;
  }

  let normalizedHostname: string;
  try {
    const parsedHost = new URL(`http://${value}`);
    if (
      parsedHost.username ||
      parsedHost.password ||
      parsedHost.port ||
      parsedHost.pathname !== '/' ||
      parsedHost.search ||
      parsedHost.hash
    ) {
      return false;
    }
    normalizedHostname = parsedHost.hostname;
  } catch {
    return false;
  }

  const labels = normalizedHostname.split('.');
  const finalLabel = labels.at(-1) ?? '';
  if (labels.length < 2 || /^[0-9]/.test(finalLabel)) {
    return false;
  }
  return labels.every(
    (label) =>
      label.length > 0 &&
      isAsciiAlphanumeric(label[0]) &&
      isAsciiAlphanumeric(label.at(-1) ?? '') &&
      [...label].every((character) => isAsciiAlphanumeric(character) || character === '-')
  );
};
const isOrdinaryEmailAddress = (value: string): boolean => {
  const separator = value.indexOf('@');
  return (
    separator > 0 &&
    separator === value.lastIndexOf('@') &&
    isOrdinaryEmailLocalPart(value.slice(0, separator)) &&
    isOrdinaryEmailHost(value.slice(separator + 1))
  );
};
type OrdinaryEmailRange = {
  start: number;
  separator: number;
  end: number;
};
const getPreviousCodePointStart = (value: string, end: number): number => {
  const previous = value.charCodeAt(end - 1);
  if (end >= 2 && previous >= 0xdc00 && previous <= 0xdfff) {
    const leading = value.charCodeAt(end - 2);
    if (leading >= 0xd800 && leading <= 0xdbff) {
      return end - 2;
    }
  }
  return end - 1;
};
const findOrdinaryEmailRangeAt = (text: string, separator: number): OrdinaryEmailRange | null => {
  let localStart = separator;
  while (localStart > 0) {
    const previousStart = getPreviousCodePointStart(text, localStart);
    const previousCharacter = text.slice(previousStart, localStart);
    if (previousCharacter !== '.' && !isEmailLocalAtomCharacter(previousCharacter)) {
      break;
    }
    localStart = previousStart;
  }

  let hostEnd = separator + 1;
  while (hostEnd < text.length && !EMAIL_HOST_SCAN_BOUNDARY_RE.test(text[hostEnd])) {
    hostEnd += 1;
  }
  while (hostEnd > separator + 1 && EMAIL_DOT_CHARACTERS.has(text[hostEnd - 1])) {
    hostEnd -= 1;
  }

  const trailingCharacter = text[hostEnd] ?? '';
  const characterAfterTrailing = text[hostEnd + 1] ?? '';
  const hasEmailBoundary =
    !trailingCharacter ||
    (trailingCharacter === '?'
      ? !characterAfterTrailing || EMAIL_TRAILING_BOUNDARY_RE.test(characterAfterTrailing)
      : EMAIL_TRAILING_BOUNDARY_RE.test(trailingCharacter));
  if (
    !isOrdinaryEmailLocalPart(text.slice(localStart, separator)) ||
    !isOrdinaryEmailHost(text.slice(separator + 1, hostEnd)) ||
    !hasEmailBoundary
  ) {
    return null;
  }

  return { start: localStart, separator, end: hostEnd };
};
const hasExcludedUrlDelimiter = (value: string): boolean => /[<>"{}|\\^`\x5b\x5d]/.test(value);
const isOutsidePath = (value: string, start: number): boolean =>
  start === 0 || !/[\\/]/.test(value[start - 1]);
const NORMAL_SCHEMELESS_EXTENDED_HOST_PATTERNS = [
  {
    pattern: SCHEMELESS_EMPTY_LABEL_HOST_RE,
    shouldScan: hasDomainSeparator,
    shouldIncludeAt: isOutsidePath,
    allowNumericLeadingFinalLabel: true,
    ownsToken: true,
  },
  {
    pattern: SCHEMELESS_DOMAIN_RE,
    shouldScan: hasDomainSeparator,
    shouldInclude: hasExplicitPortInAuthority,
    shouldIncludeAt: isOutsidePath,
    allowNumericLeadingFinalLabel: true,
    ownsToken: true,
  },
  {
    pattern: SCHEMELESS_DOMAIN_RE,
    shouldScan: hasDomainSeparator,
    shouldInclude: (candidate) =>
      hasNonDnsAsciiPunctuationInAuthority(candidate) && !isOrdinaryEmailAddress(candidate),
    shouldIncludeAt: isOutsidePath,
    allowNumericLeadingFinalLabel: true,
    ownsToken: true,
  },
  {
    pattern: SCHEMELESS_ASCII_OR_PERCENT_DOTTED_HOST_RE,
    shouldScan: hasPercentOrPunycode,
    shouldInclude: hasPercentOrPunycodeInAuthority,
  },
  {
    pattern: SCHEMELESS_USERINFO_URL_RE,
    shouldScan: (value: string) => value.includes('@'),
    shouldInclude: (candidate: string) => !isOrdinaryEmailAddress(candidate),
    allowNumericLeadingFinalLabel: true,
  },
  {
    pattern: SCHEMELESS_IDNA_DOTTED_HOST_RE,
    shouldScan: (value: string) => hasNonAsciiCharacter(value) && hasDomainSeparator(value),
    shouldInclude: hasNonAsciiAuthority,
    allowNumericLeadingFinalLabel: true,
  },
  {
    pattern: SCHEMELESS_IDNA_SPECIAL_HOST_WITH_SUFFIX_RE,
    shouldScan: (value: string) => hasNonAsciiCharacter(value) && hasUrlSuffix(value),
    shouldInclude: hasNonAsciiAuthority,
    allowNumericLeadingFinalLabel: true,
  },
] satisfies SchemelessCandidatePattern[];
const SCHEMELESS_CANDIDATE_PATTERNS = [
  {
    pattern: SCHEMELESS_EMPTY_LABEL_HOST_RE,
    shouldScan: hasDomainSeparator,
    allowNumericLeadingFinalLabel: true,
  },
  { pattern: SCHEMELESS_DOMAIN_RE, shouldScan: hasDomainSeparator },
  {
    pattern: SCHEMELESS_ASCII_OR_PERCENT_DOTTED_HOST_RE,
    shouldScan: hasDomainSeparator,
    shouldInclude: hasPercentOrPunycodeInAuthority,
  },
  {
    pattern: SCHEMELESS_IDNA_DOTTED_HOST_RE,
    shouldScan: (value) => hasNonAsciiCharacter(value) && hasDomainSeparator(value),
    shouldInclude: hasNonAsciiAuthority,
    allowNumericLeadingFinalLabel: true,
  },
  {
    pattern: SCHEMELESS_IDNA_SPECIAL_HOST_WITH_SUFFIX_RE,
    shouldScan: (value) => hasNonAsciiCharacter(value) && hasUrlSuffix(value),
    shouldInclude: hasNonAsciiAuthority,
    allowNumericLeadingFinalLabel: true,
  },
  { pattern: SCHEMELESS_IPV4_RE, shouldScan: (value) => value.includes('.') },
  { pattern: SCHEMELESS_LEGACY_IPV4_RE, shouldScan: (value) => value.includes('.') },
  { pattern: SCHEMELESS_ENCODED_LEGACY_IPV4_RE, shouldScan: hasDomainSeparator },
  { pattern: SCHEMELESS_NUMERIC_IPV4_WITH_SUFFIX_RE, shouldScan: hasUrlSuffix },
  { pattern: SCHEMELESS_HEX_IPV4_WITH_SUFFIX_RE, shouldScan: hasUrlSuffix },
  {
    pattern: SCHEMELESS_PERCENT_ENCODED_HOST_WITH_SUFFIX_RE,
    shouldScan: (value) => value.includes('%') && hasUrlSuffix(value),
  },
  { pattern: SCHEMELESS_IPV6_RE, shouldScan: (value) => value.includes('[') },
  { pattern: SCHEMELESS_LOCALHOST_RE, shouldScan: (value) => /localhost/i.test(value) },
  {
    pattern: SCHEMELESS_USERINFO_URL_RE,
    shouldScan: (value) => value.includes('@'),
    shouldInclude: (candidate) => !isOrdinaryEmailAddress(candidate),
  },
] satisfies SchemelessCandidatePattern[];

type UrlCandidate = {
  value: string;
  start: number;
  end: number;
};

type UserinfoBridgeOwner = UrlCandidate & {
  parseMode: 'explicit' | 'scheme-relative' | 'scheme-less';
};

type WhitespaceBridgedUserinfoCandidate = UrlCandidate & {
  independentOwner?: UrlCandidate;
};

function findFirstPositionAtOrAfter(positions: number[], target: number): number | null {
  let low = 0;
  let high = positions.length - 1;
  let match: number | null = null;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (positions[middle] >= target) {
      match = positions[middle];
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }

  return match;
}

function findLastPositionBefore(positions: number[], limit: number): number | null {
  let low = 0;
  let high = positions.length - 1;
  let match: number | null = null;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (positions[middle] < limit) {
      match = positions[middle];
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return match;
}

function cleanAmbiguousUrlCandidate(candidate: string): string {
  // Resolve the token boundary before punctuation cleanup so a control directly
  // before closing prose punctuation remains internal and cannot be hidden.
  const withoutTrailingControls = candidate.replace(TRAILING_URL_CONTROL_RE, '');
  if (
    ASCII_URL_CONTROL_RE.test(candidate) &&
    DETECTED_HOSTLESS_SCHEME_ONLY_RE.test(withoutTrailingControls)
  ) {
    // Keep the raw control so a scheme-only token cannot disappear after cleanup.
    return candidate;
  }
  return withoutTrailingControls;
}

function cleanTrailingSchemelessUnicodeDots(candidate: string): string {
  if (/[/?#]/.test(candidate)) {
    return candidate;
  }
  return candidate.replace(TRAILING_SCHEMELESS_UNICODE_DOT_RE, '');
}

const TRAILING_AUTHORITY_PROSE_PUNCTUATION_RE = /[.,;:!]+$/;
const TRAILING_WRAPPER_EXTERNAL_PUNCTUATION_RE = /[.,;:!?。、，；：！？．｡]+$/;
const URL_WRAPPER_PAIRS = new Map([
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
  ['<', '>'],
  ['（', '）'],
  ['［', '］'],
  ['「', '」'],
  ['『', '』'],
  ['【', '】'],
  ['〈', '〉'],
  ['《', '》'],
]);
const REPEATED_URL_WRAPPERS = new Set(['*', '_', '~', "'", '"', '`', '|']);
// Malformed wrapper-only prefixes otherwise cause repeated scans of the same
// suffix. Beyond this depth, preserve fail-closed token ownership instead.
const MAX_WRAPPER_PREFIX_DESCENT = 64;

function isUrlWrapperOpeningCharacter(character: string): boolean {
  return URL_WRAPPER_PAIRS.has(character) || REPEATED_URL_WRAPPERS.has(character);
}

function getClosingUrlWrapper(text: string, start: number): string {
  let wrapperEnd = start;
  while (wrapperEnd > 0 && /[ \v\f]/.test(text[wrapperEnd - 1])) {
    wrapperEnd -= 1;
  }
  const hasWhitespaceGap = wrapperEnd < start;
  if (hasWhitespaceGap && !URL_WRAPPER_PAIRS.has(text[wrapperEnd - 1] ?? '')) {
    return '';
  }

  let wrapperStart = wrapperEnd;
  while (wrapperStart > 0 && isUrlWrapperOpeningCharacter(text[wrapperStart - 1])) {
    wrapperStart -= 1;
  }
  if (wrapperStart === wrapperEnd) {
    return '';
  }
  const openingWrapper = text.slice(wrapperStart, wrapperEnd);

  const closingParts: string[] = [];
  for (let index = 0; index < openingWrapper.length; ) {
    const character = openingWrapper[index];
    if (REPEATED_URL_WRAPPERS.has(character)) {
      let end = index + 1;
      while (end < openingWrapper.length && openingWrapper[end] === character) {
        end += 1;
      }
      closingParts.push(openingWrapper.slice(index, end));
      index = end;
      continue;
    }
    closingParts.push(URL_WRAPPER_PAIRS.get(character) ?? '');
    index += 1;
  }

  return closingParts.reverse().join('');
}

function cleanPairedUrlWrapper(candidate: string, text: string, start: number): string {
  const closingWrapper = getClosingUrlWrapper(text, start);
  if (!closingWrapper) {
    return candidate;
  }

  const withoutExternalPunctuation = candidate.replace(
    TRAILING_WRAPPER_EXTERNAL_PUNCTUATION_RE,
    ''
  );
  if (!withoutExternalPunctuation.endsWith(closingWrapper)) {
    return candidate;
  }

  return withoutExternalPunctuation.slice(0, -closingWrapper.length);
}

function unwrapPairedUrlWrapper(candidate: string, text: string, start: number): UrlCandidate {
  let candidateOffset = 0;
  while (
    candidateOffset < candidate.length &&
    isUrlWrapperOpeningCharacter(candidate[candidateOffset])
  ) {
    if (
      candidate[candidateOffset] === '[' &&
      /^\[(?=[0-9a-f.]*:)[0-9a-f:.]+\](?::[0-9]+)?/i.test(candidate.slice(candidateOffset))
    ) {
      break;
    }
    candidateOffset += 1;
  }

  if (candidateOffset === 0) {
    return { value: candidate, start, end: start + candidate.length };
  }

  const innerStart = start + candidateOffset;
  const innerCandidate = candidate.slice(candidateOffset);
  const cleaned = cleanPairedUrlWrapper(innerCandidate, text, innerStart);
  if (cleaned === innerCandidate) {
    return { value: candidate, start, end: start + candidate.length };
  }

  return { value: cleaned, start: innerStart, end: innerStart + cleaned.length };
}

function cleanTrailingAuthorityProsePunctuation(
  candidate: string,
  text: string,
  start: number
): string {
  const explicitScheme = candidate.match(/^([a-z][a-z0-9+.-]*):/i);
  let authorityStart: number;

  if (explicitScheme) {
    const scheme = explicitScheme[1].toLowerCase();
    const schemeEnd = explicitScheme[0].length;
    const hasAuthorityPrefix = /^[\\/]{2}/.test(candidate.slice(schemeEnd));
    if (!AUTHORITY_SCHEMES.includes(scheme) && !hasAuthorityPrefix) {
      return candidate;
    }
    authorityStart = schemeEnd;
    if (scheme === 'file' || !AUTHORITY_SCHEMES.includes(scheme)) {
      if (!hasAuthorityPrefix) {
        return candidate;
      }
      authorityStart += 2;
    } else {
      while (authorityStart < candidate.length && /[\\/]/.test(candidate[authorityStart])) {
        authorityStart += 1;
      }
    }
  } else if (/^[\\/]{2}/.test(candidate)) {
    authorityStart = 0;
    while (authorityStart < candidate.length && /[\\/]/.test(candidate[authorityStart])) {
      authorityStart += 1;
    }
  } else {
    return candidate;
  }

  let cleaned = cleanPairedUrlWrapper(candidate, text, start);
  if (/[\\/?#]/.test(cleaned.slice(authorityStart))) {
    return cleaned;
  }

  let previous: string;
  do {
    previous = cleaned;
    cleaned = cleaned.replace(TRAILING_AUTHORITY_PROSE_PUNCTUATION_RE, '');

    for (const [opening, closing] of [
      ['(', ')'],
      ['[', ']'],
    ] as const) {
      if (!cleaned.endsWith(closing)) {
        continue;
      }
      const authority = cleaned.slice(authorityStart);
      const openingCount = authority.split(opening).length - 1;
      const closingCount = authority.split(closing).length - 1;
      if (closingCount > openingCount) {
        cleaned = cleaned.slice(0, -1);
      }
    }
  } while (cleaned !== previous);

  return cleaned;
}

function cleanExcludedAuthorityPairedWrapper(
  candidate: string,
  text: string,
  start: number
): string {
  const closingWrapper = getClosingUrlWrapper(text, start);
  if (!closingWrapper) {
    return candidate;
  }

  for (
    let closingStart = candidate.indexOf(closingWrapper);
    closingStart >= 0;
    closingStart = candidate.indexOf(closingWrapper, closingStart + closingWrapper.length)
  ) {
    if (!isEscapedUrlDelimiter(candidate, closingStart)) {
      return candidate.slice(0, closingStart);
    }
  }

  return candidate;
}

function hasInternalUrlControl(candidate: string): boolean {
  return ASCII_URL_CONTROL_RE.test(candidate);
}

function normalizeHostnameForComparison(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '');
}

function isSupportedHostname(hostname: string, allowNumericLeadingFinalLabel = false): boolean {
  const normalizedHostname = normalizeHostnameForComparison(hostname);
  if (
    normalizedHostname === 'localhost' ||
    isIpv4Address(normalizedHostname) ||
    (normalizedHostname.startsWith('[') && normalizedHostname.endsWith(']'))
  ) {
    return true;
  }

  const finalLabel = normalizedHostname.split('.').pop() ?? '';
  const unsupportedFinalLabel = allowNumericLeadingFinalLabel
    ? /^[0-9]+$/.test(finalLabel)
    : /^[0-9]/.test(finalLabel);
  return normalizedHostname.includes('.') && !unsupportedFinalLabel;
}

function isSupportedSchemelessUrlCandidate(
  candidate: string,
  allowNumericLeadingFinalLabel = false
): boolean {
  try {
    return isSupportedHostname(
      new URL(`http://${candidate}`).hostname,
      allowNumericLeadingFinalLabel
    );
  } catch {
    return false;
  }
}

function isSupportedSchemeRelativeUrlCandidate(candidate: string): boolean {
  if (!/^[\\/]{2}/.test(candidate)) {
    return false;
  }

  try {
    const parsedUrl = new URL(candidate, SCHEME_RELATIVE_BASE_URL);
    const authorityAndSuffix = candidate.replace(/^[\\/]+/, '');
    const hasExplicitSuffix = /[\\/?#]/.test(authorityAndSuffix);
    const hostnameWithoutTrailingDot = normalizeHostnameForComparison(parsedUrl.hostname);
    return (
      Boolean(parsedUrl.username || parsedUrl.password || parsedUrl.port) ||
      hasExplicitSuffix ||
      hostnameWithoutTrailingDot.includes('.') ||
      isSupportedHostname(parsedUrl.hostname)
    );
  } catch {
    return false;
  }
}

function detectAmbiguousSchemelessUrls(text: string): UrlCandidate[] {
  const candidates: UrlCandidate[] = [];
  const seenRanges = new Set<string>();

  CONTROL_BEARING_TOKEN_RE.lastIndex = 0;
  for (const tokenResult of text.matchAll(CONTROL_BEARING_TOKEN_RE)) {
    const rawToken = tokenResult[0];
    const tokenStart = tokenResult.index;
    const normalizedCharacters: string[] = [];
    const rawPositions: number[] = [];

    for (let rawIndex = 0; rawIndex < rawToken.length; rawIndex += 1) {
      const character = rawToken[rawIndex];
      if (ASCII_URL_CONTROL_RE.test(character)) {
        continue;
      }
      normalizedCharacters.push(character);
      rawPositions.push(rawIndex);
    }

    const normalizedToken = normalizedCharacters.join('');
    const detectedSchemePosition = normalizedToken.search(DETECTED_SCHEME_IN_TOKEN_RE);
    for (const {
      pattern,
      shouldScan,
      shouldInclude,
      allowNumericLeadingFinalLabel,
    } of SCHEMELESS_CANDIDATE_PATTERNS) {
      if (!shouldScan(normalizedToken)) {
        continue;
      }
      pattern.lastIndex = 0;
      for (const normalizedResult of normalizedToken.matchAll(pattern)) {
        const normalizedStart = normalizedResult.index;
        if (detectedSchemePosition >= 0 && detectedSchemePosition < normalizedStart) {
          continue;
        }
        const normalizedCandidate = cleanAmbiguousUrlCandidate(normalizedResult[0]);
        if (shouldInclude && !shouldInclude(normalizedCandidate)) {
          continue;
        }
        if (
          !isSupportedSchemelessUrlCandidate(normalizedCandidate, allowNumericLeadingFinalLabel)
        ) {
          continue;
        }
        const normalizedEnd = normalizedStart + normalizedCandidate.length;
        const rawStart = tokenStart + rawPositions[normalizedStart];
        const rawEnd =
          tokenStart +
          (normalizedEnd < rawPositions.length ? rawPositions[normalizedEnd] : rawToken.length);
        const rawCandidate = text.slice(rawStart, rawEnd);
        const candidateRemainder = text.slice(rawStart, tokenStart + rawToken.length);
        const explicitAuthorityBoundary = candidateRemainder.search(
          EXPLICIT_AUTHORITY_URL_LINE_BOUNDARY_RE
        );
        const value = cleanAmbiguousUrlCandidate(
          explicitAuthorityBoundary >= 0
            ? rawCandidate.slice(0, explicitAuthorityBoundary)
            : rawCandidate
        );

        if (!hasInternalUrlControl(value)) {
          continue;
        }

        const end = rawStart + value.length;
        const rangeKey = `${rawStart}:${end}`;
        if (!seenRanges.has(rangeKey)) {
          candidates.push({ value, start: rawStart, end });
          seenRanges.add(rangeKey);
        }
      }
    }
  }

  return candidates;
}

function detectControlObfuscatedSchemeRelativeUrls(text: string): UrlCandidate[] {
  const candidates: UrlCandidate[] = [];

  CONTROL_BEARING_TOKEN_RE.lastIndex = 0;
  for (const tokenResult of text.matchAll(CONTROL_BEARING_TOKEN_RE)) {
    const rawToken = tokenResult[0];
    const tokenStart = tokenResult.index;
    const normalizedCharacters: string[] = [];
    const rawPositions: number[] = [];

    for (let rawIndex = 0; rawIndex < rawToken.length; rawIndex += 1) {
      const character = rawToken[rawIndex];
      if (ASCII_URL_CONTROL_RE.test(character)) {
        continue;
      }
      normalizedCharacters.push(character);
      rawPositions.push(rawIndex);
    }

    const normalizedToken = normalizedCharacters.join('');
    SCHEME_RELATIVE_URL_RE.lastIndex = 0;
    for (const normalizedResult of normalizedToken.matchAll(SCHEME_RELATIVE_URL_RE)) {
      const normalizedStart = normalizedResult.index;
      const normalizedEnd = normalizedStart + normalizedResult[0].length;
      const rawStart = tokenStart + rawPositions[normalizedStart];
      const mappedRawEnd =
        tokenStart +
        (normalizedEnd < rawPositions.length ? rawPositions[normalizedEnd] : rawToken.length);
      let value = text.slice(rawStart, mappedRawEnd);

      const explicitAuthorityBoundary = value.search(EXPLICIT_AUTHORITY_URL_LINE_BOUNDARY_RE);
      if (explicitAuthorityBoundary >= 0) {
        value = value.slice(0, explicitAuthorityBoundary);
      }
      value = cleanAmbiguousUrlCandidate(value);

      if (
        !hasInternalUrlControl(value) ||
        !isSupportedSchemeRelativeUrlCandidate(value.replace(/[\t\n\r]/g, ''))
      ) {
        continue;
      }

      candidates.push({ value, start: rawStart, end: rawStart + value.length });
    }
  }

  return candidates;
}

function isAsciiSchemeStart(character: string): boolean {
  const codePoint = character.charCodeAt(0);
  return (codePoint >= 0x41 && codePoint <= 0x5a) || (codePoint >= 0x61 && codePoint <= 0x7a);
}

function isAsciiAlphanumeric(character: string): boolean {
  const codePoint = character.charCodeAt(0);
  return isAsciiSchemeStart(character) || (codePoint >= 0x30 && codePoint <= 0x39);
}

function hasPotentialAsciiDomainFinalLabel(value: string): boolean {
  for (let dot = value.indexOf('.'); dot >= 0; dot = value.indexOf('.', dot + 1)) {
    if (isAsciiSchemeStart(value[dot + 1] ?? '') && isAsciiSchemeStart(value[dot + 2] ?? '')) {
      return true;
    }
  }
  return false;
}

function isAsciiSchemeCharacter(character: string): boolean {
  const codePoint = character.charCodeAt(0);
  return (
    isAsciiSchemeStart(character) ||
    (codePoint >= 0x30 && codePoint <= 0x39) ||
    character === '+' ||
    character === '.' ||
    character === '-'
  );
}

type DetectedUrlPrefix = {
  index: number;
  end: number;
};

// Find colon-delimited scheme runs directly so a long scheme-character token
// is scanned linearly instead of retrying a greedy scheme regexp at each offset.
function findDetectedUrlPrefixInToken(value: string): DetectedUrlPrefix | null {
  for (let colon = value.indexOf(':'); colon >= 0; colon = value.indexOf(':', colon + 1)) {
    let schemeRunStart = colon;
    while (schemeRunStart > 0 && isAsciiSchemeCharacter(value[schemeRunStart - 1])) {
      schemeRunStart -= 1;
    }
    let schemeStart = schemeRunStart;
    while (
      schemeStart < colon &&
      (!isAsciiSchemeStart(value[schemeStart]) ||
        (schemeStart > 0 && isAsciiAlphanumeric(value[schemeStart - 1])))
    ) {
      schemeStart += 1;
    }
    if (schemeStart === colon) {
      continue;
    }

    const hasAuthorityPrefix = value[colon + 1] === '/' && value[colon + 2] === '/';
    if (!hasAuthorityPrefix) {
      const scheme = value.slice(schemeStart, colon).toLowerCase();
      if (!DETECTED_SCHEMES.has(scheme)) {
        continue;
      }
    }

    return {
      index: schemeStart === 0 ? 0 : schemeStart - 1,
      end: colon + (hasAuthorityPrefix ? 3 : 1),
    };
  }

  return null;
}

function hasStandaloneSchemeStart(text: string, index: number): boolean {
  let runStart = index;
  while (runStart > 0 && isAsciiSchemeCharacter(text[runStart - 1])) {
    runStart -= 1;
  }
  while (runStart < index && /[+.-]/.test(text[runStart])) {
    runStart += 1;
  }
  return runStart === index;
}

function detectControlObfuscatedGenericSchemes(text: string): UrlCandidate[] {
  const candidates: UrlCandidate[] = [];

  CONTROL_BEARING_TOKEN_RE.lastIndex = 0;
  for (const tokenResult of text.matchAll(CONTROL_BEARING_TOKEN_RE)) {
    const rawToken = tokenResult[0];
    const tokenStart = tokenResult.index;
    const firstDetectedUrl = findDetectedUrlPrefixInToken(rawToken);
    const firstDetectedUrlEnd = firstDetectedUrl?.end ?? Number.POSITIVE_INFINITY;

    for (let index = 0; index < rawToken.length; index += 1) {
      if (!isAsciiSchemeStart(rawToken[index]) || !hasStandaloneSchemeStart(rawToken, index)) {
        continue;
      }
      if (firstDetectedUrlEnd <= index) {
        continue;
      }

      let cursor = index + 1;
      let hasControl = false;
      while (cursor < rawToken.length) {
        const character = rawToken[cursor];
        if (isAsciiSchemeCharacter(character)) {
          cursor += 1;
          continue;
        }
        if (ASCII_URL_CONTROL_RE.test(character)) {
          hasControl = true;
          cursor += 1;
          continue;
        }
        break;
      }

      if (!hasControl || rawToken[cursor] !== ':' || cursor + 1 >= rawToken.length) {
        index = cursor;
        continue;
      }

      const potentialBoundary = rawToken
        .slice(index)
        .search(EXPLICIT_AUTHORITY_URL_LINE_BOUNDARY_RE);
      if (potentialBoundary >= 0 && index + potentialBoundary < cursor) {
        const precedingCandidate = cleanAmbiguousUrlCandidate(
          rawToken.slice(index, index + potentialBoundary)
        );
        const precedingToken = cleanAmbiguousUrlCandidate(
          rawToken.slice(0, index + potentialBoundary)
        );
        if (
          (hasUrlSuffix(precedingCandidate) &&
            isSupportedSchemelessUrlCandidate(precedingCandidate, true)) ||
          (hasUrlSuffix(precedingToken) &&
            hasPotentialWrappedSchemelessUrlStart(precedingToken) &&
            isSupportedSchemelessUrlCandidate(precedingToken, true)) ||
          isSupportedSchemeRelativeUrlCandidate(precedingToken)
        ) {
          index = cursor;
          continue;
        }
      }

      const remainder = rawToken.slice(cursor + 1);
      const nextExplicitAuthority = remainder.search(EXPLICIT_AUTHORITY_URL_LINE_BOUNDARY_RE);
      const rawEnd =
        nextExplicitAuthority >= 0 ? cursor + 1 + nextExplicitAuthority : rawToken.length;
      const value = cleanAmbiguousUrlCandidate(rawToken.slice(index, rawEnd));

      try {
        const parsedUrl = new URL(value);
        const normalizedScheme = rawToken
          .slice(index, cursor)
          .replace(/[\t\n\r]/g, '')
          .toLowerCase();
        if (parsedUrl.protocol.toLowerCase() !== `${normalizedScheme}:`) {
          index = cursor;
          continue;
        }
      } catch {
        index = cursor;
        continue;
      }

      const start = tokenStart + index;
      candidates.push({ value, start, end: start + value.length });
      index = cursor;
    }
  }

  return candidates;
}

function mergeAmbiguousUrlCandidates(text: string, candidates: UrlCandidate[]): UrlCandidate[] {
  const sortedCandidates = [...candidates].sort(
    (left, right) => left.start - right.start || right.end - left.end
  );
  const mergedCandidates: UrlCandidate[] = [];

  for (const candidate of sortedCandidates) {
    const previous = mergedCandidates[mergedCandidates.length - 1];
    if (!previous || candidate.start >= previous.end) {
      mergedCandidates.push(candidate);
      continue;
    }

    if (candidate.end <= previous.end) {
      continue;
    }

    const value = cleanAmbiguousUrlCandidate(text.slice(previous.start, candidate.end));
    previous.value = value;
    previous.end = previous.start + value.length;
  }

  return mergedCandidates;
}

function detectEntireInputAmbiguousUrl(text: string): UrlCandidate | null {
  const value = text.trim();
  if (!value || !ASCII_URL_CONTROL_RE.test(value) || EXPLICIT_URL_LINE_BOUNDARY_RE.test(value)) {
    return null;
  }

  const start = text.indexOf(value);
  try {
    const parsedUrl = new URL(value);
    const scheme = parsedUrl.protocol.replace(/:$/, '').toLowerCase();
    if (DETECTED_SCHEMES.has(scheme)) {
      return { value, start, end: start + value.length };
    }
  } catch {
    // Fall through to the scheme-less parse below.
  }

  try {
    const parsedUrl = new URL(`http://${value}`);
    const normalizedValue = value.replace(/[\t\n\r]/g, '');
    const startsWithSupportedSchemelessUrl =
      /^(?:[a-z0-9]|\[)/i.test(normalizedValue) &&
      SCHEMELESS_CANDIDATE_PATTERNS.some(
        ({ pattern, shouldScan, shouldInclude, allowNumericLeadingFinalLabel }) => {
          if (!shouldScan(normalizedValue)) {
            return false;
          }
          pattern.lastIndex = 0;
          const match = pattern.exec(normalizedValue);
          return (
            match?.index === 0 &&
            (!shouldInclude || shouldInclude(match[0])) &&
            isSupportedSchemelessUrlCandidate(match[0], allowNumericLeadingFinalLabel)
          );
        }
      );
    const normalizedHostname = normalizeHostnameForComparison(parsedUrl.hostname);
    const firstCodePoint = normalizedValue.codePointAt(0) ?? 0;
    const hasStrongWholeInputSchemelessSyntax =
      CONTROL_SEPARATED_SCHEMELESS_AUTHORITY_RE.test(value);
    const isSupportedWholeInputSpecialHost =
      (/^(?:[a-z0-9%@]|\[)/i.test(normalizedValue) || firstCodePoint > 0x7f) &&
      (normalizedHostname === 'localhost' ||
        isIpv4Address(normalizedHostname) ||
        (normalizedHostname.startsWith('[') && normalizedHostname.endsWith(']')));
    if (
      !startsWithSupportedSchemelessUrl &&
      !hasStrongWholeInputSchemelessSyntax &&
      !isSupportedWholeInputSpecialHost
    ) {
      return null;
    }
    return { value, start, end: start + value.length };
  } catch {
    return null;
  }
}

function isDisruptedSchemelessUrlCandidate(value: string, requireStructuralStart = false): boolean {
  if (
    !value ||
    ASCII_URL_CONTROL_RE.test(value) ||
    URL_WHITESPACE_RE.test(value) ||
    !hasUrlSuffix(value) ||
    findDetectedUrlPrefixInToken(value)
  ) {
    return false;
  }

  const structuralResult = DISRUPTED_SCHEMELESS_DOTTED_AUTHORITY_RE.exec(value);
  if (!structuralResult || (requireStructuralStart && structuralResult.index !== 0)) {
    return false;
  }
  const structuralMatch = structuralResult[0];
  try {
    const parsedUrl = new URL(`http://${structuralMatch}`);
    return Boolean(parsedUrl.hostname);
  } catch {
    return false;
  }
}

function hasPotentialWrappedSchemelessUrlStart(candidate: string): boolean {
  const firstCodePoint = candidate.codePointAt(0) ?? 0;
  return /^[a-z0-9%]/i.test(candidate) || candidate[0] === '[' || firstCodePoint > 0x7f;
}

function isSupportedWrappedSchemelessUrlCandidate(candidate: string): boolean {
  if (!hasPotentialWrappedSchemelessUrlStart(candidate)) {
    return false;
  }
  if (!isSupportedSchemelessUrlCandidate(candidate)) {
    return false;
  }

  const authority = getSchemelessAuthority(candidate);
  return (
    hasDomainSeparator(authority) ||
    /^localhost(?::|$)/i.test(authority) ||
    authority.startsWith('[') ||
    hasUrlSuffix(candidate)
  );
}

function isEscapedUrlDelimiter(value: string, index: number): boolean {
  let backslashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
}

function findWrappedSchemelessUrlCandidates(
  value: string,
  text: string,
  start: number
): UrlCandidate[] {
  const externallyWrapped = cleanPairedUrlWrapper(value, text, start);
  if (externallyWrapped !== value && isSupportedWrappedSchemelessUrlCandidate(externallyWrapped)) {
    return [
      {
        value: externallyWrapped,
        start,
        end: start + externallyWrapped.length,
      },
    ];
  }

  const candidates: UrlCandidate[] = [];
  // Wrapper queries move forward with `offset`. Cache the first occurrence at
  // or after each query so distant suffixes are scanned once per character.
  const nextPairedWrapperPositions = new Map<string, number>();
  const findNextPairedWrapperPosition = (character: string, searchStart: number): number => {
    const cachedPosition = nextPairedWrapperPositions.get(character);
    if (cachedPosition !== undefined && (cachedPosition < 0 || cachedPosition >= searchStart)) {
      return cachedPosition;
    }

    const nextPosition = value.indexOf(character, searchStart);
    nextPairedWrapperPositions.set(character, nextPosition);
    return nextPosition;
  };
  for (let offset = 0; offset < value.length; ) {
    if (!isUrlWrapperOpeningCharacter(value[offset])) {
      offset += 1;
      continue;
    }

    const wrapperStart = offset;
    while (offset < value.length && isUrlWrapperOpeningCharacter(value[offset])) {
      offset += 1;
    }
    const wrapperPrefixEnd = offset;

    const openingCharacter = value[wrapperStart];
    let repeatedWrapperEnd = wrapperStart + 1;
    while (repeatedWrapperEnd < value.length && value[repeatedWrapperEnd] === openingCharacter) {
      repeatedWrapperEnd += 1;
    }
    const previousCharacter = value[wrapperStart - 1] ?? '';
    const isPairedWrapper = URL_WRAPPER_PAIRS.has(openingCharacter);
    const isSharedDelimiter = openingCharacter === '|';
    const followsSameRepeatedWrapper =
      REPEATED_URL_WRAPPERS.has(openingCharacter) && previousCharacter === openingCharacter;
    if (
      /[\\/]/.test(previousCharacter) ||
      (!isPairedWrapper &&
        !isSharedDelimiter &&
        !followsSameRepeatedWrapper &&
        /[\p{L}\p{N}%_.-]/u.test(previousCharacter))
    ) {
      offset = wrapperStart + 1;
      continue;
    }

    const closingCharacter = URL_WRAPPER_PAIRS.get(openingCharacter) ?? openingCharacter;
    const pairedClosingStart = isPairedWrapper
      ? findNextPairedWrapperPosition(closingCharacter, repeatedWrapperEnd)
      : -1;
    if (isPairedWrapper && pairedClosingStart < 0) {
      const wrapperPrefixLength = wrapperPrefixEnd - wrapperStart;
      offset =
        wrapperPrefixLength > MAX_WRAPPER_PREFIX_DESCENT ? wrapperPrefixEnd : wrapperStart + 1;
      continue;
    }

    const nextPairedOpeningStart = isPairedWrapper
      ? findNextPairedWrapperPosition(openingCharacter, repeatedWrapperEnd)
      : -1;
    const hasAnotherPairedOpening = nextPairedOpeningStart >= 0;
    const repeatedWrapper = value.slice(wrapperStart, repeatedWrapperEnd);
    const firstRepeatedClosing = value.indexOf(repeatedWrapper, repeatedWrapperEnd);
    const nextRepeatedOpening =
      firstRepeatedClosing < 0
        ? -1
        : value.indexOf(repeatedWrapper, firstRepeatedClosing + repeatedWrapper.length);
    const repeatedWrapperSeparator =
      nextRepeatedOpening < 0
        ? ''
        : value.slice(firstRepeatedClosing + repeatedWrapper.length, nextRepeatedOpening);
    const hasFollowingRepeatedValue =
      !isPairedWrapper && nextRepeatedOpening >= 0 && /^[,;:]?$/.test(repeatedWrapperSeparator);
    const hasAnotherSharedValue = isSharedDelimiter && nextRepeatedOpening >= 0;
    if (!hasAnotherPairedOpening && !hasFollowingRepeatedValue && !hasAnotherSharedValue) {
      const wrapped = value.slice(wrapperStart);
      const unwrapped = unwrapPairedUrlWrapper(wrapped, text, start + wrapperStart);
      if (
        unwrapped.value !== wrapped &&
        isSupportedWrappedSchemelessUrlCandidate(unwrapped.value)
      ) {
        candidates.push(unwrapped);
        break;
      }
    }

    let openingEnd = wrapperStart + 1;
    if (!isPairedWrapper) {
      while (openingEnd < value.length && value[openingEnd] === openingCharacter) {
        openingEnd += 1;
      }
    }
    const openingWrapper = value.slice(wrapperStart, openingEnd);
    const closingWrapper = isPairedWrapper
      ? (URL_WRAPPER_PAIRS.get(openingCharacter) ?? '')
      : openingWrapper;
    let closingStart = isPairedWrapper
      ? pairedClosingStart
      : value.indexOf(closingWrapper, openingEnd);
    while (closingStart >= 0) {
      const escapedDelimiter = !isPairedWrapper && isEscapedUrlDelimiter(value, closingStart);
      const nextCharacter = value[closingStart + closingWrapper.length] ?? '';
      const internalApostrophe =
        openingCharacter === "'" && /[\p{L}\p{N}%_\\/?#-]/u.test(nextCharacter);
      if (!escapedDelimiter && !internalApostrophe) {
        break;
      }
      closingStart = value.indexOf(closingWrapper, closingStart + closingWrapper.length);
    }
    if (closingStart < 0) {
      const wrapperPrefixLength = wrapperPrefixEnd - wrapperStart;
      offset =
        wrapperPrefixLength > MAX_WRAPPER_PREFIX_DESCENT ? wrapperPrefixEnd : wrapperStart + 1;
      continue;
    }
    // A closer beyond another same-type opener does not safely bound the outer
    // token. Continue from the nested opener instead of materializing both spans.
    if (isPairedWrapper && nextPairedOpeningStart >= 0 && nextPairedOpeningStart < closingStart) {
      offset = repeatedWrapperEnd;
      continue;
    }

    const wrappedEnd = closingStart + closingWrapper.length;
    const boundedWrapper = value.slice(wrapperStart, wrappedEnd);
    const localBoundedCandidate = unwrapPairedUrlWrapper(boundedWrapper, boundedWrapper, 0);
    const boundedCandidate = {
      value: localBoundedCandidate.value,
      start: start + wrapperStart + localBoundedCandidate.start,
      end: start + wrapperStart + localBoundedCandidate.end,
    };
    const isSupportedBoundedCandidate =
      boundedCandidate.value !== boundedWrapper &&
      isSupportedWrappedSchemelessUrlCandidate(boundedCandidate.value);
    if (isSupportedBoundedCandidate) {
      candidates.push(boundedCandidate);
    } else if (
      boundedCandidate.value !== boundedWrapper &&
      hasPotentialWrappedSchemelessUrlStart(boundedCandidate.value) &&
      isDisruptedSchemelessUrlCandidate(boundedCandidate.value, true)
    ) {
      candidates.push({
        value: boundedWrapper,
        start: start + wrapperStart,
        end: start + wrappedEnd,
      });
    }
    if (isSharedDelimiter) {
      offset = closingStart;
    } else if (isPairedWrapper && !isSupportedBoundedCandidate) {
      const wrapperPrefixLength = wrapperPrefixEnd - wrapperStart;
      offset =
        wrapperPrefixLength > MAX_WRAPPER_PREFIX_DESCENT ? wrapperPrefixEnd : repeatedWrapperEnd;
    } else {
      offset = wrappedEnd;
    }
  }

  return candidates;
}

const SCHEMELESS_ASSIGNMENT_KEY_RE = /^[\p{L}_:][\p{L}\p{N}_.:-]*$/u;
const SCHEMELESS_ASSIGNMENT_EXCLUDED_DELIMITER_RE = /[<>"{}|^`]/;

type HtmlStartTagScanState = 'outside' | 'tag-name-start' | 'tag-name' | 'inside' | 'invalid';

function createHtmlStartTagTracker(text: string): (position: number) => boolean {
  let offset = 0;
  let state: HtmlStartTagScanState = 'outside';

  return (position: number): boolean => {
    while (offset < position) {
      const character = text[offset];
      if (character === '<') {
        state = 'tag-name-start';
      } else if (character === '>') {
        state = 'outside';
      } else if (state === 'tag-name-start') {
        state = isAsciiSchemeStart(character) ? 'tag-name' : 'invalid';
      } else if (state === 'tag-name') {
        if (isAsciiAlphanumeric(character) || character === ':' || character === '-') {
          // Continue scanning the tag name.
        } else {
          state = /\s/u.test(character) ? 'inside' : 'invalid';
        }
      }
      offset += 1;
    }

    return state === 'inside';
  };
}

function findAssignedSchemelessUrlCandidate(
  value: string,
  start: number,
  isInsideHtmlStartTag: boolean
): UrlCandidate | null {
  const assignment = value.indexOf('=');
  if (assignment <= 0 || !SCHEMELESS_ASSIGNMENT_KEY_RE.test(value.slice(0, assignment))) {
    return null;
  }

  const candidateStart = assignment + 1;
  const remainder = value.slice(candidateStart);
  const candidate =
    isInsideHtmlStartTag && remainder.endsWith('>') ? remainder.slice(0, -1) : remainder;
  if (SCHEMELESS_ASSIGNMENT_EXCLUDED_DELIMITER_RE.test(candidate)) {
    return null;
  }
  if (!isSupportedWrappedSchemelessUrlCandidate(candidate)) {
    return null;
  }

  const absoluteStart = start + candidateStart;
  return {
    value: candidate,
    start: absoluteStart,
    end: absoluteStart + candidate.length,
  };
}

function detectExclusiveSchemelessUrls(text: string): UrlCandidate[] {
  const candidates: UrlCandidate[] = [];
  const isInsideHtmlStartTagAt = createHtmlStartTagTracker(text);
  for (const result of text.matchAll(/\S+/gu)) {
    const value = result[0];
    const isInsideHtmlStartTag = isInsideHtmlStartTagAt(result.index);
    const explicitUrlPrefix = findDetectedUrlPrefixInToken(value);
    if (explicitUrlPrefix) {
      let firstWrapper = 0;
      while (firstWrapper < value.length && !isUrlWrapperOpeningCharacter(value[firstWrapper])) {
        firstWrapper += 1;
      }
      if (firstWrapper === value.length || explicitUrlPrefix.index <= firstWrapper) {
        continue;
      }
    }
    const wrappedCandidates = findWrappedSchemelessUrlCandidates(value, text, result.index);
    if (wrappedCandidates.length > 0) {
      candidates.push(...wrappedCandidates);
      continue;
    }
    const assignedCandidate = findAssignedSchemelessUrlCandidate(
      value,
      result.index,
      isInsideHtmlStartTag
    );
    if (assignedCandidate) {
      candidates.push(assignedCandidate);
      continue;
    }
    if (isDisruptedSchemelessUrlCandidate(value)) {
      candidates.push({ value, start: result.index, end: result.index + value.length });
    }
  }
  return candidates;
}

function detectAmbiguousUrls(text: string): UrlCandidate[] {
  if (!ASCII_URL_CONTROL_RE.test(text)) {
    return [];
  }

  const entireInputCandidate = detectEntireInputAmbiguousUrl(text);
  if (entireInputCandidate) {
    return [entireInputCandidate];
  }

  const candidates: UrlCandidate[] = [];
  const atSignPositions: number[] = [];
  const controlPositions: number[] = [];
  for (let index = text.indexOf('@'); index >= 0; index = text.indexOf('@', index + 1)) {
    atSignPositions.push(index);
  }
  for (const result of text.matchAll(/[\t\n\r]/g)) {
    controlPositions.push(result.index);
  }
  const normalizedPrefixText = text.replace(/[\t\n\r]/g, '');
  const hasControlNormalizedPrefix = findDetectedUrlPrefixInToken(normalizedPrefixText) !== null;
  CONTROL_TOLERANT_URL_CANDIDATE_RE.lastIndex = 0;
  const matches = hasControlNormalizedPrefix
    ? [...text.matchAll(CONTROL_TOLERANT_URL_CANDIDATE_RE)].filter((result) => {
        if (!hasStandaloneSchemeStart(text, result.index)) {
          return false;
        }
        const explicitAuthorityBoundary = result[0].search(EXPLICIT_AUTHORITY_URL_LINE_BOUNDARY_RE);
        if (explicitAuthorityBoundary <= 0) {
          return true;
        }

        const precedingCandidate = cleanAmbiguousUrlCandidate(
          result[0].slice(0, explicitAuthorityBoundary)
        );
        return !isSupportedSchemelessUrlCandidate(precedingCandidate, true);
      })
    : [];
  const explicitAuthorityPositions = matches
    .filter((result) => /^[a-z][a-z0-9+.-]*:\/\//i.test(result[0].replace(/[\t\n\r]/g, '')))
    .map((result) => result.index);

  const rawSchemelessCandidates: UrlCandidate[] = [];
  const seenSchemelessRanges = new Set<string>();
  for (const {
    pattern,
    shouldScan,
    shouldInclude,
    allowNumericLeadingFinalLabel,
  } of SCHEMELESS_CANDIDATE_PATTERNS) {
    if (!shouldScan(text)) {
      continue;
    }
    pattern.lastIndex = 0;
    for (const result of text.matchAll(pattern)) {
      const value = result[0];
      if (shouldInclude && !shouldInclude(value)) {
        continue;
      }
      if (!isSupportedSchemelessUrlCandidate(value, allowNumericLeadingFinalLabel)) {
        continue;
      }
      const start = result.index;
      const end = start + value.length;
      const rangeKey = `${start}:${end}`;
      if (value && !seenSchemelessRanges.has(rangeKey)) {
        rawSchemelessCandidates.push({ value, start, end });
        seenSchemelessRanges.add(rangeKey);
      }
    }
  }
  rawSchemelessCandidates.sort((left, right) => left.start - right.start);

  const schemelessBridgeOwners: UrlCandidate[] = [];
  let schemeMatchIndex = 0;
  for (const candidate of rawSchemelessCandidates) {
    while (
      schemeMatchIndex < matches.length &&
      matches[schemeMatchIndex].index + matches[schemeMatchIndex][0].length <= candidate.start
    ) {
      schemeMatchIndex += 1;
    }
    const containingSchemeMatch = matches[schemeMatchIndex];
    if (
      containingSchemeMatch &&
      containingSchemeMatch.index <= candidate.start &&
      candidate.end <= containingSchemeMatch.index + containingSchemeMatch[0].length
    ) {
      continue;
    }
    schemelessBridgeOwners.push(candidate);
  }

  const schemeBridgeOwnerPositions = matches.map((result) => result.index);
  const allBridgeOwnerPositions = [
    ...schemeBridgeOwnerPositions,
    ...schemelessBridgeOwners.map((candidate) => candidate.start),
  ].sort((left, right) => left - right);
  const detectWhitespaceBridge = (
    start: number,
    controlSearchStart: number,
    ownerPositions: number[]
  ): UrlCandidate | null => {
    const control = findFirstPositionAtOrAfter(controlPositions, controlSearchStart);
    if (control === null) {
      return null;
    }
    const atSign = findFirstPositionAtOrAfter(atSignPositions, control + 1);
    if (atSign === null) {
      return null;
    }

    // Let the closest URL candidate before the control own this bridge. This
    // prevents repeated materialization of the same long span.
    const nextOwner = findFirstPositionAtOrAfter(ownerPositions, start + 1);
    if (nextOwner !== null && nextOwner <= control) {
      return null;
    }

    // A slash-less scheme-like token before `@` can still become userinfo in
    // the original URL. Preserve every explicit `scheme://` as a boundary.
    const explicitAuthority = findFirstPositionAtOrAfter(explicitAuthorityPositions, control + 1);
    if (explicitAuthority !== null && explicitAuthority <= atSign) {
      return null;
    }

    const nextScheme = findFirstPositionAtOrAfter(schemeBridgeOwnerPositions, start + 1);
    const bridgeLimit = nextScheme !== null && atSign < nextScheme ? nextScheme : text.length;
    let bridgedEnd = atSign + 1;
    while (bridgedEnd < bridgeLimit && !NON_CONTROL_WHITESPACE_RE.test(text[bridgedEnd])) {
      bridgedEnd += 1;
    }
    if (control >= bridgedEnd) {
      return null;
    }

    const value = cleanAmbiguousUrlCandidate(text.slice(start, bridgedEnd));
    if (!hasInternalUrlControl(value)) {
      return null;
    }

    return { value, start, end: start + value.length };
  };

  for (const result of matches) {
    const rawMatch = result[0];
    const start = result.index;
    const value = cleanAmbiguousUrlCandidate(rawMatch);
    if (!value) {
      continue;
    }

    if (!hasInternalUrlControl(value)) {
      const bridgedCandidate = detectWhitespaceBridge(start, start, schemeBridgeOwnerPositions);
      if (bridgedCandidate) {
        candidates.push(bridgedCandidate);
      }
      continue;
    }

    const end = start + value.length;
    candidates.push({ value, start, end });
  }

  for (const candidate of schemelessBridgeOwners) {
    const bridgedCandidate = detectWhitespaceBridge(
      candidate.start,
      candidate.end,
      allBridgeOwnerPositions
    );
    if (bridgedCandidate) {
      candidates.push(bridgedCandidate);
    }
  }

  return mergeAmbiguousUrlCandidates(text, [
    ...candidates,
    ...detectControlObfuscatedSchemeRelativeUrls(text),
    ...detectControlObfuscatedGenericSchemes(text),
    ...detectAmbiguousSchemelessUrls(text),
  ]);
}

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
  if (!hasExplicitAuthorityScheme(url)) {
    return null;
  }

  const [, rest] = url.split('://', 2);
  if (!rest) {
    return null;
  }

  const hostAndRest = rest.split(/[/?#]/, 1)[0];
  const withoutCreds = hostAndRest.includes('@')
    ? (hostAndRest.split('@').pop() ?? '')
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

function isUrlLikeSpecialSchemeCandidate(value: string): boolean {
  const colonIndex = value.indexOf(':');
  if (colonIndex < 0) {
    return false;
  }

  const scheme = value.slice(0, colonIndex).toLowerCase();
  const payload = value.slice(colonIndex + 1);

  try {
    const hostname = normalizeHostnameForComparison(new URL(value).hostname);
    return (
      scheme === 'file' ||
      /[\\/?#]/.test(payload) ||
      hostname === 'localhost' ||
      hostname.includes('.') ||
      isIpv4Address(hostname) ||
      (hostname.startsWith('[') && hostname.endsWith(']'))
    );
  } catch {
    return false;
  }
}

function hasExcludedDelimiterInExplicitAuthority(value: string): boolean {
  const colonIndex = value.indexOf(':');
  if (colonIndex < 0) {
    return false;
  }

  try {
    new URL(value);
  } catch {
    return false;
  }

  const scheme = value.slice(0, colonIndex).toLowerCase();
  const payload = value.slice(colonIndex + 1);
  const isSpecialScheme = AUTHORITY_SCHEMES.includes(scheme);
  let authorityStart: number;
  if (isSpecialScheme) {
    authorityStart = 0;
    while (authorityStart < payload.length && /[\\/]/.test(payload[authorityStart])) {
      authorityStart += 1;
    }
  } else if (payload.startsWith('//')) {
    authorityStart = 2;
  } else {
    return false;
  }
  const authorityRemainder = payload.slice(authorityStart);
  const authorityEnd = authorityRemainder.search(isSpecialScheme ? /[\\/?#]/ : /[/?#]/);
  const rawAuthority =
    authorityEnd < 0 ? authorityRemainder : authorityRemainder.slice(0, authorityEnd);
  return /[<>"{}|\\^\x60\x5b\x5d]/.test(rawAuthority);
}

function hasExcludedDelimiterInSchemelessAuthority(value: string): boolean {
  try {
    new URL(`http://${value}`);
  } catch {
    return false;
  }

  const authorityEnd = value.search(/[\\/?#]/);
  const rawAuthority = authorityEnd < 0 ? value : value.slice(0, authorityEnd);
  return (
    SCHEMELESS_DOMAIN_SEPARATOR_RE.test(rawAuthority) &&
    /[<>"{}|\\^\x60\x5b\x5d]/.test(rawAuthority)
  );
}

function hasParsedUserinfo(value: string): boolean {
  try {
    const parsedUrl = /^[\\/]{2}/.test(value)
      ? new URL(value, SCHEME_RELATIVE_BASE_URL)
      : new URL(value);
    return Boolean(parsedUrl.username || parsedUrl.password);
  } catch {
    return false;
  }
}

function isParsableUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function hasParsedUserinfoAtFinalSeparator(
  value: string,
  parseMode: UserinfoBridgeOwner['parseMode']
): boolean {
  try {
    const parsedUrl =
      parseMode === 'scheme-less'
        ? new URL(`http://${value}`)
        : /^[\\/]{2}/.test(value)
          ? new URL(value, SCHEME_RELATIVE_BASE_URL)
          : new URL(value);
    if (!parsedUrl.username && !parsedUrl.password) {
      return false;
    }

    const finalSeparator = value.lastIndexOf('@');
    const authorityTail = value.slice(finalSeparator + 1);
    const parsedTail = new URL(`${parsedUrl.protocol}//${authorityTail}`);
    return parsedUrl.host.toLowerCase() === parsedTail.host.toLowerCase();
  } catch {
    return false;
  }
}

function detectWhitespaceBridgedUserinfoUrls(text: string): WhitespaceBridgedUserinfoCandidate[] {
  if (!text.includes('@') || !NON_CONTROL_WHITESPACE_RE.test(text)) {
    return [];
  }

  const rawOwners: UserinfoBridgeOwner[] = [];
  const seenRanges = new Set<string>();

  const addOwner = (
    value: string,
    start: number,
    parseMode: UserinfoBridgeOwner['parseMode']
  ): void => {
    const end = start + value.length;
    const rangeKey = `${start}:${end}`;
    if (!seenRanges.has(rangeKey)) {
      rawOwners.push({ value, start, end, parseMode });
      seenRanges.add(rangeKey);
    }
  };

  if (findDetectedUrlPrefixInToken(text)) {
    WHITESPACE_BRIDGE_EXPLICIT_OWNER_RE.lastIndex = 0;
    for (const result of text.matchAll(WHITESPACE_BRIDGE_EXPLICIT_OWNER_RE)) {
      if (!hasStandaloneSchemeStart(text, result.index)) {
        continue;
      }
      addOwner(result[0], result.index, 'explicit');
    }
  }

  WHITESPACE_BRIDGE_SCHEME_RELATIVE_OWNER_RE.lastIndex = 0;
  for (const result of text.matchAll(WHITESPACE_BRIDGE_SCHEME_RELATIVE_OWNER_RE)) {
    addOwner(result[0], result.index, 'scheme-relative');
  }

  // Userinfo candidates begin after the bridge owner and would incorrectly
  // displace it, so only host-based patterns participate in owner selection.
  for (const { pattern, shouldScan, shouldInclude } of SCHEMELESS_CANDIDATE_PATTERNS.slice(0, -1)) {
    if (!shouldScan(text)) {
      continue;
    }
    pattern.lastIndex = 0;
    for (const result of text.matchAll(pattern)) {
      const value = result[0];
      if (shouldInclude && !shouldInclude(value)) {
        continue;
      }
      if (!isSupportedSchemelessUrlCandidate(value, true)) {
        continue;
      }
      addOwner(value, result.index, 'scheme-less');
    }
  }

  rawOwners.sort((left, right) => left.start - right.start || right.end - left.end);
  const owners: UserinfoBridgeOwner[] = [];
  for (const owner of rawOwners) {
    const previous = owners[owners.length - 1];
    if (!previous || owner.start >= previous.end) {
      owners.push(owner);
    }
  }

  const atSignPositions: number[] = [];
  for (let index = text.indexOf('@'); index >= 0; index = text.indexOf('@', index + 1)) {
    atSignPositions.push(index);
  }
  const structuralOwnerPositions = owners
    .filter((owner) => owner.parseMode !== 'scheme-less')
    .map((owner) => owner.start);

  const bridgedCandidates: WhitespaceBridgedUserinfoCandidate[] = [];
  for (let ownerIndex = 0; ownerIndex < owners.length; ownerIndex += 1) {
    const owner = owners[ownerIndex];
    const nextStructuralOwner = findFirstPositionAtOrAfter(
      structuralOwnerPositions,
      owner.start + 1
    );
    // WHATWG treats the final `@` in an authority as the host separator. Use
    // the final separator owned by this candidate so an earlier, allowlisted
    // intermediate host cannot truncate validation. Explicit and relative
    // owners retain their scheme through the next structural URL boundary.
    // Scheme-less owners stop at the next owner so only the closest one scans
    // a given separator and large host lists remain linear.
    const nextOwner = owners[ownerIndex + 1];
    const boundary =
      owner.parseMode === 'scheme-less'
        ? (nextOwner?.start ?? text.length)
        : (nextStructuralOwner ?? text.length);
    const atSign = findLastPositionBefore(atSignPositions, boundary);
    if (atSign === null || atSign < owner.end) {
      continue;
    }

    const bridge = text.slice(owner.end, atSign);
    if (ASCII_URL_CONTROL_RE.test(bridge) || !NON_CONTROL_WHITESPACE_RE.test(bridge)) {
      continue;
    }

    let end = atSign + 1;
    while (end < text.length && !URL_WHITESPACE_RE.test(text[end])) {
      end += 1;
    }
    const value = text.slice(owner.start, end);
    if (!hasParsedUserinfoAtFinalSeparator(value, owner.parseMode)) {
      continue;
    }

    const ordinaryEmail = findOrdinaryEmailRangeAt(text, atSign);
    bridgedCandidates.push({
      value,
      start: owner.start,
      end,
      // A later ordinary email address can parse as this URL's final host.
      // Preserve the source URL so the bridge cannot hide its validation.
      independentOwner: ordinaryEmail
        ? { value: owner.value, start: owner.start, end: owner.end }
        : undefined,
    });
  }

  bridgedCandidates.sort((left, right) => left.start - right.start || right.end - left.end);
  const disjointCandidates: WhitespaceBridgedUserinfoCandidate[] = [];
  for (const candidate of bridgedCandidates) {
    const previous = disjointCandidates[disjointCandidates.length - 1];
    if (!previous || candidate.start >= previous.end) {
      disjointCandidates.push(candidate);
    } else if (candidate.end > previous.end) {
      // Overlapping scheme-less owners can hand the same authority forward
      // through multiple `@` separators. Keep the candidate that reaches the
      // final parsed host; structural candidates already span that full range.
      disjointCandidates[disjointCandidates.length - 1] = candidate;
    }
  }
  return disjointCandidates;
}

/**
 * Detect URLs in text using robust regex patterns.
 */
function detectUrls(text: string): string[] {
  const ambiguousUrls = detectAmbiguousUrls(text);
  const detectedUrls: string[] = ambiguousUrls.map((candidate) => candidate.value);
  const ordinaryEmailLocalPartRanges: Array<{ start: number; end: number }> = [];
  for (
    let separator = text.indexOf('@');
    separator >= 0;
    separator = text.indexOf('@', separator + 1)
  ) {
    const ordinaryEmail = findOrdinaryEmailRangeAt(text, separator);
    if (ordinaryEmail) {
      ordinaryEmailLocalPartRanges.push({
        start: ordinaryEmail.start,
        end: ordinaryEmail.separator,
      });
    }
  }
  const startsInsideOrdinaryEmailLocalPart = (start: number): boolean => {
    let low = 0;
    let high = ordinaryEmailLocalPartRanges.length - 1;
    let candidateIndex = -1;

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (ordinaryEmailLocalPartRanges[middle].start <= start) {
        candidateIndex = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    return candidateIndex >= 0 && start < ordinaryEmailLocalPartRanges[candidateIndex].end;
  };
  const overlapsOrdinaryEmailLocalPart = (start: number, end: number): boolean => {
    let low = 0;
    let high = ordinaryEmailLocalPartRanges.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (ordinaryEmailLocalPartRanges[middle].end <= start) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    return (
      low < ordinaryEmailLocalPartRanges.length && ordinaryEmailLocalPartRanges[low].start < end
    );
  };
  const isInsideAmbiguousUrl = (start: number, end: number): boolean => {
    let low = 0;
    let high = ambiguousUrls.length - 1;
    let candidateIndex = -1;

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (ambiguousUrls[middle].start <= start) {
        candidateIndex = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    return candidateIndex >= 0 && end <= ambiguousUrls[candidateIndex].end;
  };
  const exclusiveSchemelessUrls = detectExclusiveSchemelessUrls(text).filter(
    (candidate) =>
      !isInsideAmbiguousUrl(candidate.start, candidate.end) &&
      !overlapsOrdinaryEmailLocalPart(candidate.start, candidate.end)
  );
  detectedUrls.push(...exclusiveSchemelessUrls.map((candidate) => candidate.value));

  // Pattern 1: URLs with schemes (highest priority)
  const nestedAuthorityStartPattern =
    `(?:${AUTHORITY_SCHEMES.join('|')}):|` + `${GENERIC_SCHEME_PATTERN}:\\/\\/|` + `[/\\\\]{2}`;
  const whitespaceBridgeContentPattern = `(?:(?!${nestedAuthorityStartPattern})[^\\t\\n\\r@])*`;
  const whitespaceBridgedExplicitUserinfoPattern = new RegExp(
    `(?<![a-z0-9])(?:` +
      `(?:${AUTHORITY_SCHEMES.join('|')}):|${GENERIC_SCHEME_PATTERN}:\\/\\/` +
      `)${whitespaceBridgeContentPattern}[^\\S\\t\\n\\r]` +
      `${whitespaceBridgeContentPattern}@[^\\s]+`,
    'gi'
  );
  const whitespaceBridgedSchemeRelativeUserinfoPattern = new RegExp(
    `(?<![:/\\\\])[/\\\\]{2,}` +
      `${whitespaceBridgeContentPattern}[^\\S\\t\\n\\r]` +
      `${whitespaceBridgeContentPattern}@[^\\s]+`,
    'gi'
  );
  const delimiterBridgedUserinfoPattern = new RegExp(
    `(?<![a-z0-9])(?:` +
      `(?:${AUTHORITY_SCHEMES.join('|')}):|${GENERIC_SCHEME_PATTERN}:\\/\\/` +
      `)(?=[^\\s<>"{}|\\\\^\\x60\\[\\]@]*` +
      `[<>"{}|\\\\^\\x60\\[\\]][^\\s@]*@)[^\\s]+`,
    'gi'
  );
  const delimiterBridgedStructuralPattern = new RegExp(
    `(?<![a-z0-9])(?:` +
      `(?:${AUTHORITY_SCHEMES.join('|')}):|${GENERIC_SCHEME_PATTERN}:\\/\\/` +
      `)(?=[^\\s]*?[<>"{}|\\\\^\\x60\\[\\]][\\/\\\\?#@])[^\\s]+`,
    'gi'
  );
  const excludedAuthoritySpecialSchemePattern = new RegExp(
    `(?<![a-z0-9])(?:${AUTHORITY_SCHEMES.join('|')}):` +
      `(?=[^\\s]*?[<>"{}|\\\\^\\x60\\[\\]])[^\\s]+`,
    'gi'
  );
  const excludedAuthorityGenericSchemePattern = new RegExp(
    `(?<![a-z0-9])${GENERIC_SCHEME_PATTERN}:\\/\\/` + `(?=[^\\s]*?[<>"{}|\\\\^\\x60\\[\\]])[^\\s]+`,
    'gi'
  );
  const excludedAuthoritySchemelessPattern = new RegExp(
    `(?<![\\p{L}\\p{N}%_.\\-\\u3002\\uff0e\\uff61])` +
      `(?=[^\\s]*${SCHEMELESS_DOMAIN_SEPARATOR_PATTERN})` +
      `(?=[^\\s]*[<>"{}|\\\\^\\x60\\[\\]])[\\p{L}\\p{N}][^\\s]+`,
    'giu'
  );
  const specialSchemePattern = /(?<![a-z0-9])(?:https?|ftp|wss?|file):[^\s<>"{}|^`]+/gi;
  const schemePatterns: Array<{
    pattern: RegExp;
    ownsNestedCandidates: boolean;
    ownsCleanedRange?: boolean;
    requiresExplicitPrefix?: boolean;
    shouldScan?: (value: string) => boolean;
    shouldInclude?: (value: string) => boolean;
    clean?: (value: string, text: string, start: number) => string;
  }> = [
    {
      pattern: whitespaceBridgedExplicitUserinfoPattern,
      ownsNestedCandidates: true,
      requiresExplicitPrefix: true,
      shouldScan: (value) => value.includes('@') && NON_CONTROL_WHITESPACE_RE.test(value),
      shouldInclude: hasParsedUserinfo,
    },
    {
      pattern: whitespaceBridgedSchemeRelativeUserinfoPattern,
      ownsNestedCandidates: true,
      shouldInclude: hasParsedUserinfo,
    },
    {
      pattern: excludedAuthoritySpecialSchemePattern,
      ownsNestedCandidates: true,
      requiresExplicitPrefix: true,
      shouldScan: hasExcludedUrlDelimiter,
      shouldInclude: hasExcludedDelimiterInExplicitAuthority,
      clean: cleanExcludedAuthorityPairedWrapper,
      ownsCleanedRange: true,
    },
    {
      pattern: excludedAuthorityGenericSchemePattern,
      ownsNestedCandidates: true,
      requiresExplicitPrefix: true,
      shouldScan: hasExcludedUrlDelimiter,
      shouldInclude: hasExcludedDelimiterInExplicitAuthority,
      clean: cleanExcludedAuthorityPairedWrapper,
      ownsCleanedRange: true,
    },
    {
      pattern: SCHEME_RELATIVE_URL_RE,
      ownsNestedCandidates: true,
      shouldInclude: isSupportedSchemeRelativeUrlCandidate,
      clean: cleanTrailingAuthorityProsePunctuation,
    },
    {
      pattern: excludedAuthoritySchemelessPattern,
      ownsNestedCandidates: true,
      shouldScan: (value) => hasDomainSeparator(value) && hasExcludedUrlDelimiter(value),
      shouldInclude: hasExcludedDelimiterInSchemelessAuthority,
      clean: cleanExcludedAuthorityPairedWrapper,
      ownsCleanedRange: true,
    },
    {
      pattern: delimiterBridgedUserinfoPattern,
      ownsNestedCandidates: true,
      requiresExplicitPrefix: true,
      shouldScan: (value) => value.includes('@') && hasExcludedUrlDelimiter(value),
      shouldInclude: hasParsedUserinfo,
    },
    {
      pattern: delimiterBridgedStructuralPattern,
      ownsNestedCandidates: true,
      requiresExplicitPrefix: true,
      shouldScan: hasExcludedUrlDelimiter,
      shouldInclude: isParsableUrl,
    },
    {
      pattern: specialSchemePattern,
      ownsNestedCandidates: true,
      requiresExplicitPrefix: true,
      shouldInclude: isUrlLikeSpecialSchemeCandidate,
      clean: cleanTrailingAuthorityProsePunctuation,
    },
    {
      pattern: /(?<![a-z0-9])[a-z][a-z0-9+.-]*:\/\/[^\s<>"{}|\\^`[\]]+/gi,
      ownsNestedCandidates: true,
      requiresExplicitPrefix: true,
      clean: cleanTrailingAuthorityProsePunctuation,
    },
    {
      pattern: /(?<![a-z0-9])(?:data|javascript|vbscript|mailto):(?=[<>"{}|\\^`[\]])[^\s]+/gi,
      ownsNestedCandidates: true,
      requiresExplicitPrefix: true,
    },
    {
      pattern: /(?<![a-z0-9])(?:data|javascript|vbscript|mailto):(?=[\t\n\r])/gi,
      ownsNestedCandidates: false,
      requiresExplicitPrefix: true,
    },
    {
      pattern: /(?<![a-z0-9])data:[^\s<>"{}|\\^`[\]]+/gi,
      ownsNestedCandidates: false,
      requiresExplicitPrefix: true,
    },
    {
      pattern: /(?<![a-z0-9])javascript:[^\s<>"{}|\\^`[\]]+/gi,
      ownsNestedCandidates: false,
      requiresExplicitPrefix: true,
    },
    {
      pattern: /(?<![a-z0-9])vbscript:[^\s<>"{}|\\^`[\]]+/gi,
      ownsNestedCandidates: false,
      requiresExplicitPrefix: true,
    },
    {
      pattern: /(?<![a-z0-9])mailto:[^\s<>"{}|\\^`[\]]+/gi,
      ownsNestedCandidates: true,
      requiresExplicitPrefix: true,
    },
  ];

  const schemeUrls = new Set<string>();
  const explicitUrlPrefixInText = findDetectedUrlPrefixInToken(text);
  const hasExplicitUrlCandidate =
    explicitUrlPrefixInText !== null && explicitUrlPrefixInText.end < text.length;
  const exclusiveSchemeRanges: Array<{ start: number; end: number }> = exclusiveSchemelessUrls.map(
    ({ start, end }) => ({ start, end })
  );
  const isInsideExclusiveSchemeUrl = (start: number, end: number): boolean => {
    let low = 0;
    let high = exclusiveSchemeRanges.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const range = exclusiveSchemeRanges[middle];
      if (start < range.start) {
        high = middle - 1;
      } else if (start >= range.end) {
        low = middle + 1;
      } else {
        return end <= range.end;
      }
    }
    return false;
  };
  const overlapsExclusiveUrl = (start: number, end: number): boolean => {
    let low = 0;
    let high = exclusiveSchemeRanges.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (exclusiveSchemeRanges[middle].end <= start) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low < exclusiveSchemeRanges.length && exclusiveSchemeRanges[low].start < end;
  };

  for (const candidate of detectWhitespaceBridgedUserinfoUrls(text)) {
    if (isInsideAmbiguousUrl(candidate.start, candidate.end)) {
      continue;
    }
    if (
      candidate.independentOwner &&
      !isInsideAmbiguousUrl(candidate.independentOwner.start, candidate.independentOwner.end)
    ) {
      detectedUrls.push(candidate.independentOwner.value);
      exclusiveSchemeRanges.push({
        start: candidate.independentOwner.start,
        end: candidate.independentOwner.end,
      });
    }
    detectedUrls.push(candidate.value);
    exclusiveSchemeRanges.push({ start: candidate.start, end: candidate.end });
  }
  exclusiveSchemeRanges.sort((left, right) => left.start - right.start);

  for (const {
    pattern,
    ownsNestedCandidates,
    ownsCleanedRange,
    requiresExplicitPrefix,
    shouldScan,
    shouldInclude,
    clean,
  } of schemePatterns) {
    if (requiresExplicitPrefix && !hasExplicitUrlCandidate) {
      continue;
    }
    if (shouldScan && !shouldScan(text)) {
      continue;
    }
    for (const result of text.matchAll(pattern)) {
      const rawMatch = result[0];
      if (isAsciiSchemeStart(rawMatch[0]) && !hasStandaloneSchemeStart(text, result.index)) {
        continue;
      }
      if (shouldInclude && !shouldInclude(rawMatch)) {
        continue;
      }
      const match = clean ? clean(rawMatch, text, result.index) : rawMatch;
      if (match) {
        const start = result.index;
        const end = start + (ownsCleanedRange ? match.length : rawMatch.length);
        if (isInsideAmbiguousUrl(start, end)) {
          continue;
        }
        if (isInsideExclusiveSchemeUrl(start, end)) {
          continue;
        }
        const hasExplicitUrlPrefix = /^[a-z][a-z0-9+.-]*:/i.test(match) || /^[\\/]{2}/.test(match);
        if (!hasExplicitUrlPrefix && overlapsExclusiveUrl(start, end)) {
          continue;
        }
        detectedUrls.push(match);
        if (ownsNestedCandidates) {
          exclusiveSchemeRanges.push({ start, end });
        }
        // Track the domain part to avoid duplicates
        if (hasExplicitAuthorityScheme(match)) {
          const domainPart = match.split('://', 2)[1].split('/')[0].split('?')[0].split('#')[0];
          schemeUrls.add(domainPart.toLowerCase());
        }
      }
    }
    if (ownsNestedCandidates) {
      exclusiveSchemeRanges.sort((left, right) => left.start - right.start);
    }
  }

  const schemelessScanText = exclusiveSchemeRanges.some(
    ({ start, end }) => start === 0 && end >= text.length
  )
    ? ''
    : text;
  const extendedSchemelessCandidates: UrlCandidate[] = [];
  for (const {
    pattern,
    shouldScan,
    shouldInclude,
    shouldIncludeAt,
    allowNumericLeadingFinalLabel,
    ownsToken,
  } of NORMAL_SCHEMELESS_EXTENDED_HOST_PATTERNS) {
    if (!shouldScan(schemelessScanText)) {
      continue;
    }
    pattern.lastIndex = 0;
    for (const result of schemelessScanText.matchAll(pattern)) {
      const rawMatchedValue = result[0];
      const unwrapped = unwrapPairedUrlWrapper(rawMatchedValue, text, result.index);
      const matchedValue = cleanTrailingSchemelessUnicodeDots(unwrapped.value);
      if (startsInsideOrdinaryEmailLocalPart(unwrapped.start)) {
        continue;
      }
      if (shouldInclude && !shouldInclude(matchedValue)) {
        continue;
      }
      if (shouldIncludeAt && !shouldIncludeAt(text, unwrapped.start)) {
        continue;
      }
      if (!isSupportedSchemelessUrlCandidate(matchedValue, allowNumericLeadingFinalLabel)) {
        continue;
      }
      let { start } = unwrapped;
      let end = unwrapped.start + matchedValue.length;
      if (ownsToken && matchedValue === rawMatchedValue) {
        while (start > 0 && !URL_WHITESPACE_RE.test(text[start - 1])) {
          start -= 1;
        }
        while (end < text.length && !URL_WHITESPACE_RE.test(text[end])) {
          end += 1;
        }
      }
      if (overlapsOrdinaryEmailLocalPart(start, end)) {
        continue;
      }
      extendedSchemelessCandidates.push({
        value: text.slice(start, end),
        start,
        end,
      });
    }
  }
  extendedSchemelessCandidates.sort(
    (left, right) => left.start - right.start || right.end - left.end
  );
  const selectedExtendedSchemelessCandidates: UrlCandidate[] = [];
  for (const candidate of extendedSchemelessCandidates) {
    if (isInsideAmbiguousUrl(candidate.start, candidate.end)) {
      continue;
    }
    if (overlapsExclusiveUrl(candidate.start, candidate.end)) {
      continue;
    }
    const previous = selectedExtendedSchemelessCandidates.at(-1);
    if (previous && candidate.start < previous.end) {
      continue;
    }
    if (startsInsideOrdinaryEmailLocalPart(candidate.start)) {
      continue;
    }
    detectedUrls.push(candidate.value);
    selectedExtendedSchemelessCandidates.push(candidate);
  }
  exclusiveSchemeRanges.push(
    ...selectedExtendedSchemelessCandidates.map(({ start, end }) => ({ start, end }))
  );
  exclusiveSchemeRanges.sort((left, right) => left.start - right.start);

  // Pattern 2: Domain-like patterns without schemes (exclude already found)
  const domainPattern = /\b(?:www\.)?[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}(?:\/[^\s]*)?/gi;
  if (hasPotentialAsciiDomainFinalLabel(schemelessScanText)) {
    for (const result of schemelessScanText.matchAll(domainPattern)) {
      const rawMatch = result[0];
      const match = cleanPairedUrlWrapper(rawMatch, text, result.index);
      if (match) {
        const start = result.index;
        const rawEnd = start + rawMatch.length;
        if (isInsideAmbiguousUrl(start, rawEnd)) {
          continue;
        }
        if (overlapsExclusiveUrl(start, rawEnd)) {
          continue;
        }
        if (startsInsideOrdinaryEmailLocalPart(start)) {
          continue;
        }
        // Extract just the domain part for comparison
        const domainPart = match.split('/')[0].split('?')[0].split('#')[0].toLowerCase();
        // Only add if we haven't already found this domain with a scheme
        if (!schemeUrls.has(domainPart)) {
          detectedUrls.push(match);
        }
      }
    }
  }

  // Pattern 3: IP addresses (exclude already found)
  const ipPattern = /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?::[0-9]+)?(?:\/[^\s]*)?/g;
  for (const result of schemelessScanText.matchAll(ipPattern)) {
    const rawMatch = result[0];
    const match = cleanPairedUrlWrapper(rawMatch, text, result.index);
    if (match) {
      const start = result.index;
      const rawEnd = start + rawMatch.length;
      if (isInsideAmbiguousUrl(start, rawEnd)) {
        continue;
      }
      if (overlapsExclusiveUrl(start, rawEnd)) {
        continue;
      }
      if (startsInsideOrdinaryEmailLocalPart(start)) {
        continue;
      }
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
    if (hasExplicitAuthorityScheme(url)) {
      try {
        const parsed = new URL(url);
        if (parsed.hostname) {
          const normalizedHostname = normalizeHostnameForComparison(parsed.hostname);
          schemeUrlDomains.add(normalizedHostname);
          // Also add www-stripped version
          const bareDomain = normalizedHostname.replace(/^www\./, '');
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
    if (!hasExplicitAuthorityScheme(url)) {
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
  if (ASCII_URL_CONTROL_RE.test(urlString)) {
    return {
      parsedUrl: null,
      reason: AMBIGUOUS_URL_REASON,
      hadScheme: false,
    };
  }

  try {
    let parsedUrl: URL;
    let originalScheme: string;
    let hadScheme: boolean;

    // Parse URL - preserve original scheme for validation
    if (hasExplicitAuthorityScheme(urlString)) {
      // Standard URL with a double-slash scheme
      parsedUrl = new URL(urlString);
      originalScheme = parsedUrl.protocol.replace(/:$/, '');
      hadScheme = true;
    } else if (/^[\\/]{2}/.test(urlString)) {
      // Resolve network-path references exactly as a WHATWG consumer would.
      parsedUrl = new URL(urlString, SCHEME_RELATIVE_BASE_URL);
      originalScheme = parsedUrl.protocol.replace(/:$/, '');
      hadScheme = false;
    } else if (
      urlString.includes(':') &&
      DETECTED_SCHEMES.has(urlString.split(':', 1)[0].toLowerCase())
    ) {
      // Recognized schemes that can omit the double slash
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
      return {
        parsedUrl: null,
        reason: 'Contains userinfo (potential credential injection)',
        hadScheme,
      };
    }

    // Everything else (IPs, localhost, private IPs) goes through allow list logic
    return { parsedUrl, reason: '', hadScheme };
  } catch (error) {
    // Provide specific error information for debugging
    const errorName = error instanceof Error ? error.name : 'Error';
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      parsedUrl: null,
      reason: `URL parsing error: ${errorName}: ${errorMessage}`,
      hadScheme: false,
    };
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
  const allowedHasNonDefaultPort =
    allowedParsed.port &&
    allowedPort !== DEFAULT_PORTS[allowedScheme as keyof typeof DEFAULT_PORTS];

  if (!allowedHasNonDefaultPort) {
    return false; // No port restriction when allow list has no non-default port
  }

  // Allow list has explicit non-default port, so URL must match exactly
  const urlHasNonDefaultPort =
    urlParsed.port && urlPort !== DEFAULT_PORTS[urlScheme as keyof typeof DEFAULT_PORTS];

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
function isUrlAllowed(
  parsedUrl: URL,
  allowList: string[],
  allowSubdomains: boolean,
  hadScheme: boolean
): boolean {
  if (allowList.length === 0) {
    return false;
  }

  const urlHost = normalizeHostnameForComparison(parsedUrl.hostname || '');
  if (!urlHost) {
    return false;
  }

  const urlDomain = urlHost.replace(/^www\./, '');
  const schemeLower = parsedUrl.protocol ? parsedUrl.protocol.replace(/:$/, '').toLowerCase() : '';
  const urlPort = safeGetPort(parsedUrl, schemeLower);
  const hostIndicatesPort =
    Boolean(parsedUrl.host) && parsedUrl.host.includes(':') && !parsedUrl.host.startsWith('[');
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

    const allowedHost = normalizeHostnameForComparison(parsedAllowed.hostname || '');
    if (!allowedHost) {
      continue;
    }

    const allowedScheme = hasExplicitScheme
      ? parsedAllowed.protocol.replace(/:$/, '').toLowerCase()
      : '';
    const allowedPort = safeGetPort(parsedAllowed, allowedScheme);
    const allowIndicatesPort =
      Boolean(parsedAllowed.host) &&
      parsedAllowed.host.includes(':') &&
      !parsedAllowed.host.startsWith('[');
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
      if (
        shouldBlockDueToPortMismatch(
          urlPort,
          parsedUrl,
          allowedPort,
          parsedAllowed,
          schemeLower,
          allowedScheme
        )
      ) {
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
    if (
      shouldBlockDueToPortMismatch(
        urlPort,
        parsedUrl,
        allowedPort,
        parsedAllowed,
        schemeLower,
        allowedScheme
      )
    ) {
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

      if (
        normalizedUrlPath !== normalizedAllowedPath &&
        !normalizedUrlPath.startsWith(`${normalizedAllowedPath}/`)
      ) {
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
