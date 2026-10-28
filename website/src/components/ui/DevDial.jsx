import { useEffect } from 'react';
import { DialRoot, useDialKit } from 'dialkit';
import 'dialkit/styles.css';

export default function DevDial() {
  const d = useDialKit('Motion tokens', {
    'duration-quick': [150, 0, 600, 10],
    'duration-fast': [250, 0, 800, 10],
    'duration-medium': [350, 0, 1000, 10],
    'duration-slow': [400, 0, 1200, 10],
    'blur-small': [2, 0, 10, 1],
    'blur-medium': [3, 0, 12, 1],
    'distance-base': [8, 0, 40, 1],
  });

  useEffect(() => {
    const s = document.documentElement.style;
    s.setProperty('--duration-quick', d['duration-quick'] + 'ms');
    s.setProperty('--duration-fast', d['duration-fast'] + 'ms');
    s.setProperty('--duration-medium', d['duration-medium'] + 'ms');
    s.setProperty('--duration-slow', d['duration-slow'] + 'ms');
    s.setProperty('--blur-small', d['blur-small'] + 'px');
    s.setProperty('--blur-medium', d['blur-medium'] + 'px');
    s.setProperty('--distance-base', d['distance-base'] + 'px');
  }, [d]);

  return <DialRoot position="bottom-right" theme="dark" />;
}
