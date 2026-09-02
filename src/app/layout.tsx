import type { Metadata } from "next";
import { Montserrat } from "next/font/google";

import ThemeRegistry from "@/theme/ThemeRegistry";
import { BRANDING_TAGLINE } from "@/lib/branding";
import { getBranding } from "@/lib/brandingServer";

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getBranding();
  return { title: branding.displayName, description: BRANDING_TAGLINE };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={montserrat.variable}>
      <body>
        <ThemeRegistry>{children}</ThemeRegistry>
      </body>
    </html>
  );
}
