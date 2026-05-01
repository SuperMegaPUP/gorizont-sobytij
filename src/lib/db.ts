import { PrismaClient } from '@prisma/client';

// Singleton pattern для Next.js (предотвращает множественные подключения в dev)
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const isNeon = process.env.DATABASE_URL?.includes('.neon.tech');
const isProduction = process.env.NODE_ENV === 'production';

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    // Neon/Serverless оптимизации
    ...(isNeon && {
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    }),
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Wrapper с retry логикой для критичных операций
export async function prismaQuery<T>(fn: () => Promise<T>): Promise<T> {
  if (isNeon) {
    return withRetry(fn, 3, 1000);
  }
  return fn();
}

// Health check для БД
export async function checkDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    console.error('Database check failed:', error);
    return false;
  }
}

export default prisma;