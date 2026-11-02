'use client';
// General screen for all reference lists. Its body is a separate component because section settings render the same component limited to their own lists, and a Next route cannot take custom props; keeping it here would mean a second diverging copy.
import ReferenceDataManager from '@/components/system/ReferenceDataManager';

export default function Page() {
  return <ReferenceDataManager />;
}
