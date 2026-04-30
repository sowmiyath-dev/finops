import "./globals.css";
import Providers from "./providers";

export const metadata = { title: "Finoptix — Multi-Cloud FinOps Platform", description: "Centralized cloud cost management for AWS, Azure and GCP" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
