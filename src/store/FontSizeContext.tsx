import React, { createContext, useContext, useState, useEffect } from 'react';

type FontSize = 'normal' | 'large' | 'xlarge';

interface FontSizeContextType {
  fontSize: FontSize;
  setFontSize: (size: FontSize) => void;
  highContrast: boolean;
  setHighContrast: (on: boolean) => void;
}

const FontSizeContext = createContext<FontSizeContextType | undefined>(undefined);

export function FontSizeProvider({ children }: { children: React.ReactNode }) {
  const [fontSize, setFontSizeState] = useState<FontSize>(() => {
    return (localStorage.getItem('fontSize') as FontSize) || 'normal';
  });
  const [highContrast, setHighContrastState] = useState(() => localStorage.getItem('highContrast') === 'true');

  useEffect(() => {
    document.documentElement.classList.remove('text-size-normal', 'text-size-large', 'text-size-xlarge');
    document.documentElement.classList.add(`text-size-${fontSize}`);
  }, [fontSize]);

  useEffect(() => {
    document.documentElement.classList.toggle('high-contrast', highContrast);
  }, [highContrast]);

  const setFontSize = (size: FontSize) => {
    localStorage.setItem('fontSize', size);
    setFontSizeState(size);
  };

  const setHighContrast = (on: boolean) => {
    localStorage.setItem('highContrast', String(on));
    setHighContrastState(on);
  };

  return (
    <FontSizeContext.Provider value={{ fontSize, setFontSize, highContrast, setHighContrast }}>
      {children}
    </FontSizeContext.Provider>
  );
}

export function useFontSize() {
  const context = useContext(FontSizeContext);
  if (context === undefined) {
    throw new Error('useFontSize must be used within a FontSizeProvider');
  }
  return context;
}
