import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogIn, LogOut, User, Settings, CreditCard, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import TierBadge from './TierBadge';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const Header = () => {
  const { isAuthenticated, user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const handleSignOut = async () => {
    setOpen(false);
    await signOut();
    navigate('/');
    toast.success('Signed out');
  };

  const displayName =
    profile?.display_name || user?.email?.split('@')[0] || 'User';
  const tier = profile?.subscription_tier ?? 'free';

  return (
    <header className="border-b border-border/40 bg-background/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="container max-w-6xl mx-auto flex items-center justify-between h-14 px-4">
        {/* Logo / Home */}
        <Link to="/" className="font-display font-bold text-lg tracking-tight hover:opacity-80 transition-opacity">
          SilentCine
        </Link>

        {/* Right side */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
            <Link to="/pricing">Pricing</Link>
          </Button>

          {isAuthenticated ? (
            <DropdownMenu open={open} onOpenChange={setOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2">
                  <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium text-primary">
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                  <span className="hidden sm:inline text-sm max-w-[120px] truncate">
                    {displayName}
                  </span>
                  {profile && <TierBadge tier={tier} showIcon={false} className="hidden sm:inline-flex" />}
                  <ChevronDown className="w-3 h-3 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <div className="px-2 py-1.5">
                  <p className="text-sm font-medium truncate">{displayName}</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/dashboard" className="cursor-pointer" onClick={() => setOpen(false)}>
                    <User className="w-4 h-4 mr-2" />
                    Dashboard
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/pricing" className="cursor-pointer" onClick={() => setOpen(false)}>
                    <CreditCard className="w-4 h-4 mr-2" />
                    Plans
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer text-destructive focus:text-destructive">
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" asChild>
                <Link to="/login">
                  <LogIn className="w-4 h-4 mr-1.5" />
                  Sign In
                </Link>
              </Button>
              <Button size="sm" asChild className="hidden sm:inline-flex">
                <Link to="/signup">Sign Up</Link>
              </Button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
