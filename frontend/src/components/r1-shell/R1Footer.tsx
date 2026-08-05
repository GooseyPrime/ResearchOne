/**
 * R1Footer - Global footer for ResearchOne
 * Runtime topology info and navigation links
 */

import { Link } from 'react-router-dom';
import { footerNavSections, runtimeTopology } from '@/content/researchoneUiData';

export function R1Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer data-ev-id="ev_90e499f7c1" className="relative z-10 border-t border-r1-border bg-r1-canvas-deep">
      <div data-ev-id="ev_6c209b8f34" className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        {/* Main footer content */}
        <div data-ev-id="ev_98fe994910" className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-8 lg:gap-12">
          {/* Brand column */}
          <div data-ev-id="ev_e48b5e7d55" className="col-span-2 md:col-span-4 lg:col-span-2">
            <Link to="/" className="inline-flex items-center gap-3 group">
              <div data-ev-id="ev_81d4247365" className="relative w-7 h-7">
                <svg data-ev-id="ev_728725a670" viewBox="0 0 32 32" fill="none" className="w-full h-full">
                  <rect data-ev-id="ev_c214b1d082" x="2" y="8" width="28" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" className="text-r1-border-strong" />
                  <circle data-ev-id="ev_3f0e72cc65" cx="10" cy="16" r="3" className="fill-r1-cyan" />
                  <circle data-ev-id="ev_9431a2849d" cx="22" cy="16" r="3" className="fill-r1-amber" />
                  <line data-ev-id="ev_ce7cfba36b" x1="13" y1="16" x2="19" y2="16" stroke="currentColor" strokeWidth="1.5" className="text-r1-muted" />
                </svg>
              </div>
              <span data-ev-id="ev_f53e1b3104" className="text-r1-heading font-semibold tracking-tight">
                ResearchOne
              </span>
            </Link>
            <p data-ev-id="ev_c64a04d348" style={{ display: 'block', width: '100%' }} className="mt-4 text-sm text-r1-muted leading-relaxed">
              Multi-agent deep research platform. Citation-backed dossiers with optional challenge review.
            </p>
            
            {/* Runtime topology mini */}
            <div data-ev-id="ev_c138c43eca" className="mt-6 flex flex-wrap gap-2">
              {runtimeTopology.slice(0, 3).map((node) =>
              <span data-ev-id="ev_4244709bcd" key={node.layer} className="r1-tag text-[9px]">
                  {node.layer}
                </span>
              )}
            </div>
          </div>

          {/* Nav columns */}
          {footerNavSections.map((section) =>
          <div data-ev-id="ev_f6a592f828" key={section.title}>
              <h3 data-ev-id="ev_93f5b84f2f" className="r1-mono-label text-r1-dim mb-4">
                {section.title}
              </h3>
              <ul data-ev-id="ev_5047deba84" className="flex flex-col gap-2.5">
                {section.links.map((link) =>
              <li data-ev-id="ev_658cce7cbd" key={link.href}>
                    <Link
                  to={link.href}
                  className="text-sm text-r1-muted hover:text-r1-text transition-colors duration-150">

                      {link.label}
                    </Link>
                  </li>
              )}
              </ul>
            </div>
          )}
        </div>

        {/* Bottom bar */}
        <div data-ev-id="ev_33df4471ac" className="mt-12 pt-8 border-t border-r1-border flex flex-col sm:flex-row items-center justify-between gap-4">
          <div data-ev-id="ev_c322eb57b1" className="flex items-center gap-4 text-xs text-r1-dim">
            <span data-ev-id="ev_6c622ca8c0">© {currentYear} ResearchOne</span>
            <span data-ev-id="ev_2c3dfcd669" className="hidden sm:inline">·</span>
            <Link to="/privacy" className="hover:text-r1-muted transition-colors">Privacy</Link>
            <Link to="/terms" className="hover:text-r1-muted transition-colors">Terms</Link>
          </div>
          
          {/* System status */}
          <div data-ev-id="ev_d8dcb4c3ea" className="flex items-center gap-3">
            <div data-ev-id="ev_88168c5402" className="flex items-center gap-1.5 r1-mono-label text-[9px]">
              <span data-ev-id="ev_e35d09e109" className="w-1.5 h-1.5 rounded-full bg-r1-green" />
              ALL SYSTEMS OPERATIONAL
            </div>
          </div>
        </div>
      </div>
    </footer>);

}

export default R1Footer;