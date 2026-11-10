export async function* streamChat(messages, options = {}) {
  const providerName = process.env.LLM_PROVIDER || 'mock';
  if (providerName !== 'mock') {
    throw new Error(`LLM provider "${providerName}" is not available yet`);
  }
  const provider = await import('./mock.js');
  yield* provider.streamChat(messages, options);
}
