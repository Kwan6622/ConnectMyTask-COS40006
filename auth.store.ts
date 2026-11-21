import { create } from 'zustand';
import { api } from '../services/api';
import type { User } from '../types';

function clearLegacyBrowserAuthStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth-storage');
  } catch (error) {
    console.warn('Could not clear legacy browser auth storage:', error);
  }
}

clearLegacyBrowserAuthStorage();

let sessionInitialization: Promise<void> | null = null;

interface AuthState {
  user: User | null;
  accessToken: string | null;
  sessionInitialized: boolean;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  login: (email: string, password: string) => Promise<void>;
  register: (data: {
    email: string;
    password: string;
    fullName: string;
    role: 'CLIENT' | 'PROVIDER';
    phone?: string;
  }) => Promise<void>;
  logout: () => void;
  initializeSession: () => Promise<void>;
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  clearError: () => void;
  updateProfile: (data: Partial<User>) => Promise<void>;
  updateProfilePhoto: (profilePhotoUrl: string) => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
      user: null,
      accessToken: null,
      sessionInitialized: false,
      isLoading: false,
      error: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
          const response = await api.auth.login(email, password);
          set({
            user: response.data.user,
            accessToken: null,
            sessionInitialized: true,
            isLoading: false,
          });
        } catch (error: any) {
          const message =
            error?.response?.data?.message ||
            error?.message ||
            'Login failed';
          set({ 
            error: message, 
            isLoading: false 
          });
          throw error;
        }
      },

      register: async (data) => {
        set({ isLoading: true, error: null });
        try {
          const response = await api.auth.signup(data);
          set({
            user: response.data.user,
            accessToken: null,
            sessionInitialized: true,
            isLoading: false,
          });
        } catch (error: any) {
          const message =
            error?.response?.data?.message ||
            error?.response?.data?.error ||
            error?.message ||
            'Registration failed';
          set({ 
            error: message, 
            isLoading: false 
          });
          throw error;
        }
      },

      logout: () => {
        void api.auth.logout().catch((error) => {
          console.error('Failed to clear browser session cookie:', error);
        });
        set({ user: null, accessToken: null, sessionInitialized: true });
      },

      initializeSession: () => {
        if (get().sessionInitialized) return Promise.resolve();
        if (!sessionInitialization) {
          sessionInitialization = (async () => {
            try {
              const response = await api.auth.getCurrentUser();
              set({ user: response.data.user, accessToken: null, error: null });
            } catch (error: any) {
              if (error?.response?.status !== 401) {
                set({ error: error?.message || 'Unable to restore the browser session.' });
              }
              set({ user: null, accessToken: null });
            } finally {
              set({ sessionInitialized: true });
            }
          })().finally(() => {
            sessionInitialization = null;
          });
        }
        return sessionInitialization;
      },

      setUser: (user) => set({ user }),
      setToken: () => set({ accessToken: null }),
      clearError: () => set({ error: null }),

      updateProfile: async (data) => {
        set({ isLoading: true, error: null });
        try {
          const response = await api.users.updateProfile({
            name: data.fullName || data.name,
            phone: data.phone,
            bio: data.bio,
          });
          set((state) => ({
            user: state.user
              ? {
                  ...state.user,
                  ...response.data.user,
                  fullName: response.data.user?.name || state.user.fullName,
                }
              : null,
            isLoading: false,
          }));
        } catch (error: any) {
          set({
            error: error?.response?.data?.message || error.message || 'Failed to update profile',
            isLoading: false
          });
          throw error;
        }
      },

      updateProfilePhoto: async (profilePhotoUrl: string) => {
        set({ isLoading: true, error: null });
        try {
          const response = await api.users.updateProfilePhoto(profilePhotoUrl);
          set((state) => ({
            user: state.user ? { ...state.user, ...response.data.user } : state.user,
            isLoading: false,
          }));
        } catch (error: any) {
          const message =
            error?.response?.data?.message ||
            error?.message ||
            'Failed to update profile photo';
          set({
            error: message,
            isLoading: false,
          });
          throw error;
        }
      },
    }));
