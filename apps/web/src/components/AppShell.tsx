"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { NavigationHeader } from "@/components/NavigationHeader";
import { BackgroundCanvas } from "@/components/BackgroundCanvas";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLanding = pathname === "/" || pathname === "/landing";

  if (isLanding) {
    return <>{children}</>;
  }

  return (
    <>
      <BackgroundCanvas />
      <div className="relative z-10 flex flex-col min-h-screen pt-20">
        <NavigationHeader />
        <main className="flex-1 flex flex-col max-w-7xl w-full mx-auto px-3 sm:px-6 pb-8">
          {children}
        </main>
      </div>
    </>
  );
}
