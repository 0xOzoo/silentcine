import { Link } from 'react-router-dom';

const LegalFooter = () => (
  <footer className="w-full border-t border-border bg-background/80 backdrop-blur-sm py-4 px-6">
    <div className="container max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>&copy; {new Date().getFullYear()} SilentCine. All rights reserved.</span>
      <nav className="flex items-center gap-4">
        <Link to="/terms" className="hover:text-foreground transition-colors">Terms</Link>
        <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
        <Link to="/dmca" className="hover:text-foreground transition-colors">DMCA</Link>
        <Link to="/refund" className="hover:text-foreground transition-colors">Refund Policy</Link>
      </nav>
    </div>
  </footer>
);

export default LegalFooter;
