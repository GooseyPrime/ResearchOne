/**
 * R1TopRail - Global navigation header for ResearchOne
 * Refined technical aesthetic with hairline borders and precision typography
 */

import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, ChevronRight, MessageSquare } from 'lucide-react';
import { publicNavLinks, appNavLinks } from '@/content/researchoneUiData';
import { FeedbackModal } from './FeedbackModal';

interface R1TopRailProps {
  variant?: 'public' | 'app';
}

export function R1TopRail({ variant = 'public' }: R1TopRailProps) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const location = useLocation();

  const navLinks = variant === 'app' ? appNavLinks : publicNavLinks;

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  return (
    <>
      <header data-ev-id="ev_fce432e464"
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-250 ${
      isScrolled ?
      'bg-r1-canvas/95 backdrop-blur-sm border-b border-r1-border' :
      'bg-transparent border-b border-transparent'}`
      }
      style={{ transitionTimingFunction: 'cubic-bezier(0.25, 1, 0.5, 1)' }}>

        <div data-ev-id="ev_57ccb8eadf" className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <div data-ev-id="ev_4d05c5b7e2" className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link
              to="/"
              className="flex items-center gap-3 group r1-focus-ring rounded">

              <div data-ev-id="ev_0df0dbb5af" className="relative w-8 h-8">
                {/* Logo mark — Contradiction Ring (Option 3): rounded hexagon with dual parallel Möbius strokes */}
                <svg data-ev-id="ev_53eb1ef1bb" viewBox="0 0 32 32" fill="none" role="img" aria-label="ResearchOne Contradiction Ring logo" className="w-full h-full">
                  {/* Rounded hexagon outline */}
                  <path
                    d="M16 2 L27 8.5 L27 23.5 L16 30 L5 23.5 L5 8.5 Z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                    className="text-r1-border-strong"
                    fill="none"
                  />
                  {/* Upper parallel stroke — one side of the Möbius loop */}
                  <path
                    d="M10 13 C12.5 9.75 15 9.75 16 16 C17 22.25 19.5 22.25 22 19"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    fill="none"
                    className="text-r1-cyan"
                  />
                  {/* Lower parallel stroke — bridging anomaly/consensus (crosses upper at midpoint) */}
                  <path
                    d="M10 19 C12.5 22.25 15 22.25 16 16 C17 9.75 19.5 9.75 22 13"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    fill="none"
                    className="text-r1-amber"
                  />
                </svg>
              </div>
              <span data-ev-id="ev_1c62c7b621" className="text-r1-heading font-semibold tracking-tight text-lg">
                ResearchOne
              </span>
              {/* Status indicator */}
              <span data-ev-id="ev_3ab8fe8656" className="hidden sm:flex items-center gap-1.5 ml-2 r1-mono-label text-[9px]">
                <span data-ev-id="ev_f54a4f1476" className="w-1.5 h-1.5 rounded-full bg-r1-green animate-pulse" />
                ONLINE
              </span>
            </Link>

            {/* Desktop Navigation */}
            <nav data-ev-id="ev_a4f8661ea3" className="hidden lg:flex items-center gap-1" aria-label="Main navigation">
              {navLinks.map((link) => {
                const isActive = location.pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    to={link.href}
                    className={`px-3 py-2 text-sm font-medium rounded transition-colors duration-150 r1-focus-ring ${
                    isActive ?
                    'text-r1-cyan' :
                    'text-r1-muted hover:text-r1-text'}`
                    }>

                    {link.label}
                  </Link>);

              })}
            </nav>

            {/* Right side actions */}
            <div data-ev-id="ev_452bac6fe6" className="flex items-center gap-3">
              {/* Help & Feedback button for app variant */}
              {variant === 'app' &&
              <button data-ev-id="ev_f2fe12dc00"
              onClick={() => setIsFeedbackOpen(true)}
              className="hidden sm:flex items-center gap-2 px-3 py-2 text-sm font-medium text-r1-muted hover:text-r1-text transition-colors duration-150 r1-focus-ring rounded"
              aria-label="Help and Feedback">

                  <MessageSquare className="w-4 h-4" />
                  <span data-ev-id="ev_4bf24a3406" className="hidden md:inline">Feedback</span>
                </button>
              }

              {variant === 'public' ? (
              <>
                  <Link
                  to="/sign-in"
                  className="hidden sm:block px-3 py-2 text-sm font-medium text-r1-muted hover:text-r1-text transition-colors duration-150 r1-focus-ring rounded">

                    Sign In
                  </Link>
                  <Link
                  to="/sign-up"
                  className="hidden sm:flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-r1-cyan text-r1-canvas rounded hover:bg-r1-cyan/90 transition-colors duration-150 r1-focus-ring">

                    Start Research
                    <ChevronRight className="w-4 h-4" />
                  </Link>
                </> ) : (
              <Link
                to="/sign-in"
                className="hidden sm:block px-3 py-2 text-sm font-medium text-r1-muted hover:text-r1-text transition-colors duration-150 r1-focus-ring rounded"
              >
                Account
              </Link>
              )}

              {/* Mobile menu button */}
              <button data-ev-id="ev_3b4e502093"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="lg:hidden p-2 text-r1-muted hover:text-r1-text transition-colors r1-focus-ring rounded"
              aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={isMobileMenuOpen}>

                {isMobileMenuOpen ?
                <X className="w-5 h-5" /> :

                <Menu className="w-5 h-5" />
                }
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen &&
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-40 lg:hidden">

            {/* Backdrop */}
            <div data-ev-id="ev_85a72dedf6"
          className="absolute inset-0 bg-r1-canvas-deep/80 backdrop-blur-sm"
          onClick={() => setIsMobileMenuOpen(false)} />

            
            {/* Menu panel */}
            <motion.nav
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.25, ease: [0.25, 1, 0.5, 1] }}
            className="absolute right-0 top-0 bottom-0 w-72 bg-r1-panel border-l border-r1-border p-6 pt-20"
            aria-label="Mobile navigation">

              <div data-ev-id="ev_eff68d6f1f" className="flex flex-col gap-2">
                {navLinks.map((link) => {
                const isActive = location.pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    to={link.href}
                    className={`px-4 py-3 text-base font-medium rounded transition-colors r1-focus-ring ${
                    isActive ?
                    'text-r1-cyan bg-r1-panel-lift' :
                    'text-r1-text hover:bg-r1-panel-lift'}`
                    }>

                      {link.label}
                    </Link>);

              })}
                
                <div data-ev-id="ev_cda5380d4f" className="h-px bg-r1-border my-4" />
                
                {variant === 'public' ?
              <>
                    <Link
                  to="/sign-in"
                  className="px-4 py-3 text-base font-medium text-r1-muted hover:text-r1-text transition-colors r1-focus-ring rounded">

                      Sign In
                    </Link>
                    <Link
                  to="/sign-up"
                  className="flex items-center justify-center gap-2 px-4 py-3 text-base font-semibold bg-r1-cyan text-r1-canvas rounded hover:bg-r1-cyan/90 transition-colors r1-focus-ring mt-2">

                      Start Research
                      <ChevronRight className="w-4 h-4" />
                    </Link>
                  </> :

              <>
                <button data-ev-id="ev_6c37f44924"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  setIsFeedbackOpen(true);
                }}
                className="flex items-center gap-3 px-4 py-3 text-base font-medium text-r1-muted hover:text-r1-text transition-colors r1-focus-ring rounded w-full text-left">

                  <MessageSquare className="w-5 h-5" />
                  Help & Feedback
                </button>
                <Link
                  to="/"
                  className="px-4 py-3 text-base font-medium text-r1-muted hover:text-r1-text transition-colors r1-focus-ring rounded">

                  Logout
                </Link>
              </>
              }
              </div>
            </motion.nav>
          </motion.div>
        }
      </AnimatePresence>

      {/* Feedback Modal */}
      <FeedbackModal isOpen={isFeedbackOpen} onClose={() => setIsFeedbackOpen(false)} />
    </>);

}

export default R1TopRail;