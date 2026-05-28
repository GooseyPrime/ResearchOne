/**
 * R1Shell - Global layout wrapper for ResearchOne
 * Provides consistent chrome, grain texture, and page structure
 */

import { type ReactNode } from 'react';
import { R1TopRail } from './R1TopRail';
import { R1Footer } from './R1Footer';

interface R1ShellProps {
  children: ReactNode;
  variant?: 'public' | 'app';
  showFooter?: boolean;
}

export function R1Shell({ children, variant = 'public', showFooter = true }: R1ShellProps) {
  return (
    <div data-ev-id="ev_3ebe6bdf0c" className="min-h-screen bg-r1-canvas text-r1-text relative">
      {/* Grain overlay for texture */}
      <div data-ev-id="ev_380bbac552" className="fixed inset-0 pointer-events-none z-0 r1-grain" aria-hidden="true" />
      
      {/* Skip to main content link for accessibility */}
      <a data-ev-id="ev_e7941af1bf"
      href="#main-content"
      className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-r1-cyan focus:text-r1-canvas focus:rounded focus:outline-none">

        Skip to main content
      </a>
      
      {/* Navigation */}
      <R1TopRail variant={variant} />
      
      {/* Main content */}
      <main data-ev-id="ev_78e7af17dd" id="main-content" className="relative z-10">
        {children}
      </main>
      
      {/* Footer */}
      {showFooter && <R1Footer />}
    </div>);

}

export default R1Shell;