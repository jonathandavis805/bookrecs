// MCP server (JSON-RPC over stdio) exposing the BookRecs API as tools. It acts
// as one user through an API token (generate one on the Account page) against
// a running instance: BOOKRECS_TOKEN, and BOOKRECS_URL (default local dev).
import { createInterface } from "node:readline";

const BASE = (process.env.BOOKRECS_URL || "http://localhost:8788").replace(/\/$/, "");
const TOKEN = (process.env.BOOKRECS_TOKEN || "").trim();

type Args = Record<string, unknown>;
type Request = [method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown];

interface Tool {
  name: string;
  description: string;
  properties?: Record<string, { type: string; description?: string; items?: { type: string } }>;
  required?: string[];
  request: (args: Args) => Request;
}

const str = (description?: string) => ({ type: "string", description });
const num = (description?: string) => ({ type: "number", description });
const bool = (description?: string) => ({ type: "boolean", description });
const ids = (description: string) => ({ type: "array", items: { type: "number" }, description });
const seg = (v: unknown) => encodeURIComponent(String(v ?? ""));

const bookId = num("Book id, as returned by the list tools");
const username = str("Friend's username");
const rank = num("Optional 1-based position (defaults to the end)");
const isPublic = bool("Visible to friends (default true)");
const categoryIds = ids("Category ids, from my_categories");
const manual = {
  title: str("Book title"),
  author: str(),
  year: num("First publish year"),
  cover_url: str("Cover image URL"),
};
const manualBody = (a: Args) => ({ title: a.title, author: a.author, year: a.year, coverUrl: a.cover_url });

const tools: Tool[] = [
  {
    name: "search_books",
    description: "Search Open Library by title, author or keywords. Results carry an ol_key for the add tools.",
    properties: { query: str() },
    required: ["query"],
    request: (a) => ["GET", `/api/books/search?q=${seg(a.query)}`],
  },
  {
    name: "my_books",
    description:
      "The user's ranked list of books read (rank 1 = top), with reviews, listened (audiobook) flags, category_ids and the user's categories.",
    request: () => ["GET", "/api/me/books"],
  },
  {
    name: "add_book",
    description: "Add an Open Library book to the user's read list.",
    properties: {
      ol_key: str("Open Library work key, e.g. /works/OL123W"),
      review: str(),
      rank,
      public: isPublic,
      category_ids: categoryIds,
    },
    required: ["ol_key"],
    request: (a) => ["POST", "/api/books", a],
  },
  {
    name: "add_manual_book",
    description: "Add a book that isn't on Open Library to the user's read list.",
    properties: { ...manual, review: str(), rank, public: isPublic, category_ids: categoryIds },
    required: ["title"],
    request: (a) => [
      "POST",
      "/api/books/manual",
      { ...manualBody(a), review: a.review, rank: a.rank, public: a.public, category_ids: a.category_ids },
    ],
  },
  {
    name: "remove_book",
    description: "Remove a book from the user's read list.",
    properties: { book_id: bookId },
    required: ["book_id"],
    request: (a) => ["DELETE", `/api/me/books/${seg(a.book_id)}`],
  },
  {
    name: "set_review",
    description: "Set or clear the review of a book on the user's read list.",
    properties: { book_id: bookId, review: str("Review text; empty clears it") },
    required: ["book_id", "review"],
    request: (a) => ["PATCH", `/api/me/books/${seg(a.book_id)}`, { review: a.review }],
  },
  {
    name: "set_rank",
    description: "Move a book to a new position in the user's read list.",
    properties: { book_id: bookId, rank: num("New 1-based position") },
    required: ["book_id", "rank"],
    request: (a) => ["PATCH", `/api/me/books/${seg(a.book_id)}`, { rank: a.rank }],
  },
  {
    name: "reorder_books",
    description: "Reorder the read list. Books left out keep their order after the given ones.",
    properties: { book_ids: ids("Book ids, top first") },
    required: ["book_ids"],
    request: (a) => ["POST", "/api/me/books/reorder", { ordered: a.book_ids }],
  },
  {
    name: "my_categories",
    description: "The user's categories, shared by books read, wishlist and currently reading.",
    request: () => ["GET", "/api/me/categories"],
  },
  {
    name: "create_category",
    description: "Create a category for books on any of the user's lists.",
    properties: { name: str() },
    required: ["name"],
    request: (a) => ["POST", "/api/me/categories", { name: a.name }],
  },
  {
    name: "rename_category",
    description: "Rename one of the user's categories.",
    properties: { category_id: num(), name: str() },
    required: ["category_id", "name"],
    request: (a) => ["PATCH", `/api/me/categories/${seg(a.category_id)}`, { name: a.name }],
  },
  {
    name: "delete_category",
    description: "Delete a category. Its books stay on their lists.",
    properties: { category_id: num() },
    required: ["category_id"],
    request: (a) => ["DELETE", `/api/me/categories/${seg(a.category_id)}`],
  },
  {
    name: "set_book_categories",
    description: "Replace the categories of a book on any of the user's lists (empty list removes it from all).",
    properties: { book_id: bookId, category_ids: categoryIds },
    required: ["book_id", "category_ids"],
    request: (a) => ["POST", `/api/me/books/${seg(a.book_id)}/categories`, { category_ids: a.category_ids }],
  },
  {
    name: "reorder_category",
    description:
      "Reorder the read books in a category. They swap among the overall positions they already hold, so books outside the category keep their rank. Books left out keep their order after the given ones.",
    properties: { category_id: num(), book_ids: ids("Book ids in the category, top first") },
    required: ["category_id", "book_ids"],
    request: (a) => ["POST", `/api/me/categories/${seg(a.category_id)}/reorder`, { ordered: a.book_ids }],
  },
  {
    name: "set_public",
    description: "Show or hide a read-list or wishlist book from friends.",
    properties: { list: str("'read' or 'wishlist'"), book_id: bookId, public: isPublic },
    required: ["list", "book_id", "public"],
    request: (a) => [
      "POST",
      `/api/me/${a.list === "wishlist" ? "wishlist" : "books"}/${seg(a.book_id)}/public`,
      { public: a.public },
    ],
  },
  {
    name: "set_listened",
    description: "Mark a read-list book as listened to (audiobook) or read.",
    properties: { book_id: bookId, listened: bool("Listened to rather than read") },
    required: ["book_id", "listened"],
    request: (a) => ["POST", `/api/me/books/${seg(a.book_id)}/listened`, { listened: a.listened }],
  },
  {
    name: "my_wishlist",
    description: "The user's ranked wishlist, with owned and public flags.",
    request: () => ["GET", "/api/me/wishlist"],
  },
  {
    name: "add_to_wishlist",
    description: "Add a book to the wishlist by Open Library key or existing book id.",
    properties: { ol_key: str(), book_id: bookId, owned: bool("Already owned"), public: isPublic, rank },
    request: (a) => ["POST", "/api/me/wishlist", a],
  },
  {
    name: "add_to_wishlist_manual",
    description: "Add a book that isn't on Open Library to the wishlist.",
    properties: { ...manual, owned: bool("Already owned"), public: isPublic, rank },
    required: ["title"],
    request: (a) => [
      "POST",
      "/api/me/wishlist/manual",
      { ...manualBody(a), owned: a.owned, public: a.public, rank: a.rank },
    ],
  },
  {
    name: "set_owned",
    description: "Mark a wishlist book as owned or not.",
    properties: { book_id: bookId, owned: bool() },
    required: ["book_id", "owned"],
    request: (a) => ["POST", `/api/me/wishlist/${seg(a.book_id)}/owned`, { owned: a.owned }],
  },
  {
    name: "move_to_read",
    description: "Move a wishlist book to the read list.",
    properties: { book_id: bookId, review: str(), rank, category_ids: categoryIds },
    required: ["book_id"],
    request: (a) => [
      "POST",
      `/api/me/wishlist/${seg(a.book_id)}/move-to-read`,
      { review: a.review, rank: a.rank, category_ids: a.category_ids },
    ],
  },
  {
    name: "remove_from_wishlist",
    description: "Remove a book from the wishlist.",
    properties: { book_id: bookId },
    required: ["book_id"],
    request: (a) => ["DELETE", `/api/me/wishlist/${seg(a.book_id)}`],
  },
  {
    name: "reorder_wishlist",
    description: "Reorder the wishlist. Books left out keep their order after the given ones.",
    properties: { book_ids: ids("Book ids, top first") },
    required: ["book_ids"],
    request: (a) => ["POST", "/api/me/wishlist/reorder", { ordered: a.book_ids }],
  },
  {
    name: "my_reading",
    description: "Books the user is currently reading, with a listening (audiobook) flag.",
    request: () => ["GET", "/api/me/reading"],
  },
  {
    name: "add_to_reading",
    description: "Start reading a book, by Open Library key or existing book id. Takes it off the wishlist.",
    properties: { ol_key: str(), book_id: bookId },
    request: (a) => ["POST", "/api/me/reading", a],
  },
  {
    name: "add_to_reading_manual",
    description: "Start reading a book that isn't on Open Library.",
    properties: manual,
    required: ["title"],
    request: (a) => ["POST", "/api/me/reading/manual", manualBody(a)],
  },
  {
    name: "set_listening",
    description: "Mark a currently-reading book as being listened to (audiobook) or read.",
    properties: { book_id: bookId, listening: bool("Listening rather than reading") },
    required: ["book_id", "listening"],
    request: (a) => ["POST", `/api/me/reading/${seg(a.book_id)}/listening`, { listening: a.listening }],
  },
  {
    name: "finish_reading",
    description: "Finish a book: it moves to the read list, marked listened if it was being listened to.",
    properties: { book_id: bookId, review: str(), rank, category_ids: categoryIds },
    required: ["book_id"],
    request: (a) => [
      "POST",
      `/api/me/reading/${seg(a.book_id)}/finish`,
      { review: a.review, rank: a.rank, category_ids: a.category_ids },
    ],
  },
  {
    name: "back_to_wishlist",
    description: "Stop reading a book and return it to the wishlist where it was.",
    properties: { book_id: bookId },
    required: ["book_id"],
    request: (a) => ["POST", `/api/me/reading/${seg(a.book_id)}/back-to-wishlist`],
  },
  {
    name: "remove_from_reading",
    description: "Stop reading a book. One that came from the wishlist goes back there.",
    properties: { book_id: bookId },
    required: ["book_id"],
    request: (a) => ["DELETE", `/api/me/reading/${seg(a.book_id)}`],
  },
  {
    name: "search_users",
    description: "Find discoverable users by username or email, for adding friends.",
    properties: { query: str() },
    required: ["query"],
    request: (a) => ["GET", `/api/users/discover?q=${seg(a.query)}`],
  },
  {
    name: "send_friend_request",
    description: "Send a friend request by username or email (accepts theirs if they already asked).",
    properties: { username: str("Username or email") },
    required: ["username"],
    request: (a) => ["POST", "/api/friends/requests", { usernameOrEmail: a.username }],
  },
  {
    name: "friend_requests",
    description: "Pending incoming and outgoing friend requests.",
    request: () => ["GET", "/api/friends/requests"],
  },
  {
    name: "accept_friend_request",
    description: "Accept an incoming friend request by its id (see friend_requests).",
    properties: { request_id: num() },
    required: ["request_id"],
    request: (a) => ["POST", `/api/friends/requests/${seg(a.request_id)}/accept`],
  },
  {
    name: "decline_friend_request",
    description: "Decline an incoming friend request by its id.",
    properties: { request_id: num() },
    required: ["request_id"],
    request: (a) => ["POST", `/api/friends/requests/${seg(a.request_id)}/decline`],
  },
  {
    name: "list_friends",
    description: "The user's friends and what each is currently reading.",
    request: () => ["GET", "/api/friends"],
  },
  ...(["books", "wishlist", "reading"] as const).map(
    (list): Tool => ({
      name: `friend_${list}`,
      description: `A friend's ${list === "books" ? "public read list" : list === "wishlist" ? "public wishlist" : "currently-reading books"}.`,
      properties: { username },
      required: ["username"],
      request: (a) => ["GET", `/api/friends/${seg(a.username)}/${list}`],
    }),
  ),
];

async function callApi([method, path, body]: Request): Promise<string> {
  if (!TOKEN) return "Error: BOOKRECS_TOKEN is not set. Generate a token on the BookRecs Account page.";
  const res = await fetch(BASE + path, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return res.ok ? JSON.stringify(data, null, 2) : `Error: ${data.error ?? `Request failed (${res.status})`}`;
}

// ---------- JSON-RPC / MCP over stdio ----------

interface Message {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: { protocolVersion?: string; name?: string; arguments?: Args };
}

const write = (obj: unknown) => {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
};
const reply = (id: Message["id"], result: unknown) => write({ jsonrpc: "2.0", id, result });
const replyError = (id: Message["id"], code: number, message: string) =>
  write({ jsonrpc: "2.0", id, error: { code, message } });

async function dispatch({ id, method, params = {} }: Message): Promise<void> {
  if (method?.startsWith("notifications/")) return;
  if (method === "initialize") {
    return reply(id, {
      protocolVersion: params.protocolVersion ?? "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "bookrecs", version: "2.0.0" },
    });
  }
  if (method === "ping") return reply(id, {});
  if (method === "tools/list") {
    return reply(id, {
      tools: tools.map(({ name, description, properties = {}, required }) => ({
        name,
        description,
        inputSchema: { type: "object", properties, required },
      })),
    });
  }
  if (method === "tools/call") {
    const tool = tools.find((t) => t.name === params.name);
    if (!tool) return replyError(id, -32602, `Unknown tool: ${params.name}`);
    let text: string;
    try {
      text = await callApi(tool.request(params.arguments ?? {}));
    } catch (e) {
      text = `Error: BookRecs is unreachable at ${BASE} (${e instanceof Error ? e.message : e})`;
    }
    return reply(id, { content: [{ type: "text", text }], isError: text.startsWith("Error:") });
  }
  replyError(id, -32601, `Method not found: ${method}`);
}

process.stderr.write(`bookrecs MCP server started against ${BASE}${TOKEN ? "" : " (BOOKRECS_TOKEN not set)"}\n`);

for await (const line of createInterface({
  input: process.stdin,
  terminal: false,
  crlfDelay: Number.POSITIVE_INFINITY,
})) {
  try {
    const msg = JSON.parse(line) as Message;
    if (msg?.jsonrpc === "2.0") await dispatch(msg);
  } catch {
    // Ignore lines that aren't JSON-RPC.
  }
}
