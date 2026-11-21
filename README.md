# BookRecs

A tiny book-tracking app. Create an account, fuzzy-search the
[Open Library](https://openlibrary.org) to add books you've read (or add one
by hand if it's missing), rank them in order (1 = your #1 — _not_ a 1–5
rating), write a short review, and add friends by username or email to browse
each other's books. One page shows your **currently reading**, **read list**, and
**wishlist** — the read list and wishlist are ranked in order (1 = top, drag to
reorder); keep a wishlist (mark each book **owned** or not), pull a friend's
book straight into your wishlist, move a wishlist item into your read list when
you finish it, and mark what you're **currently reading**. Read/wishlist books
are each **public or private** (friends only see the public ones); your
**currently reading** is always visible to friends. Click any book title to see
its **detail page** with synopsis, friend activity, and review carousel.

Start a **book club** with a group of friends: nominate books from Open
Library, vote for the next read (one vote per member, changeable until the vote
closes), and the winning pick becomes the club's **current read** — with the
full pick history kept. Clubs are invite-only among friends.

Runs on **Cloudflare Workers** + **D1** + **Pages**.

## Stack

- **Runtime:** [Cloudflare Workers](https://workers.cloudflare.com) (serverless edge runtime)
- **Data:** [Cloudflare D1](https://www.cloudflare.com/developer-platform/d1/) (serverless SQLite)
- **Frontend:** React + Vite, deployed to Cloudflare Pages
- **Auth:** username/email + password (PBKDF2), self-signup, HttpOnly session cookie, bearer tokens for scripts
- **Books:** [Open Library](https://openlibrary.org) search + work metadata
- **AI agents:** a stdio **MCP server** exposing the same operations as tools

## Project layout

```
bookrecs/
├─ src/
│  ├─ api.ts        # HTTP routes (Workers/D1 compatible)
│  ├─ core/         # domain logic: users, books, lists, friends, clubs, notifications
│  ├─ db.ts         # D1 query helpers
│  ├─ auth.ts       # password hashing + sessions (Web Crypto)
│  ├─ ratelimit.ts  # D1-backed login rate limiting
│  ├─ ol.ts         # Open Library client
│  ├─ mcp.ts        # MCP (stdio JSON-RPC) server, a client of the HTTP API
│  └─ test/         # in-memory D1 for tests (bun test)
├─ functions/       # Cloudflare Pages Functions (API entry point)
├─ web/             # Vite + React frontend
├─ scripts/         # MCP launcher, preview seeding, migration-history adoption
├─ lint/            # project-specific lint rules
└─ migrations/      # D1 database migrations
```

## Quick start (development)

```bash
# one-time
bun install
(cd web && bun install)

# run locally with Wrangler (port 8788)
bun run dev

# or just the frontend dev server (port 5173)
bun run dev:web
```

Open http://localhost:8788, sign up, and add a book.

## Production

The app deploys automatically via GitHub Actions when you push to `main`:

1. Database migrations run against D1
2. Frontend builds and deploys to Cloudflare Pages
3. API runs as a Cloudflare Worker

To deploy manually:

```bash
bun install          # if not done
(cd web && bun install)
bun run build        # builds web/dist
bun run deploy       # deploys worker + pages
```

## Talking to it from AI agents (MCP)

The app ships an MCP server over stdio. It is a client of the HTTP API and acts
as **one user** through an API token: sign in, open **My Account**, and generate
one. Set it as `BOOKRECS_TOKEN`, and point `BOOKRECS_URL` at the instance
(default `http://localhost:8788`).

Register it with any MCP client (Claude Desktop, Claude Code, etc.):

```json
{
  "mcpServers": {
    "bookrecs": {
      "command": "/path/to/bookrecs/scripts/mcp.sh",
      "env": { "BOOKRECS_TOKEN": "<token>", "BOOKRECS_URL": "https://bookrecs.dev" }
    }
  }
}
```

Or with Claude Code:

```bash
claude mcp add bookrecs -e BOOKRECS_TOKEN=<token> -e BOOKRECS_URL=https://bookrecs.dev -- /path/to/bookrecs/scripts/mcp.sh
```

Or run it directly (from anywhere — paths are anchored to the repo):

```bash
BOOKRECS_TOKEN=<token> bun run src/mcp.ts
```

### MCP tools

| Tool                                               | Purpose                                                                                        |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `search_books`                                     | Fuzzy-search Open Library, returns `ol_key`s                                                   |
| `add_book`                                         | Add a book to your list (optional rank + review)                                               |
| `add_manual_book`                                  | Add a book that isn't in Open Library, by title/author                                         |
| `my_books`                                         | Your ranked list with reviews                                                                  |
| `remove_book`                                      | Remove a book by `book_id`                                                                     |
| `set_review`                                       | Set/update a review                                                                            |
| `set_rank`                                         | Move one book to a new rank                                                                    |
| `reorder_books`                                    | Reorder the list (ordered `book_id`s; others keep their order after them)                      |
| `search_users`                                     | Find users by username or email                                                                |
| `send_friend_request`                              | Add a friend by username/email                                                                 |
| `friend_requests`                                  | List pending incoming + outgoing requests                                                      |
| `accept_friend_request` / `decline_friend_request` | Answer a request                                                                               |
| `list_friends`                                     | Your accepted friends                                                                          |
| `friend_books`                                     | A friend's ranked list + reviews                                                               |
| `my_wishlist`                                      | Your wishlist (each item: `owned` + `public`)                                                  |
| `add_to_wishlist`                                  | Add to your wishlist by `ol_key` **or** `book_id` (a friend's book), optional `owned`/`public` |
| `add_to_wishlist_manual`                           | Add a not-in-Open-Library book to your wishlist                                                |
| `remove_from_wishlist`                             | Remove a wishlist item by `book_id`                                                            |
| `reorder_wishlist`                                 | Reorder your wishlist (full ordered `book_id` array)                                           |
| `set_owned`                                        | Mark a wishlist item owned / not owned                                                         |
| `set_public`                                       | Set a book public/private (`list` = `read` or `wishlist`)                                      |
| `friend_wishlist`                                  | A friend's public wishlist items                                                               |
| `move_to_read`                                     | Move a wishlist item into your read list (optional `review`, `rank`)                           |
| `my_reading`                                       | The books you're currently reading                                                             |
| `add_to_reading`                                   | Mark a book currently reading (by `ol_key` or `book_id`)                                       |
| `add_to_reading_manual`                            | Add a not-in-Open-Library book as currently reading                                            |
| `finish_reading`                                   | Move a currently-reading book into your read list                                              |
| `back_to_wishlist`                                 | Move a currently-reading book back to the wishlist                                             |
| `remove_from_reading`                              | Remove a book from currently reading                                                           |
| `friend_reading`                                   | A friend's currently-reading books                                                             |

Send it a line of JSON-RPC over stdio to try it manually:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"my_books","arguments":{}}}' \
  | BOOKRECS_TOKEN=<token> bun run src/mcp.ts
```

## HTTP API (for scripts / non-MCP agents)

All `POST`/`PATCH` bodies are JSON; auth is a session cookie (or `Authorization:
Bearer <token>` where the token is minted via `POST /api/token`). Errors are
`{error}` with 400 (invalid), 403 (not allowed) or 404 (not found). Club changes
answer with the updated club detail (`{club}`).

| Method | Path                                       | Description                                                                                       |
| ------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| POST   | `/api/signup`                              | `{username, email, password}` → starts a session                                                  |
| POST   | `/api/login`                               | `{usernameOrEmail, password}` → starts a session                                                  |
| POST   | `/api/logout`                              | ends the session                                                                                  |
| GET    | `/api/me`                                  | current user (or `{user: null}`)                                                                  |
| POST   | `/api/token`                               | mint a bearer token for scripting                                                                 |
| GET    | `/api/books/search?q=`                     | search Open Library                                                                               |
| POST   | `/api/books`                               | add `{ol_key, review?, rank?, year?, public?}` to your list                                       |
| POST   | `/api/books/manual`                        | add by hand `{title, author?, year?, coverUrl?, review?, rank?, public?}`                         |
| GET    | `/api/me/books`                            | your ranked list (each with `public`)                                                             |
| POST   | `/api/me/books/reorder`                    | `{ordered: [bookIds]}` full order                                                                 |
| PATCH  | `/api/me/books/:id`                        | update `{review?}`, `{rank?}`                                                                     |
| POST   | `/api/me/books/:id/public`                 | `{public}` set a book public/private                                                              |
| DELETE | `/api/me/books/:id`                        | remove                                                                                            |
| GET    | `/api/me/wishlist`                         | your wishlist (each item: `owned`, `public`)                                                      |
| POST   | `/api/me/wishlist`                         | add `{ol_key?, book_id?, owned?, public?, rank?}` (book_id = someone else's book)                 |
| POST   | `/api/me/wishlist/manual`                  | add by hand `{title, author?, year?, coverUrl?, owned?, public?, rank?}`                          |
| POST   | `/api/me/wishlist/reorder`                 | `{ordered: [bookIds]}` reorder wishlist                                                           |
| POST   | `/api/me/wishlist/:id/owned`               | `{owned}` mark owned / not                                                                        |
| POST   | `/api/me/wishlist/:id/public`              | `{public}` set a wishlist item public/private                                                     |
| POST   | `/api/me/wishlist/:id/move-to-read`        | `{review?, rank?}` move wishlist → read list                                                      |
| DELETE | `/api/me/wishlist/:id`                     | remove wishlist item                                                                              |
| GET    | `/api/friends/:username/wishlist`          | a friend's public wishlist                                                                        |
| GET    | `/api/me/reading`                          | your currently-reading books                                                                      |
| POST   | `/api/me/reading`                          | add `{ol_key?, book_id?, year?}` (currently reading)                                              |
| POST   | `/api/me/reading/manual`                   | add by hand `{title, author?, year?, coverUrl?}`                                                  |
| POST   | `/api/me/reading/:id/finish`               | `{review?, rank?}` move reading → read list                                                       |
| POST   | `/api/me/reading/:id/back-to-wishlist`     | move reading → wishlist                                                                           |
| DELETE | `/api/me/reading/:id`                      | remove                                                                                            |
| GET    | `/api/friends/:username/reading`           | a friend's currently-reading (always visible)                                                     |
| GET    | `/api/users/discover?q=`                   | discoverable users, filtered by username/email when `q` is given                                  |
| GET    | `/api/friends`                             | accepted friends                                                                                  |
| POST   | `/api/friends/requests`                    | `{usernameOrEmail}` send request                                                                  |
| GET    | `/api/friends/requests`                    | pending requests (in/out)                                                                         |
| POST   | `/api/friends/requests/:id/accept`         | accept                                                                                            |
| POST   | `/api/friends/requests/:id/decline`        | decline                                                                                           |
| GET    | `/api/friends/:username/books`             | a friend's public books (each flagged `mine`)                                                     |
| DELETE | `/api/friends/:id`                         | unfriend                                                                                          |
| POST   | `/api/clubs`                               | create `{name, description?, usernames?[]}` (invitees must be friends)                            |
| GET    | `/api/clubs`                               | your clubs + pending invites                                                                      |
| GET    | `/api/clubs/:id`                           | club detail: members, nominations (with counts), your vote, current + past picks                  |
| GET    | `/api/clubs/:id/events`                    | live club detail over Server-Sent Events (single `data:` per change; `gone` event on access loss) |
| POST   | `/api/clubs/:id/invite`                    | `{username}` invite a friend (members only)                                                       |
| POST   | `/api/clubs/:id/respond`                   | `{accept}` accept/decline your invite                                                             |
| POST   | `/api/clubs/:id/nominate`                  | `{ol_key?, book_id?, year?}` nominate a book (nomination stage only)                              |
| POST   | `/api/clubs/:id/vote`                      | `{nominationId}` cast/move your one vote (voting stage only)                                      |
| POST   | `/api/clubs/:id/veto`                      | `{nominationId}` strike a nomination (one veto per member per vote)                               |
| DELETE | `/api/clubs/:id/nominations/:nominationId` | owner: remove a nomination (accidental adds)                                                      |
| DELETE | `/api/clubs/:id/vote`                      | remove your vote                                                                                  |
| POST   | `/api/clubs/:id/open-nominations`          | owner: start a new cycle in the nomination stage                                                  |
| POST   | `/api/clubs/:id/start-voting`              | owner: lock nominations and open the vote                                                         |
| POST   | `/api/clubs/:id/back-to-nominations`       | owner: clear all votes and return to the nomination stage                                         |
| POST   | `/api/clubs/:id/close-vote`                | owner: a simple majority wins (otherwise a runoff is offered)                                     |
| POST   | `/api/clubs/:id/runoff`                    | owner: revote among the top two vote-getters (ties included)                                      |
| DELETE | `/api/clubs/:id/members/:userId`           | owner: remove a member / cancel invite                                                            |
| POST   | `/api/clubs/:id/leave`                     | member: leave the club                                                                            |
| POST   | `/api/clubs/:id/transfer`                  | owner: `{userId}` transfer ownership to a member and leave                                        |
| DELETE | `/api/clubs/:id`                           | owner: delete the club                                                                            |
| GET    | `/api/notifications`                       | grouped notifications and the unread count                                                        |
| POST   | `/api/notifications/seen`                  | mark everything that doesn't need a response as read                                              |

## Notes

- Database is Cloudflare D1 (serverless SQLite). Back it up using `wrangler d1 export` or the Cloudflare dashboard.
- Rankings are an **ordered list** (1 = top), maintained by shifting ranks.
- Every read/wishlist book is individually **public or private**; friends only
  see your public books. Existing books were seeded public; newly added books
  default private — flip the Public switch on a book to share it. Your
  **currently reading** list has no privacy flag and is always visible to friends.
- Tabs are real pages with hash URLs — `#/books`, `#/add`, `#/friends`,
  `#/account` (My Account, via the @username link), `#/u/<username>` — so
  reloading keeps you on the same page.
- Friend requests are mutual: a pending request from the other side is
  auto-accepted when you send yours.
- Book search and display are English-first: author names are resolved to
  their English form (Wikidata label when available), book searches rank
  Latin-script titles ahead of foreign-script ones, and adding a work whose
  title is in a foreign script (e.g. "Братья Карамазовы") stores the title of
  its most common English edition instead ("The Brothers Karamazov").
- **Book clubs** live under the Clubs tab. The owner creates a club and invites
  friends (anyone in the club can invite their own friends). Each cycle has two
  owner-controlled stages: a **nomination stage** (members suggest books from
  their own lists or Open Library) and a **voting stage** (nominations lock,
  each member casts one vote — you can move or remove it). The owner can reset
  the vote and return to nominations at any time, clearing all cast votes.
  The owner closes the vote; a book needs a
  simple majority (more than half the votes cast) to win, and it becomes the club's
  current read with a one-tap "Start reading" into your personal list. The
  owner can then start a new cycle; past picks are kept on the club page.
  Open club pages live-update over Server-Sent Events (`/api/clubs/:id/events`
  pushes the detail within ~half a second of a change) with an automatic
  5s-polling fallback when the stream can't connect. Nominations are ordered
  by live vote count with animated reordering (tied books hold their
  nomination order until a count actually changes), and each member gets one
  veto per vote: a vetoed nomination is struck (votes on it are released, it
  can't win). Closing a vote without a majority offers a runoff instead of an
  arbitrary winner: the also-rans drop, votes reset, and the club votes again
  between the top two vote-getters (all books tied at the top stay in). The owner can also remove an accidentally
  nominated book from the vote (members can re-nominate it fresh). Owners
  who want out must transfer ownership to a member or delete the club.
- Starting a book is one tap: every book on a friend's profile has a "📖 Reading"
  quick action (plus "♡ Wishlist"), and your own wishlist items have a
  "📖 Reading" button to start reading them.
- Database migrations are in `migrations/`, applied with `wrangler d1 migrations apply`: `bun run migrate:local` for local dev, and `bun run migrate:remote` (run by CI on deploy) for production.
