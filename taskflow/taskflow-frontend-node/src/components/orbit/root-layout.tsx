import { useEffect } from 'react';
import { Outlet } from 'react-router';
import { bootstrapSession } from '@/lib/session';
import { Starfield } from './starfield';
import { Toaster } from './toaster';

export function RootLayout() {
  useEffect(() => {
    void bootstrapSession();
  }, []);
  return (
    <>
      <Starfield />
      <Outlet />
      <Toaster />
    </>
  );
}
