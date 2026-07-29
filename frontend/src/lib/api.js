import axios from 'axios';

// Empty string = same-origin (production: FastAPI serves this bundle itself).
// Set REACT_APP_BACKEND_URL only when the API lives on a different host,
// e.g. http://localhost:8000 during local development.
export const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';

const api = axios.create({
    baseURL: `${BACKEND_URL}/api`,
    withCredentials: true,
    headers: { 'Content-Type': 'application/json' }
});

api.interceptors.response.use(
    res => res,
    async error => {
        const url = error.config?.url || '';
        // Never retry or redirect for auth endpoints
        if (url.includes('/auth/')) {
            return Promise.reject(error);
        }
        if (error.response?.status === 401 && !error.config._retry) {
            error.config._retry = true;
            try {
                await axios.post(`${BACKEND_URL}/api/auth/refresh`, {}, { withCredentials: true });
                return api(error.config);
            } catch {
                return Promise.reject(error);
            }
        }
        return Promise.reject(error);
    }
);

export default api;

export async function downloadFile(url, filename) {
    try {
        const response = await fetch(`${BACKEND_URL}${url}`, {
            credentials: 'include',
        });
        if (!response.ok) {
            const err = await response.text();
            throw new Error(err || 'Download failed');
        }
        const blob = await response.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    } catch (e) {
        throw e;
    }
}
