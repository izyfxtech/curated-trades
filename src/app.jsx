import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
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

const AuthenticatedApp = () => {
  const { isLoadingAuth, authChecked } = useAuth();

  if (isLoadingAuth || !authChecked) {
    return (
      <div className="dark fixed inset-0 flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/welcome" element={<Landing />} />
      <Route path="/p/:slug" element={<PublicSharedView />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
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
