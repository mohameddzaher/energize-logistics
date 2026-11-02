// Old URL kept alive and redirected to its new place.
// Form settings became a tab inside section settings, but the old link is bookmarked, and removing it would give a pointless 404.
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/system/shipment-orders/settings?tab=form');
}
