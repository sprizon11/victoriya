import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { Toaster } from "sonner";
import Layout from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import OperatorsPage from "./pages/OperatorsPage";
import OperationsPage from "./pages/OperationsPage";
import ColorsPage from "./pages/ColorsPage";
import SizeChartsPage from "./pages/SizeChartsPage";
import AdvancesPage from "./pages/AdvancesPage";
import LotsPage from "./pages/LotsPage";
import LotFormPage from "./pages/LotFormPage";
import ProductionEntryPage from "./pages/ProductionEntryPage";
import PayrollPage from "./pages/PayrollPage";
import ReportsPage from "./pages/ReportsPage";
import VouchersPage from "./pages/VouchersPage";
import SettingsPage from "./pages/SettingsPage";
import WeeksPage from "./pages/WeeksPage";
import UsersPage from "./pages/UsersPage";

function ProtectedRoute({ children, roles }) {
    const { user, loading } = useAuth();
    if (loading) return <div className="flex items-center justify-center h-screen text-slate-500">Loading...</div>;
    if (!user) return <Navigate to="/login" replace />;
    if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
    return <Layout>{children}</Layout>;
}

function AppRoutes() {
    const { user, loading } = useAuth();
    if (loading) return <div className="flex items-center justify-center h-screen text-slate-500">Loading...</div>;

    return (
        <Routes>
            <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
            <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
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
                <AppRoutes />
                <Toaster position="top-right" richColors closeButton />
            </AuthProvider>
        </BrowserRouter>
    );
}

export default App;
