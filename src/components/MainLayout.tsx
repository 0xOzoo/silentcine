import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Header from './Header';
import LegalFooter from './LegalFooter';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Shared layout wrapper. Renders Header + child route via <Outlet /> + Footer.
 *
 * Enterprise white-label: if profile has custom_branding_url,
 * loads an external CSS stylesheet and hides SilentCine branding.
 */
const MainLayout = () => {
  const { profile } = useAuth();

  const isWhiteLabel =
    profile?.subscription_tier === 'enterprise' && !!profile?.custom_branding_url;

  // Load custom CSS for enterprise white-label
  useEffect(() => {
    if (!isWhiteLabel || !profile?.custom_branding_url) return;

    const linkId = 'enterprise-custom-css';
    let link = document.getElementById(linkId) as HTMLLinkElement | null;

    if (!link) {
      link = document.createElement('link');
      link.id = linkId;
      link.rel = 'stylesheet';
      link.type = 'text/css';
      document.head.appendChild(link);
    }

    link.href = profile.custom_branding_url;

    return () => {
      link?.remove();
    };
  }, [isWhiteLabel, profile?.custom_branding_url]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {!isWhiteLabel && <Header />}
      <main className="flex-1">
        <Outlet />
      </main>
      {/* Hide SilentCine footer branding for enterprise white-label */}
      {!isWhiteLabel && <LegalFooter />}
    </div>
  );
};

export default MainLayout;
