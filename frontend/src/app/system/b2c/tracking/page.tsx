'use client';
/** Media Go / light-transport vehicle tracking: live map, routes and distances from the Express GPS units. */
import { Navigation } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { PageHeader } from '@/components/hr/HRKit';
import TrackingScreen from '@/components/tracking/TrackingScreen';

export default function B2cTrackingPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  return (
    <div className="space-y-4">
      <PageHeader icon={<Navigation className="w-6 h-6" />} title={ar ? 'متابعة مركبات Media Go' : 'Media Go Vehicle Tracking'}
        subtitle={ar ? 'المواقع المباشرة، وخط السير لأي فترة، والمسافات والتوقّفات والسرعات' : 'Live positions, routes for any period, distances, stops and speeds'} />
      <TrackingScreen base="/api/b2c/tracking" ar={ar} />
    </div>
  );
}
