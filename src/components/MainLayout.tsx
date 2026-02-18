import { Outlet } from 'react-router-dom';
import LegalFooter from './LegalFooter';

/**
 * Shared layout wrapper. Renders child route via <Outlet />,
 * with a persistent footer on all pages.
 */
const MainLayout = () => (
  <div className="min-h-screen bg-background flex flex-col">
    <main className="flex-1">
      <Outlet />
    </main>
    <LegalFooter />
  </div>
);

export default MainLayout;
