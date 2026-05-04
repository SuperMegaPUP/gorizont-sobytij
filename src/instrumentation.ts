export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    process.on('unhandledRejection', (reason, promise) => {
      console.error('🚨 UNHANDLED REJECTION:', reason);
    });

    process.on('uncaughtException', (error) => {
      console.error('🚨 UNCAUGHT EXCEPTION:', error);
    });
  }
}