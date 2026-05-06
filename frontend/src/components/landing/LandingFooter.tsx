import { Link } from 'react-router-dom';

export default function LandingFooter() {
  return (
    <footer className="border-t border-white/10 bg-r1-bg-deep">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm text-r1-text-muted sm:grid-cols-2 md:grid-cols-4 sm:px-6">
        <div>
          <h3 className="mb-3 font-semibold text-r1-text">Product</h3>
          <ul className="space-y-2">
            <li><Link to="/pricing">Pricing</Link></li>
            <li><Link to="/methodology">Modes</Link></li>
            <li><Link to="/sovereign">Sovereign</Link></li>
            <li><Link to="/byok">BYOK</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="mb-3 font-semibold text-r1-text">Methodology</h3>
          <ul className="space-y-2">
            <li><Link to="/methodology">How it works</Link></li>
            <li><Link to="/methodology">Pipeline</Link></li>
            <li><Link to="/methodology">Revision workflow</Link></li>
            <li><Link to="/security">Security</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="mb-3 font-semibold text-r1-text">Company</h3>
          <ul className="space-y-2">
            <li>About</li>
            <li>Contact</li>
            <li>Status</li>
            <li>Changelog</li>
          </ul>
        </div>
        <div>
          <h3 className="mb-3 font-semibold text-r1-text">Legal</h3>
          <ul className="space-y-2">
            <li><Link to="/terms">Terms of service</Link></li>
            <li><Link to="/privacy">Privacy policy</Link></li>
            <li><Link to="/acceptable-use">Acceptable use</Link></li>
            <li>Cookies</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10 px-4 py-4 text-center text-xs text-r1-text-muted">
        ResearchOne is a research platform. It is not a substitute for legal, medical, or financial advice.
      </div>
    </footer>
  );
}
