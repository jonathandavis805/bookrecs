import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, type User } from "./api";
import Account from "./components/Account";
import AddBook from "./components/AddBook";
import Auth from "./components/Auth";
import BookDetail from "./components/BookDetail";
import ClubDetail from "./components/ClubDetail";
import Clubs from "./components/Clubs";
import Friends from "./components/Friends";
import Notifications from "./components/Notifications";
import Profile from "./components/Profile";
import Settings from "./components/Settings";
import UserMenu from "./components/UserMenu";
import { IconBell } from "./components/ui/icons";
import { adoptAccountTheme } from "./theme";
import { clearCache } from "./useData";

type Route =
  | { name: "books" }
  | { name: "add" }
  | { name: "friends" }
  | { name: "account" }
  | { name: "clubs" }
  | { name: "profile"; username: string }
  | { name: "book"; bookId: number }
  | { name: "club"; clubId: number };

function parseRoute(): Route {
  const h = window.location.hash;
  if (h.startsWith("#/book/")) {
    const bookId = parseInt(h.slice(7), 10);
    if (!Number.isNaN(bookId)) return { name: "book", bookId };
  }
  if (h.startsWith("#/club/")) {
    const clubId = parseInt(h.slice(7), 10);
    if (!Number.isNaN(clubId)) return { name: "club", clubId };
  }
  if (h.startsWith("#/u/")) return { name: "profile", username: decodeURIComponent(h.slice(4)) };
  if (h === "#/add") return { name: "add" };
  if (h === "#/friends") return { name: "friends" };
  if (h === "#/account") return { name: "account" };
  if (h === "#/clubs") return { name: "clubs" };
  return { name: "books" };
}

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [route, setRoute] = useState<Route>(() => parseRoute());

  useEffect(() => {
    api<{ user: User | null }>("/api/me")
      .then((d) => setUser(d.user))
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (user) adoptAccountTheme(user.theme);
  }, [user]);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    // Remembered on the history entry, so only going back to it restores it.
    let timer: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => history.replaceState({ scroll: window.scrollY }, ""), 100);
    };
    history.scrollRestoration = "manual";
    window.addEventListener("hashchange", onHash);
    window.addEventListener("scroll", onScroll);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once the new page has laid out
  useLayoutEffect(() => {
    window.scrollTo(0, history.state?.scroll ?? 0);
  }, [route]);

  if (user === undefined) return <div className="centered">Loading…</div>;
  if (user === null) return <Auth onAuthed={setUser} />;

  return (
    <Main
      user={user}
      route={route}
      onLogout={() => {
        clearCache();
        setUser(null);
      }}
      onNavigate={(name) => {
        window.location.hash = name === "books" ? "#/books" : `#/${name}`;
      }}
    />
  );
}

// Stacks the header (tabs on their own row) only when the one-row layout
// actually wraps, so adding tabs or long usernames can never leave a half-wrapped header.
function useStackWhenWrapped(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      // Measure the one-row layout; class changes and reads happen before paint, so no flicker.
      el.classList.remove("stacked");
      const rects = [...el.children].map((c) => c.getBoundingClientRect());
      const wrapped = Math.max(...rects.map((r) => r.top)) >= Math.min(...rects.map((r) => r.bottom));
      el.classList.toggle("stacked", wrapped);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
}

type TabName = "books" | "add" | "friends" | "clubs";

function Main({
  user,
  route,
  onLogout,
  onNavigate,
}: {
  user: User;
  route: Route;
  onLogout: () => void;
  onNavigate: (name: TabName) => void;
}) {
  const active =
    route.name === "books" || route.name === "add" || route.name === "friends" || route.name === "clubs"
      ? route.name
      : null;
  const headerRef = useRef<HTMLElement>(null);
  useStackWhenWrapped(headerRef);
  const [showSettings, setShowSettings] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  // Bumped whenever friend requests or club invites change so the Friends
  // page, Clubs page, notifications panel, and unread badge all stay in sync
  const [friendRequestsVersion, setFriendRequestsVersion] = useState(0);
  const bumpFriendRequests = () => setFriendRequestsVersion((v) => v + 1);

  // Fetch unread notification count (also refetches when friend requests change)
  // biome-ignore lint/correctness/useExhaustiveDependencies: friendRequestsVersion is a refetch trigger
  useEffect(() => {
    const fetchCount = () => {
      api<{ unreadCount: number }>("/api/notifications")
        .then((d) => setUnreadCount(d.unreadCount))
        .catch(() => {});
    };

    fetchCount();
    const interval = setInterval(fetchCount, 30000); // Poll every 30 seconds
    return () => clearInterval(interval);
  }, [friendRequestsVersion]);

  function logout() {
    api("/api/logout", { method: "POST" }).finally(onLogout);
  }

  return (
    <div className="app">
      <header className="topbar" ref={headerRef}>
        <h1>BookRecs</h1>
        <nav>
          <button type="button" className={active === "books" ? "active" : ""} onClick={() => onNavigate("books")}>
            My Books
          </button>
          <button type="button" className={active === "add" ? "active" : ""} onClick={() => onNavigate("add")}>
            Add Book
          </button>
          <button type="button" className={active === "friends" ? "active" : ""} onClick={() => onNavigate("friends")}>
            Friends
          </button>
          <button type="button" className={active === "clubs" ? "active" : ""} onClick={() => onNavigate("clubs")}>
            Clubs
          </button>
        </nav>
        <div className="userbox">
          <button
            type="button"
            className="icon-btn notification-bell"
            onClick={() => setShowNotifications(true)}
            title="Notifications"
          >
            <IconBell size={20} />
            {unreadCount > 0 && <span className="notification-badge">{unreadCount}</span>}
          </button>
          <UserMenu username={user.username} onAccount={() => (window.location.hash = "#/account")} onLogout={logout} />
        </div>
      </header>
      <main>
        {active === "books" && <Profile key={user.username} username={user.username} me={user} />}
        {active === "add" && <AddBook />}
        {active === "friends" && (
          <Friends refreshKey={friendRequestsVersion} onFriendRequestsChanged={bumpFriendRequests} />
        )}
        {route.name === "account" && <Account user={user} onChangePassword={() => setShowSettings(true)} />}
        {active === "clubs" && (
          <Clubs key={user.username} refreshKey={friendRequestsVersion} onClubsChanged={bumpFriendRequests} />
        )}
        {route.name === "club" && <ClubDetail key={route.clubId} user={user} clubId={route.clubId} />}
        {route.name === "profile" && <Profile key={route.username} username={route.username} me={user} />}
        {route.name === "book" && <BookDetail key={route.bookId} bookId={route.bookId} />}
      </main>
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      {showNotifications && (
        <Notifications
          refreshKey={friendRequestsVersion}
          onFriendRequestsChanged={bumpFriendRequests}
          onClose={() => setShowNotifications(false)}
          onCountChange={setUnreadCount}
        />
      )}
    </div>
  );
}
