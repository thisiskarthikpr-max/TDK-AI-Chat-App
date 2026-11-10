import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.jsx';

const MarkdownMessage = lazy(() => import('./MarkdownMessage.jsx'));

function parseSseBlock(block) {
  if (!block || block.startsWith(':')) return null;
  const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
  return data ? JSON.parse(data) : null;
}

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
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(true);
  const [thoughtDuration, setThoughtDuration] = useState(null);
  const [thinkingElapsed, setThinkingElapsed] = useState(0);
  const [showJump, setShowJump] = useState(false);
  const [streamTitle, setStreamTitle] = useState('');
  const abortControllerRef = useRef(null);
  const streamChatIdRef = useRef(null);
  const justCompletedChatIdRef = useRef(null);
  const streamVersionRef = useRef(0);
  const streamAssistantIdRef = useRef(null);
  const pendingTokensRef = useRef('');
  const animationFrameRef = useRef(0);
  const stageRef = useRef(null);
  const nearBottomRef = useRef(true);
  const thinkingStartedAtRef = useRef(null);

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
    if (chatId && chatId === justCompletedChatIdRef.current) {
      justCompletedChatIdRef.current = null;
      return () => { current = false; };
    }
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

  useEffect(() => {
    if (!streaming || thoughtDuration !== null) return undefined;
    const timer = window.setInterval(() => {
      if (thinkingStartedAtRef.current) setThinkingElapsed((Date.now() - thinkingStartedAtRef.current) / 1000);
    }, 100);
    return () => window.clearInterval(timer);
  }, [streaming, thoughtDuration]);

  const flushTokens = useCallback(() => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = 0;
    const text = pendingTokensRef.current;
    pendingTokensRef.current = '';
    if (text) {
      const targetId = streamAssistantIdRef.current;
      setMessages((current) => current.map((message) => message._id === targetId
        ? { ...message, content: `${message.content}${text}` }
        : message));
    }
  }, []);

  useEffect(() => () => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    abortControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !nearBottomRef.current) return;
    stage.scrollTop = stage.scrollHeight;
    setShowJump(false);
  }, [messages, streaming]);

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
    streamVersionRef.current += 1;
    abortControllerRef.current?.abort();
    streamChatIdRef.current = null;
    setStreamTitle('');
    setMessages([]);
    setDraft('');
    setSidebarOpen(false);
    navigate('/');
  }

  async function sendMessage(text = draft, retryUserMessageId = null) {
    const content = text.trim();
    if (streaming || (!retryUserMessageId && !content)) return;
    if (!retryUserMessageId && content.length > 8000) {
      setChatError('Messages can be up to 8,000 characters.');
      return;
    }

    setChatError('');
    setDraft('');
    setStreaming(true);
    setThinkingOpen(true);
    setThoughtDuration(null);
    setThinkingElapsed(0);
    thinkingStartedAtRef.current = Date.now();
    const userTempId = retryUserMessageId ? null : `user-${crypto.randomUUID()}`;
    const assistantTempId = `assistant-${crypto.randomUUID()}`;
    const streamVersion = ++streamVersionRef.current;
    streamAssistantIdRef.current = assistantTempId;
    streamChatIdRef.current = chatId ?? streamChatIdRef.current ?? null;
    pendingTokensRef.current = '';
    if (!retryUserMessageId) {
      setMessages((current) => [...current,
        { _id: userTempId, role: 'user', content, status: 'complete', createdAt: new Date().toISOString() },
        { _id: assistantTempId, role: 'assistant', content: '', thinking: '', status: 'streaming', createdAt: new Date().toISOString() },
      ]);
    } else {
      setMessages((current) => [...current,
        { _id: assistantTempId, role: 'assistant', content: '', thinking: '', status: 'streaming', retryUserMessageId, createdAt: new Date().toISOString() },
      ]);
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    let responseChatId = chatId ?? null;
    let responseUserMessageId = retryUserMessageId;
    let terminal = false;
    let firstTokenSeen = false;
    let thoughtSeconds = null;
    const finishMessage = (event, status) => {
      flushTokens();
      if (event?.chatId) responseChatId = event.chatId;
      if (event?.userMessageId) responseUserMessageId = event.userMessageId;
      setMessages((current) => current.map((message) => {
        if (message._id === assistantTempId) {
          return {
            ...message,
            _id: event?.messageId ?? message._id,
            status,
            error: event?.error,
            retryUserMessageId: responseUserMessageId,
            thinkingDuration: thoughtSeconds,
          };
        }
        if (userTempId && message._id === userTempId && responseUserMessageId) return { ...message, _id: responseUserMessageId };
        return message;
      }));
      setStreaming(false);
      setThoughtDuration((current) => current ?? ((Date.now() - thinkingStartedAtRef.current) / 1000));
    };

    try {
      const endpointChatId = chatId ?? streamChatIdRef.current ?? 'new';
      const response = await authFetch(`/api/chats/${encodeURIComponent(endpointChatId)}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(retryUserMessageId ? { retryUserMessageId } : { content }),
        signal: controller.signal,
      });
      responseChatId = response.headers.get('x-chat-id') ?? responseChatId;
      if (responseChatId) streamChatIdRef.current = responseChatId;
      responseUserMessageId = response.headers.get('x-user-message-id') ?? responseUserMessageId;
      const titleHeader = response.headers.get('x-chat-title');
      if (titleHeader) setStreamTitle(titleHeader);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? 'Could not send this message');
      }
      await reloadChats().catch(() => {});
      if (!response.body) throw new Error('This browser could not read the response stream');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const handleEvent = (event) => {
        if (!event || streamVersion !== streamVersionRef.current) return;
        if (event.type === 'thinking') {
          setMessages((current) => current.map((message) => message._id === assistantTempId
            ? { ...message, thinking: `${message.thinking}${event.text}` }
            : message));
        } else if (event.type === 'token') {
          if (!firstTokenSeen) {
            firstTokenSeen = true;
            thoughtSeconds = (Date.now() - thinkingStartedAtRef.current) / 1000;
            setThoughtDuration(thoughtSeconds);
            setThinkingOpen(false);
          }
          pendingTokensRef.current += event.text;
          if (!animationFrameRef.current) {
            animationFrameRef.current = requestAnimationFrame(() => {
              animationFrameRef.current = 0;
              const chunk = pendingTokensRef.current;
              pendingTokensRef.current = '';
              if (chunk) setMessages((current) => current.map((message) => message._id === assistantTempId
                ? { ...message, content: `${message.content}${chunk}` }
                : message));
            });
          }
        } else if (event.type === 'done') {
          terminal = true;
          finishMessage(event, event.status ?? 'complete');
          setStreamTitle('');
          if (event.chatId) {
            reloadChats().catch(() => {});
            if (!chatId) {
              justCompletedChatIdRef.current = event.chatId;
              navigate(`/chat/${event.chatId}`, { replace: true });
            }
          }
        } else if (event.type === 'error') {
          terminal = true;
          finishMessage(event, 'error');
          setChatError(event.error ?? 'The response could not be completed.');
          setStreamTitle('');
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        let separator;
        while ((separator = buffer.match(/\r?\n\r?\n/))) {
          const index = separator.index;
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + separator[0].length);
          handleEvent(parseSseBlock(block));
        }
        if (done) break;
      }
      if (!terminal) throw new Error('The response stream ended unexpectedly');
    } catch (error) {
      flushTokens();
      if (error.name === 'AbortError') {
        if (!terminal) finishMessage(null, 'stopped');
      } else {
        if (streamVersion === streamVersionRef.current) setChatError(error.message);
        finishMessage({ userMessageId: responseUserMessageId }, 'error');
      }
      if (responseChatId) {
        if (streamVersion === streamVersionRef.current) streamChatIdRef.current = responseChatId;
        reloadChats().catch(() => {});
      }
      if (error.name !== 'AbortError' && !responseUserMessageId && userTempId && streamVersion === streamVersionRef.current) {
        setMessages((current) => current.filter((message) => message._id !== userTempId && message._id !== assistantTempId));
        setDraft(content);
      }
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
      setStreaming(false);
    }
  }

  function stopStreaming() {
    abortControllerRef.current?.abort();
  }

  function onComposerKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  function onStageScroll() {
    const stage = stageRef.current;
    if (!stage) return;
    nearBottomRef.current = stage.scrollHeight - stage.scrollTop - stage.clientHeight < 110;
    if (nearBottomRef.current) setShowJump(false);
    else if (messages.length) setShowJump(true);
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
        <button className="new-chat-button" onClick={beginNewChat}><span aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false"><path d="M8 3v10M3 8h10" /></svg></span> New chat</button>
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
          <button className="sidebar-toggle" aria-label="Open chat history" onClick={() => setSidebarOpen(true)}><svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M3 5h14M3 10h14M3 15h14" /></svg></button>
          <div className="topbar-title">{activeChat?.title ?? (streamTitle || 'New conversation')}</div>
          <div className="connection-status"><span />Saved to your history</div>
        </header>
        <div ref={stageRef} onScroll={onStageScroll} className={`conversation-stage${messages.length ? ' conversation-stage-has-messages' : ''}`}>
          {chatError && <div className="chat-alert" role="alert">{chatError}<button onClick={() => setChatError('')} aria-label="Dismiss">×</button></div>}
          {!chatId && messages.length === 0 && <div className="conversation-empty">
            <div className="empty-mark"><span>T</span><i /><b /></div>
            <p className="empty-eyebrow">A CLEAR SPACE TO THINK</p>
            <h1>Where should we<br /><span>start?</span></h1>
            <p className="empty-copy">Choose a conversation from your history, or start a fresh chat. New conversations are saved when you send your first message.</p>
          </div>}
          {chatId && loadingMessages && messages.length === 0 && <div className="messages-loading" aria-live="polite"><span className="loading-mark" />Loading conversation…</div>}
          {chatId && !loadingMessages && messages.length === 0 && !chatError && <div className="conversation-empty conversation-empty-small">
            <div className="empty-mark"><span>T</span><i /><b /></div>
            <h1>This conversation is<br /><span>just beginning.</span></h1>
          </div>}
          {messages.length > 0 && <div className="message-history" aria-live="polite" aria-relevant="additions text">
            {messages.map((message) => <article className={`history-message message-${message.role}`} key={message._id}>
              <div className="message-avatar">{message.role === 'user' ? user?.email?.slice(0, 1).toUpperCase() : 'T'}</div>
              <div className="message-body">
                <div className="message-author">{message.role === 'user' ? 'You' : 'TDK AI'}{message.status === 'stopped' && <span className="message-status">Stopped</span>}{message.status === 'error' && <span className="message-status message-status-error">Could not finish</span>}</div>
                {message.role === 'assistant' && (message.thinking || message.status === 'streaming') && <div className={`thinking-card${thinkingOpen && message.status === 'streaming' ? ' thinking-card-open' : ''}`}>
                  {thoughtDuration !== null || message.status !== 'streaming'
                    ? <button className="thinking-summary" onClick={() => setThinkingOpen((open) => !open)} aria-expanded={thinkingOpen}>{message.status === 'streaming' ? `Thought for ${thoughtDuration.toFixed(1)} s` : message.thinkingDuration !== null && message.thinkingDuration !== undefined ? `Thought for ${message.thinkingDuration.toFixed(1)} s` : 'Thought process'}<span>{thinkingOpen ? '⌃' : '⌄'}</span></button>
                    : <div className="thinking-live"><span className="thinking-pulse" />Thinking for {thinkingElapsed.toFixed(1)} s</div>}
                  {thinkingOpen && <div className="thinking-text">{message.thinking || 'Considering the request…'}</div>}
                </div>}
                {message.content && <Suspense fallback={<div className="markdown-content">{message.content}</div>}><MarkdownMessage content={message.content} /></Suspense>}
                {message.status === 'error' && message.retryUserMessageId && <button className="retry-button" onClick={() => sendMessage('', message.retryUserMessageId)}>↻ Retry response</button>}
              </div>
            </article>)}
          </div>}
          {showJump && <button className="jump-latest-button" onClick={() => { nearBottomRef.current = true; const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'; stageRef.current?.scrollTo({ top: stageRef.current.scrollHeight, behavior }); setShowJump(false); }}>↓ Jump to latest</button>}
        </div>
        <form className="composer-shell" onSubmit={(event) => { event.preventDefault(); sendMessage(); }}>
          <div className="composer-box">
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onComposerKeyDown} maxLength={8000} rows={1} disabled={streaming} placeholder="Message TDK AI…" aria-label="Message TDK AI" />
            {streaming
              ? <button type="button" className="stop-button" onClick={stopStreaming} aria-label="Stop response"><svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><rect x="2" y="2" width="8" height="8" rx="1.5" /></svg>Stop</button>
              : <button type="submit" className="send-button" disabled={!draft.trim()} aria-label="Send message"><svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M10 16V4m-5 5 5-5 5 5" /></svg></button>}
          </div>
          <div className="composer-hint">Enter to send <span>·</span> Shift + Enter for a new line <span>·</span> {draft.length}/8,000</div>
        </form>
        <footer className="chat-footer-note">Thoughtful conversations, right where you left them.</footer>
      </section>
    </main>
  );
}
