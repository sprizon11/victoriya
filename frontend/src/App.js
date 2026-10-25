import React, { Suspense, useEffect } from 'react';
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { Toaster } from "sonner";
import Layout from "./components/Layout";
const LoginPage = React.lazy(() => import("./pages/LoginPage"));
const DashboardPage = React.lazy(() => import("./pages/DashboardPage"));
const OperatorsPage = React.lazy(() => import("./pages/OperatorsPage"));
const OperationsPage = React.lazy(() => import("./pages/OperationsPage"));
const ColorsPage = React.lazy(() => import("./pages/ColorsPage"));
const SizeChartsPage = React.lazy(() => import("./pages/SizeChartsPage"));
const AdvancesPage = React.lazy(() => import("./pages/AdvancesPage"));
const LotsPage = React.lazy(() => import("./pages/LotsPage"));
const LotFormPage = React.lazy(() => import("./pages/LotFormPage"));
const ProductionEntryPage = React.lazy(() => import("./pages/ProductionEntryPage"));
const PayrollPage = React.lazy(() => import("./pages/PayrollPage"));
const ReportsPage = React.lazy(() => import("./pages/ReportsPage"));
const VouchersPage = React.lazy(() => import("./pages/VouchersPage"));
const SettingsPage = React.lazy(() => import("./pages/SettingsPage"));
const WeeksPage = React.lazy(() => import("./pages/WeeksPage"));
const UsersPage = React.lazy(() => import("./pages/UsersPage"));

const Landing = React.lazy(() => import('./landing/LandingPage'));
const EnquiriesPage = React.lazy(() => import('./pages/EnquiriesPage'));
const AuditPage = React.lazy(() => import('./pages/AuditPage'));
const ApprovalsPage = React.lazy(() => import('./pages/ApprovalsPage'));
const PublicLanding = () => <Suspense fallback={<div className="p-8">Victoria Garments</div>}><Landing /></Suspense>;

function ProtectedRoute({ children, roles }) {
    const { user, loading } = useAuth();
    if (loading) return <div className="flex items-center justify-center h-screen text-slate-500">Loading...</div>;
    if (!user) return <Navigate to="/login" replace />;
    if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
    return <Layout>{children}</Layout>;
}

function AppRoutes() {
    const { user, loading } = useAuth();
    const { pathname } = useLocation();
    useEffect(() => {
        if (pathname !== "/home" && (pathname !== "/" || user)) document.title = "Victoria Unit Flow";
    }, [pathname, user]);
    if (loading && !['/', '/home'].includes(window.location.pathname)) return <div className="flex items-center justify-center h-screen text-slate-500">Loading...</div>;

    return (
        <Routes>
            <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
            <Route path="/home" element={<PublicLanding />} />
            <Route path="/" element={user ? <ProtectedRoute><Suspense fallback={<div>Loading...</div>}><DashboardPage /></Suspense></ProtectedRoute> : <PublicLanding />} />
            <Route path="/enquiries" element={<ProtectedRoute roles={['admin']}><Suspense fallback={<div>Loading...</div>}><EnquiriesPage /></Suspense></ProtectedRoute>} />
            <Route path="/approvals" element={<ProtectedRoute><Suspense fallback={<div>Loading...</div>}><ApprovalsPage /></Suspense></ProtectedRoute>} />
            <Route path="/audit" element={<ProtectedRoute roles={['admin']}><Suspense fallback={<div>Loading...</div>}><AuditPage /></Suspense></ProtectedRoute>} />
            <Route path="/operators" element={<ProtectedRoute roles={['admin']}><OperatorsPage /></ProtectedRoute>} />
            <Route path="/operations" element={<ProtectedRoute roles={['admin']}><OperationsPage /></ProtectedRoute>} />
            <Route path="/colors" element={<ProtectedRoute roles={['admin']}><ColorsPage /></ProtectedRoute>} />
            <Route path="/size-charts" element={<ProtectedRoute roles={['admin']}><SizeChartsPage /></ProtectedRoute>} />
            <Route path="/lots" element={<ProtectedRoute roles={['admin', 'accounts']}><LotsPage /></ProtectedRoute>} />
            <Route path="/lots/new" element={<ProtectedRoute roles={['admin']}><LotFormPage /></ProtectedRoute>} />
            <Route path="/lots/:id" element={<ProtectedRoute roles={['admin']}><LotFormPage /></ProtectedRoute>} />
            <Route path="/production" element={<ProtectedRoute roles={['admin', 'data_entry']}><ProductionEntryPage /></ProtectedRoute>} />
            <Route path="/advances" element={<ProtectedRoute roles={['admin', 'accounts']}><AdvancesPage /></ProtectedRoute>} />
            <Route path="/payroll" element={<ProtectedRoute roles={['admin', 'accounts']}><PayrollPage /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute roles={['admin', 'accounts']}><ReportsPage /></ProtectedRoute>} />
            <Route path="/vouchers" element={<ProtectedRoute roles={['admin', 'accounts']}><VouchersPage /></ProtectedRoute>} />
            <Route path="/weeks" element={<ProtectedRoute roles={['admin']}><WeeksPage /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute roles={['admin']}><SettingsPage /></ProtectedRoute>} />
            <Route path="/users" element={<ProtectedRoute roles={['admin']}><UsersPage /></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    );
}

function App() {
    return (
        <BrowserRouter>
            <AuthProvider>
                <Suspense fallback={<div className="p-8">Loading...</div>}><AppRoutes /></Suspense>
                <Toaster position="top-right" richColors closeButton />
            </AuthProvider>
        </BrowserRouter>
    );
}

export default App;
