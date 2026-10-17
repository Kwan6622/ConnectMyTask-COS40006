import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import './App.css';
import { Header } from './components/layout/Header';
import { Footer } from './components/layout/Footer';
const HomePage = lazy(() => import('./pages/HomePage').then((module) => ({ default: module.HomePage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((module) => ({ default: module.ProfilePage })));
const TaskBrowsePage = lazy(() => import('./pages/TaskBrowsePage').then((module) => ({ default: module.TaskBrowsePage })));
const TaskDetailPage = lazy(() => import('./pages/TaskDetailPage').then((module) => ({ default: module.TaskDetailPage })));
const TaskPostPage = lazy(() => import('./pages/TaskPostPage').then((module) => ({ default: module.TaskPostPage })));
const TrackingPage = lazy(() => import('./pages/TrackingPage').then((module) => ({ default: module.TrackingPage })));
const SavedTasksPage = lazy(() => import('./pages/SavedTasksPage').then((module) => ({ default: module.SavedTasksPage })));
const RequesterDashboardPage = lazy(() => import('./pages/RequesterDashboardPage').then((module) => ({ default: module.RequesterDashboardPage })));
const ProviderDashboardPage = lazy(() => import('./pages/ProviderDashboardPage').then((module) => ({ default: module.ProviderDashboardPage })));
const TaskProgressPage = lazy(() => import('./pages/TaskProgressPage').then((module) => ({ default: module.TaskProgressPage })));
const RegisterPage = lazy(() => import('./pages/Auth/RegisterPage').then((module) => ({ default: module.RegisterPage })));
const AdminDashboard = lazy(() => import('./pages/Admin/Dashboard').then((module) => ({ default: module.AdminDashboard })));
const PrivacyPolicyPage = lazy(() => import('./pages/PrivacyPolicyPage').then((module) => ({ default: module.PrivacyPolicyPage })));
const TermsOfServicePage = lazy(() => import('./pages/TermsOfServicePage').then((module) => ({ default: module.TermsOfServicePage })));
const AboutPage = lazy(() => import('./pages/AboutPage').then((module) => ({ default: module.AboutPage })));
import { ChatWidget } from './components/chat/ChatWidget';
import { useAuthStore } from './stores/auth.store';

function App() {
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const isAuthRoute = location.pathname === '/login' || location.pathname === '/register';

  return (
    <div className="app-container">
      {!isAuthRoute && <Header />}
      <main className="flex-grow">
        <div className="page-content">
          <Suspense fallback={<div aria-live="polite" className="p-6 text-center">Loading...</div>}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/home" element={<HomePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route
              path="/my-tasks"
              element={
                user
                  ? (
                    String(user.role).toUpperCase() === 'PROVIDER'
                      ? <Navigate to="/provider-dashboard" replace />
                      : <Navigate to="/requester-dashboard" replace />
                  )
                  : <Navigate to="/" replace />
              }
            />
            <Route
              path="/profile"
              element={user ? <ProfilePage /> : <Navigate to="/" replace />}
            />
            <Route
              path="/saved-tasks"
              element={user ? <SavedTasksPage /> : <Navigate to="/" replace />}
            />
            <Route path="/browse-tasks" element={<TaskBrowsePage />} />
            <Route path="/tasks" element={<TaskBrowsePage />} />
            <Route path="/tasks/:id" element={<TaskDetailPage />} />
            <Route path="/task/:id" element={<TaskDetailPage />} />
            <Route
              path="/tasks/:id/progress"
              element={user ? <TaskProgressPage /> : <Navigate to="/" replace />}
            />
            <Route
              path="/post-task"
              element={
                user
                  ? (
                    String(user.role).toUpperCase() === 'REQUESTER' || String(user.role).toUpperCase() === 'CLIENT'
                      ? <TaskPostPage />
                      : <Navigate to="/browse-tasks" replace />
                  )
                  : <Navigate to="/" replace />
              }
            />
            <Route
              path="/requester-dashboard"
              element={
                user
                  ? (
                    String(user.role).toUpperCase() === 'REQUESTER' || String(user.role).toUpperCase() === 'CLIENT'
                      ? <RequesterDashboardPage />
                      : <Navigate to="/browse-tasks" replace />
                  )
                  : <Navigate to="/" replace />
              }
            />
            <Route
              path="/provider-dashboard"
              element={
                user
                  ? (
                    String(user.role).toUpperCase() === 'PROVIDER'
                      ? <ProviderDashboardPage />
                      : <Navigate to="/browse-tasks" replace />
                  )
                  : <Navigate to="/" replace />
              }
            />
            <Route
              path="/tracking"
              element={user ? <TrackingPage /> : <Navigate to="/" replace />}
            />
            <Route
              path="/admin"
              element={user ? <AdminDashboard /> : <Navigate to="/" replace />}
            />
            <Route
              path="/about"
              element={<AboutPage />}
            />
            <Route
              path="/privacy-policy"
              element={<PrivacyPolicyPage />}
            />
            <Route
              path="/terms-of-service"
              element={<TermsOfServicePage />}
            />
          </Routes>
          </Suspense>
        </div>
      </main>
      {!isAuthRoute && <ChatWidget />}
      {!isAuthRoute && <Footer />}
    </div>
  );
}

export default App;
