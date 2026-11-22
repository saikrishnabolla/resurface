import { useEffect, useRef } from 'react';

const themeTokens = ['surface', 'ink', 'muted', 'rule', 'accent'];

export function DemoReels() {
  const observer = useRef(null);
  useEffect(() => () => observer.current?.disconnect(), []);

  function fit(event) {
    observer.current?.disconnect();
    const frame = event.currentTarget;
    const root = frame.contentDocument?.documentElement;
    if (!root) return;
    const theme = getComputedStyle(frame);
    for (const token of themeTokens) {
      root.style.setProperty(`--app-${token}`, theme.getPropertyValue(`--${token}`));
    }
    const content = frame.contentDocument?.querySelector('.wrap');
    if (!content) return;
    const resize = () => { frame.style.height = `${Math.ceil(content.getBoundingClientRect().height)}px`; };
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver(resize);
    observer.current.observe(content);
  }

  return <iframe title="Demo reels" src="/demo/jahbari/variations/index.html?reels"
    className="block w-full border-0" style={{ height: '1600px' }} onLoad={fit} />;
}

export default DemoReels;
