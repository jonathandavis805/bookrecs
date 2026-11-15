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

  const isAdmin = user.is_admin === 1;

  // Fetch unread notification count for admins
  useEffect(() => {
    if (!isAdmin) return;
    
    const fetchCount = () => {
      api<{ unreadCount: number }>("/api/notifications")
        .then((d) => setUnreadCount(d.unreadCount))
        .catch(() => {});
    };
    
    fetchCount();
    const interval = setInterval(fetchCount, 30000); // Poll every 30 seconds
    return () => clearInterval(interval);
  }, [isAdmin]);

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
          {isAdmin && (
            <button
              className="link notification-bell"
              onClick={() => setShowNotifications(true)}
              title="Notifications"
            >
              🔔
              {unreadCount > 0 && <span className="notification-badge">{unreadCount}</span>}
            </button>
          )}
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
      {showNotifications && isAdmin && (
        <Notifications
          onClose={() => setShowNotifications(false)}
          onCountChange={setUnreadCount}
        />
      )}
    </div>
  );
}
