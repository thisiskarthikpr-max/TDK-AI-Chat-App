import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.jsx';

function dayGroup(dateValue) {
  const date = new Date(dateValue);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (left, right) => left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
  if (sameDay(date, today)) return 'Today';
  if (sameDay(date, yesterday)) return 'Yesterday';
  return 'Earlier';
}

function displayDate(value) {
  const date = new Date(value);
  if (dayGroup(value) === 'Today') return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function groupChats(chats) {
  return chats.reduce((groups, chat) => {
    const group = dayGroup(chat.updatedAt);
    groups[group] ??= [];
    groups[group].push(chat);
    return groups;
  }, {});
}

export default function ChatWorkspace() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const { user, logout, authFetch } = useAuth();
  const [chats, setChats] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [chatError, setChatError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const reloadChats = useCallback(async () => {
    const response = await authFetch('/api/chats');
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? 'Could not load conversations');
    setChats(body.chats ?? []);
  }, [authFetch]);

  useEffect(() => {
    let current = true;
    setLoadingChats(true);
    reloadChats()
      .catch((error) => { if (current) setChatError(error.message); })
      .finally(() => { if (current) setLoadingChats(false); });
    return () => { current = false; };
  }, [reloadChats]);

  useEffect(() => {
    let current = true;
    setMessages([]);
    setChatError('');
    if (!chatId) {
      setLoadingMessages(false);
      return () => { current = false; };
    }

    setLoadingMessages(true);
    authFetch(`/api/chats/${encodeURIComponent(chatId)}/messages`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? 'Could not load this conversation');
        if (current) setMessages(body.messages ?? []);
      })
      .catch((error) => { if (current) setChatError(error.message); })
      .finally(() => { if (current) setLoadingMessages(false); });
    return () => { current = false; };
  }, [authFetch, chatId]);

  const groupedChats = useMemo(() => groupChats(chats), [chats]);
  const activeChat = chats.find((chat) => chat._id === chatId);

  async function renameChat(chat) {
    const title = window.prompt('Rename conversation', chat.title);
    if (title === null || !title.trim() || title.trim() === chat.title) return;
    const response = await authFetch(`/api/chats/${chat._id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: title.trim() }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setChatError(body.error ?? 'Could not rename this conversation');
      return;
    }
    setChats((current) => current.map((item) => item._id === chat._id ? body.chat : item));
  }

  async function deleteChat(chat) {
    if (!window.confirm(`Delete “${chat.title}”? This will remove its messages.`)) return;
    const response = await authFetch(`/api/chats/${chat._id}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setChatError(body.error ?? 'Could not delete this conversation');
      return;
    }
    setChats((current) => current.filter((item) => item._id !== chat._id));
    if (chatId === chat._id) navigate('/', { replace: true });
  }

  async function signOut() {
    await logout();
    navigate('/login', { replace: true });
  }

  function beginNewChat() {
    setSidebarOpen(false);
    navigate('/');
  }

  return (
    <main className="chat-app-shell">
      {sidebarOpen && <button className="sidebar-backdrop" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} />}
      <aside className={`chat-sidebar${sidebarOpen ? ' chat-sidebar-open' : ''}`} aria-label="Chat history">
        <div className="sidebar-brand-row">
          <Link className="brand" to="/" onClick={() => setSidebarOpen(false)}>
            <span className="brand-mark">T</span><span>TDK<span className="brand-light"> AI</span></span>
          </Link>
          <button className="sidebar-close" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)}>×</button>
        </div>
        <button className="new-chat-button" onClick={beginNewChat}><span>＋</span> New chat</button>
        <div className="history-heading"><span>YOUR HISTORY</span><span className="history-count">{chats.length}</span></div>
        <nav className="chat-history-list" aria-label="Past conversations">
          {loadingChats && <div className="chat-skeletons" aria-label="Loading conversations">
            {[0, 1, 2, 3, 4].map((item) => <div className="chat-skeleton" key={item}><span /><i /></div>)}
          </div>}
          {!loadingChats && chats.length === 0 && <div className="history-empty"><span className="history-empty-icon">◌</span><p>No conversations yet</p><small>Your chats will be saved here.</small></div>}
          {!loadingChats && ['Today', 'Yesterday', 'Earlier'].map((group) => groupedChats[group]?.length > 0 && (
            <section className="history-group" key={group}>
              <h2>{group}</h2>
              {groupedChats[group].map((chat) => <article className={`history-item${chatId === chat._id ? ' history-item-active' : ''}`} key={chat._id}>
                <Link className="history-link" to={`/chat/${chat._id}`} onClick={() => setSidebarOpen(false)}>
                  <span className="history-chat-title">{chat.title}</span>
                  <time dateTime={chat.updatedAt}>{displayDate(chat.updatedAt)}</time>
                </Link>
                <div className="history-actions">
                  <button title="Rename conversation" aria-label={`Rename ${chat.title}`} onClick={() => renameChat(chat)}>···</button>
                  <button title="Delete conversation" aria-label={`Delete ${chat.title}`} onClick={() => deleteChat(chat)}>×</button>
                </div>
              </article>)}
            </section>
          ))}
        </nav>
        <div className="sidebar-profile">
          <div className="profile-avatar">{user?.email?.slice(0, 1).toUpperCase() ?? 'U'}</div>
          <span className="profile-email" title={user?.email}>{user?.email}</span>
          <button className="profile-signout" onClick={signOut} title="Sign out" aria-label="Sign out">↗</button>
        </div>
      </aside>

      <section className="chat-main-panel">
        <header className="chat-topbar">
          <button className="sidebar-toggle" aria-label="Open chat history" onClick={() => setSidebarOpen(true)}>☰</button>
          <div className="topbar-title">{activeChat?.title ?? 'New conversation'}</div>
          <div className="connection-status"><span />Saved to your history</div>
        </header>
        <div className={`conversation-stage${messages.length ? ' conversation-stage-has-messages' : ''}`}>
          {chatError && <div className="chat-alert" role="alert">{chatError}<button onClick={() => setChatError('')} aria-label="Dismiss">×</button></div>}
          {!chatId && <div className="conversation-empty">
            <div className="empty-mark"><span>T</span><i /><b /></div>
            <p className="empty-eyebrow">A CLEAR SPACE TO THINK</p>
            <h1>Where should we<br /><span>start?</span></h1>
            <p className="empty-copy">Choose a conversation from your history, or start a fresh chat. New conversations are saved when you send your first message.</p>
          </div>}
          {chatId && loadingMessages && <div className="messages-loading" aria-live="polite"><span className="loading-mark" />Loading conversation…</div>}
          {chatId && !loadingMessages && messages.length === 0 && !chatError && <div className="conversation-empty conversation-empty-small">
            <div className="empty-mark"><span>T</span><i /><b /></div>
            <h1>This conversation is<br /><span>just beginning.</span></h1>
          </div>}
          {chatId && !loadingMessages && messages.length > 0 && <div className="message-history" aria-live="polite">
            {messages.map((message) => <article className={`history-message message-${message.role}`} key={message._id}>
              <div className="message-avatar">{message.role === 'user' ? user?.email?.slice(0, 1).toUpperCase() : 'T'}</div>
              <div className="message-body"><div className="message-author">{message.role === 'user' ? 'You' : 'TDK AI'}{message.status === 'stopped' && <span className="message-status">Stopped</span>}</div><p>{message.content}</p></div>
            </article>)}
          </div>}
        </div>
        <footer className="chat-footer-note">Thoughtful conversations, right where you left them.</footer>
      </section>
    </main>
  );
}
