"""
Optional web search for Sky AI. Standard library only, no API key needed.

Providers, tried in order:
  1. SearXNG, if you set SKY_AI_SEARXNG_URL (for example a self-hosted instance)
  2. DuckDuckGo's HTML results page
  3. Wikipedia's search API (reliable fallback for encyclopedia-style questions)

research() searches, fetches the best pages, and pulls out the most relevant text. Every
source it returns is a page it actually downloaded, so citations are never made up. When the
PC is offline or a site fails, it says so instead of guessing.
"""

import html
import json
import os
import re
import socket
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser

DDG_URL = "https://html.duckduckgo.com/html/"
WIKI_API = "https://en.wikipedia.org/w/api.php"
SEARXNG_URL = os.environ.get("SKY_AI_SEARXNG_URL", "").rstrip("/")
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SkyAIUltra/1.0 (local assistant)"
TIMEOUT = 8
MAX_PAGE_BYTES = 600_000
EXCERPT_CHARS = 900

# Official and primary sources go first when they show up in results.
PREFERRED_DOMAINS = ("skytheft.net", "skycreatorpro.com", "wikipedia.org", "minecraft.wiki", "rockstargames.com",
                     "epicgames.com", "fortnite.com", "roblox.com", "unrealengine.com", "python.org",
                     "developer.mozilla.org", "learn.microsoft.com", "nvidia.com", "github.com")


class SearchError(Exception):
    pass


def _get(url, data=None, timeout=TIMEOUT):
    req = urllib.request.Request(url, data=data, headers={
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.8",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read(MAX_PAGE_BYTES)
            charset = res.headers.get_content_charset() or "utf-8"
            return raw.decode(charset, errors="replace"), res.geturl(), res.headers.get_content_type()
    except urllib.error.HTTPError as e:
        raise SearchError(f"{urllib.parse.urlsplit(url).netloc} answered with HTTP {e.code}") from e
    except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError, OSError) as e:
        reason = getattr(e, "reason", e)
        raise SearchError(f"couldn't reach {urllib.parse.urlsplit(url).netloc} ({reason})") from e


# ---------------------------------------------------------------- HTML helpers

class _TextExtractor(HTMLParser):
    """Readable text from a page, split into paragraphs, skipping scripts, menus and footers."""
    SKIP = {"script", "style", "noscript", "svg", "nav", "footer", "header", "form", "iframe", "template"}
    BLOCK = {"p", "div", "li", "h1", "h2", "h3", "h4", "section", "article", "tr", "br", "td", "dd", "dt", "blockquote"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth_skip = 0
        self.parts, self.current, self.title, self._in_title = [], [], "", False

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.depth_skip += 1
        elif tag == "title":
            self._in_title = True
        if tag in self.BLOCK:
            self._flush()

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.depth_skip:
            self.depth_skip -= 1
        elif tag == "title":
            self._in_title = False
        if tag in self.BLOCK:
            self._flush()

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif not self.depth_skip:
            self.current.append(data)

    def _flush(self):
        text = " ".join("".join(self.current).split())
        if text:
            self.parts.append(text)
        self.current = []


def page_text(raw_html):
    p = _TextExtractor()
    try:
        p.feed(raw_html)
        p.close()
    except Exception:  # broken HTML: keep what was parsed
        pass
    p._flush()
    return " ".join(p.title.split()), [t for t in p.parts if len(t) > 30]


def best_excerpt(paragraphs, query, limit=EXCERPT_CHARS):
    words = {w for w in re.findall(r"[a-z0-9]+", query.lower()) if len(w) > 2}
    scored = []
    for i, para in enumerate(paragraphs):
        low = para.lower()
        hits = sum(1 for w in words if w in low)
        scored.append((hits, -i, para))
    picked, used = [], 0
    for hits, neg_i, para in sorted(scored, reverse=True):
        if used >= limit:
            break
        if hits == 0 and picked:
            break
        picked.append((-neg_i, para[: limit - used]))
        used += len(para)
    return " ... ".join(p for _, p in sorted(picked))


# ---------------------------------------------------------------- providers

class _DDGParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.results, self._mode, self._buf, self._href = [], None, [], None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = a.get("class", "") or ""
        if tag == "a" and "result__a" in cls:
            self._mode, self._buf, self._href = "title", [], a.get("href", "")
        elif "result__snippet" in cls:
            self._mode, self._buf = "snippet", []

    def handle_endtag(self, tag):
        if self._mode == "title" and tag == "a":
            self.results.append({"title": " ".join("".join(self._buf).split()), "url": _ddg_target(self._href), "snippet": ""})
            self._mode = None
        elif self._mode == "snippet" and tag in ("a", "div", "td"):
            if self.results:
                self.results[-1]["snippet"] = " ".join("".join(self._buf).split())
            self._mode = None

    def handle_data(self, data):
        if self._mode:
            self._buf.append(data)


def _ddg_target(href):
    """DuckDuckGo wraps links as //duckduckgo.com/l/?uddg=<real url>."""
    if href.startswith("//"):
        href = "https:" + href
    parsed = urllib.parse.urlsplit(href)
    if "duckduckgo.com" in parsed.netloc and parsed.path.startswith("/l/"):
        target = urllib.parse.parse_qs(parsed.query).get("uddg", [""])[0]
        return target or href
    return href


def search_duckduckgo(query, max_results=6):
    body = urllib.parse.urlencode({"q": query, "kl": "us-en"}).encode()
    page, _, _ = _get(DDG_URL, data=body)
    parser = _DDGParser()
    parser.feed(page)
    results = [r for r in parser.results
               if r["url"].startswith("http") and "duckduckgo.com/y.js" not in r["url"]]  # skip ads
    if not results and ("anomaly" in page.lower() or "captcha" in page.lower()):
        raise SearchError("DuckDuckGo asked for a captcha (too many searches)")
    return results[:max_results]


def search_wikipedia(query, max_results=4):
    url = WIKI_API + "?" + urllib.parse.urlencode({
        "action": "query", "list": "search", "srsearch": query, "format": "json", "srlimit": max_results, "utf8": 1})
    page, _, _ = _get(url)
    data = json.loads(page)
    out = []
    for item in data.get("query", {}).get("search", []):
        title = item["title"]
        snippet = html.unescape(re.sub(r"<[^>]+>", "", item.get("snippet", "")))
        out.append({"title": title, "snippet": snippet,
                    "url": "https://en.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"))})
    return out


def search_searxng(query, max_results=6):
    page, _, _ = _get(SEARXNG_URL + "/search?" + urllib.parse.urlencode({"q": query, "format": "json"}))
    data = json.loads(page)
    return [{"title": r.get("title", ""), "url": r.get("url", ""), "snippet": r.get("content", "")}
            for r in data.get("results", [])[:max_results] if r.get("url", "").startswith("http")]


def search(query, max_results=6):
    """Returns (provider name, results). Raises SearchError if every provider fails."""
    providers = []
    if SEARXNG_URL:
        providers.append(("SearXNG", search_searxng))
    providers += [("DuckDuckGo", search_duckduckgo), ("Wikipedia", search_wikipedia)]
    errors = []
    for name, fn in providers:
        try:
            results = fn(query, max_results)
            if results:
                return name, results
            errors.append(f"{name}: no results")
        except (SearchError, ValueError) as e:
            errors.append(f"{name}: {e}")
    raise SearchError("; ".join(errors))


def _domain(url):
    host = urllib.parse.urlsplit(url).netloc.lower()
    return host[4:] if host.startswith("www.") else host


def _rank(results, prefer):
    def key(item):
        i, r = item
        d = _domain(r["url"])
        preferred = any(d == p or d.endswith("." + p) for p in prefer)
        return (0 if preferred else 1, i)
    return [r for _, r in sorted(enumerate(results), key=key)]


def research(query, prefer=(), official_urls=(), max_pages=3):
    """
    Search, then download the best pages and extract the relevant text.
    official_urls are fetched first (e.g. https://skytheft.net for Sky Theft questions).
    Returns {"query", "provider", "sources": [{"n","title","url","excerpt"}], "errors": [...]}.
    """
    result = {"query": query, "provider": None, "sources": [], "errors": []}
    candidates = [{"title": "", "url": u, "snippet": ""} for u in official_urls]
    try:
        provider, found = search(query)
        result["provider"] = provider
        candidates += _rank(found, tuple(prefer) + PREFERRED_DOMAINS)
    except SearchError as e:
        result["errors"].append(f"Search failed: {e}")

    seen = set()
    for c in candidates:
        if len(result["sources"]) >= max_pages:
            break
        url = c["url"]
        if not url or url in seen or _domain(url) in {_domain(s["url"]) for s in result["sources"]}:
            continue
        seen.add(url)
        try:
            raw, final_url, ctype = _get(url)
            if "html" not in ctype and "text" not in ctype:
                raise SearchError(f"not a web page ({ctype})")
            title, paragraphs = page_text(raw)
            excerpt = best_excerpt(paragraphs, query) or c["snippet"]
            if not excerpt:
                raise SearchError("no readable text")
            result["sources"].append({"n": len(result["sources"]) + 1, "title": title or c["title"] or _domain(final_url),
                                      "url": final_url, "excerpt": excerpt})
        except SearchError as e:
            result["errors"].append(f"{_domain(url)}: {e}")
            if c["snippet"]:  # the search snippet is still a real, attributable result
                result["sources"].append({"n": len(result["sources"]) + 1, "title": c["title"] or _domain(url),
                                          "url": url, "excerpt": c["snippet"], "snippet_only": True})
    return result


def format_for_model(result):
    """The tool result Sky AI reads. Sources are numbered so it can cite them as [1], [2]."""
    if not result["sources"]:
        problems = "; ".join(result["errors"]) or "no results"
        return (f'Web search for "{result["query"]}" FAILED: {problems}.\n'
                "Tell the user you couldn't get live information right now. Don't invent results. "
                "If you answer from your own knowledge, say it may be outdated.")
    lines = [f'Web search results for "{result["query"]}" (fetched just now). Cite them as [1], [2]. '
             "If sources disagree, say so. The knowledge base and saved corrections still win over these results."]
    for s in result["sources"]:
        note = " (search snippet only, page didn't load)" if s.get("snippet_only") else ""
        lines.append(f"\n[{s['n']}] {s['title']}{note}\nURL: {s['url']}\n{s['excerpt']}")
    return "\n".join(lines)


SOURCE_LINE_RE = re.compile(r"^\[(\d+)\] (.+?)(?: \(search snippet only, page didn't load\))?\nURL: (\S+)", re.MULTILINE)


def sources_from_tool_text(text):
    """Re-read sources from a saved tool message (used to redraw old chats)."""
    return [{"n": int(n), "title": t, "url": u} for n, t, u in SOURCE_LINE_RE.findall(text)]
