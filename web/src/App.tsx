import { useEffect, useState } from "react";
import { api, User } from "./api";
import Auth from "./components/Auth";
import MyBooks from "./components/MyBooks";
import AddBook from "./components/AddBook";
import Friends from "./components/Friends";
import Profile from "./components/Profile";
import BookDetail from "./components/BookDetail";
import Settings from "./components/Settings";
import Notifications from "./components/Notifications";

type Route =
  | { name: "books" }
  | { name: "add" }
  | { name: "friends" }
  | { name: "profile"; username: string }
  | { name: "book"; bookId: number };

function parseRoute(): Route {
  const h = window.location.hash;
  if (h.startsWith("#/book/")) {
    const bookId = parseInt(h.slice(7), 10);
    if (!isNaN(bookId)) return { name: "book", bookId };
  }
  if (h.startsWith("#/u/")) return { name: "profile", username: decodeURIComponent(h.slice(4)) };
  if (h === "#/add") return { name: "add" };
  if (h === "#/friends") return { name: "friends" };
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
    const onHash = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (user === undefined) return <div className="centered">Loading…</div>;
  if (user === null) return <Auth onAuthed={setUser} />;

  return (
    <Main
      user={user}
      route={route}
      onLogout={() => setUser(null)}
      onNavigate={(name) => {
        window.location.hash = name === "books" ? "#/books" : `#/${name}`;
      }}
    />
  );
}

type TabName = "books" | "add" | "friends";

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
  const active = route.name === "books" || route.name === "add" || route.name === "friends" 
    ? route.name 
    : null;
  const [showSettings, setShowSettings] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  // Bumped whenever friend requests change so the Friends page,
  // notifications panel, and unread badge all stay in sync
  const [friendRequestsVersion, setFriendRequestsVersion] = useState(0);
  const bumpFriendRequests = () => setFriendRequestsVersion((v) => v + 1);

  // Fetch unread notification count (also refetches when friend requests change)
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

  function openProfile(username: string) {
    window.location.hash = "#/u/" + encodeURIComponent(username);
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>BookRecs</h1>
        <nav>
          <button className={active === "books" ? "active" : ""} onClick={() => onNavigate("books")}>
            My Books
          </button>
          <button className={active === "add" ? "active" : ""} onClick={() => onNavigate("add")}>
            Add Book
          </button>
          <button className={active === "friends" ? "active" : ""} onClick={() => onNavigate("friends")}>
            My Account
          </button>
        </nav>
        <div className="userbox">
          <button
            className="link notification-bell"
            onClick={() => setShowNotifications(true)}
            title="Notifications"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C10.343 2 9 3.343 9 5V5.29C6.716 6.144 5 8.381 5 11V16L3 18V19H21V18L19 16V11C19 8.381 17.284 6.144 15 5.29V5C15 3.343 13.657 2 12 2ZM12 4C12.552 4 13 4.448 13 5V5.065C12.672 5.021 12.34 5 12 5C11.66 5 11.328 5.021 11 5.065V5C11 4.448 11.448 4 12 4ZM10 20C10 21.105 10.895 22 12 22C13.105 22 14 21.105 14 20H10Z"/>
            </svg>
            {unreadCount > 0 && <span className="notification-badge">{unreadCount}</span>}
          </button>
          <button className="link" onClick={() => openProfile(user.username)} title="Your profile">
            @{user.username}
          </button>
          <button className="link" onClick={logout}>
            Log out
          </button>
        </div>
      </header>
      <main>
        {active === "books" && (
          <Profile
            key={user.username}
            username={user.username}
            me={user}
            onBack={() => {}}
          />
        )}
        {active === "add" && <AddBook />}
        {active === "friends" && (
          <Friends 
            user={user} 
            refreshKey={friendRequestsVersion}
            onFriendRequestsChanged={bumpFriendRequests}
            onOpenProfile={openProfile} 
            onChangePassword={() => setShowSettings(true)} 
          />
        )}
        {route.name === "profile" && (
          <Profile
            key={route.username}
            username={route.username}
            me={user}
            onBack={() => {
              window.location.hash = "#/books";
            }}
          />
        )}
        {route.name === "book" && (
          <BookDetail
            key={route.bookId}
            bookId={route.bookId}
            onBack={() => {
              window.history.back();
            }}
          />
        )}
      </main>
      {showSettings && (
        <Settings onClose={() => setShowSettings(false)} />
      )}
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
