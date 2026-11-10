import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';

function getText(node) {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(getText).join('');
  if (node?.props?.children) return getText(node.props.children);
  return '';
}

function CodeBlock({ children, node: _node, ...props }) {
  const [copied, setCopied] = useState(false);
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(getText(children));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1300);
    } catch {
      setCopied(false);
    }
  }
  return <div className="code-frame"><div className="code-toolbar"><span>CODE</span><button onClick={copyCode}>{copied ? 'Copied' : 'Copy'}</button></div><pre {...props}>{children}</pre></div>;
}

const MarkdownMessage = memo(function MarkdownMessage({ content }) {
  return <div className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{ pre: CodeBlock }}>{content}</ReactMarkdown></div>;
});

export default MarkdownMessage;
