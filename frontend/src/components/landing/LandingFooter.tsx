import { Link } from 'react-router-dom';
import { MARKETING_FOOTER_LINKS } from '../../lib/marketingNav';

export default function LandingFooter() {
  return (
    <footer className="border-t border-white/10 bg-r1-bg-deep">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="mb-8 border-b border-white/10 pb-8">
          <p className="font-serif text-lg text-r1-text">ResearchOne</p>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-r1-text-muted">
            We do not sanitize. We do not debunk by recall. We do not silently smooth contradictions.
          </p>
        </div>
        <div className="grid gap-8 text-sm text-r1-text-muted sm:grid-cols-2 md:grid-cols-5">
          <div>
            <h3 className="mb-3 font-semibold text-r1-text">Product</h3>
            <ul className="space-y-2">
              {MARKETING_FOOTER_LINKS.product.map((item) => (
                <li key={item.to}>
                  <Link to={item.to} className="hover:text-r1-text hover:underline">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-3 font-semibold text-r1-text">Methodology</h3>
            <ul className="space-y-2">
              {MARKETING_FOOTER_LINKS.methodology.map((item) => (
                <li key={item.to}>
                  <Link to={item.to} className="hover:text-r1-text hover:underline">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-3 font-semibold text-r1-text">Trust</h3>
            <ul className="space-y-2">
              {MARKETING_FOOTER_LINKS.trust.map((item) => (
                <li key={item.to}>
                  <Link to={item.to} className="hover:text-r1-text hover:underline">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-3 font-semibold text-r1-text">Company</h3>
            <ul className="space-y-2">
              {MARKETING_FOOTER_LINKS.company.map((item) => (
                <li key={item.to}>
                  <Link to={item.to} className="hover:text-r1-text hover:underline">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-3 font-semibold text-r1-text">Legal</h3>
            <ul className="space-y-2">
              {MARKETING_FOOTER_LINKS.legal.map((item) => (
                <li key={item.to}>
                  <Link to={item.to} className="hover:text-r1-text hover:underline">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <div className="border-t border-white/10 px-4 py-4 text-center text-xs text-r1-text-muted">
        ResearchOne is a research platform. It is not a substitute for legal, medical, or financial advice.
      </div>
    </footer>
  );
}
