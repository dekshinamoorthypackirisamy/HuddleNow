import { useEffect, useState } from 'react';

export default function useTimeTheme() {
  const [theme, setTheme] = useState('dark');

  useEffect(() => {
    const updateTheme = () => {
      const hour = new Date().getHours();
      setTheme(hour >= 6 && hour < 18 ? 'light' : 'dark');
    };

    updateTheme();
    const interval = window.setInterval(updateTheme, 60000);
    return () => window.clearInterval(interval);
  }, []);

  return theme;
}
