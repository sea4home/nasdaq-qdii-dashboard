import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '纳斯达克 QDII 基金看板',
  description: '纳斯达克 QDII 基金的场内溢价、场外限购、费率与业绩数据看板。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN"><body>{children}</body></html>
  );
}
