import { createInterface } from "node:readline";
import * as core from "./core";
import { searchBooks } from "./ol";

const ACTING = (process.env.BOOKRECS_USER || "").trim();

const actingUser = ACTING ? core.findUser(ACTING) : null;

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: any) => Promise<string> | string;
}

const err = (m: string) => `Error: ${m}`;
const requireUser = (): core.User | string => {
  if (!actingUser)
    return err("BOOKRECS_USER is not set, or does not match a user. Launch with: BOOKRECS_USER=alice bun run mcp");
  const u = core.getUserById(actingUser.id);
  if (!u) return err(`Acting user not found: ${ACTING}`);
  return u;
};

const tools: Tool[] = [
  {
    name: "search_books",
    description:
      "Search the Open Library for books by title, author, or keywords. Returns matches with an 'ol_key' you pass to add_book.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search text (title, author, keywords)" },
        limit: { type: "number", description: "Max results, default 20" },
      },
      required: ["query"],
    },
    handler: async (args) => {
      try {
        const results = await searchBooks(String(args.query ?? ""));
        const limited = results.slice(0, Number(args.limit) || 20);
        return JSON.stringify({ results: limited }, null, 2);
      } catch (e) {
        return err(`Open Library unavailable: ${e}`);
      }
    },
  },
  {
    name: "my_books",
    description: "List the acting user's ranked reading list (ordered, rank 1 = top) with reviews.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const u = requireUser();
      if (typeof u === "string") return u;
      return JSON.stringify({ user: { username: u.username }, books: core.listReads(u.id) }, null, 2);
    },
  },
  {
    name: "add_book",
    description:
      "Add a book to the acting user's list by Open Library work key (from search_books). Optionally set rank (1-based), a review, and whether it's public.",
    inputSchema: {
      type: "object",
      properties: {
        ol_key: { type: "string", description: "Open Library work key, e.g. /works/OL123W" },
        review: { type: "string", description: "Optional review text" },
        rank: { type: "number", description: "Optional 1-based position (defaults to end of list)" },
        year: { type: "number", description: "Optional first publish year hint" },
        public: { type: "boolean", description: "Visible to friends (default false)" },
      },
      required: ["ol_key"],
    },
    handler: async (args) => {
      const u = requireUser();
      if (typeof u === "string") return u;
      const r = await core.addRead(u.id, String(args.ol_key), args.review, args.rank, args.year, args.public);
      if (r.error) return err(r.error);
      return JSON.stringify({ ok: true, book: r.book, list: core.listReads(u.id) }, null, 2);
    },
  },
  {
    name: "add_manual_book",
    description:
      "Add a book that isn't in Open Library directly, by entering its title and author. Use this when search_books returns no match.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Book title (required)" },
        author: { type: "string", description: "Author name" },
        year: { type: "number", description: "First publish year" },
        cover_url: { type: "string", description: "Cover image URL" },
        review: { type: "string", description: "Optional review text" },
        rank: { type: "number", description: "Optional 1-based position (defaults to end)" },
        public: { type: "boolean", description: "Visible to friends (default false)" },
      },
      required: ["title"],
    },
    handler: (args) => {
      const u = requireUser();
      if (typeof u === "string") return u;
      const r = core.addManualBook(
        u.id,
        { title: args.title, author: args.author, year: args.year, coverUrl: args.cover_url },
        args.review,
        args.rank,
        args.public,
      );
      if (r.error) return err(r.error);
      return JSON.stringify({ ok: true, book: r.book, list: core.listReads(u.id) }, null, 2);
    },
  },
  {
    name: "remove_book",
    description: "Remove a book from the acting user's list by its ol_key.",
    inputSchema: {
      type: "object",
      properties: { ol_key: { type: "string" } },
      required: ["ol_key"],
    },
    handler: (args) => {
      const u = requireUser();
      if (typeof u === "string") return u;
      const book = core.getBookByOlKey(String(args.ol_key));
      if (!book) return err("Book not found");
      core.removeRead(u.id, book.id);
      return JSON.stringify({ ok: true, list: core.listReads(u.id) }, null, 2);
    },
  },
  {
    name: "set_review",
    description: "Set or replace the acting user's review for a book already on their list.",
    inputSchema: {
      type: "object",
      properties: {
        ol_key: { type: "string" },
        review: { type: "string", description: "The review text (empty string clears it)" },
      },
      required: ["ol_key", "review"],
    },
    handler: (args) => {
      const u = requireUser();
      if (typeof u === "string") return u;
      const book = core.getBookByOlKey(String(args.ol_key));
      if (!book) return err("Book not found on your list");
      const r = core.setReview(u.id, book.id, String(args.review ?? ""));
      if (r.error) return err(r.error);
      return JSON.stringify({ ok: true }, null, 2);
    },
  },
  {
    name: "set_rank",
    description: "Move a single book to a new rank (1 = top) in the acting user's ordered list.",
    inputSchema: {
      type: "object",
      properties: {
        ol_key: { type: "string" },
        rank: { type: "number", description: "New 1-based position" },
      },
      required: ["ol_key", "rank"],
    },
    handler: (args) => {
      const u = requireUser();
      if (typeof u === "string") return u;
      const book = core.getBookByOlKey(String(args.ol_key));
      if (!book) return err("Book not found on your list");
      const r = core.setRank(u.id, book.id, Number(args.rank));
      if (r.error) return err(r.error);
      return JSON.stringify({ ok: true, list: core.listReads(u.id) }, null, 2);
    },
  },
  {
    name: "reorder_books",
    description:
      "Reorder the acting user's full list. Pass the complete ordered array of ol_keys (first = top). Books omitted are appended after.",
    inputSchema: {
      type: "object",
      properties: {
        ordered_ol_keys: { type: "array", items: { type: "string" }, description: "Ordered ol_keys, top first" },
      },
      required: ["ordered_ol_keys"],
    },
    handler: (args) => {
      const u = requireUser();
      if (typeof u === "string") return u;
      const keys: string[] = Array.isArray(args.ordered_ol_keys) ? args.ordered_ol_keys.map(String) : [];
      const ids = keys.map((k) => core.getBookByOlKey(k)?.id).filter((x): x is number => typeof x === "number");
      core.reorderReads(u.id, ids);
      return JSON.stringify({ ok: true, list: core.listReads(u.id) }, null, 2);
    },
  },
  {
    name: "search_users",
    description: "Find users by username or email, for adding friends.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    handler: (args) => {
      const u = requireUser();
      if (typeof u === "string") return u;
      return JSON.stringify({ users: core.searchUsers(String(args.query), u.id) }, null, 2);
    },
  },
  {
    name: "send_friend_request",
    description:
      "Send a friend request by username or email. Accepts a real friend request from the other side automatically.",
    inputSchema: {
      type: "object",
      properties: { username_or_email: { type: "string" } },
      required: ["username_or_email"],
    },
    handler: (args) => {
      const u = requireUser();
      if (typeof u === "string") return u;
      const r = core.sendFriendRequest(u.id, String(args.username_or_email));
      if (r.error) return err(r.error);
      return JSON.stringify(r, null, 2);
    },
  },
  {
    name: "friend_requests",
    description: "List the acting user's pending incoming and outgoing friend requests.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const u = requireUser();
      if (typeof u === "string") return u;
      return JSON.stringify(core.listFriendRequests(u.id), null, 2);
    },
  },
  {
    name: "accept_friend_request",
    description: "Accept a pending incoming friend request by its id (see friend_requests).",
    inputSchema: {
      type: "object",
      properties: { request_id: { type: "number" } },
      required: ["request_id"],
    },
    handler: (args) => {
      const u = requireUser();
      if (typeof u === "string") return u;
      const r = core.acceptFriendRequest(u.id, Number(args.request_id));
      if (r.error) return err(r.error);
      return JSON.stringify(r, null, 2);
    },
  },
  {
    name: "decline_friend_request",
    description: "Decline a pending incoming friend request by its id.",
    inputSchema: {
      type: "object",
      properties: { request_id: { type: "number" } },
      required: ["request_id"],
    },
    handler: (args) => {
      const u = requireUser();
      if (typeof u === "string") return u;
      const r = core.declineFriendRequest(u.id, Number(args.request_id));
      if (r.error) return err(r.error);
      return JSON.stringify(r, null, 2);
    },
  },
  {
    name: "list_friends",
    description: "List the acting user's accepted friends.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const u = requireUser();
      if (typeof u === "string") return u;
      return JSON.stringify({ friends: core.listFriends(u.id) }, null, 2);
    },
  },
  {
    name: "friend_books",
    description: "Get a friend's ranked reading list and reviews by their username.",
    inputSchema: {
      type: "object",
      properties: { username: { type: "string" } },
      required: ["username"],
    },
    handler: (args) => {
      const u = requireUser();
      if (typeof u === "string") return u;
      const r = core.getFriendReads(u.id, String(args.username));
      if (r.error) return err(r.error);
      return JSON.stringify({ user: r.user, books: r.books }, null, 2);
    },
  },
  {
    name: "my_wishlist",
    description: "List the acting user's wishlist (each item shows owned + public flags).",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const u = requireUser();
      if (typeof u === "string") return u;
      return JSON.stringify({ books: core.listWishlist(u.id) }, null, 2);
    },
  },
  {
    name: "add_to_wishlist",
    description:
      "Add a book to the acting user's wishlist, either by Open Library ol_key or by an existing book_id (e.g. a friend's book). Optional 'owned' flag.",
    inputSchema: {
      type: "object",
      properties: {
        ol_key: { type: "string", description: "Open Library work key" },
        book_id: { type: "number", description: "Existing book id (alternative to ol_key)" },
        owned: { type: "boolean", description: "Mark as already owned" },
        public: { type: "boolean", description: "Visible to friends (default false)" },
        rank: { type: "number", description: "Optional 1-based position (defaults to end of wishlist)" },
        year: { type: "number", description: "Optional first publish year hint" },
      },
    },
    handler: async (args) => {
      const u = requireUser();
      if (typeof u === "string") return u;
      let r: { ok: boolean; error?: string; book?: core.BookRow };
      if (args.book_id != null) {
        r = core.addToWishlistByBookId(u.id, Number(args.book_id), !!args.owned, !!args.public, args.rank);
      } else if (args.ol_key != null) {
        r = await core.addToWishlistByOlKey(
          u.id,
          String(args.ol_key),
          !!args.owned,
          args.year,
          !!args.public,
          args.rank,
        );
      } else {
        return err("Provide ol_key or book_id");
      }
      if (r.error) return err(r.error);
      return JSON.stringify({ ok: true, book: r.book, list: core.listWishlist(u.id) }, null, 2);
    },
  },
  {
    name: "add_to_wishlist_manual",
    description: "Add a book that isn't in Open Library directly to the wishlist by title/author.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        author: { type: "string" },
        year: { type: "number" },
        cover_url: { type: "string" },
        owned: { type: "boolean", description: "Mark as already owned" },
        public: { type: "boolean", description: "Visible to friends (default false)" },
        rank: { type: "number", description: "Optional 1-based position (defaults to end of wishlist)" },
      },
      required: ["title"],
    },
    handler: (args) => {
      const u = requireUser();
      if (typeof u === "string") return u;
      const r = core.addManualToWishlist(
        u.id,
        { title: args.title, author: args.author, year: args.year, coverUrl: args.cover_url },
        !!args.owned,
        !!args.public,
        args.rank,
      );
      if (r.error) return err(r.error);
      return JSON.stringify({ ok: true, book: r.book, list: core.listWishlist(u.id) }, null, 2);
    },
  },
  {
    name: "move_to_read",
    description:
      "Move a book from the acting user's wishlist into their read list (appends to the end, or at a given 1-based rank).",
    inputSchema: {
      type: "object",
      properties: {
        book_id: { type: "number" },
        review: { type: "string" },
        rank: { type: "number" },
      },
      required: ["book_id"],
    },
    handler: (args) => {
      const u = requireUser();
      if (typeof u === "string") return u;
      const r = core.moveToRead(u.id, Number(args.book_id), args.review, args.rank);
      if (r.error) return err(r.error);
      return JSON.stringify({ ok: true }, null, 2);
    },
  },
  {
    name: "set_owned",
    description: "Mark a wishlist book as owned (true) or not (false).",
    inputSchema: {
      type: "object",
      properties: { book_id: { type: "number" }, owned: { type: "boolean" } },
      required: ["book_id", "owned"],
    },
    handler: (args) => {
      const u = requireUser();
      if (typeof u === "string") return u;
      const r = core.setOwned(u.id, Number(args.book_id), !!args.owned);
      if (r.error) return err(r.error);
      return JSON.stringify({ ok: true }, null, 2);
    },
  },
  {
    name: "remove_from_wishlist",
    description: "Remove a book from the acting user's wishlist by book_id (see my_wishlist).",
    inputSchema: {
      type: "object",
      properties: { book_id: { type: "number" } },
      required: ["book_id"],
    },
    handler: (args) => {
      const u = requireUser();
      if (typeof u === "string") return u;
      core.removeFromWishlist(u.id, Number(args.book_id));
      return JSON.stringify({ ok: true, list: core.listWishlist(u.id) }, null, 2);
    },
  },
  {
    name: "reorder_wishlist",
    description:
      "Reorder the acting user's wishlist. Pass the full ordered array of book_ids (first = top). Books omitted are appended after.",
    inputSchema: {
      type: "object",
      properties: {
        ordered_book_ids: { type: "array", items: { type: "number" }, description: "Ordered book_ids, top first" },
      },
      required: ["ordered_book_ids"],
    },
    handler: (args) => {
      const u = requireUser();
      if (typeof u === "string") return u;
      const ids: number[] = Array.isArray(args.ordered_book_ids) ? args.ordered_book_ids.map(Number) : [];
      core.reorderWishlist(u.id, ids);
      return JSON.stringify({ ok: true, list: core.listWishlist(u.id) }, null, 2);
    },
  },
  {
    name: "set_wish_rank",
    description: "Move a single wishlist book to a new 1-based rank.",
    inputSchema: {
      type: "object",
      properties: { book_id: { type: "number" }, rank: { type: "number" } },
      required: ["book_id", "rank"],
    },
    handler: (args) => {
      const u = requireUser();
      if (typeof u === "string") return u;
      const r = core.setWishRank(u.id, Number(args.book_id), Number(args.rank));
      if (r.error) return err(r.error);
      return JSON.stringify({ ok: true, list: core.listWishlist(u.id) }, null, 2);
    },
  },
  {
    name: "set_public",
    description: "Set whether a single book is public (visible to friends) or private. 'list' is 'read' or 'wish'.",
    inputSchema: {
      type: "object",
      properties: {
        book_id: { type: "number" },
        list: { type: "string", enum: ["read", "wish"] },
        public: { type: "boolean" },
      },
      required: ["book_id", "list", "public"],
    },
    handler: (args) => {
      const u = requireUser();
      if (typeof u === "string") return u;
      const r =
        args.list === "wish"
          ? core.setWishPublic(u.id, Number(args.book_id), !!args.public)
          : core.setReadPublic(u.id, Number(args.book_id), !!args.public);
      if (r.error) return err(r.error);
      return JSON.stringify({ ok: true }, null, 2);
    },
  },
  {
    name: "friend_wishlist",
    description: "Get a friend's public wishlist items by username.",
    inputSchema: {
      type: "object",
      properties: { username: { type: "string" } },
      required: ["username"],
    },
    handler: (args) => {
      const u = requireUser();
      if (typeof u === "string") return u;
      const r = core.getFriendWishlist(u.id, String(args.username));
      if (r.error) return err(r.error);
      return JSON.stringify({ user: r.user, books: r.books }, null, 2);
    },
  },
  {
    name: "my_reading",
    description: "List the books the acting user is currently reading (always visible to friends).",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const u = requireUser();
      if (typeof u === "string") return u;
      return JSON.stringify({ books: core.listReading(u.id) }, null, 2);
    },
  },
  {
    name: "add_to_reading",
    description: "Mark a book as currently reading, by ol_key or book_id (removes it from the read/wishlist lists).",
    inputSchema: {
      type: "object",
      properties: {
        ol_key: { type: "string" },
        book_id: { type: "number" },
        year: { type: "number", description: "Optional first publish year hint" },
      },
    },
    handler: async (args) => {
      const u = requireUser();
      if (typeof u === "string") return u;
      let r: { ok: boolean; error?: string; book?: core.BookRow };
      if (args.book_id != null) r = core.addToReadingByBookId(u.id, Number(args.book_id));
      else if (args.ol_key != null) r = await core.addToReadingByOlKey(u.id, String(args.ol_key), args.year);
      else return err("Provide ol_key or book_id");
      if (r.error) return err(r.error);
      return JSON.stringify({ ok: true, book: r.book, list: core.listReading(u.id) }, null, 2);
    },
  },
  {
    name: "add_to_reading_manual",
    description: "Add a book that isn't in Open Library as currently reading.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        author: { type: "string" },
        year: { type: "number" },
        cover_url: { type: "string" },
      },
      required: ["title"],
    },
    handler: (args) => {
      const u = requireUser();
      if (typeof u === "string") return u;
      const r = core.addManualToReading(u.id, {
        title: args.title,
        author: args.author,
        year: args.year,
        coverUrl: args.cover_url,
      });
      if (r.error) return err(r.error);
      return JSON.stringify({ ok: true, book: r.book, list: core.listReading(u.id) }, null, 2);
    },
  },
  {
    name: "finish_reading",
    description: "Move a currently-reading book into the read list (optionally with review + rank).",
    inputSchema: {
      type: "object",
      properties: { book_id: { type: "number" }, review: { type: "string" }, rank: { type: "number" } },
      required: ["book_id"],
    },
    handler: (args) => {
      const u = requireUser();
      if (typeof u === "string") return u;
      const r = core.finishReading(u.id, Number(args.book_id), args.review, args.rank);
      if (r.error) return err(r.error);
      return JSON.stringify({ ok: true }, null, 2);
    },
  },
  {
    name: "back_to_wishlist",
    description: "Move a currently-reading book back to the wishlist.",
    inputSchema: {
      type: "object",
      properties: { book_id: { type: "number" } },
      required: ["book_id"],
    },
    handler: (args) => {
      const u = requireUser();
      if (typeof u === "string") return u;
      const r = core.backToWishlist(u.id, Number(args.book_id));
      if (r.error) return err(r.error);
      return JSON.stringify({ ok: true }, null, 2);
    },
  },
  {
    name: "remove_from_reading",
    description: "Remove a book from currently reading.",
    inputSchema: {
      type: "object",
      properties: { book_id: { type: "number" } },
      required: ["book_id"],
    },
    handler: (args) => {
      const u = requireUser();
      if (typeof u === "string") return u;
      core.removeFromReading(u.id, Number(args.book_id));
      return JSON.stringify({ ok: true, list: core.listReading(u.id) }, null, 2);
    },
  },
  {
    name: "friend_reading",
    description: "Get a friend's currently-reading books (always visible).",
    inputSchema: {
      type: "object",
      properties: { username: { type: "string" } },
      required: ["username"],
    },
    handler: (args) => {
      const u = requireUser();
      if (typeof u === "string") return u;
      const r = core.getFriendReading(u.id, String(args.username));
      if (r.error) return err(r.error);
      return JSON.stringify({ user: r.user, books: r.books }, null, 2);
    },
  },
];

// ---------- JSON-RPC / MCP over stdio ----------

const SERVER_INFO = { name: "bookrecs", version: "1.0.0" };

function write(obj: unknown): void {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

async function dispatch(msg: any): Promise<void> {
  const id = msg?.id;
  const method = msg?.method;
  const params = msg?.params ?? {};

  if (method === "initialize") {
    write({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      },
    });
    return;
  }
  if (method === "notifications/initialized" || method?.startsWith("notifications/")) return;
  if (method === "ping") {
    write({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  if (method === "tools/list") {
    write({
      jsonrpc: "2.0",
      id,
      result: {
        tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      },
    });
    return;
  }
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments ?? {};
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      write({ jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool: ${name}` } });
      return;
    }
    try {
      const text = await tool.handler(args);
      write({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text }], isError: text.startsWith("Error:") },
      });
    } catch (e) {
      write({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: `Error: ${(e as Error)?.message ?? e}` }], isError: true },
      });
    }
    return;
  }

  write({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
}

const rl = createInterface({ input: process.stdin, terminal: false, crlfDelay: Infinity });

process.stderr.write(`bookrecs MCP server started. Acting as: ${ACTING || "(unset — set BOOKRECS_USER)"}\n`);

for await (const line of rl) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  let msg: any;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    continue;
  }
  if (msg && typeof msg === "object" && msg.jsonrpc === "2.0") {
    await dispatch(msg);
  }
}
