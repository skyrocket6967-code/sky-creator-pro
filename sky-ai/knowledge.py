"""
Sky AI's local knowledge system. It's lightweight: plain Python, no extra libraries.

- KnowledgeBase: reads the editable fact files in knowledge/*.md and picks the facts that
  matter for each question (BM25 keyword scoring, plus "core" facts for any topic in the chat).
- Memory: corrections the user has confirmed, saved in memory/memory.json. They survive
  across chats and apps and never need retraining.
- Guards: knowledge/guards.json lists claims Sky AI must never make (like "Sky Theft is on
  Steam"). Answers are checked against them before they're kept.
- Correction handling: spots when the user is correcting Sky AI, so the wrong earlier answer
  stops being copied and the correction is pinned for the rest of the chat.
"""

import json
import math
import os
import re
import threading
import time
import uuid
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
KNOWLEDGE_DIR = os.path.join(HERE, "knowledge")
MEMORY_FILE = os.path.join(HERE, "memory", "memory.json")

KNOWLEDGE_BUDGET_CHARS = 1700  # roughly 450 tokens of facts per answer
MEMORY_BUDGET_CHARS = 1000
CHAT_CORRECTION_BUDGET_CHARS = 700

STOPWORDS = set("""
a an the and or but if then so of to in on at by for from with about into over as is are was were be been being
do does did doing have has had having i me my you your we our they them their he she it its this that these those
what which who whom whose when where why how can could would should will shall may might must just also very
there here not no yes up down out off again more most some any all each other than too only own same such
get got gets im ive id youre dont doesnt didnt isnt arent wasnt cant wont tell know please hey yo okay ok
""".split())


def terms(text):
    out = []
    for word in re.findall(r"[a-z0-9]+(?:['.][a-z0-9]+)*", text.lower().replace("’", "'")):
        word = word.replace("'s", "").replace("'", "")
        if len(word) < 2 or word in STOPWORDS:
            continue
        if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
            word = word[:-1]
        out.append(word)
    return out


# ---------------------------------------------------------------- knowledge base

class Chunk:
    def __init__(self, topic, heading, body, core):
        self.topic, self.heading, self.body, self.core = topic, heading, body.strip(), core
        self.terms = Counter(terms(f"{topic} {heading} {body}"))
        self.length = sum(self.terms.values())

    def render(self):
        return f"[{self.topic}: {self.heading}]\n{self.body}"


class KnowledgeBase:
    """Loads knowledge/*.md and reloads automatically when a file changes."""

    def __init__(self, folder=KNOWLEDGE_DIR):
        self.folder = folder
        self.chunks, self.topics, self.sites, self.guards = [], {}, {}, []
        self._stamp = None
        self._lock = threading.Lock()
        self.refresh()

    def _files(self):
        if not os.path.isdir(self.folder):
            return []
        return sorted(os.path.join(self.folder, n) for n in os.listdir(self.folder)
                      if n.endswith((".md", ".json")))

    def refresh(self):
        stamp = tuple((p, os.path.getmtime(p)) for p in self._files())
        if stamp == self._stamp:
            return
        with self._lock:
            chunks, topics, sites, guards = [], {}, {}, []
            for path, _ in stamp:
                if path.endswith("guards.json"):
                    try:
                        with open(path, encoding="utf-8") as f:
                            guards = json.load(f)
                    except (OSError, ValueError) as e:
                        print(f"WARNING: couldn't read {path}: {e}")
                    continue
                if path.endswith(".md"):
                    chunks += self._parse(path, topics, sites)
            self.chunks, self.topics, self.sites, self.guards = chunks, topics, sites, guards
            self._stamp = stamp
            self._index()

    def _parse(self, path, topics, sites):
        with open(path, encoding="utf-8") as f:
            text = re.sub(r"<!--.*?-->", "", f.read(), flags=re.DOTALL)
        title = os.path.splitext(os.path.basename(path))[0]
        triggers, chunks, heading, body = [], [], None, []
        for line in text.splitlines():
            if line.startswith("# "):
                title = line[2:].strip()
            elif line.lower().startswith("topics:"):
                triggers = [t.strip().lower() for t in line.split(":", 1)[1].split(",") if t.strip()]
            elif line.lower().startswith("site:"):
                sites[title] = line.split(":", 1)[1].strip()
            elif line.startswith("## "):
                if heading:
                    chunks.append((heading, "\n".join(body)))
                heading, body = line[3:].strip(), []
            elif heading:
                body.append(line)
        if heading:
            chunks.append((heading, "\n".join(body)))
        topics[title] = triggers or [title.lower()]
        return [Chunk(title, h.replace("[core]", "").strip(), b, "[core]" in h) for h, b in chunks if b.strip()]

    def _index(self):
        n = len(self.chunks) or 1
        df = Counter(t for c in self.chunks for t in c.terms)
        self.idf = {t: math.log(1 + (n - d + 0.5) / (d + 0.5)) for t, d in df.items()}
        self.avg_len = sum(c.length for c in self.chunks) / n if self.chunks else 1

    def active_topics(self, conversation_text):
        text = conversation_text.lower().replace("’", "'")
        return [t for t, triggers in self.topics.items() if any(trig in text for trig in triggers)]

    def score(self, chunk, query_terms, k1=1.4, b=0.75):
        s = 0.0
        for t in set(query_terms):
            tf = chunk.terms.get(t, 0)
            if tf:
                s += self.idf.get(t, 0) * tf * (k1 + 1) / (tf + k1 * (1 - b + b * chunk.length / self.avg_len))
        return s

    def retrieve(self, query, conversation_text="", budget=KNOWLEDGE_BUDGET_CHARS):
        """Facts for this question: core facts of every topic in the chat, then the best keyword matches."""
        self.refresh()
        active = set(self.active_topics(f"{conversation_text}\n{query}"))
        picked = [c for c in self.chunks if c.core and c.topic in active]
        q = terms(query)
        scored = [(self.score(c, q), c) for c in self.chunks if c not in picked]
        top = max([s for s, c in scored if c.topic not in active] or [0])
        keep = []
        for s, c in scored:
            if c.topic in active:
                ok = s * 1.6 >= 1.2  # the chat is already about this project: be generous
            else:
                ok = s >= max(3.0, top * 0.5)  # otherwise only clear, strong matches
            if ok:
                keep.append((s * (1.6 if c.topic in active else 1.0), c))
        picked += [c for _, c in sorted(keep, key=lambda x: -x[0])]
        out, used = [], 0
        for c in picked:
            size = len(c.render())
            if used + size > budget and out:
                continue
            out.append(c)
            used += size
        return out, sorted(active)


# ---------------------------------------------------------------- memory

class Memory:
    """User-confirmed facts in memory/memory.json. Edit it from the app's Memory panel or by hand."""

    def __init__(self, path=MEMORY_FILE):
        self.path = path
        self._lock = threading.Lock()

    def all(self):
        try:
            with open(self.path, encoding="utf-8") as f:
                data = json.load(f)
            return [m for m in data.get("facts", []) if isinstance(m, dict) and m.get("text")]
        except (OSError, ValueError):
            return []

    def _save(self, facts):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"version": 1, "facts": facts}, f, indent=2, ensure_ascii=False)
        os.replace(tmp, self.path)  # atomic: a crash can't leave a half-written file

    def add(self, text, source="user"):
        text = " ".join(str(text).split())[:500]
        if not text:
            raise ValueError("empty fact")
        with self._lock:
            facts = self.all()
            for m in facts:
                if m["text"].lower() == text.lower():
                    return m
            now = time.strftime("%Y-%m-%d %H:%M")
            entry = {"id": uuid.uuid4().hex[:10], "text": text, "source": source, "created": now, "updated": now}
            facts.append(entry)
            self._save(facts)
            return entry

    def update(self, fact_id, text):
        text = " ".join(str(text).split())[:500]
        with self._lock:
            facts = self.all()
            for m in facts:
                if m["id"] == fact_id:
                    m["text"], m["updated"] = text, time.strftime("%Y-%m-%d %H:%M")
                    self._save(facts)
                    return m
        raise KeyError(fact_id)

    def delete(self, fact_id):
        with self._lock:
            facts = self.all()
            kept = [m for m in facts if m["id"] != fact_id]
            if len(kept) == len(facts):
                raise KeyError(fact_id)
            self._save(kept)

    def relevant(self, conversation_text, budget=MEMORY_BUDGET_CHARS):
        facts = self.all()
        if sum(len(m["text"]) for m in facts) > budget:
            words = set(terms(conversation_text))
            facts = [m for m in facts if words & set(terms(m["text"]))]
        out, used = [], 0
        for m in reversed(facts):  # newest first: a newer correction beats an older one
            if used + len(m["text"]) > budget:
                break
            out.append(m)
            used += len(m["text"])
        return list(reversed(out))


# ---------------------------------------------------------------- corrections in a chat

CORRECTION_RE = re.compile(
    r"\b(that'?s|thats|this is|it'?s|its|you'?re|youre|you are|that is)\s+(so |completely |totally |just |all )?"
    r"(wrong|incorrect|false|not (true|right|correct|accurate))\b"
    r"|\b(incorrect|not true|wrong (info|information|answer))\b"
    r"|\byou (got|have) (that|it|this) wrong\b"
    r"|\bstop saying\b|\bi never said\b|\bnever said that\b"
    r"|\byou (said|told me|keep saying)\b"
    r"|\b(is|it'?s|its|it is) not (on|in|made|from|available)\b|\bisn'?t (on|in|made|available)\b"
    r"|\b(has|have) never been (released|on|in)\b"
    r"|\bno,? (it|that) (is|was)n'?t\b|\bno,? (it|that) (is|was) not\b"
    r"|\bactually,? (it|he|she|they|that|the)\b",
    re.IGNORECASE,
)


def looks_like_correction(text):
    return bool(CORRECTION_RE.search(text.replace("’", "'")))


def apply_corrections(history):
    """
    Model-facing copy of the chat. When the user corrects Sky AI, the answer they corrected is
    removed (so the model can't copy its own mistake again), and the correction is pinned in the
    system prompt for the rest of the chat. The chat shown in the app is not changed.
    """
    model_history, corrections = [], []
    for m in history:
        if m["role"] == "user" and looks_like_correction(m.get("content", "")):
            corrections.append(" ".join(m["content"].split())[:300])
            for j in range(len(model_history) - 1, -1, -1):  # the most recent answer before this message
                prev = model_history[j]
                if prev["role"] == "assistant" and prev.get("content") and not prev.get("tool_calls"):
                    del model_history[j]
                    break
                if prev["role"] == "user":
                    break
        model_history.append(dict(m))
    out, used = [], 0
    for c in reversed(corrections):  # keep the newest when there are many
        if used + len(c) > CHAT_CORRECTION_BUDGET_CHARS:
            break
        out.append(c)
        used += len(c)
    return model_history, list(reversed(out))


# ---------------------------------------------------------------- guards

NEGATION_RE = re.compile(
    r"\b(not|no|never|nor|neither|without|cannot|none)\b|\b\w+n't\b|\b(isnt|arent|hasnt|havent|wasnt|doesnt|dont|wont|cant)\b",
    re.IGNORECASE,
)


def split_sentences(text):
    return [s for s in re.split(r"(?<=[.!?])\s+|\n+", text) if s.strip()]


def _mentions(term, text):
    return re.search(r"(?<![a-z0-9])" + re.escape(term) + r"(?![a-z0-9])", text) is not None


FICTION_RE = re.compile(
    r"\b(write|make up|tell me|create)\b.{0,40}\b(story|fanfic|fan fiction|poem|rap|song|lyrics|joke|script|fake|parody)\b"
    r"|\b(imagine|pretend|hypothetical(ly)?|what if|role ?play|fictional|make[- ]believe)\b",
    re.IGNORECASE,
)


def is_fiction_request(text):
    return bool(FICTION_RE.search(text))


def _affirms(term, sentence):
    """'...and also on Steam' / 'on Steam too' count as claims even if the sentence has a 'not' elsewhere."""
    for m in re.finditer(rf"\b(also|both|plus|and)\b([^.]{{0,40}}?){re.escape(term)}", sentence):
        if not NEGATION_RE.search(m.group(2)) and not NEGATION_RE.search(sentence[max(0, m.start() - 12):m.start()]):
            if m.group(1) != "and" or re.search(r"\b(also|too|as well)\b", sentence):
                return True
    return bool(re.search(rf"{re.escape(term)}[^.]{{0,25}}\b(too|as well)\b", sentence))


def check_guards(guards, reply, context):
    """Sentences in `reply` that make a forbidden claim. Returns [(guard, sentence)].
    Requested fiction ("write a story where...", "imagine...") is exempt; the reply should label it."""
    if is_fiction_request(context):
        return []
    ctx = f"{context}\n{reply}".lower()
    found = []
    for g in guards:
        if not any(a in ctx for a in g.get("about", [])):
            continue
        for sentence in split_sentences(reply):
            s = sentence.lower()
            hits = [f for f in g.get("forbid", []) if _mentions(f, s)]
            if not hits:
                continue
            affirmed = any(_affirms(f, s) for f in hits)
            if affirmed or not NEGATION_RE.search(s):
                found.append((g, sentence))
    return found


def repair(reply, violations):
    """Last resort: drop the false sentences and state the verified fact instead."""
    bad = {s for _, s in violations}
    kept = [s for s in split_sentences(reply) if s not in bad]
    facts = []
    for g, _ in violations:
        if g.get("fact") and g["fact"] not in facts:
            facts.append(g["fact"])
    return ("\n".join(kept).strip() + "\n\n" + " ".join(facts)).strip()


# ---------------------------------------------------------------- prompt block

def context_block(kb, memory, query, conversation_text, chat_corrections):
    """The facts section added to the system prompt. Returns (text, names of sources used)."""
    chunks, topics = kb.retrieve(query, conversation_text)
    facts = memory.relevant(f"{conversation_text}\n{query}") if memory else []
    parts, used = [], []
    if chunks:
        parts.append("## Knowledge base (verified by Sky the Goat)\n" + "\n\n".join(c.render() for c in chunks))
        used += sorted({c.topic for c in chunks})
    if facts:
        parts.append("## Saved corrections (confirmed by the user; highest priority)\n" +
                     "\n".join(f"- {m['text']}" for m in facts))
        used.append("Memory")
    if chat_corrections:
        parts.append("## Corrections the user made in this chat (the user is right; don't repeat the old claim)\n" +
                     "\n".join(f'- "{c}"' for c in chat_corrections))
    return "\n\n".join(parts), used, topics
