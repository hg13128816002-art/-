import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Synesthesia Canvas｜通感画布",
  description:
    "把颜色、形状与位置翻译成一段充满层次的电子音乐。画下声音，然后听见它。",
  keywords: ["通感", "音乐创作", "Web Audio", "Complextro", "互动艺术"],
  openGraph: {
    title: "Synesthesia Canvas｜通感画布",
    description: "画下声音，然后听见它。",
    type: "website",
    siteName: "Synesthesia Canvas",
  },
  twitter: {
    card: "summary",
    title: "Synesthesia Canvas｜通感画布",
    description: "把视觉作品变成可播放的电子音乐。",
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
