'use client';
// Cash invoices; the same page serves tax invoices, with another type.
import CollectionsInvoicesPage from '@/components/collections/InvoicesPage';
export default function Page() { return <CollectionsInvoicesPage kind="cash" />; }
