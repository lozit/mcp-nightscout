<!-- generated-by: groundrules v1.10.0 -->
# Learnings — mcp-nightscout

Rules learned from corrections and non-trivial discoveries during the project. Reverse-chronological order (newest at the top). **Re-read at session start.**

One entry = one **actionable rule**, not a journal note. Each entry has:
- a title that states the rule (imperative or "X: do Y");
- **Why** — the story behind it: what happened, what it cost (a revert, a lost CI cycle, a confused user…);
- **When to apply** — the concrete trigger conditions, so the rule fires at the right moment instead of being remembered too late.

Include the minimal code snippet / command when it is the fix.

---

## Fresh analysis means fresh: don't mine the other projects unasked

**Why**: this project exists because an evaluated third-party server was audited and rejected.
Its value is in being reasoned from its own threat model rather than assembled from whatever was
nearby. Pulling patterns from the other repos in `~/Projets/` without being asked reintroduces
exactly the borrowed assumptions the restart was meant to shed — and does it invisibly, since
the import leaves no trace in the reasoning.

**When to apply**: any time something outside this repository looks relevant — a sibling project,
a house convention, a remembered implementation. **Say so and ask.** Do not import it on your own
initiative. Reading *this* repo's docs is not affected; this is about outside material.

## A scrubbing filter never sees the traceback — scrub at format time too

**Why**: the highest-quality implementation found while surveying the ecosystem scrubs the token
on two levels (by *value*, registering the literal token and its URL-encoded forms at startup;
and by *pattern*) and applies it via **both** a log filter and a formatter. The reason is
specific and easy to miss: a filter inspects the log record, but a traceback is only rendered
when the record is *formatted*. A filter-only implementation looks correct and still writes the
token to disk the first time an upstream HTTP call throws.

**When to apply**: when implementing or reviewing anything in the logging path, and whenever
reasoning about whether a secret can escape. Test it the only way that proves anything: cause a
real upstream failure and read what lands on disk. See `docs/SECURITY.md`.

## HTTP clients normalize `..` — an unvalidated id is a path traversal

**Why**: interpolating an identifier into a request path without validating it is not merely
sloppy. HTTP clients normalize `..` segments per RFC 3986, so an id like `../devicestatus` turns
a scoped operation on one collection into an arbitrary operation on any collection — carrying
whatever credential the client holds. This was verified experimentally during the audit, not
assumed.

**When to apply**: every identifier that reaches a URL, without exception. Mongo ObjectId =
`^[0-9a-fA-F]{24}$`. Validate before building the path, not inside the request.

## Read-only removes the consequence of prompt injection, not the vector

**Why**: it is tempting to treat read-only as closing the free-text problem. It does not. The
`notes` field of a treatment is written by any uploader or integration with write access to the
instance, and it reaches the model verbatim. Read-only means an injected instruction has no write
tool to reach for *in this server* — the injected text still enters the model's context, and the
model has other tools.

**When to apply**: whenever the answer to a security question is "but we're read-only". Ask
whether the claim addresses the vector or only the consequence. Free-text neutralization is a
separate, still-required control.
