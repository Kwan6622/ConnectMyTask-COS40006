import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  MapPinIcon,
} from '@heroicons/react/24/outline';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { TaskTrackingMap } from '../components/task/TaskTrackingMap';
import { api } from '../services/api';
import { useAuthStore } from '../stores/auth.store';
import type { Task, TaskLocationVerificationStatus, TrackingLog } from '../types';

const REFRESH_INTERVAL_MS = 5000;

export const TrackingPage: React.FC = () => {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const [task, setTask] = useState<Task | null>(null);
  const [latest, setLatest] = useState<TrackingLog | null>(null);
  const [history, setHistory] = useState<TrackingLog[]>([]);
  const [verification, setVerification] = useState<TaskLocationVerificationStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [taskErrorMessage, setTaskErrorMessage] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const validTaskId = Boolean(taskId && /^[1-9]\d*$/.test(taskId));

  const fetchTrackingData = useCallback(async (showError = false) => {
    if (!taskId || !validTaskId) {
      setErrorMessage('Invalid or missing task ID');
      setIsLoading(false);
      return;
    }
    setIsRefreshing(true);
    try {
      const [latestResponse, historyResponse, verificationResponse] = await Promise.all([
        api.tracking.getLatest(taskId),
        api.tracking.getHistory(taskId),
        api.tracking.getVerification(taskId),
      ]);
      setLatest((latestResponse.data || null) as TrackingLog | null);
      setHistory(Array.isArray(historyResponse.data) ? historyResponse.data as TrackingLog[] : []);
      setVerification(verificationResponse.data as TaskLocationVerificationStatus);
      setErrorMessage(null);
      setLastUpdate(new Date());
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { message?: string } } };
      const message = apiError.response?.data?.message || 'Failed to load tracking data';
      setErrorMessage(message);
      if (showError) toast.error(message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [taskId, validTaskId]);

  useEffect(() => {
    void fetchTrackingData();
  }, [fetchTrackingData]);

  useEffect(() => {
    if (!taskId || !validTaskId) return;
    let mounted = true;
    api.tasks.getById(taskId)
      .then((response) => {
        if (mounted) setTask(response.data as Task);
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        const apiError = error as { response?: { data?: { message?: string } }; message?: string };
        setTaskErrorMessage(apiError.response?.data?.message || apiError.message || 'Failed to load task details');
      });
    return () => {
      mounted = false;
    };
  }, [taskId, validTaskId]);

  useEffect(() => {
    if (!validTaskId) return;
    const handleFocus = () => void fetchTrackingData();
    const handleVisible = () => {
      if (document.visibilityState === 'visible') void fetchTrackingData();
    };
    const timer = autoRefresh
      ? window.setInterval(() => void fetchTrackingData(), REFRESH_INTERVAL_MS)
      : undefined;
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisible);
    return () => {
      if (timer) window.clearInterval(timer);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisible);
    };
  }, [autoRefresh, fetchTrackingData, validTaskId]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto" />
          <p className="mt-4 text-dark-600">Loading tracking data...</p>
        </div>
      </div>
    );
  }

  if (!validTaskId || (errorMessage && !latest && history.length === 0 && !verification)) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <Card className="text-center py-12">
          <ExclamationTriangleIcon className="w-12 h-12 text-amber-500 mx-auto mb-3" />
          <h2 className="text-2xl font-bold text-dark-900 mb-2">Tracking unavailable</h2>
          <p className="text-dark-600 mb-6">{errorMessage || 'Invalid or missing task ID'}</p>
          <Button onClick={() => navigate('/browse-tasks')}>Back to tasks</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dark-50 py-8">
      <div className="container mx-auto px-4 max-w-5xl">
        <Button variant="ghost" onClick={() => navigate(`/tasks/${taskId}/progress`)} className="mb-4">
          <ArrowLeftIcon className="w-5 h-5 mr-2" />
          Back to Task Progress
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-dark-900 flex items-center gap-3">
              <MapPinIcon className="w-8 h-8 text-primary-600" />
              Task GPS Tracking
            </h1>
            <p className="text-dark-600 mt-2">Live data recorded by the assigned provider&apos;s mobile app.</p>
          </div>
          <Button variant="outline" onClick={() => void fetchTrackingData(true)} disabled={isRefreshing}>
            <ArrowPathIcon className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {errorMessage && (
          <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {errorMessage}. Showing the last successfully loaded data.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {user && task && task.assignedProviderId
              && (String(task.createdById || task.clientId) === String(user?.id)
                || String(task.assignedProviderId) === String(user?.id)) && (
                <TaskTrackingMap
                  task={task}
                  isProvider={String(task.assignedProviderId) === String(user?.id)}
                  latestLocation={latest}
                  pollLatest={false}
                />
              )}

            {taskErrorMessage && (
              <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {taskErrorMessage}
              </p>
            )}

            <Card className="p-6">
              <h2 className="text-lg font-bold text-dark-900 mb-4">Latest provider location</h2>
              {latest ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="rounded-xl bg-dark-50 p-4">
                    <p className="text-xs uppercase text-dark-500">Latitude</p>
                    <p className="font-semibold text-dark-900 mt-1">{Number(latest.lat).toFixed(6)}</p>
                  </div>
                  <div className="rounded-xl bg-dark-50 p-4">
                    <p className="text-xs uppercase text-dark-500">Longitude</p>
                    <p className="font-semibold text-dark-900 mt-1">{Number(latest.lng).toFixed(6)}</p>
                  </div>
                  <div className="rounded-xl bg-dark-50 p-4">
                    <p className="text-xs uppercase text-dark-500">Accuracy</p>
                    <p className="font-semibold text-dark-900 mt-1">
                      {latest.accuracy == null ? 'Not recorded' : `±${Math.round(Number(latest.accuracy))} m`}
                    </p>
                  </div>
                  <div className="sm:col-span-3 flex items-center gap-2 text-sm text-dark-600">
                    <ClockIcon className="w-4 h-4" />
                    Captured {new Date(latest.timestamp).toLocaleString()}
                  </div>
                </div>
              ) : (
                <p className="text-dark-600">No GPS updates have been recorded for this task.</p>
              )}
            </Card>

            <Card className="p-6">
              <h2 className="text-lg font-bold text-dark-900 mb-4">Location history</h2>
              {history.length === 0 ? (
                <p className="text-dark-600">No location history is available.</p>
              ) : (
                <div className="space-y-3">
                  {history.map((location, index) => (
                    <div key={location.id} className="flex items-start gap-4 rounded-xl border border-dark-100 p-4">
                      <div className="w-9 h-9 flex-shrink-0 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center font-semibold">
                        {index + 1}
                      </div>
                      <div>
                        <p className="font-medium text-dark-900">
                          {Number(location.lat).toFixed(6)}, {Number(location.lng).toFixed(6)}
                        </p>
                        <p className="text-sm text-dark-500 mt-1">
                          {new Date(location.timestamp).toLocaleString()}
                          {location.accuracy != null ? ` · ±${Math.round(Number(location.accuracy))} m` : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div className="space-y-6">
            <Card className={`p-6 border-2 ${verification?.isValid ? 'border-success-200 bg-success-50/50' : 'border-amber-200 bg-amber-50/50'}`}>
              <div className="flex items-center gap-3">
                {verification?.isValid
                  ? <CheckCircleIcon className="w-9 h-9 text-success-600" />
                  : <ExclamationTriangleIcon className="w-9 h-9 text-amber-600" />}
                <div>
                  <h2 className="text-lg font-bold text-dark-900">
                    {verification?.isValid ? 'Location verified' : 'Not verified'}
                  </h2>
                  <p className="text-sm text-dark-600">
                    {verification?.isValid
                      ? `${verification.distanceMeters ?? 0} m from the task site`
                      : 'Verification must be completed in the mobile app.'}
                  </p>
                </div>
              </div>
              {verification?.expiresAt && (
                <p className="text-xs text-dark-500 mt-4">Expires {new Date(verification.expiresAt).toLocaleString()}</p>
              )}
            </Card>

            <Card className="p-6">
              <p className="text-sm text-dark-500">
                Last refresh: <span className="font-medium text-dark-700">{lastUpdate?.toLocaleTimeString() || 'Never'}</span>
              </p>
              <label className="mt-4 flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(event) => setAutoRefresh(event.target.checked)}
                  className="w-5 h-5 text-primary-600 rounded focus:ring-primary-500"
                />
                <span className="text-dark-700">Auto-refresh every 5s</span>
              </label>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};
