import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate, useSearchParams } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import ScrollToTop from './components/ScrollToTop';

// Auth pages
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';

// Public pages
import Landing from '@/pages/Landing';
import PublicSharedView from '@/pages/PublicSharedView';

// App pages
import Dashboard from '@/pages/Dashboard';
import Trades from '@/pages/Trades';
import Analytics from '@/pages/Analytics';
import ProfitCalendar from '@/pages/ProfitCalendar';
import Strategies from '@/pages/Strategies';
import Accounts from '@/pages/Accounts';
import SharePerformance from '@/pages/SharePerformance';
import Settings from '@/pages/Settings';
import Timeline from '@/pages/Timeline';

// Layout
import AppLayout from '@/components/layout/AppLayout';

/**
 * Renders the landing page, but bypasses the auth redirect when
 * the ?preview=1 query param is present.  This lets logged-in users
 * view the landing page from the sidebar link without creating a
 * duplicate /landing route.
 */
const LandingRoute = ({ isAuthenticated }) => {
  const [searchParams] = useSearchParams();
  const preview = searchParams.get('preview') === '1';
  if (isAuthenticated && !preview) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Landing />;
};

const AuthenticatedApp = () => {
  const { isLoadingAuth, authChecked, isAuthenticated } = useAuth();

  // Show spinner only for protected routes while auth is resolving.
  // Public routes (Landing, login, register, etc.) render immediately.
  if (isLoadingAuth || !authChecked) {
    return (
      <Routes>
        {/* Always-public routes — render without waiting for auth */}
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/p/:slug" element={<PublicSharedView />} />
        {/* Everything else shows a spinner while auth resolves */}
        <Route path="*" element={
          <div className="dark fixed inset-0 flex items-center justify-center bg-background">
            <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin"></div>
          </div>
        } />
      </Routes>
    );
  }

  return (
    <Routes>
      {/* Landing page — authenticated users are redirected to /dashboard
          unless ?preview=1 is present in the URL. */}
      <Route path="/" element={<LandingRoute isAuthenticated={isAuthenticated} />} />
      <Route path="/p/:slug" element={<PublicSharedView />} />

      {/* Auth pages — redirect already-authenticated users to /dashboard */}
      <Route path="/login" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/register" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* Protected app routes */}
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/trades" element={<Trades />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/calendar" element={<ProfitCalendar />} />
          <Route path="/strategies" element={<Strategies />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/share" element={<SharePerformance />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/timeline" element={<Timeline />} />
        </Route>
      </Route>

      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
