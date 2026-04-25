'use client';

import { useEffect } from 'react';
import { initSettingsFromStorage } from '@/lib/settings-store';

/**
 * Call once on app mount to apply persisted font settings from localStorage
 * to CSS custom properties on <html>.
 */
export function SettingsInitializer() {
  useEffect(() => {
    initSettingsFromStorage();
  }, []);

  return null;
}
