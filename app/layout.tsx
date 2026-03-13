import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vantalos Operator Dashboard",
  description: "Operator dashboard for Vantalos Recruiter",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

