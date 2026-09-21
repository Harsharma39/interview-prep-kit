const cheerio = require('cheerio');
const dns = require('node:dns').promises;
const net = require('node:net');

const MAX_PAGES = 6;
const MAX_TEXT = 12000;
const MAX_RESPONSE_BYTES = 1_000_000;
const relevantTerms = ['careers', 'career', 'jobs', 'hiring', 'recruitment', 'work-with-us', 'culture', 'values', 'mission', 'about', 'engineering', 'technology', 'products', 'services', 'team'];
const interviewTerms = /\b(interview|hiring process|recruitment process|technical screen|take-home|assessment|coding challenge|system design)\b/i;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const isBlockedAddress = (address) => {
  const family = net.isIP(address);
  if (family === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    if (normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
    return Boolean(mapped && isBlockedAddress(mapped[1]));
  }
  // Hostnames are validated by DNS immediately afterwards. Only literal IP
  // addresses belong to this address-range policy.
  return false;
};

const assertResearchUrl = async (value, { allowPrivateResearch = false } = {}) => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Company URL must use HTTP or HTTPS.');
  if (allowPrivateResearch || process.env.ALLOW_PRIVATE_RESEARCH === 'true') return url;
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || isBlockedAddress(hostname)) throw new Error('Private network company URLs are not allowed.');
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    const error = new Error('Company hostname could not be resolved.');
    error.code = 'COMPANY_UNREACHABLE';
    throw error;
  }
  if (!addresses.length || addresses.some(({ address }) => isBlockedAddress(address))) throw new Error('Private network company URLs are not allowed.');
  return url;
};

const readTextLimited = async (response, maximum = MAX_RESPONSE_BYTES) => {
  const length = Number(response.headers.get('content-length') || 0);
  if (length > maximum) throw new Error('Company page exceeded the response-size limit.');
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximum) {
      await reader.cancel();
      throw new Error('Company page exceeded the response-size limit.');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
};

const uniqueUrls = (urls) => [...new Set(urls.filter((url) => typeof url === 'string' && /^https?:\/\//i.test(url)))];

const fetchWithRetry = async (inputUrl, options = {}) => {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      let url = await assertResearchUrl(inputUrl, options);
      for (let redirects = 0; redirects < 5; redirects += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        let response;
        try {
          response = await fetch(url, { signal: controller.signal, redirect: 'manual', headers: { 'User-Agent': 'InterviewKitResearch/1.0' } });
        } finally { clearTimeout(timeout); }
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          if (!location) {
            const error = new Error('Company site returned a redirect without a location.');
            error.retryable = false;
            throw error;
          }
          url = await assertResearchUrl(new URL(location, url).toString(), options);
          continue;
        }
        if (response.ok) {
          response.researchUrl = url.toString();
          return response;
        }
        if (![429, 500, 502, 503, 504].includes(response.status)) {
          const error = new Error(`Company site returned HTTP ${response.status}.`);
          error.retryable = false;
          throw error;
        }
        lastError = new Error(`Company site returned HTTP ${response.status}.`);
        break;
      }
      if (!lastError) throw new Error('Company site redirected too many times.');
    } catch (error) {
      lastError = error;
    }
    if (lastError?.retryable === false) break;
    if (attempt < 2) await sleep(150 * (2 ** attempt));
  }
  if (lastError && !lastError.code) lastError.code = lastError.name === 'AbortError' ? 'COMPANY_UNREACHABLE' : 'COMPANY_FETCH_FAILED';
  throw lastError;
};

const pageText = (html) => {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg').remove();
  return $('body').text().replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
};

const discoverLinks = (baseUrl, html) => {
  const base = new URL(baseUrl);
  const $ = cheerio.load(html);
  return [...new Set($('a[href]').map((_, element) => $(element).attr('href')).get().map((href) => { try { return new URL(href, base).toString(); } catch { return null; } }).filter((url) => url && new URL(url).hostname === base.hostname && ['http:', 'https:'].includes(new URL(url).protocol)))];
};

const rankLink = (url) => relevantTerms.reduce((score, term) => score + (url.toLowerCase().includes(term) ? 1 : 0), 0);

const robotsRules = async (homepage, options = {}) => {
  try {
    const response = await fetchWithRetry(`${homepage.origin}/robots.txt`, options);
    if (!response.ok) return [];
    const lines = (await readTextLimited(response, 100_000)).split(/\r?\n/);
    let applies = false;
    return lines.reduce((rules, line) => {
      const [rawKey, rawValue] = line.split(':', 2);
      const key = rawKey?.trim().toLowerCase();
      const value = rawValue?.trim();
      if (key === 'user-agent') applies = value === '*' || value === 'InterviewKitResearch/1.0';
      if (applies && key === 'disallow' && value) rules.push(value);
      return rules;
    }, []);
  } catch {
    return [];
  }
};

const allowedByRobots = (url, homepage, rules) => rules.every((rule) => !new URL(url).pathname.startsWith(rule.startsWith('/') ? rule : `/${rule}`));

const discoverPublicInterviewLinks = (html) => {
  const $ = cheerio.load(html);
  return uniqueUrls($('a.result__a, a[data-testid="result-title-a"]').map((_, element) => $(element).attr('href')).get()).slice(0, 3);
};

const buildInterviewProcess = (pages) => {
  const evidence = pages.filter((page) => interviewTerms.test(page.text));
  return {
    found: evidence.length > 0,
    summary: evidence.length ? 'Public interview-process reference material was found. Review the cited sources; the application does not treat these reports as official company policy.' : '',
    sources: uniqueUrls(evidence.map((page) => page.url)),
  };
};

const researchPublicInterviewProcess = async (companyName) => {
  if (process.env.PUBLIC_INTERVIEW_RESEARCH === 'false') return { found: false, summary: '', sources: [] };
  try {
    const query = encodeURIComponent(`${companyName} interview process`);
    const searchResponse = await fetchWithRetry(`https://html.duckduckgo.com/html/?q=${query}`);
    const links = discoverPublicInterviewLinks(await readTextLimited(searchResponse, 500_000));
    const pages = [];
    for (const link of links) {
      try {
        const publicUrl = await assertResearchUrl(link);
        const robots = await robotsRules(publicUrl);
        if (!allowedByRobots(publicUrl.toString(), publicUrl, robots)) continue;
        const response = await fetchWithRetry(publicUrl.toString());
        if ((response.headers.get('content-type') || '').includes('text/html')) {
          pages.push({ url: response.researchUrl || link, text: pageText(await readTextLimited(response, 500_000)) });
        }
      } catch (error) {
        console.warn(`Skipping public interview research source ${link}: ${error.message}`);
      }
    }
    return buildInterviewProcess(pages);
  } catch (error) {
    console.warn(`Public interview research unavailable: ${error.message}`);
    return { found: false, summary: '', sources: [] };
  }
};

const researchCompany = async (companyUrl, { allowPrivateResearch = false } = {}) => {
  const options = { allowPrivateResearch };
  const homepage = await assertResearchUrl(companyUrl, options);
  const firstResponse = await fetchWithRetry(homepage.toString(), options);
  const contentType = firstResponse.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) throw new Error('Company site did not return HTML.');
  const homepageUrl = firstResponse.researchUrl || homepage.toString();
  const firstHtml = await readTextLimited(firstResponse);
  const resolvedHomepage = new URL(homepageUrl);
  const robots = await robotsRules(resolvedHomepage, options);
  const links = discoverLinks(homepageUrl, firstHtml).sort((a, b) => rankLink(b) - rankLink(a));
  const urls = [homepageUrl, ...links].filter((url) => allowedByRobots(url, resolvedHomepage, robots)).slice(0, MAX_PAGES);
  const pages = [];
  for (const url of urls) {
    const isHomepage = url === homepageUrl;
    try {
      const response = isHomepage ? { text: async () => firstHtml, headers: firstResponse.headers, researchUrl: homepageUrl } : await fetchWithRetry(url, options);
      const type = response.headers.get('content-type') || '';
      if (type.includes('text/html')) pages.push({ url: response.researchUrl || url, text: pageText(isHomepage ? firstHtml : await readTextLimited(response)) });
    } catch (error) {
      if (isHomepage) {
        const homepageError = new Error(`Failed to research company homepage ${url}: ${error.message}`);
        homepageError.code = error.code || 'COMPANY_UNREACHABLE';
        throw homepageError;
      }
      console.warn(`Skipping research page ${url}: ${error.message}`);
    }
  }
  const pagesUsed = uniqueUrls(pages.map((page) => page.url));
  const companyName = resolvedHomepage.hostname.replace(/^www\./, '').split('.')[0];
  const interview_process = await researchPublicInterviewProcess(companyName);
  return { pages, pages_used: pagesUsed, corpus: pages.map((page) => `SOURCE: ${page.url}\n${page.text}`).join('\n\n').slice(0, MAX_TEXT * 2), interview_process };
};

module.exports = { researchCompany, assertResearchUrl, isBlockedAddress, uniqueUrls, buildInterviewProcess, discoverPublicInterviewLinks };
