import React, { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useTaskStore } from '../stores/task.store';
import { useAuthStore } from '../stores/auth.store';
import { api } from '../services/api';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { Card } from '../components/common/Card';
import { uploadImageToCloudinary } from '../utils/cloudinaryUpload';
import { CityWardPicker, type CityWardValue } from '../components/location/CityWardPicker';
import { useWards } from '../utils/wards';
import { TaskLocationPicker } from '../components/task/TaskLocationPicker';
import toast from 'react-hot-toast';
import {
  SparklesIcon,
  CurrencyDollarIcon,
  CalendarIcon,
  MapPinIcon,
  DocumentTextIcon,
  TagIcon,
  CheckCircleIcon,
  ClockIcon,
  UserGroupIcon,
  LightBulbIcon,
  ArrowRightIcon,
  PaperClipIcon,
} from '@heroicons/react/24/outline';

interface TaskFormData {
  title: string;
  description: string;
  category: string;
  streetName: string;
  budget?: number;
  maxBids?: number;
  deadline?: string;
  imageUrls?: string[];
}

function formatVndInput(value?: number): string {
  if (!value || value <= 0) return '';
  return value.toLocaleString('en-US');
}

function parseVndInput(rawValue: string): number | undefined {
  const digitsOnly = rawValue.replace(/\D/g, '');
  if (!digitsOnly) return undefined;
  const parsed = Number.parseInt(digitsOnly, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function getDateTimeLocalNow(): string {
  const now = new Date();
  const tzOffsetMs = now.getTimezoneOffset() * 60 * 1000;
  const localNow = new Date(now.getTime() - tzOffsetMs);
  return localNow.toISOString().slice(0, 16);
}

export const TaskPostPage: React.FC = () => {
  const navigate = useNavigate();
  const { createTask, tasks } = useTaskStore();
  const user = useAuthStore((state) => state.user);
  const [aiBudgetSuggestion, setAiBudgetSuggestion] = useState<{
    suggestedBudget: number;
    suggestedMin?: number;
    suggestedMax?: number;
    currency?: string;
    explanation?: string;
    factorsUsed?: string[];
  } | null>(null);
  const [isGettingAiBudgetSuggestion, setIsGettingAiBudgetSuggestion] = useState(false);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const [addressVerification, setAddressVerification] = useState<{
    status: 'idle' | 'verifying' | 'verified' | 'error';
    message?: string;
    /** ADDRESS_NOT_FOUND: the geocoder has no such house, so offer the nearby-address option. */
    code?: string;
    latitude?: number;
    longitude?: number;
  }>({ status: 'idle' });
  // Start from the account's ward; the requester can pick another for this task.
  const [place, setPlace] = useState<CityWardValue>({ cityId: user?.cityId ?? null, wardId: user?.locationId ?? null });
  const { wards: placeWards } = useWards(place.cityId);
  const placeWard = placeWards.find((ward) => ward.id === place.wardId) || null;
  const [placeError, setPlaceError] = useState('');
  // "Nearby address" mode: the street address only verifies the area (within 100 m)
  // and the exact place goes in Address details, shown only to the hired provider.
  const [isApproximateLocation, setIsApproximateLocation] = useState(false);
  const [approxTouched, setApproxTouched] = useState(false);
  const [hadNotFound, setHadNotFound] = useState(false);
  const [addressDetail, setAddressDetail] = useState('');
  const [addressDetailError, setAddressDetailError] = useState('');
  const ADDRESS_DETAIL_MAX = 100;

  // The saved session can predate the account's ward / home address; refresh it once.
  useEffect(() => {
    if (!user?.id) return;
    api.users.getMe()
      .then((response) => {
        const fresh = response.data || {};
        useAuthStore.getState().setUser({ ...user, ...fresh, fullName: fresh.name || user.fullName });
        setPlace((current) => (current.wardId ? current : { cityId: fresh.cityId ?? null, wardId: fresh.locationId ?? null }));
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  // A new ward starts a fresh address search.
  useEffect(() => {
    setHadNotFound(false);
    if (!approxTouched) setIsApproximateLocation(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place.wardId]);

  // The house was not on the map and a nearby address now verifies: switch to
  // nearby mode for the user (they can still untick it).
  useEffect(() => {
    if (addressVerification.status === 'verified' && hadNotFound && !approxTouched) setIsApproximateLocation(true);
  }, [addressVerification.status, hadNotFound, approxTouched]);

  const minDeadlineValue = getDateTimeLocalNow();
  const categoryCounts = tasks.reduce<Record<string, number>>((acc, task) => {
    acc[task.category] = (acc[task.category] || 0) + 1;
    return acc;
  }, {});

  const { control, register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<TaskFormData>();
  const wardId = place.wardId;
  const streetName = watch('streetName');

  useEffect(() => {
    const street = String(streetName || '').trim();
    if (!wardId || street.length < 3) {
      setAddressVerification({ status: 'idle' });
      return;
    }

    let cancelled = false;
    setAddressVerification({ status: 'verifying' });
    const timer = window.setTimeout(async () => {
      try {
        const response = await api.tasks.verifyAddress({ wardId, streetName: street });
        if (cancelled) return;
        setAddressVerification({
          status: 'verified',
          message: 'Address verified successfully. GPS coordinates have been detected.',
          latitude: Number(response.data.latitude),
          longitude: Number(response.data.longitude),
        });
      } catch (error: any) {
        if (cancelled) return;
        setAddressVerification({
          status: 'error',
          message: error?.response?.data?.message || 'Unable to verify this address. Please enter a valid address in Vietnam.',
          code: error?.response?.data?.code,
        });
        if (error?.response?.data?.code === 'ADDRESS_NOT_FOUND') setHadNotFound(true);
      }
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [wardId, streetName]);

  useEffect(() => {
    if (!user) {
      navigate('/');
      return;
    }
    const role = String(user.role || '').toUpperCase();
    if (role !== 'REQUESTER' && role !== 'CLIENT') {
      toast.error('Only requesters can post tasks');
      navigate('/browse-tasks');
    }
  }, [navigate, user]);

  const categories = [
    { value: 'DELIVERY', label: 'Delivery', icon: '🚚', color: 'bg-blue-50 text-blue-600' },
    { value: 'HOME_REPAIR', label: 'Home Repair', icon: '🔧', color: 'bg-orange-50 text-orange-600' },
    { value: 'CLEANING', label: 'Cleaning', icon: '✨', color: 'bg-cyan-50 text-cyan-600' },
    { value: 'IT_SUPPORT', label: 'IT Support', icon: '💻', color: 'bg-indigo-50 text-indigo-600' },
    { value: 'PERSONAL_ASSISTANT', label: 'Personal Assistant', icon: '👤', color: 'bg-purple-50 text-purple-600' },
    { value: 'MOVING', label: 'Moving', icon: '📦', color: 'bg-yellow-50 text-yellow-600' },
    { value: 'TUTORING', label: 'Tutoring', icon: '📚', color: 'bg-green-50 text-green-600' },
    { value: 'OTHER', label: 'Other', icon: '⭐', color: 'bg-gray-50 text-gray-600' },
  ];

  const handleGetAiBudgetSuggestion = async () => {
    const formData = watch();
    if (!formData.category || !placeWard) {
      toast.error('Please select category, city and ward first');
      return;
    }

    setIsGettingAiBudgetSuggestion(true);
    try {
      const title = String(formData.title || '').trim();
      const description = String(formData.description || '').trim();
      const response = await api.ai.predictPrice({
        title,
        category: formData.category,
        location: placeWard.name,
        budget: formData.budget,
        description: [title, description].filter(Boolean).join('. '),
        complexity: 'MEDIUM',
        urgency: 'NORMAL',
      });
      setAiBudgetSuggestion({
        suggestedBudget: Number(response.data?.suggestedBudget || response.data?.aiSuggestedPrice || 0),
        suggestedMin: response.data?.suggestedMin != null ? Number(response.data.suggestedMin) : undefined,
        suggestedMax: response.data?.suggestedMax != null ? Number(response.data.suggestedMax) : undefined,
        currency: response.data?.currency || 'VND',
        explanation: response.data?.explanation || response.data?.rationale || '',
        factorsUsed: Array.isArray(response.data?.factorsUsed) ? response.data.factorsUsed : [],
      });
      toast.success('AI budget suggestion generated');
    } catch (error) {
      toast.error('Failed to get AI budget suggestion');
    } finally {
      setIsGettingAiBudgetSuggestion(false);
    }
  };

  const onSubmit = async (data: TaskFormData) => {
    if (imageUrls.length > 3) {
      toast.error('You can upload up to 3 task images');
      return;
    }
    if (!user?.id) {
      toast.error('Please log in to post a task');
      return;
    }
    if (!place.wardId) {
      setPlaceError('Choose the city, then pick the ward from the suggestions.');
      toast.error('Choose the city and ward of the task.');
      return;
    }
    if (isApproximateLocation && !addressDetail.trim()) {
      setAddressDetailError('Write your exact address here so the provider you hire can find you.');
      toast.error('Write your exact address in Address details.');
      return;
    }
    if (addressVerification.status !== 'verified'
      || !Number.isFinite(addressVerification.latitude)
      || !Number.isFinite(addressVerification.longitude)) {
      toast.error(addressVerification.message || 'Please verify the task address before posting.');
      return;
    }

    try {
      const taskData = {
        ...data,
        wardId: place.wardId,
        isApproximateLocation,
        addressDetail: addressDetail.trim() || undefined,
        budget: data.budget ? Number(data.budget) : undefined,
        maxBids: data.maxBids ? Number(data.maxBids) : undefined,
        streetName: data.streetName,
        siteAddress: `${data.streetName}, ${placeWard?.name || ''}`,
        siteLatitude: addressVerification.latitude,
        siteLongitude: addressVerification.longitude,
        // Backend schema accepts number or undefined. Do not send null.
        aiSuggestedPrice: aiBudgetSuggestion?.suggestedBudget ?? undefined,
        imageUrls,
      };

      const task = await createTask(taskData);
      toast.success('Task posted successfully!');
      navigate(`/tasks/${task.id}`);
    } catch (error: any) {
      const details = error?.response?.data?.details;
      const firstDetailMessage =
        Array.isArray(details) && details.length > 0
          ? details[0]?.message
          : null;
      const message =
        error?.response?.data?.message ||
        firstDetailMessage ||
        error?.message ||
        'Failed to post task';
      toast.error(message);
    }
  };

  const handleTaskImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    if (selectedFiles.length === 0) return;

    const remainingSlots = 3 - imageUrls.length;
    if (selectedFiles.length > remainingSlots) {
      const message = `You can upload only ${remainingSlots} more image${remainingSlots === 1 ? '' : 's'}.`;
      setImageUploadError(message);
      toast.error(message);
      event.target.value = '';
      return;
    }

    setIsUploadingImages(true);
    setImageUploadError(null);

    try {
      // Upload selected files directly to Cloudinary first, then keep only secure URLs.
      const uploadedUrls = await Promise.all(
        selectedFiles.map((file) => uploadImageToCloudinary(file))
      );
      setImageUrls((prev) => [...prev, ...uploadedUrls]);
      toast.success(`Uploaded ${uploadedUrls.length} image${uploadedUrls.length > 1 ? 's' : ''}`);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Image upload failed. Please try again.';
      setImageUploadError(message);
      toast.error(message);
    } finally {
      setIsUploadingImages(false);
      event.target.value = '';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Professional Background Pattern */}
      <div className="absolute inset-0">
        <div 
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `
              linear-gradient(to right, #e5e7eb 1px, transparent 1px),
              linear-gradient(to bottom, #e5e7eb 1px, transparent 1px)
            `,
            backgroundSize: '40px 40px'
          }}
        />
        <div className="absolute top-20 right-10 w-72 h-72 bg-blue-200/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-20 left-10 w-96 h-96 bg-indigo-200/10 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>
      
      <div className="relative container mx-auto px-4 py-12 max-w-6xl">
        {/* Header Section */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center px-4 py-2 bg-blue-50 border border-blue-200 rounded-full text-blue-700 text-sm font-medium mb-6">
            <span className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></span>
            Post Your Task
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
            Get Help for
            <span className="block bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">Any Task</span>
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Describe what you need help with, and we&apos;ll match you with the best providers in minutes
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Main Form */}
          <div className="lg:col-span-2">
            <Card className="shadow-xl border-0 bg-white/95 backdrop-blur-sm">
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
                {/* Task Title */}
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <DocumentTextIcon className="w-5 h-5 text-blue-600" />
                    Task Title *
                  </label>
                  <Input
                    {...register('title', {
                      required: 'Title is required',
                      minLength: { value: 5, message: 'Title must be at least 5 characters' }
                    })}
                    placeholder="e.g. Fix air conditioner"
                    className="h-12 text-lg border-gray-200 focus:ring-2 focus:ring-blue-500"
                    error={errors.title?.message}
                  />
                  <p className="text-sm text-gray-500 flex items-center gap-1">
                    <LightBulbIcon className="w-4 h-4" />
                    Be specific to attract the right providers
                  </p>
                </div>

                {/* Description */}
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <DocumentTextIcon className="w-5 h-5 text-blue-600" />
                    Description *
                  </label>
                  <textarea
                    {...register('description', {
                      required: 'Description is required',
                      minLength: { value: 20, message: 'Description must be at least 20 characters' }
                    })}
                    rows={6}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-lg"
                    placeholder="Describe your task in detail. Include any specific requirements, materials needed, or special instructions..."
                  />
                  {errors.description && (
                    <p className="text-sm text-red-600 flex items-center gap-1">
                      <span>⚠️</span> {errors.description.message}
                    </p>
                  )}
                  <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
                    <p className="text-sm text-blue-700 flex items-center gap-2">
                      <LightBulbIcon className="w-4 h-4" />
                      <span className="font-medium">Pro tip:</span> Detailed descriptions get 50% more responses and better quality providers
                    </p>
                  </div>
                </div>

                {/* Task Images */}
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <PaperClipIcon className="w-5 h-5 text-blue-600" />
                    Task Images (max 3)
                  </label>
                  <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleTaskImageUpload}
                      disabled={isUploadingImages || imageUrls.length >= 3}
                      className="block w-full text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-white hover:file:bg-blue-700 disabled:cursor-not-allowed"
                    />
                    <p className="mt-2 text-xs text-gray-500">
                      Files are uploaded directly to Cloudinary and previewed before submit.
                    </p>
                  </div>
                  <p className="text-sm text-gray-500">{imageUrls.length}/3</p>
                  {isUploadingImages && (
                    <p className="text-sm text-blue-600">Uploading image(s)...</p>
                  )}
                  {imageUploadError && (
                    <p className="text-sm text-red-600">{imageUploadError}</p>
                  )}
                  {imageUrls.length > 0 && (
                    <div className="grid grid-cols-3 gap-3">
                      {imageUrls.map((url, index) => (
                        <div key={url + index} className="relative">
                          <img
                            src={url}
                            alt={`Task ${index + 1}`}
                            className="h-24 w-full rounded-lg object-cover border"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setImageUrls((prev) => prev.filter((_, i) => i !== index))
                            }
                            className="absolute top-2 right-2 bg-white/90 text-xs px-2 py-1 rounded shadow"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Two independent columns: the location column can grow (details, hints, map)
                    without stretching or pushing the Category / Deadline column. */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:items-start">
                  <div className="space-y-8">
                  {/* Category */}
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                      <TagIcon className="w-5 h-5 text-blue-600" />
                      Category *
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      {categories.map((cat) => (
                        <label
                          key={cat.value}
                          className={`
                            flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 group
                            ${watch('category') === cat.value
                              ? 'border-blue-500 bg-blue-50 shadow-md'
                              : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                            }
                          `}
                        >
                          <input
                            type="radio"
                            value={cat.value}
                            {...register('category', { required: 'Category is required' })}
                            className="sr-only"
                          />
                          <div className={`text-2xl group-hover:scale-110 transition-transform duration-200 ${
                            watch('category') === cat.value ? 'scale-110' : ''
                          }`}>
                            {cat.icon}
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-700">{cat.label}</p>
                            <p className="text-xs text-gray-500">{categoryCounts[cat.value] ?? 0} tasks</p>
                          </div>
                        </label>
                      ))}
                    </div>
                    {errors.category && (
                      <p className="text-sm text-red-600 flex items-center gap-1">
                        <span>⚠️</span> {errors.category.message}
                      </p>
                    )}
                  </div>

                  {/* Deadline */}
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                      <CalendarIcon className="w-5 h-5 text-blue-600" />
                      Deadline
                    </label>
                    <Input
                      type="datetime-local"
                      min={minDeadlineValue}
                      {...register('deadline', {
                        validate: (value) => {
                          if (!value) return true;
                          const selected = new Date(value);
                          if (Number.isNaN(selected.getTime())) return 'Invalid deadline';
                          return selected.getTime() >= Date.now() || 'Deadline cannot be in the past';
                        },
                      })}
                      className="h-12 text-lg border-gray-200 focus:ring-2 focus:ring-blue-500"
                      leftIcon={<CalendarIcon className="w-5 h-5 text-gray-400" />}
                    />
                    {errors.deadline && (
                      <p className="text-sm text-red-600 flex items-center gap-1">
                        <span>⚠️</span> {errors.deadline.message}
                      </p>
                    )}
                    <div className="bg-orange-50 rounded-lg p-3 border border-orange-100">
                      <p className="text-sm text-orange-700 flex items-center gap-2">
                        <ClockIcon className="w-4 h-4" />
                        <span className="font-medium">Urgent tasks get priority</span>
                      </p>
                    </div>
                  </div>
                  </div>

                  {/* Location: city, then ward, then the street address to verify */}
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                      <MapPinIcon className="w-5 h-5 text-blue-600" />
                      Task location *
                    </label>
                    <CityWardPicker
                      value={place}
                      required
                      error={placeError}
                      onChange={(next) => { setPlace(next); setPlaceError(''); }}
                    />
                    <Input
                      label="Street address (with house number) *"
                      placeholder="e.g. A35 Bach Dang"
                      {...register('streetName', {
                        required: 'Address is required',
                        minLength: { value: 3, message: 'Enter at least 3 characters' },
                      })}
                      className="h-12 text-lg border-gray-200"
                    />
                    {errors.streetName && <p className="text-sm text-red-600">{errors.streetName.message}</p>}
                    {/* Verification result. "Not on the map" is a hint, not an error. */}
                    <div className="flex min-h-5 items-start gap-2 text-sm" aria-live="polite">
                      {addressVerification.status === 'verifying' && <span className="mt-0.5 h-4 w-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />}
                      {addressVerification.status === 'verified' && <CheckCircleIcon className="h-5 w-5 text-green-600" />}
                      {addressVerification.status === 'error' && addressVerification.code !== 'ADDRESS_NOT_FOUND' && <span className="font-bold text-red-600">✕</span>}
                      {addressVerification.status === 'verifying' ? (
                        <span className="text-blue-600">Verifying address...</span>
                      ) : addressVerification.code === 'ADDRESS_NOT_FOUND' ? null : addressVerification.message ? (
                        <span className={addressVerification.status === 'verified' ? 'text-green-700' : 'text-red-600'}>
                          {addressVerification.message}
                        </span>
                      ) : null}
                    </div>
                    {addressVerification.code === 'ADDRESS_NOT_FOUND' && (
                      <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                        <span className="font-semibold">Not found on the map.</span>{' '}
                        Enter a nearby address within 100 m (e.g. the alley entrance) to verify, and put your exact address in Address details.
                      </div>
                    )}
                    {addressVerification.status === 'verified'
                      && Number.isFinite(addressVerification.latitude)
                      && Number.isFinite(addressVerification.longitude) && (
                      <TaskLocationPicker
                        readOnly
                        address={String(streetName || '')}
                        coordinates={{ latitude: addressVerification.latitude as number, longitude: addressVerification.longitude as number }}
                        searchRequest={0}
                        onCoordinatesChange={() => undefined}
                      />
                    )}

                    {/* Private address details (max 100 characters) */}
                    <div>
                      <div className="flex items-baseline justify-between gap-2">
                        <label htmlFor="address-detail" className="text-sm font-medium text-gray-700">
                          {isApproximateLocation ? 'Exact address *' : 'Address details (optional)'}
                        </label>
                        <span className={`text-xs ${addressDetail.length >= ADDRESS_DETAIL_MAX ? 'text-red-600' : 'text-gray-400'}`}>
                          {addressDetail.length}/{ADDRESS_DETAIL_MAX}
                        </span>
                      </div>
                      <textarea
                        id="address-detail"
                        rows={3}
                        maxLength={ADDRESS_DETAIL_MAX}
                        value={addressDetail}
                        onChange={(event) => { setAddressDetail(event.target.value); setAddressDetailError(''); }}
                        placeholder={isApproximateLocation ? 'e.g. 47/24/3 Bui Dinh Tuy, blue gate' : 'e.g. Apt 12.05, Block B, Floor 12'}
                        aria-invalid={Boolean(addressDetailError)}
                        aria-describedby="address-detail-help"
                        className={`mt-1 w-full resize-none rounded-xl border px-3 py-2.5 text-base placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 ${addressDetailError ? 'border-red-400' : 'border-gray-200'}`}
                      />
                      <p id="address-detail-help" className={`mt-1 text-xs ${addressDetailError ? 'text-red-600' : 'text-gray-500'}`}>
                        {addressDetailError || (isApproximateLocation
                          ? 'Your real address, if the map cannot find it. Only the provider you hire sees this, after the escrow is funded.'
                          : 'Apartment, floor or block, if any. Only the provider you hire sees this, after the escrow is funded.')}
                      </p>
                    </div>
                    {(hadNotFound || isApproximateLocation) && (
                      <label className="flex cursor-pointer items-start gap-3 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-5 w-5 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                          checked={isApproximateLocation}
                          onChange={(event) => { setIsApproximateLocation(event.target.checked); setApproxTouched(true); setAddressDetailError(''); }}
                        />
                        <span>The street address above is a nearby spot (within 100 m), not the exact place. Tasks posted this way show a &ldquo;Nearby address&rdquo; tag.</span>
                      </label>
                    )}
                    <div className="bg-green-50 rounded-lg p-3 border border-green-100">
                      <p className="text-sm text-green-700 flex items-center gap-2">
                        <UserGroupIcon className="w-4 h-4" />
                        <span className="font-medium">Local providers respond faster</span>
                      </p>
                    </div>
                  </div>
                </div>

                {/* AI Budget Suggestion */}
                <div className="bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 border-2 border-dashed border-blue-200 rounded-2xl p-8">
                  <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
                    <div className="flex items-center">
                      <div className="p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl mr-4 shadow-lg">
                        <SparklesIcon className="w-7 h-7 text-white" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-gray-900">AI Budget Suggestion</h3>
                        <p className="text-sm text-gray-600">Get AI budget guidance based on market data</p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      onClick={handleGetAiBudgetSuggestion}
                      disabled={isGettingAiBudgetSuggestion}
                      className="bg-white border-blue-200 text-blue-600 hover:bg-blue-50 shadow-lg px-6"
                    >
                      {isGettingAiBudgetSuggestion ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2" />
                          Analyzing...
                        </>
                      ) : (
                        <>
                          <SparklesIcon className="w-4 h-4 mr-2" />
                          Get AI Budget
                        </>
                      )}
                    </Button>
                  </div>

                  {aiBudgetSuggestion ? (
                    <div className="bg-white rounded-xl p-6 border-2 border-green-200 shadow-lg">
                      <div className="flex items-center justify-between flex-wrap gap-4">
                        <div>
                          <p className="text-sm text-gray-500 mb-2 flex items-center gap-1">
                            <SparklesIcon className="w-4 h-4" />
                            Suggested Budget
                          </p>
                          <p className="text-4xl font-bold text-green-600">
                            {aiBudgetSuggestion.suggestedBudget.toLocaleString('en-US')} VND
                          </p>
                          {aiBudgetSuggestion.suggestedMin != null && aiBudgetSuggestion.suggestedMax != null ? (
                            <p className="text-sm text-gray-700 mt-1">
                              Estimated Budget Range: {aiBudgetSuggestion.suggestedMin.toLocaleString('en-US')} - {aiBudgetSuggestion.suggestedMax.toLocaleString('en-US')} VND
                            </p>
                          ) : null}
                          <p className="text-sm text-gray-600 mt-2">
                            {aiBudgetSuggestion.explanation || 'Based on category, title details, and task scope.'}
                          </p>
                          {aiBudgetSuggestion.factorsUsed?.length ? (
                            <p className="text-xs text-gray-500 mt-2">
                              Factors: {aiBudgetSuggestion.factorsUsed.slice(0, 4).join(' · ')}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2 bg-green-50 px-4 py-2 rounded-lg">
                          <CheckCircleIcon className="w-6 h-6 text-green-500" />
                          <span className="text-green-700 font-semibold">Budget guidance ready</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-white/80 rounded-xl p-6 text-center border border-blue-100">
                      <SparklesIcon className="w-12 h-12 text-blue-400 mx-auto mb-3" />
                      <p className="text-gray-700 font-medium mb-2">Budget Guidance</p>
                      <p className="text-sm text-gray-600">
                        Get an AI-powered budget suggestion based on similar tasks in your area
                      </p>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                      <CurrencyDollarIcon className="w-5 h-5 text-blue-600" />
                      Set Budget (VND)
                    </label>
                    <Controller
                      name="budget"
                      control={control}
                      rules={{
                        required: 'Budget is required',
                        min: { value: 1, message: 'Budget must be greater than 0' },
                      }}
                      render={({ field }) => (
                        <Input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9,]*"
                          value={formatVndInput(field.value)}
                          onChange={(event) => field.onChange(parseVndInput(event.target.value))}
                          onBlur={field.onBlur}
                          placeholder="e.g., 500,000"
                          className="h-12 text-lg border-gray-200 focus:ring-2 focus:ring-blue-500"
                          leftIcon={<CurrencyDollarIcon className="w-5 h-5 text-gray-400" />}
                          error={errors.budget?.message}
                        />
                      )}
                    />
                    <p className="text-sm text-gray-500 flex items-center gap-1">
                      <ArrowRightIcon className="w-4 h-4" />
                      Enter your estimated budget in VND (e.g., 500,000)
                    </p>
                  </div>

                  <div className="space-y-3">
                    <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                      <UserGroupIcon className="w-5 h-5 text-blue-600" />
                      Maximum number of bids
                    </label>
                    <Input
                      type="number"
                      step="1"
                      {...register('maxBids', {
                        min: { value: 1, message: 'Bid limit must be at least 1' },
                        max: { value: 100, message: 'Bid limit cannot be more than 100' },
                      })}
                      placeholder="Default: 30"
                      className="h-12 text-lg border-gray-200 focus:ring-2 focus:ring-blue-500"
                      error={errors.maxBids?.message}
                    />
                    <p className="text-sm text-gray-500">
                      You can limit how many providers can bid on this task (maximum 100).
                    </p>
                  </div>
                </div>

                {/* Submit */}
                <div className="flex justify-between items-center pt-8 border-t border-gray-200">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => navigate(-1)}
                    className="border-gray-200 text-gray-600 hover:bg-gray-50 px-6"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={isSubmitting || addressVerification.status !== 'verified'}
                    className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-xl px-8 py-3 text-lg font-semibold min-w-[160px]"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-current mr-2" />
                        Posting...
                      </>
                    ) : (
                      <>
                        Post Task
                        <ArrowRightIcon className="w-5 h-5 ml-2" />
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </Card>
          </div>
          
          {/* Sidebar */}
          <div className="space-y-6">
            {/* Tips Card */}
            <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-100 shadow-lg">
              <div className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-blue-500 rounded-lg">
                    <LightBulbIcon className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-lg font-bold text-gray-900">Quick Tips</h3>
                </div>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-green-600 text-sm font-bold">✓</span>
                    </div>
                    <p className="text-sm text-gray-700">Be specific about requirements for better matches</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-green-600 text-sm font-bold">✓</span>
                    </div>
                    <p className="text-sm text-gray-700">Include photos when possible</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-green-600 text-sm font-bold">✓</span>
                    </div>
                    <p className="text-sm text-gray-700">Set realistic deadlines for quality work</p>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};
