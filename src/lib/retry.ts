export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const isConnectionError =
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.code === '57P01' ||
        error.code === 'P1001' ||
        error.code === 'P1002' ||
        error.message?.includes('Connection refused') ||
        error.message?.includes('Connection reset') ||
        error.message?.includes('timeout');

      if (!isConnectionError || attempt === maxRetries) throw error;
      const delay = baseDelayMs * attempt;
      console.warn(`⚠️ Retry ${attempt}/${maxRetries} after ${delay}ms: ${error.code || error.message}`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}