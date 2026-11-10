function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

export async function* streamChat(messages, { signal } = {}) {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
  const thoughts = ['Let me understand the request.', 'I’ll organize the key points into a useful answer.'];

  for (const text of thoughts) {
    await wait(45, signal);
    yield { type: 'thinking', text };
  }

  const codeExample = /\b(code|snippet)\b/i.test(latestUserMessage)
    ? '\n\n```js\nconsole.log("Hello, TDK AI!");\n```'
    : '';
  const answer = `Here is a useful starting point for: ${latestUserMessage}${codeExample}`;
  for (const word of answer.match(/\S+\s*/g) ?? []) {
    await wait(35, signal);
    yield { type: 'token', text: word };
  }
}
