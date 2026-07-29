import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import api from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    const checkAuth = useCallback(async () => {
        try {
            const { data } = await api.get('/auth/me');
            setUser(data);
        } catch (err) {
            console.error('Auth check failed:', err);
            setUser(false);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { checkAuth(); }, [checkAuth]);

    const login = useCallback(async (email, password) => {
        const { data } = await api.post('/auth/login', { email, password });
        setUser(data);
        return data;
    }, []);

    const logout = useCallback(async () => {
        try { await api.post('/auth/logout'); } catch (err) { console.error('Logout error:', err); }
        setUser(false);
    }, []);

    const value = useMemo(() => ({ user, loading, login, logout, checkAuth }), [user, loading, login, logout, checkAuth]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
