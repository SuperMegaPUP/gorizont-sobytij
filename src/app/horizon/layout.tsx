import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ГОРИЗОНТ СОБЫТИЙ',
  description: 'Система обнаружения манипуляций на MOEX — v4.3',
};

export default function HorizonLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-950">
      {children}
    </div>
  );
}