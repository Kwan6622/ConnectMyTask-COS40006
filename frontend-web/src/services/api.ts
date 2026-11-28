import axios from 'axios';
import type { AxiosError, AxiosInstance } from 'axios';
import { API_BASE_URL, API_TIMEOUT } from '../constants';
import { storage } from '../utils';
import { saveAccountLock } from '../utils/accountLock';

// Bump when the city/ward list changes shape or names.
export const LOCATIONS_DATA_VERSION = 'en-1';

function getAccessToken(): string | null {
  const rawToken = localStorage.getItem('accessToken');
  if (rawToken) return rawToken;
  const legacyToken = storage.get('auth_token');
  return typeof legacyToken === 'string' ? legacyToken : null;
}

class ApiService {
  private api: AxiosInstance;

  constructor() {
    this.api = axios.create({
      baseURL: API_BASE_URL,
      timeout: API_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor
    this.api.interceptors.request.use(
      (config) => {
        const token = getAccessToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor
    this.api.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        const requestUrl = error.config?.url || '';
        const isAuthRequest = requestUrl.includes('/auth/login') || requestUrl.includes('/auth/signup');

        // 3 warnings: the account is locked. Keep the unlock time for the lock page.
        const body = error.response?.data as { code?: string; lockedUntil?: string; warningCount?: number; reasons?: string[] } | undefined;
        if (error.response?.status === 403 && body?.code === 'ACCOUNT_LOCKED') {
          saveAccountLock({ lockedUntil: body.lockedUntil || null, warningCount: body.warningCount ?? null, reasons: body.reasons || [] });
          storage.remove('auth_token');
          localStorage.removeItem('accessToken');
          localStorage.removeItem('auth-storage');
          if (!window.location.pathname.startsWith('/account-locked')) window.location.href = '/account-locked';
          return Promise.reject(error);
        }

        if (error.response?.status === 401 && !isAuthRequest) {
          // Handle unauthorized
          storage.remove('auth_token');
          localStorage.removeItem('accessToken');
          localStorage.removeItem('auth-storage');
          window.location.href = '/';
        }
        return Promise.reject(error);
      }
    );
  }

  // Auth APIs
  auth = {
    login: (email: string, password: string) =>
      this.api.post('/auth/login', { email, password }),
    signup: (data: any) => this.api.post('/auth/signup', data),
    logout: () => this.api.post('/auth/logout'),
    refreshToken: () => this.api.post('/auth/refresh'),
    getCurrentUser: () => this.api.get('/auth/me'),
  };

  // Task APIs
  tasks = {
    verifyAddress: (data: { wardId: number; streetName: string }) => this.api.post('/tasks/verify-address', data),
    getAll: (filters?: any) => this.api.get('/tasks', { params: filters }),
    getById: (id: string) => this.api.get(`/tasks/${id}`),
    create: (data: any) => this.api.post('/tasks', data),
    update: (id: string, data: any) => this.api.patch(`/tasks/${id}`, data),
    delete: (id: string) => this.api.delete(`/tasks/${id}`),
    getByUser: (userId: string) => this.api.get(`/users/${userId}/tasks`),
    getRequesterMe: () => this.api.get('/tasks/requester/me'),
    // Expired tasks (requester only)
    getRepostSuggestions: (id: string | number) => this.api.get(`/tasks/${id}/repost-suggestions`),
    repost: (id: string | number, data: Record<string, unknown>) => this.api.patch(`/tasks/${id}/repost`, data),
    deletePermanently: (id: string | number) => this.api.delete(`/tasks/${id}/permanent`),
    getProviderAssignedMe: () => this.api.get('/tasks/provider/assigned/me'),
    getSuggestedMe: () => this.api.get('/tasks/suggested/me'),
    updateStatus: (id: string, status: string) => this.api.patch(`/tasks/${id}/status`, { status }),
    assignProvider: (id: string, bidId: number) => this.api.patch(`/tasks/${id}/assign-provider`, { bidId }),
    getProgress: (id: string) => this.api.get(`/tasks/${id}/progress`),
    addProgressUpdate: (
      id: string,
      data: {
        progressPercent: number;
        note: string;
        attachments?: string[];
        milestoneStatus?: string;
        markAsCompleted?: boolean;
      }
    ) => this.api.post(`/tasks/${id}/progress`, data),
    updateSubtaskStatus: (
      id: string,
      subtaskId: string | number,
      status: 'PENDING' | 'IN_PROGRESS' | 'DONE'
    ) => this.api.patch(`/tasks/${id}/subtasks/${subtaskId}`, { status }),
    confirmCompletion: (id: string) => this.api.post(`/tasks/${id}/confirm-completion`),
    getActivity: (id: string) => this.api.get(`/tasks/${id}/activity`),
    getDisputes: (id: string) => this.api.get(`/tasks/${id}/disputes`),
    openDispute: (
      id: string,
      data: {
        reason: 'PROVIDER_NOT_DELIVERING' | 'REQUESTER_NOT_CONFIRMING' | 'QUALITY_ISSUE' | 'PAYMENT_ISSUE' | 'OTHER';
        description: string;
        evidenceUrls?: string[];
      }
    ) => this.api.post(`/tasks/${id}/disputes`, data),
    cancel: (id: string, reason: string) => this.api.post(`/tasks/${id}/cancel`, { reason }),
    save: (id: string) => this.api.post(`/tasks/${id}/save`),
    unsave: (id: string) => this.api.delete(`/tasks/${id}/save`),
    getSavedMe: () => this.api.get('/tasks/saved/me'),
  };

  // Bid APIs
  bids = {
    getAll: (taskId: string, sort = 'NEWEST') => this.api.get(`/tasks/${taskId}/bids`, { params: { sort } }),
    create: (taskId: string, data: any) => this.api.post(`/tasks/${taskId}/bids`, data),
    getProviderMe: () => this.api.get('/bids/provider/me'),
  };

  // Cities and wards (public; ids are official codes)
  locations = {
    // `v` changes the URL whenever the list format changes, so a copy cached by an
    // older build (Vietnamese names) is never reused.
    cities: () => this.api.get('/locations/cities', { params: { v: LOCATIONS_DATA_VERSION } }),
    wards: (cityId: number) => this.api.get(`/locations/cities/${cityId}/wards`, { params: { v: LOCATIONS_DATA_VERSION } }),
  };

  // User APIs
  users = {
    getProfile: (id: string) => this.api.get(`/users/${id}`),
    getMe: () => this.api.get('/users/me'),
    updateProfile: (data: { name?: string; phone?: string | null; wardId?: number; streetAddress?: string | null; bio?: string | null; profilePhotoUrl?: string }) =>
      this.api.patch('/users/me', data),
    getRating: (id: string) => this.api.get(`/users/${id}/rating`),
    getReviews: (id: string) => this.api.get(`/users/${id}/reviews`),
    updateProfilePhoto: (profilePhotoUrl: string) =>
      this.api.patch('/users/me', { profilePhotoUrl }),
    updateProviderProfile: (data: {
      address?: string;
      city?: string;
      specialties?: string[];
      safetyComplianceAgreed?: boolean;
      shortBio?: string;
    }) => this.api.patch('/users/me/provider-profile', data),
    uploadProviderCertificate: (data: {
      title: string;
      certificateType: string;
      fileUrl: string;
    }) => this.api.post('/users/me/provider-certificates', data),
    verifyProviderCertificate: (
      certificateId: string | number,
      data: { verificationStatus: 'VERIFIED' | 'REJECTED'; rejectionReason?: string }
    ) => this.api.patch(`/users/provider-certificates/${certificateId}/verification`, data),
    getProviderRatingSummary: (providerId: string | number) =>
      this.api.get(`/users/providers/${providerId}/rating-summary`),
  };

  // Tracking APIs
  tracking = {
    getTaskSiteLocation: (taskId: string) => this.api.get(`/tracking/tasks/${taskId}/site-location`),
    getLatest: (taskId: string) => this.api.get(`/tracking/tasks/${taskId}/latest`),
    updateLocation: (data: any) => this.api.post('/tracking/update', data),
    getHistory: (taskId: string) => this.api.get(`/tracking/tasks/${taskId}/history`),
    getVerification: (taskId: string) => this.api.get(`/tracking/tasks/${taskId}/verification`),
  };

  // AI APIs
  ai = {
    predictPrice: (data: any) => this.api.post('/ai/predict-price', data),
    matchProviders: (data: any) => this.api.post('/ai/match-providers', data),
    analyzeSentiment: (text: string) => this.api.post('/ai/analyze-sentiment', { text }),
  };

  // Chat assistant API
  chat = {
    send: (data: {
      message: string;
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    }) => this.api.post('/chat', data),
  };

  // Payment APIs
  payment = {
    create: (data: { taskId: number; method?: 'STRIPE'; flow?: 'ESCROW_DEPOSIT' | 'DIRECT_PAYMENT' }) =>
      this.api.post('/payments/create', data),
    confirmSession: (sessionId: string) => this.api.post('/payments/confirm-session', { sessionId }),
    getMine: () => this.api.get('/payments/me'),
    getTask: (taskId: string | number) => this.api.get(`/payments/task/${taskId}`),
  };

  // Review APIs
  reviews = {
    create: (taskId: string, data: any) => this.api.post(`/tasks/${taskId}/reviews`, data),
    getByTask: (taskId: string) => this.api.get(`/tasks/${taskId}/reviews`),
  };

  // Notification APIs
  support = {
    list: (params?: Record<string, string | number>) => this.api.get('/support/tickets', { params }),
    create: (data: Record<string, unknown>) => this.api.post('/support/tickets', data),
    get: (id: number) => this.api.get(`/support/tickets/${id}`),
    messages: (id: number, page = 1) => this.api.get(`/support/tickets/${id}/messages`, { params: { page } }),
    activity: (id: number, page = 1) => this.api.get(`/support/tickets/${id}/activity`, { params: { page } }),
    reply: (id: number, data: Record<string, unknown>) => this.api.post(`/support/tickets/${id}/messages`, data),
    update: (id: number, data: Record<string, string>) => this.api.patch(`/support/tickets/${id}`, data),
  };

  notifications = {
    contactClient: (data: { taskId: number }) =>
      this.api.post('/notifications/contact', data),
    getMine: () => this.api.get('/notifications/me'),
    markRead: (id: string) => this.api.patch(`/notifications/${id}/read`),
  };

  // Rating APIs
  ratings = {
    create: (data: { taskId: number; toUserId?: number; rating: number; comment?: string }) =>
      this.api.post('/ratings', data),
    getUserRatings: (userId: string | number) => this.api.get(`/users/${userId}/ratings`),
    getProviderRatings: (providerId: string | number) => this.api.get(`/providers/${providerId}/ratings`),
    getMyTaskRatingStatus: (taskId: string | number) => this.api.get(`/tasks/${taskId}/ratings/me`),
  };

  // Admin APIs
  admin = {
    getStats: () => this.api.get('/admin/stats'),
    getUsers: () => this.api.get('/admin/users'),
    updateUserStatus: (userId: string | number, status: 'ACTIVE' | 'SUSPENDED') =>
      this.api.patch(`/admin/users/${userId}/status`, { status }),
    getUserWarnings: (userId: string | number) => this.api.get(`/admin/users/${userId}/warnings`),
    /** change: +1 adds a warning, -1 removes one; 3 warnings lock the account for 3 days */
    changeUserWarnings: (userId: string | number, change: 1 | -1, reason: string) =>
      this.api.post(`/admin/users/${userId}/warnings`, { change, reason }),
    getTasks: () => this.api.get('/admin/tasks'),
    getSuspiciousTasks: () => this.api.get('/admin/tasks/suspicious'),
    /** Soft delete: hides and cancels the task, closes bids; the reason is sent to the requester and bidders. */
    deleteTask: (taskId: string | number, reason: string) => this.api.delete(`/admin/tasks/${taskId}`, { data: { reason } }),
    reviewTask: (taskId: string | number) => this.api.patch(`/admin/tasks/${taskId}/reviewed`),
    updateTaskStatus: (taskId: string | number, data: { status: string; reason: string }) =>
      this.api.patch(`/admin/tasks/${taskId}/status`, data),
    getPlatformFeeSettings: () => this.api.get('/admin/settings/platform-fee'),
    updatePlatformFeeSettings: (data: {
      feeType: 'PERCENTAGE' | 'FIXED'; percentageRate?: number; fixedAmount?: number; isActive: boolean; reason: string;
    }) => this.api.patch('/admin/settings/platform-fee', data),
    getCertificates: () => this.api.get('/admin/certificates'),
    verifyCertificate: (certificateId: string | number) => this.api.patch(`/admin/certificates/${certificateId}/verify`),
    rejectCertificate: (certificateId: string | number) => this.api.patch(`/admin/certificates/${certificateId}/reject`),
    getPayments: () => this.api.get('/admin/payments'),
    getEscrowPayments: () => this.api.get('/admin/payments/escrow'),
    releasePayment: (paymentId: string | number) => this.api.patch(`/admin/payments/${paymentId}/release`),
    getDisputes: () => this.api.get('/tasks/disputes/all'),
    reviewDispute: (
      taskId: string | number,
      disputeId: string | number,
      data: { status: 'UNDER_REVIEW' | 'RESOLVED' | 'REJECTED' | 'CLOSED'; resolution?: string; action?: 'NONE' | 'REFUND_ESCROW' | 'RELEASE_ESCROW' | 'FORCE_CANCEL' }
    ) => this.api.patch(`/tasks/${taskId}/disputes/${disputeId}/review`, data),
  };

  // Platform public stats APIs
  platform = {
    getStats: () => this.api.get('/platform/stats'),
  };
}

export const api = new ApiService();
