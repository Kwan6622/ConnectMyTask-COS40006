import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useAuthStore } from '../stores/auth.store';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { Card } from '../components/common/Card';
import { uploadImageToCloudinary } from '../utils/cloudinaryUpload';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import {
  EnvelopeIcon,
  PhoneIcon,
  MapPinIcon,
  StarIcon,
  ArrowRightOnRectangleIcon,
  PencilSquareIcon,
  CheckBadgeIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline';

interface ProfileFormData {
  fullName: string;
  email: string;
  phone?: string;
  location?: string;
  bio?: string;
  avatar?: string;
}

export const ProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const { user, logout, updateProfilePhoto } = useAuthStore();
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedPhotoFile, setSelectedPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoUploadError, setPhotoUploadError] = useState<string | null>(null);
  const [isSavingPhoto, setIsSavingPhoto] = useState(false);
  const [ratingSummary, setRatingSummary] = useState<{ averageRating: number; totalReviews: number } | null>(null);
  const [recentFeedback, setRecentFeedback] = useState<Array<{ id: string | number; comment?: string | null; fromUser?: { name?: string } }>>([]);

  const { register, handleSubmit, formState: { errors }, reset } = useForm<ProfileFormData>({
    defaultValues: {
      fullName: user?.fullName || '',
      email: user?.email || '',
      phone: user?.phone || '',
      location: user?.location || '',
      bio: '',
    },
  });

  const handleLogout = () => {
    logout();
    toast.success('Logged out successfully');
    navigate('/login');
  };

  const handlePhotoFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSelectedPhotoFile(file);
    setPhotoPreviewUrl(URL.createObjectURL(file));
    setPhotoUploadError(null);
  };

  const handleSavePhoto = async () => {
    if (!selectedPhotoFile) {
      toast.error('Please choose a profile image');
      return;
    }

    setIsSavingPhoto(true);
    setPhotoUploadError(null);
    try {
      // Upload to Cloudinary first, then save secure URL to backend profile.
      const secureUrl = await uploadImageToCloudinary(selectedPhotoFile);
      await updateProfilePhoto(secureUrl);
      setSelectedPhotoFile(null);
      setPhotoPreviewUrl(null);
      toast.success('Profile photo updated');
    } catch (error: any) {
      const message = error?.message || 'Failed to update profile photo';
      setPhotoUploadError(message);
      toast.error(message);
    } finally {
      setIsSavingPhoto(false);
    }
  };

  useEffect(() => {
    return () => {
      if (photoPreviewUrl) {
        URL.revokeObjectURL(photoPreviewUrl);
      }
    };
  }, [photoPreviewUrl]);

  useEffect(() => {
    if (!user?.id) return;
    api.ratings
      .getUserRatings(user.id)
      .then((response) => {
        const payload = response.data || {};
        setRatingSummary({
          averageRating: Number(payload.averageRating || 0),
          totalReviews: Number(payload.totalReviews || 0),
        });
        setRecentFeedback((payload.ratings || []).filter((item: any) => item.comment).slice(0, 5));
      })
      .catch(() => {
        setRatingSummary(null);
        setRecentFeedback([]);
      });
  }, [user?.id]);

  const onSubmit = async (_data: ProfileFormData) => {
    setIsLoading(true);
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      toast.success('Profile updated successfully');
      setIsEditing(false);
      reset();
    } catch (error: any) {
      toast.error(error.message || 'Failed to update profile');
    } finally {
      setIsLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card className="text-center py-16">
          <div className="text-6xl mb-4">🔐</div>
          <h2 className="text-2xl font-bold text-dark-900 mb-2">Please log in</h2>
          <p className="text-dark-600 mb-6">You need to be logged in to view your profile.</p>
          <Button onClick={() => navigate('/login')}>Log In</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dark-50 py-8">
      <div className="container mx-auto px-4 max-w-5xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-dark-900">My Profile</h1>
          <p className="text-dark-600 mt-1">Manage your account and preferences</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Sidebar */}
          <div className="space-y-6">
            {/* Profile Card */}
            <Card className="text-center">
              <div className="relative inline-block mb-4">
                {photoPreviewUrl ? (
                  <img
                    src={photoPreviewUrl}
                    alt="Profile preview"
                    className="w-24 h-24 mx-auto rounded-2xl object-cover shadow-xl"
                  />
                ) : user.profilePhotoUrl ? (
                  <img
                    src={user.profilePhotoUrl}
                    alt={user.fullName}
                    className="w-24 h-24 mx-auto rounded-2xl object-cover shadow-xl"
                  />
                ) : (
                  <div className="w-24 h-24 mx-auto bg-gradient-to-br from-primary-500 to-accent-600 rounded-2xl flex items-center justify-center text-white text-4xl font-bold shadow-xl">
                    {user.fullName?.charAt(0).toUpperCase()}
                  </div>
                )}
                {user.isVerified && (
                  <div className="absolute -bottom-1 -right-1 bg-success-500 rounded-full p-1.5 shadow-lg">
                    <CheckBadgeIcon className="w-5 h-5 text-white" />
                  </div>
                )}
              </div>
              <div className="text-left mt-4 space-y-3">
                <label className="text-xs font-semibold text-dark-500">Profile Photo</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoFileChange}
                  className="w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-white hover:file:bg-blue-700"
                />
                <Button
                  onClick={handleSavePhoto}
                  disabled={isSavingPhoto || !selectedPhotoFile}
                  className="w-full"
                >
                  {isSavingPhoto ? 'Uploading...' : 'Upload Profile Photo'}
                </Button>
                {photoUploadError && (
                  <p className="text-xs text-red-600">{photoUploadError}</p>
                )}
                <p className="text-xs text-dark-400">
                  Select an image to preview it, then upload.
                </p>
              </div>
              <h2 className="text-xl font-bold text-dark-900 mb-1">{user.fullName}</h2>
              <p className="text-sm text-dark-600 mb-4">
                {user.role === 'CLIENT' ? 'Task Poster' : 'Service Provider'}
              </p>
              {(ratingSummary?.totalReviews || 0) > 0 && (
                <div className="flex items-center justify-center gap-2 mb-4">
                  <div className="flex items-center">
                    {[...Array(5)].map((_, i) => (
                      <StarIcon
                        key={i}
                        className={`w-5 h-5 ${
                          i < Math.floor(ratingSummary?.averageRating || 0)
                            ? 'fill-yellow-400 text-yellow-400'
                            : 'text-dark-300'
                        }`}
                      />
                    ))}
                  </div>
                  <span className="text-dark-600 font-medium">
                    {(ratingSummary?.averageRating || 0).toFixed(1)} ({ratingSummary?.totalReviews || 0} reviews)
                  </span>
                </div>
              )}

              <div className="grid grid-cols-3 gap-4 pt-4 border-t border-dark-100">
                <div className="text-center">
                  <p className="text-2xl font-bold text-primary-600">{user.completedTasks || 0}</p>
                  <p className="text-xs text-dark-500">Tasks</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-success-600">98%</p>
                  <p className="text-xs text-dark-500">Success</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-accent-600">{ratingSummary?.totalReviews || 0}</p>
                  <p className="text-xs text-dark-500">Reviews</p>
                </div>
              </div>
            </Card>

            {(recentFeedback.length > 0) && (
              <Card>
                <h3 className="text-sm font-semibold text-dark-700 mb-3">Recent Feedback</h3>
                <div className="space-y-3">
                  {recentFeedback.map((item) => (
                    <div key={String(item.id)} className="rounded-lg border border-dark-100 bg-dark-50 p-3">
                      <p className="text-sm text-dark-700">"{item.comment}"</p>
                      <p className="text-xs text-dark-500 mt-1">- {item.fromUser?.name || 'User'}</p>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Contact Info */}
            <Card>
              <div className="space-y-4">
                <div className="flex items-center gap-3 text-dark-600">
                  <div className="p-2 bg-primary-50 rounded-lg">
                    <EnvelopeIcon className="w-5 h-5 text-primary-600" />
                  </div>
                  <span className="text-sm break-all">{user.email}</span>
                </div>
                {user.phone && (
                  <div className="flex items-center gap-3 text-dark-600">
                    <div className="p-2 bg-success-50 rounded-lg">
                      <PhoneIcon className="w-5 h-5 text-success-600" />
                    </div>
                    <span className="text-sm">{user.phone}</span>
                  </div>
                )}
                {user.location && (
                  <div className="flex items-center gap-3 text-dark-600">
                    <div className="p-2 bg-accent-50 rounded-lg">
                      <MapPinIcon className="w-5 h-5 text-accent-600" />
                    </div>
                    <span className="text-sm">{user.location}</span>
                  </div>
                )}
              </div>
            </Card>

            {/* Actions */}
            <Card className="space-y-3">
              <Button
                onClick={handleLogout}
                variant="outline"
                className="w-full text-danger-600 border-danger-200 hover:bg-danger-50"
              >
                <ArrowRightOnRectangleIcon className="w-5 h-5 mr-2" />
                Logout
              </Button>
            </Card>
          </div>

          {/* Main Content */}
          <div className="md:col-span-2">
            <Card>
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary-100 rounded-lg">
                    <UserCircleIcon className="w-6 h-6 text-primary-600" />
                  </div>
                  <h2 className="text-xl font-bold text-dark-900">Profile Information</h2>
                </div>
                {!isEditing && (
                  <Button
                    variant="outline"
                    onClick={() => setIsEditing(true)}
                  >
                    <PencilSquareIcon className="w-5 h-5 mr-2" />
                    Edit
                  </Button>
                )}
              </div>

              {isEditing ? (
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                  <Input
                    {...register('fullName', {
                      required: 'Full name is required',
                    })}
                    label="Full Name"
                    leftIcon={<UserCircleIcon className="w-5 h-5" />}
                    error={errors.fullName?.message}
                  />

                  <Input
                    {...register('email', {
                      required: 'Email is required',
                    })}
                    type="email"
                    label="Email"
                    leftIcon={<EnvelopeIcon className="w-5 h-5" />}
                    disabled
                    error={errors.email?.message}
                  />

                  <Input
                    {...register('phone')}
                    label="Phone Number"
                    leftIcon={<PhoneIcon className="w-5 h-5" />}
                    placeholder="+1 234 567 8900"
                    error={errors.phone?.message}
                  />

                  <Input
                    {...register('location')}
                    label="Location"
                    leftIcon={<MapPinIcon className="w-5 h-5" />}
                    placeholder="City, Country"
                    error={errors.location?.message}
                  />

                  <div>
                    <label className="block text-sm font-medium text-dark-700 mb-2">
                      Bio
                    </label>
                    <textarea
                      {...register('bio')}
                      rows={4}
                      className="input-field resize-none"
                      placeholder="Tell us about yourself..."
                    />
                  </div>

                  <div className="flex gap-4 pt-6 border-t border-dark-100">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setIsEditing(false);
                        reset();
                      }}
                      className="flex-1"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={isLoading}
                      className="flex-1"
                    >
                      {isLoading ? 'Saving...' : 'Save Changes'}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="space-y-6">
                  <div className="flex items-center gap-3 p-4 bg-dark-50 rounded-xl">
                    <div className="p-2 bg-primary-100 rounded-lg">
                      <UserCircleIcon className="w-5 h-5 text-primary-600" />
                    </div>
                    <div>
                      <p className="text-sm text-dark-500">Full Name</p>
                      <p className="font-semibold text-dark-900">{user.fullName}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 p-4 bg-dark-50 rounded-xl">
                    <div className="p-2 bg-success-100 rounded-lg">
                      <EnvelopeIcon className="w-5 h-5 text-success-600" />
                    </div>
                    <div>
                      <p className="text-sm text-dark-500">Email</p>
                      <p className="font-semibold text-dark-900">{user.email}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 p-4 bg-dark-50 rounded-xl">
                    <div className="p-2 bg-accent-100 rounded-lg">
                      <PhoneIcon className="w-5 h-5 text-accent-600" />
                    </div>
                    <div>
                      <p className="text-sm text-dark-500">Phone</p>
                      <p className="font-semibold text-dark-900">{user.phone || '-'}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 p-4 bg-dark-50 rounded-xl">
                    <div className="p-2 bg-yellow-100 rounded-lg">
                      <MapPinIcon className="w-5 h-5 text-yellow-600" />
                    </div>
                    <div>
                      <p className="text-sm text-dark-500">Location</p>
                      <p className="font-semibold text-dark-900">{user.location || '-'}</p>
                    </div>
                  </div>

                  <div className="p-4 bg-dark-50 rounded-xl">
                    <p className="text-sm text-dark-500 mb-2">Bio</p>
                    <p className="font-semibold text-dark-900">
                      No bio added yet. Click Edit to add a bio.
                    </p>
                  </div>
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};
