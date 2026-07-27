import { lazy, Suspense, useEffect } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import PageTransition from './components/PageTransition';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Admin from './pages/Admin';
import WordleLoader from './components/WordleLoader';
import { legacyWorldDestination, parseWorldPath, worldTransitionKey } from '@/lib/world-routes';

const PromoCapture = lazy(() => import('./pages/PromoCapture'));

const RootRedirect = () => {
  const location = useLocation();
  return <Navigate to={legacyWorldDestination(location.search)} replace />;
};

const WorldRoute = () => {
  const location = useLocation();
  const route = parseWorldPath(location.pathname);
  if (!route) return <PageNotFound />;
  if (location.pathname !== route.path) return <Navigate to={route.path} replace />;
  return <PageTransition><Home /></PageTransition>;
};

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError } = useAuth();
  const location = useLocation();

  // Show the game loader while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return <WordleLoader />;
  }

  // Authentication is optional for Wordle Daily. Guests keep local progress.
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    }
  }

  // Render the main app
  return (
    <AnimatePresence mode="wait" initial={false}>
      <Routes location={location} key={worldTransitionKey(location.pathname)}>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/play/:mode" element={<WorldRoute />} />
        <Route path="/player/:panel" element={<WorldRoute />} />
        <Route path="/login" element={<PageTransition><Login /></PageTransition>} />
        <Route path="/register" element={<PageTransition><Register /></PageTransition>} />
        <Route path="/forgot-password" element={<PageTransition><ForgotPassword /></PageTransition>} />
        <Route path="/reset-password" element={<PageTransition><ResetPassword /></PageTransition>} />
        <Route path="/admin" element={<PageTransition><Admin /></PageTransition>} />
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    </AnimatePresence>
  );
};

const AppContent = () => {
  const location = useLocation();

  // Intentionally unlinked and isolated from auth: a promotional capture workspace.
  if (location.pathname === '/promo-capture') {
    return <Suspense fallback={null}><PromoCapture /></Suspense>;
  }

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <ScrollToTop />
        <AuthenticatedApp />
      </QueryClientProvider>
      <Toaster />
    </AuthProvider>
  );
};


function App() {
  useEffect(() => {
    const preventContextMenu = (event) => event.preventDefault();
    document.addEventListener('contextmenu', preventContextMenu, true);
    return () => document.removeEventListener('contextmenu', preventContextMenu, true);
  }, []);

  return (
    <Router>
      <AppContent />
    </Router>
  )
}

export default App
